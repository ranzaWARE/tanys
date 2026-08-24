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

export interface ClipBase {
  id: string;
  trackId: string;
  trackStart: number;
  trackEnd: number;
  opacity: number;
}

export interface VideoClip extends ClipBase {
  kind: "video";
  mediaId: string;
  sourceIn: number;
  sourceOut: number;
  volume: number;
}

export interface TextClip extends ClipBase {
  kind: "text";
  text: string;
  color: string;
  fontSize: number;
}

// La Fase 3 aggiungera' Clip360 come membro di questa union (stesso schema
// tracks/clips, cosi' timeline ed export non vanno ridisegnati).
export type Clip = VideoClip | TextClip;

// Partial<Clip> (con Clip union) ristringerebbe ai soli campi comuni fra
// VideoClip e TextClip: niente "text"/"color"/"fontSize", niente
// "sourceIn"/"volume". Serve l'intersezione dei due Partial per poter
// patchare campi specifici di un solo tipo.
export type ClipPatch = Partial<VideoClip & TextClip>;

export interface Track {
  id: string;
  kind: "video" | "text";
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
  selectedClipId: string | null;

  setProjectId: (id: string) => void;
  addVideoTrack: () => void;
  addTextTrack: () => void;
  removeTrack: (trackId: string) => void;
  importMediaToTrack: (trackId: string, file: File) => Promise<void>;
  addTextClip: (trackId: string) => void;
  moveClip: (clipId: string, trackId: string, trackStart: number) => void;
  resizeClipStart: (clipId: string, trackStart: number) => void;
  resizeClipEnd: (clipId: string, trackEnd: number) => void;
  updateClip: (clipId: string, patch: ClipPatch) => void;
  removeClip: (clipId: string) => void;
  selectClip: (clipId: string | null) => void;
}

function emptyProject(id: string): Project {
  return {
    id,
    name: "Progetto senza titolo",
    fps: 30,
    width: 1920,
    height: 1080,
    tracks: [{ id: createId(), kind: "video", clips: [] }],
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

function findClip(project: Project, clipId: string): { track: Track; clip: Clip } | null {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

function overlaps(a: { trackStart: number; trackEnd: number }, b: { trackStart: number; trackEnd: number }) {
  return a.trackStart < b.trackEnd && b.trackStart < a.trackEnd;
}

// Niente clip sovrapposte sulla stessa traccia: un rifiuto silenzioso (no-op)
// e' piu' semplice e prevedibile di una reflow automatica per un MVP.
function hasCollision(track: Track, clipId: string, trackStart: number, trackEnd: number) {
  return track.clips.some((c) => c.id !== clipId && overlaps(c, { trackStart, trackEnd }));
}

export const useProjectStore = create<ProjectStore>((set) => ({
  project: emptyProject("demo"),
  media: {},
  selectedClipId: null,

  setProjectId: (id) => set((s) => ({ project: { ...s.project, id } })),

  addVideoTrack: () =>
    set((s) => ({
      project: { ...s.project, tracks: [...s.project.tracks, { id: createId(), kind: "video", clips: [] }] },
    })),

  addTextTrack: () =>
    set((s) => ({
      project: { ...s.project, tracks: [...s.project.tracks, { id: createId(), kind: "text", clips: [] }] },
    })),

  removeTrack: (trackId) =>
    set((s) => ({ project: { ...s.project, tracks: s.project.tracks.filter((t) => t.id !== trackId) } })),

  importMediaToTrack: async (trackId, file) => {
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
    set((s) => {
      const track = s.project.tracks.find((t) => t.id === trackId);
      if (!track || track.kind !== "video") return s;
      const atTime = track.clips.reduce((max, c) => Math.max(max, c.trackEnd), 0);
      const clip: VideoClip = {
        id: createId(),
        kind: "video",
        trackId,
        trackStart: atTime,
        trackEnd: atTime + probe.duration,
        opacity: 1,
        mediaId,
        sourceIn: 0,
        sourceOut: probe.duration,
        volume: 1,
      };
      return {
        media: { ...s.media, [mediaId]: asset },
        selectedClipId: clip.id,
        project: {
          ...s.project,
          tracks: s.project.tracks.map((t) => (t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t)),
        },
      };
    });
  },

  addTextClip: (trackId) =>
    set((s) => {
      const track = s.project.tracks.find((t) => t.id === trackId);
      if (!track || track.kind !== "text") return s;
      const start = track.clips.reduce((max, c) => Math.max(max, c.trackEnd), 0);
      const clip: TextClip = {
        id: createId(),
        kind: "text",
        trackId,
        trackStart: start,
        trackEnd: start + 3,
        opacity: 1,
        text: "Testo",
        color: "#ffffff",
        fontSize: 48,
      };
      return {
        selectedClipId: clip.id,
        project: {
          ...s.project,
          tracks: s.project.tracks.map((t) => (t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t)),
        },
      };
    }),

  moveClip: (clipId, trackId, trackStart) =>
    set((s) => {
      const found = findClip(s.project, clipId);
      const destTrack = s.project.tracks.find((t) => t.id === trackId);
      if (!found || !destTrack || destTrack.kind !== found.clip.kind) return s;
      const duration = found.clip.trackEnd - found.clip.trackStart;
      const newStart = Math.max(0, trackStart);
      const newEnd = newStart + duration;
      if (hasCollision(destTrack, clipId, newStart, newEnd)) return s;
      return {
        project: {
          ...s.project,
          tracks: s.project.tracks.map((t) => {
            if (t.id === found.track.id && t.id !== trackId) {
              return { ...t, clips: t.clips.filter((c) => c.id !== clipId) };
            }
            if (t.id === trackId) {
              const withoutOld = t.clips.filter((c) => c.id !== clipId);
              const moved = { ...found.clip, trackId, trackStart: newStart, trackEnd: newEnd } as Clip;
              return { ...t, clips: [...withoutOld, moved] };
            }
            return t;
          }),
        },
      };
    }),

  resizeClipStart: (clipId, trackStart) =>
    set((s) => {
      const found = findClip(s.project, clipId);
      if (!found) return s;
      const { track, clip } = found;
      const delta = trackStart - clip.trackStart;
      const newStart = Math.max(0, trackStart);
      if (newStart >= clip.trackEnd - 0.1) return s;
      if (clip.kind === "video" && clip.sourceIn + delta < 0) return s;
      if (hasCollision(track, clipId, newStart, clip.trackEnd)) return s;
      return {
        project: {
          ...s.project,
          tracks: s.project.tracks.map((t) =>
            t.id === track.id
              ? {
                  ...t,
                  clips: t.clips.map((c) =>
                    c.id === clipId
                      ? c.kind === "video"
                        ? { ...c, trackStart: newStart, sourceIn: c.sourceIn + delta }
                        : { ...c, trackStart: newStart }
                      : c
                  ),
                }
              : t
          ),
        },
      };
    }),

  resizeClipEnd: (clipId, trackEnd) =>
    set((s) => {
      const found = findClip(s.project, clipId);
      if (!found) return s;
      const { track, clip } = found;
      const delta = trackEnd - clip.trackEnd;
      if (trackEnd <= clip.trackStart + 0.1) return s;
      if (clip.kind === "video") {
        const asset = s.media[clip.mediaId];
        if (asset && clip.sourceOut + delta > asset.duration) return s;
      }
      if (hasCollision(track, clipId, clip.trackStart, trackEnd)) return s;
      return {
        project: {
          ...s.project,
          tracks: s.project.tracks.map((t) =>
            t.id === track.id
              ? {
                  ...t,
                  clips: t.clips.map((c) =>
                    c.id === clipId
                      ? c.kind === "video"
                        ? { ...c, trackEnd, sourceOut: c.sourceOut + delta }
                        : { ...c, trackEnd }
                      : c
                  ),
                }
              : t
          ),
        },
      };
    }),

  updateClip: (clipId, patch) =>
    set((s) => {
      const found = findClip(s.project, clipId);
      if (!found) return s;
      return {
        project: {
          ...s.project,
          tracks: s.project.tracks.map((t) =>
            t.id === found.track.id
              ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? ({ ...c, ...patch } as Clip) : c)) }
              : t
          ),
        },
      };
    }),

  removeClip: (clipId) =>
    set((s) => ({
      selectedClipId: s.selectedClipId === clipId ? null : s.selectedClipId,
      project: {
        ...s.project,
        tracks: s.project.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clipId) })),
      },
    })),

  selectClip: (clipId) => set({ selectedClipId: clipId }),
}));
