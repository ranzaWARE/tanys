import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import type { Compositor } from "./compositor";
import type { ClipSource } from "./source";

export interface ExportProgress {
  phase: "video" | "audio" | "mux";
  ratio: number;
}

export interface ExportOptions {
  width: number;
  height: number;
  fps: number;
  file: File;
  inSec: number;
  outSec: number;
  onProgress?: (p: ExportProgress) => void;
}

// Profili H.264 in ordine di preferenza. I livelli 4.0/4.2 del prototipo
// reframe360.html (pensato per un singolo stitch, non per sorgenti generiche)
// non bastano per risoluzioni tipiche di action cam/drone (es. 2720x1530 di
// un DJI: ~4.16 Mpx, sopra il limite di ~2.1 Mpx del Level 4.0) — servono
// anche i livelli 5.0/5.1 (fino a ~5.6 Mpx) prima di scendere ai fallback.
const VIDEO_CODEC_CANDIDATES = [
  "avc1.640033", // High, Level 5.1
  "avc1.640032", // High, Level 5.0
  "avc1.64002a", // High, Level 4.2
  "avc1.640028", // High, Level 4.0
  "avc1.4d0033", // Main, Level 5.1
  "avc1.4d0028", // Main, Level 4.0
  "avc1.42e01e", // Baseline, Level 3.0 (ultima spiaggia, solo bassa risoluzione)
];
const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_CHUNK_FRAMES = 1024;

async function pickVideoCodec(width: number, height: number, fps: number): Promise<string | null> {
  for (const codec of VIDEO_CODEC_CANDIDATES) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate: 12_000_000,
        framerate: fps,
      });
      if (support.supported) return codec;
    } catch {
      // prova il profilo successivo
    }
  }
  return null;
}

// Tipo locale (non una dichiarazione globale) per requestVideoFrameCallback:
// evita sia di dipendere dal fatto che lib.dom.d.ts lo includa o meno, sia
// il rischio di un conflitto "duplicate identifier" se invece lo includesse
// gia'. E' un'API Chromium-only, ma qui va bene: WebCodecs lo e' comunque.
interface VideoFrameCallbackMetadata {
  mediaTime: number;
}
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback(cb: (now: number, metadata: VideoFrameCallbackMetadata) => void): number;
};

/**
 * Cattura i frame in riproduzione in tempo reale (via requestVideoFrameCallback)
 * invece di fare un seek per ogni frame: un seek preciso ha un costo reale (il
 * browser deve riposizionarsi sul keyframe piu' vicino e decodificare in
 * avanti), farlo 30 volte al secondo e' molto piu' lento della riproduzione
 * continua che il decoder gestisce comunque in modo efficiente. Adeguato per
 * l'unico caso che esiste ora (una clip sola, trim in/out) — quando la
 * timeline avra' piu' clip/tagli da comporre in un ordine non riproducibile
 * linearmente, questa funzione andra' rivista.
 */
async function encodeVideoRealtime(
  compositor: Compositor,
  source: ClipSource,
  videoEncoder: VideoEncoder,
  inSec: number,
  outSec: number,
  fps: number,
  isAborted: () => boolean,
  onProgress?: (ratio: number) => void
): Promise<void> {
  const video = source.video as VideoWithFrameCallback;
  const durationSec = outSec - inSec;
  await source.seekTo(inSec);

  let frameIndex = 0;
  let settled = false;
  // Timestamp dell'ultimo frame accettato: mai mandare all'encoder un
  // timestamp <= a questo, qualunque cosa riporti mediaTime. Protegge da
  // interferenze esterne sullo stesso <video> (play/seek/trim toccati
  // mentre l'export e' in corso) che altrimenti manderebbero il muxer in un
  // loop infinito di errori "timestamps must be monotonically increasing"
  // invece di limitarsi a corrompere l'export in corso.
  let lastAcceptedT = -Infinity;

  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      if (settled) return;
      settled = true;
      video.pause();
      resolve();
    };

    const onFrame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      if (settled) return;
      if (isAborted()) {
        finish();
        return;
      }
      const t = metadata.mediaTime - inSec;
      if (t >= durationSec) {
        finish();
        return;
      }
      if (t <= lastAcceptedT) {
        video.requestVideoFrameCallback(onFrame);
        return;
      }
      lastAcceptedT = t;
      compositor.renderFrame();
      const frame = new VideoFrame(compositor.canvas, {
        timestamp: Math.round(t * 1_000_000),
      });
      videoEncoder.encode(frame, { keyFrame: frameIndex % (fps * 2) === 0 });
      frame.close();
      frameIndex++;
      onProgress?.(Math.min(1, Math.max(0, t) / durationSec));
      video.requestVideoFrameCallback(onFrame);
    };

    video.addEventListener("ended", finish, { once: true });
    video.requestVideoFrameCallback(onFrame);
    video.play().catch(reject);
  });
}

async function decodeAudio(file: File, sampleRate: number): Promise<AudioBuffer | null> {
  if (typeof AudioContext === "undefined") return null;
  try {
    const ctx = new AudioContext({ sampleRate });
    const raw = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(raw);
    await ctx.close();
    return audioBuffer;
  } catch {
    // il file potrebbe non avere una traccia audio, o il browser non riesce a decodificarla
    return null;
  }
}

/**
 * Video catturato in riproduzione in tempo reale (vedi encodeVideoRealtime),
 * audio tagliato separatamente da un AudioBuffer decodificato una volta sola
 * (quello invece resta indipendente dal tempo reale, non ha bisogno di esserlo).
 */
export async function exportClip(
  compositor: Compositor,
  source: ClipSource,
  opts: ExportOptions
): Promise<Blob> {
  if (typeof VideoEncoder === "undefined") {
    throw new Error("Questo browser non supporta WebCodecs (VideoEncoder): impossibile esportare.");
  }

  const { width, height, fps, file, inSec, outSec, onProgress } = opts;
  const durationSec = outSec - inSec;
  if (durationSec <= 0) {
    throw new Error("Intervallo di trim non valido.");
  }

  const videoCodec = await pickVideoCodec(width, height, fps);
  if (!videoCodec) {
    throw new Error("Nessun codec video hardware supportato da questo browser per questa risoluzione.");
  }

  const audioBuffer = await decodeAudio(file, AUDIO_SAMPLE_RATE);
  const numberOfChannels = audioBuffer?.numberOfChannels ?? 0;

  let audioCodec: "mp4a.40.2" | null = null;
  if (audioBuffer && typeof AudioEncoder !== "undefined") {
    try {
      const support = await AudioEncoder.isConfigSupported({
        codec: "mp4a.40.2",
        sampleRate: AUDIO_SAMPLE_RATE,
        numberOfChannels,
        bitrate: 160_000,
      });
      if (support.supported) audioCodec = "mp4a.40.2";
    } catch {
      // si esporta senza audio
    }
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width, height },
    audio: audioCodec ? { codec: "aac", numberOfChannels, sampleRate: AUDIO_SAMPLE_RATE } : undefined,
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });

  let videoFailed = false;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (videoFailed) return;
      try {
        muxer.addVideoChunk(chunk, meta);
      } catch (e) {
        // Un solo errore del muxer (es. timestamp fuori sequenza per
        // interferenza esterna sul <video> durante l'export) ferma la
        // cattura invece di continuare a mandare frame a un encoder ormai
        // rotto, che altrimenti fallirebbe su ogni chunk successivo.
        videoFailed = true;
        console.error("[video-engine] errore muxer video, export interrotto", e);
      }
    },
    error: (e) => {
      videoFailed = true;
      console.error("[video-engine] errore encoder video", e);
    },
  });
  videoEncoder.configure({ codec: videoCodec, width, height, bitrate: 12_000_000, framerate: fps });

  let audioEncoder: AudioEncoder | null = null;
  if (audioCodec) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => console.error("[video-engine] errore encoder audio", e),
    });
    audioEncoder.configure({
      codec: audioCodec,
      sampleRate: AUDIO_SAMPLE_RATE,
      numberOfChannels,
      bitrate: 160_000,
    });
  }

  // ---- video: cattura in tempo reale, non piu' seek-per-frame ----
  compositor.setSize(width, height);
  await encodeVideoRealtime(
    compositor,
    source,
    videoEncoder,
    inSec,
    outSec,
    fps,
    () => videoFailed,
    (ratio) => onProgress?.({ phase: "video", ratio })
  );
  if (videoFailed) {
    videoEncoder.close();
    throw new Error(
      "Export interrotto: qualcosa ha interferito con la riproduzione durante la cattura (es. play/seek/trim toccati mentre esportava). Riprova senza toccare i controlli finché l'export non è finito."
    );
  }
  await videoEncoder.flush();
  videoEncoder.close();

  // ---- audio: taglio deterministico dall'AudioBuffer gia' decodificato ----
  if (audioEncoder && audioBuffer) {
    const startSample = Math.floor(inSec * AUDIO_SAMPLE_RATE);
    const endSample = Math.min(audioBuffer.length, Math.floor(outSec * AUDIO_SAMPLE_RATE));
    const channelData: Float32Array[] = [];
    for (let ch = 0; ch < numberOfChannels; ch++) channelData.push(audioBuffer.getChannelData(ch));

    const totalSamples = Math.max(0, endSample - startSample);
    const totalChunks = Math.ceil(totalSamples / AUDIO_CHUNK_FRAMES) || 0;

    for (let c = 0; c < totalChunks; c++) {
      const offset = startSample + c * AUDIO_CHUNK_FRAMES;
      const frames = Math.min(AUDIO_CHUNK_FRAMES, endSample - offset);
      if (frames <= 0) break;

      const planar = new Float32Array(frames * numberOfChannels);
      for (let ch = 0; ch < numberOfChannels; ch++) {
        planar.set(channelData[ch].subarray(offset, offset + frames), ch * frames);
      }

      const audioData = new AudioData({
        format: "f32-planar",
        sampleRate: AUDIO_SAMPLE_RATE,
        numberOfFrames: frames,
        numberOfChannels,
        timestamp: Math.round(((offset - startSample) / AUDIO_SAMPLE_RATE) * 1_000_000),
        data: planar,
      });
      audioEncoder.encode(audioData);
      audioData.close();
      onProgress?.({ phase: "audio", ratio: (c + 1) / totalChunks });
    }
    await audioEncoder.flush();
    audioEncoder.close();
  }

  onProgress?.({ phase: "mux", ratio: 1 });
  muxer.finalize();
  return new Blob([target.buffer], { type: "video/mp4" });
}
