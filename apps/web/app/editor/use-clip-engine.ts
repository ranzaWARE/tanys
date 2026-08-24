"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  ClipSource,
  Compositor,
  detectCapabilities,
  exportClip,
  type EngineCapabilities,
  type Layer,
} from "@tanys/video-engine";
import type { Clip, MediaAsset, Project, VideoClip } from "@/lib/store/project-store";

export interface ExportState {
  status: "idle" | "running" | "done" | "error";
  progress: number;
  message: string;
  url?: string;
}

const IDLE_EXPORT: ExportState = { status: "idle", progress: 0, message: "" };

// Valore neutro identico a quello che detectCapabilities() produce quando
// window/document non esistono (rendering server-side di Next.js). Se lo
// stato iniziale del client fosse gia' il risultato vero, il badge GPU
// cambierebbe testo fra HTML server e primo render client (hydration
// mismatch, errore React #418).
const SSR_SAFE_CAPABILITIES: EngineCapabilities = {
  webCodecs: false,
  webgl2: false,
  gpuRenderer: null,
  hardwareAccelerated: false,
};

function projectDuration(project: Project): number {
  let max = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.trackEnd > max) max = clip.trackEnd;
    }
  }
  return max;
}

function activeClipOnTrack(clips: Clip[], t: number): Clip | undefined {
  return clips.find((c) => t >= c.trackStart && t < c.trackEnd);
}

/**
 * Pilota preview ed export sopra il modello multitraccia: una ClipSource per
 * clip video presente nel progetto (create/distrutte solo quando la clip
 * compare/scompare, non ad ogni modifica di trim), un orologio manuale per
 * l'avanzamento della riproduzione (piu' robusto di leggere currentTime da
 * un singolo <video> quando le clip attive possono essere multiple o
 * assenti), e un compositor multi-layer condiviso fra preview ed export.
 *
 * L'export, per ora, considera solo la prima clip video del progetto —
 * l'export multitraccia arriva in un passaggio successivo della Fase 2.
 */
export function useClipEngine(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  project: Project,
  media: Record<string, MediaAsset>
) {
  const compositorRef = useRef<Compositor | null>(null);
  const sourcesRef = useRef<Map<string, ClipSource>>(new Map());
  const activeClipIdsRef = useRef<Set<string>>(new Set());
  const lastTickRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [capabilities, setCapabilities] = useState<EngineCapabilities>(SSR_SAFE_CAPABILITIES);
  const [exportState, setExportState] = useState<ExportState>(IDLE_EXPORT);

  useEffect(() => {
    setCapabilities(detectCapabilities());
  }, []);

  // Un Compositor per tutta la vita del canvas.
  useEffect(() => {
    if (!canvasRef.current) return;
    const compositor = new Compositor(canvasRef.current);
    compositorRef.current = compositor;
    compositor.setSize(project.width, project.height);
    return () => {
      compositor.dispose();
      compositorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    compositorRef.current?.setSize(project.width, project.height);
  }, [project.width, project.height]);

  // Riconcilia le ClipSource con le clip video presenti nel progetto.
  useEffect(() => {
    const wantedIds = new Set<string>();
    for (const track of project.tracks) {
      if (track.kind !== "video") continue;
      for (const clip of track.clips) wantedIds.add(clip.id);
    }
    const sources = sourcesRef.current;
    for (const [id, source] of sources) {
      if (!wantedIds.has(id)) {
        source.dispose();
        sources.delete(id);
      }
    }
    for (const track of project.tracks) {
      if (track.kind !== "video") continue;
      for (const clip of track.clips as VideoClip[]) {
        if (sources.has(clip.id)) continue;
        const asset = media[clip.mediaId];
        if (!asset) continue;
        sources.set(clip.id, new ClipSource(asset.file));
      }
    }
    setReady(sources.size > 0);
  }, [project, media]);

  const buildLayers = (t: number): Layer[] => {
    const layers: Layer[] = [];
    for (const track of project.tracks) {
      const clip = activeClipOnTrack(track.clips, t);
      if (!clip) continue;
      if (clip.kind === "video") {
        const source = sourcesRef.current.get(clip.id);
        if (source) layers.push({ id: clip.id, kind: "video", video: source.video, opacity: clip.opacity });
      } else {
        layers.push({
          id: clip.id,
          kind: "text",
          text: clip.text,
          color: clip.color,
          fontSize: clip.fontSize,
          opacity: clip.opacity,
        });
      }
    }
    return layers;
  };

  const syncActiveVideos = async (t: number, autoplay: boolean) => {
    const nextActive = new Set<string>();
    const seeks: Promise<void>[] = [];
    for (const track of project.tracks) {
      if (track.kind !== "video") continue;
      const clip = activeClipOnTrack(track.clips, t) as VideoClip | undefined;
      if (!clip) continue;
      const source = sourcesRef.current.get(clip.id);
      if (!source) continue;
      nextActive.add(clip.id);
      if (!activeClipIdsRef.current.has(clip.id)) {
        seeks.push(source.seekTo(clip.sourceIn + (t - clip.trackStart)));
      }
    }
    await Promise.all(seeks);
    for (const id of nextActive) {
      if (!activeClipIdsRef.current.has(id) && autoplay) {
        sourcesRef.current.get(id)?.video.play().catch(() => {});
      }
    }
    for (const id of activeClipIdsRef.current) {
      if (!nextActive.has(id)) sourcesRef.current.get(id)?.video.pause();
    }
    activeClipIdsRef.current = nextActive;
  };

  const renderAt = (t: number) => {
    const compositor = compositorRef.current;
    if (!compositor) return;
    compositor.setLayers(buildLayers(t));
    compositor.renderFrame();
  };

  // Loop di riproduzione: orologio manuale (wall clock), non legato alla
  // posizione di un singolo <video> — piu' robusto quando le clip video
  // attive possono essere multiple, o assenti (tratti solo testo/vuoti).
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    lastTickRef.current = performance.now();
    const tick = () => {
      const now = performance.now();
      const delta = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      setCurrentTime((prev) => {
        const duration = projectDuration(project);
        const next = Math.min(prev + delta, duration);
        if (next >= duration) {
          setPlaying(false);
        } else {
          void syncActiveVideos(next, true);
        }
        renderAt(next);
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, project]);

  // Ridisegna quando cambia il progetto ma non si sta riproducendo (dopo un
  // trim, uno spostamento clip, o l'aggiunta/modifica di un layer di testo).
  useEffect(() => {
    if (!playing) renderAt(currentTime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  const play = () => {
    if (projectDuration(project) <= 0) return;
    void syncActiveVideos(currentTime, true);
    setPlaying(true);
  };

  const pause = () => {
    setPlaying(false);
    for (const source of sourcesRef.current.values()) source.video.pause();
  };

  const seek = async (t: number) => {
    const duration = projectDuration(project);
    const clamped = Math.min(Math.max(t, 0), duration);
    await syncActiveVideos(clamped, playing);
    setCurrentTime(clamped);
    renderAt(clamped);
  };

  const runExport = async (fps: number) => {
    const compositor = compositorRef.current;
    if (!compositor) return;
    const firstVideoClip = project.tracks.find((t) => t.kind === "video")?.clips[0] as VideoClip | undefined;
    if (!firstVideoClip) return;
    const asset = media[firstVideoClip.mediaId];
    const source = sourcesRef.current.get(firstVideoClip.id);
    if (!asset || !source) return;

    pause();
    setExportState({ status: "running", progress: 0, message: "Preparazione…" });
    try {
      compositor.setSize(project.width, project.height);
      compositor.setLayers([{ id: firstVideoClip.id, kind: "video", video: source.video, opacity: 1 }]);
      const blob = await exportClip(compositor, source, {
        width: project.width,
        height: project.height,
        fps,
        file: asset.file,
        inSec: firstVideoClip.sourceIn,
        outSec: firstVideoClip.sourceOut,
        onProgress: (p) =>
          setExportState((s) => ({
            ...s,
            progress: p.ratio,
            message:
              p.phase === "video" ? "Rendering video…" : p.phase === "audio" ? "Codifica audio…" : "Finalizzazione…",
          })),
      });
      const url = URL.createObjectURL(blob);
      setExportState({ status: "done", progress: 1, message: "Esportato", url });
    } catch (err) {
      console.error(err);
      setExportState({
        status: "error",
        progress: 0,
        message: err instanceof Error ? err.message : "Errore durante l'export",
      });
    } finally {
      await seek(firstVideoClip.trackStart);
    }
  };

  return {
    ready,
    playing,
    currentTime,
    duration: projectDuration(project),
    capabilities,
    exportState,
    play,
    pause,
    seek,
    runExport,
  };
}
