"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  ClipSource,
  Compositor,
  detectCapabilities,
  exportClip,
  type EngineCapabilities,
} from "@tanys/video-engine";
import type { MediaAsset, VideoClip } from "@/lib/store/project-store";

export interface ExportState {
  status: "idle" | "running" | "done" | "error";
  progress: number;
  message: string;
  url?: string;
}

const IDLE_EXPORT: ExportState = { status: "idle", progress: 0, message: "" };

export function useClipEngine(canvasRef: RefObject<HTMLCanvasElement | null>, asset: MediaAsset | null) {
  const sourceRef = useRef<ClipSource | null>(null);
  const compositorRef = useRef<Compositor | null>(null);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [capabilities] = useState<EngineCapabilities>(() => detectCapabilities());
  const [exportState, setExportState] = useState<ExportState>(IDLE_EXPORT);

  // Un Compositor per tutta la vita del canvas.
  useEffect(() => {
    if (!canvasRef.current) return;
    const compositor = new Compositor(canvasRef.current);
    compositorRef.current = compositor;
    return () => {
      compositor.dispose();
      compositorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Una ClipSource per ogni asset importato.
  useEffect(() => {
    setReady(false);
    setPlaying(false);
    setCurrentTime(0);
    sourceRef.current?.dispose();
    sourceRef.current = null;

    if (!asset) {
      compositorRef.current?.clearSource();
      return;
    }

    let cancelled = false;
    const source = new ClipSource(asset.file);
    sourceRef.current = source;

    source.ready
      .then(() => {
        if (cancelled) return;
        compositorRef.current?.setSize(source.width, source.height);
        compositorRef.current?.setSourceVideo(source.video);
        compositorRef.current?.renderFrame();
        setReady(true);
      })
      .catch((err) => console.error(err));

    return () => {
      cancelled = true;
      source.dispose();
    };
  }, [asset]);

  // Loop di rendering della preview durante la riproduzione.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const source = sourceRef.current;
      const compositor = compositorRef.current;
      if (source && compositor) {
        compositor.renderFrame();
        setCurrentTime(source.video.currentTime);
        if (source.video.ended) {
          setPlaying(false);
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const play = () => {
    const source = sourceRef.current;
    if (!source) return;
    void source.video.play();
    setPlaying(true);
  };

  const pause = () => {
    const source = sourceRef.current;
    if (!source) return;
    source.video.pause();
    setPlaying(false);
  };

  const seek = async (t: number) => {
    const source = sourceRef.current;
    if (!source) return;
    await source.seekTo(t);
    compositorRef.current?.renderFrame();
    setCurrentTime(t);
  };

  const runExport = async (clip: VideoClip, fps: number) => {
    const source = sourceRef.current;
    const compositor = compositorRef.current;
    if (!source || !compositor || !asset) return;

    pause();
    setExportState({ status: "running", progress: 0, message: "Preparazione…" });
    try {
      const blob = await exportClip(compositor, source, {
        width: asset.width,
        height: asset.height,
        fps,
        file: asset.file,
        inSec: clip.sourceIn,
        outSec: clip.sourceOut,
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
      compositor.setSize(source.width, source.height);
      await source.seekTo(clip.sourceIn);
      compositor.renderFrame();
    }
  };

  return { ready, playing, currentTime, capabilities, exportState, play, pause, seek, runExport };
}
