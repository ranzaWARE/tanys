"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Clip, Project } from "@/lib/store/project-store";

const PX_PER_SEC = 60;
const MIN_DURATION_SEC = 0.2;
const TICK_EVERY_SEC = 5;

export interface TimelineProps {
  project: Project;
  selectedClipId: string | null;
  currentTime: number;
  onSeek: (t: number) => void;
  onSelectClip: (id: string | null) => void;
  onMoveClip: (clipId: string, trackId: string, trackStart: number) => void;
  onResizeClipStart: (clipId: string, trackStart: number) => void;
  onResizeClipEnd: (clipId: string, trackEnd: number) => void;
  onAddVideoTrack: () => void;
  onAddTextTrack: () => void;
  onRemoveTrack: (trackId: string) => void;
  onImportToTrack: (trackId: string, file: File) => void;
  onAddTextClip: (trackId: string) => void;
  onRemoveClip: (clipId: string) => void;
}

type DragState =
  | { kind: "move"; clipId: string; trackId: string; startPointerX: number; startTrackStart: number }
  | { kind: "resize-start" | "resize-end"; clipId: string; startPointerX: number; startValue: number };

function timeToPx(t: number) {
  return t * PX_PER_SEC;
}
function pxToTime(px: number) {
  return Math.max(0, px / PX_PER_SEC);
}
function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const rest = Math.floor(s % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${rest}`;
}

export function Timeline({
  project,
  selectedClipId,
  currentTime,
  onSeek,
  onSelectClip,
  onMoveClip,
  onResizeClipStart,
  onResizeClipEnd,
  onAddVideoTrack,
  onAddTextTrack,
  onRemoveTrack,
  onImportToTrack,
  onAddTextClip,
  onRemoveClip,
}: TimelineProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const importInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const duration = Math.max(
    10,
    project.tracks.reduce((max, t) => t.clips.reduce((m, c) => Math.max(m, c.trackEnd), max), 0) + 3
  );
  const totalWidth = timeToPx(duration);

  const ticks: number[] = [];
  for (let t = 0; t <= duration; t += TICK_EVERY_SEC) ticks.push(t);

  const onRulerPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek(pxToTime(e.clientX - rect.left));
  };

  const onClipPointerDown = (e: ReactPointerEvent<HTMLDivElement>, clip: Clip, trackId: string) => {
    e.stopPropagation();
    onSelectClip(clip.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ kind: "move", clipId: clip.id, trackId, startPointerX: e.clientX, startTrackStart: clip.trackStart });
  };

  const onHandlePointerDown = (e: ReactPointerEvent<HTMLDivElement>, clip: Clip, edge: "start" | "end") => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({
      kind: edge === "start" ? "resize-start" : "resize-end",
      clipId: clip.id,
      startPointerX: e.clientX,
      startValue: edge === "start" ? clip.trackStart : clip.trackEnd,
    });
  };

  const onDragPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const deltaSec = (e.clientX - drag.startPointerX) / PX_PER_SEC;
    if (drag.kind === "move") {
      onMoveClip(drag.clipId, drag.trackId, Math.max(0, drag.startTrackStart + deltaSec));
    } else if (drag.kind === "resize-start") {
      onResizeClipStart(drag.clipId, Math.max(0, drag.startValue + deltaSec));
    } else {
      onResizeClipEnd(drag.clipId, Math.max(MIN_DURATION_SEC, drag.startValue + deltaSec));
    }
  };

  const onDragPointerUp = () => setDrag(null);

  return (
    <div className="card timelineCard">
      <div className="cardHeader">
        <h3>Timeline</h3>
        <div className="row">
          <button className="aurorBtn" type="button" onClick={onAddVideoTrack}>
            + Traccia video
          </button>
          <button className="aurorBtn" type="button" onClick={onAddTextTrack}>
            + Traccia testo
          </button>
        </div>
      </div>
      <div className="cardBody timelineBody">
        <div className="timelineHeaders">
          <div className="timelineHeaderSpacer" />
          {project.tracks.map((track) => (
            <div key={track.id} className="timelineTrackHeader">
              <span className="small">{track.kind === "video" ? "Video" : "Testo"}</span>
              <div className="row" style={{ gap: 4 }}>
                {track.kind === "video" ? (
                  <>
                    <button
                      className="iconBtn"
                      type="button"
                      title="Importa video su questa traccia"
                      onClick={() => importInputs.current[track.id]?.click()}
                    >
                      +
                    </button>
                    <input
                      ref={(el) => {
                        importInputs.current[track.id] = el;
                      }}
                      type="file"
                      accept="video/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) onImportToTrack(track.id, file);
                      }}
                    />
                  </>
                ) : (
                  <button className="iconBtn" type="button" title="Aggiungi testo" onClick={() => onAddTextClip(track.id)}>
                    +
                  </button>
                )}
                <button className="iconBtn" type="button" title="Rimuovi traccia" onClick={() => onRemoveTrack(track.id)}>
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="timelineScroll">
          <div style={{ width: totalWidth, position: "relative" }}>
            <div className="timelineRuler" onPointerDown={onRulerPointerDown}>
              {ticks.map((t) => (
                <span key={t} className="timelineTick" style={{ left: timeToPx(t) }}>
                  {formatTime(t)}
                </span>
              ))}
              <div className="timelinePlayhead" style={{ left: timeToPx(currentTime) }} />
            </div>

            {project.tracks.map((track) => (
              <div key={track.id} className={`timelineTrack timelineTrack--${track.kind}`}>
                {track.clips.map((clip) => (
                  <div
                    key={clip.id}
                    className={`timelineClip timelineClip--${clip.kind}${
                      selectedClipId === clip.id ? " selected" : ""
                    }`}
                    style={{
                      left: timeToPx(clip.trackStart),
                      width: Math.max(6, timeToPx(clip.trackEnd - clip.trackStart)),
                    }}
                    onPointerDown={(e) => onClipPointerDown(e, clip, track.id)}
                    onPointerMove={onDragPointerMove}
                    onPointerUp={onDragPointerUp}
                  >
                    <span className="timelineClipLabel">{clip.kind === "video" ? "🎬" : clip.text}</span>
                    <div
                      className="timelineClipHandle timelineClipHandle--start"
                      onPointerDown={(e) => onHandlePointerDown(e, clip, "start")}
                      onPointerMove={onDragPointerMove}
                      onPointerUp={onDragPointerUp}
                    />
                    <div
                      className="timelineClipHandle timelineClipHandle--end"
                      onPointerDown={(e) => onHandlePointerDown(e, clip, "end")}
                      onPointerMove={onDragPointerMove}
                      onPointerUp={onDragPointerUp}
                    />
                    {selectedClipId === clip.id && (
                      <button
                        className="timelineClipRemove"
                        type="button"
                        title="Elimina clip"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveClip(clip.id);
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
