"use client";

import { create } from "zustand";

// crypto.randomUUID() richiede un secure context (https o localhost): su un
// server raggiunto in plain http non e' disponibile, quindi non ci si affida.
function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface MediaAsset {
  id: string;
  file: File;
  fileName: string;
  duration: number;
  width: number;
  height: number;
}

export interface VideoClip {
  id: string;
  kind: "video";
  mediaId: string;
  trackStart: number;
  trackEnd: number;
  sourceIn: number;
  sourceOut: number;
}

// La Fase 3 aggiungera' Clip360 come membro di questa union (stesso schema
// tracks/clips, cosi' timeline ed export non vanno ridisegnati).
export type Clip = VideoClip;

export interface Track {
  id: string;
  kind: "video" | "audio" | "text";
  clips: Clip[];
}

export interface Project {
  id: string;
  name: string;
  fps: number;
  width: number;
  height: number;
  tracks: Track[];
}

interface ProjectStore {
  project: Project;
  media: Record<string, MediaAsset>;
  setProjectId: (id: string) => void;
  importMedia: (file: File) => Promise<void>;
  setTrim: (clipId: string, sourceIn: number, sourceOut: number) => void;
}

function emptyProject(id: string): Project {
  return {
    id,
    name: "Progetto senza titolo",
    fps: 30,
    width: 1920,
    height: 1080,
    tracks: [{ id: "track-video-1", kind: "video", clips: [] }],
  };
}

interface ProbeResult {
  duration: number;
  width: number;
  height: number;
}

// Sonda solo i metadata (durata/risoluzione): l'object URL usato qui e'
// temporaneo e viene rilasciato subito dopo — la decodifica vera passa da
// una ClipSource separata (video-engine), creata a partire dal File.
function probeVideo(file: File): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.src = url;
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Impossibile leggere il file (codec non supportato dal browser?)"));
    };
  });
}

export const useProjectStore = create<ProjectStore>((set) => ({
  project: emptyProject("demo"),
  media: {},

  setProjectId: (id) => set((s) => ({ project: { ...s.project, id } })),

  importMedia: async (file) => {
    const probe = await probeVideo(file);
    const mediaId = createId();
    const asset: MediaAsset = {
      id: mediaId,
      file,
      fileName: file.name,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
    };
    const clip: VideoClip = {
      id: createId(),
      kind: "video",
      mediaId,
      trackStart: 0,
      trackEnd: probe.duration,
      sourceIn: 0,
      sourceOut: probe.duration,
    };
    set((s) => {
      const [firstTrack, ...rest] = s.project.tracks;
      return {
        media: { ...s.media, [mediaId]: asset },
        project: {
          ...s.project,
          width: probe.width || s.project.width,
          height: probe.height || s.project.height,
          tracks: [{ ...firstTrack, clips: [clip] }, ...rest],
        },
      };
    });
  },

  setTrim: (clipId, sourceIn, sourceOut) =>
    set((s) => ({
      project: {
        ...s.project,
        tracks: s.project.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) =>
            c.id === clipId
              ? { ...c, sourceIn, sourceOut, trackStart: 0, trackEnd: sourceOut - sourceIn }
              : c
          ),
        })),
      },
    })),
}));
