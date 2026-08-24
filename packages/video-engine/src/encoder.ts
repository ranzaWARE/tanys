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

// Stessi profili gia' validati (in ordine di preferenza) nel prototipo reframe360.html.
const VIDEO_CODEC_CANDIDATES = ["avc1.640028", "avc1.4d0028", "avc1.42e01e"];
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
 * Loop di export deterministico e non-realtime: per ogni frame di output si
 * fa seek della sorgente, si compone su canvas e si passa il risultato a
 * VideoEncoder; l'audio viene tagliato separatamente da un AudioBuffer
 * decodificato una volta sola. A differenza della cattura realtime del
 * prototipo 360 (necessaria li' per tenere sincroni due <video> indipendenti),
 * qui non c'e' alcun vincolo di tempo reale.
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

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => console.error("[video-engine] errore encoder video", e),
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

  // ---- video: seek -> render -> VideoFrame, un frame alla volta ----
  const frameDurationUs = 1_000_000 / fps;
  const totalFrames = Math.max(1, Math.round(durationSec * fps));
  compositor.setSize(width, height);

  for (let i = 0; i < totalFrames; i++) {
    const t = inSec + i / fps;
    await source.seekTo(t);
    compositor.renderFrame();

    const timestamp = Math.round(i * frameDurationUs);
    const frame = new VideoFrame(compositor.canvas, {
      timestamp,
      duration: Math.round(frameDurationUs),
    });
    videoEncoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();

    if (videoEncoder.encodeQueueSize > 8) {
      await new Promise((r) => setTimeout(r, 0));
    }
    onProgress?.({ phase: "video", ratio: (i + 1) / totalFrames });
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
