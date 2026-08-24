"use client";

import { useEffect, useRef, useState } from "react";
import { useProjectStore, type Clip, type ClipPatch } from "@/lib/store/project-store";
import { useClipEngine } from "../use-clip-engine";
import { Timeline } from "../Timeline";
import "../editor.css";

function formatTime(s: number) {
  if (!Number.isFinite(s) || s < 0) return "0:00.0";
  const m = Math.floor(s / 60);
  const rest = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${rest}`;
}

function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const stored = window.localStorage.getItem("tanys-theme");
    const initial = stored === "light" || stored === "dark" ? stored : "dark";
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("tanys-theme", next);
  };

  return (
    <button className="iconBtn themeToggle" onClick={toggle} title="Cambia tema" type="button">
      <svg className="ic-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
      <svg className="ic-moon" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />
      </svg>
    </button>
  );
}

function ClipProperties({
  clip,
  onUpdate,
  disabled,
}: {
  clip: Clip;
  onUpdate: (patch: ClipPatch) => void;
  disabled: boolean;
}) {
  return (
    <div className="card">
      <div className="cardHeader">
        <h3>Proprietà clip</h3>
      </div>
      <div className="cardBody stack">
        <div className="line">
          <span className="aurorLabel">Opacità</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={clip.opacity}
            disabled={disabled}
            onChange={(e) => onUpdate({ opacity: Number(e.target.value) })}
          />
        </div>
        {clip.kind === "text" && (
          <>
            <div className="field">
              <span className="aurorLabel">Testo</span>
              <input
                className="aurorInput"
                type="text"
                value={clip.text}
                disabled={disabled}
                onChange={(e) => onUpdate({ text: e.target.value })}
              />
            </div>
            <div className="line">
              <span className="aurorLabel">Colore</span>
              <input
                type="color"
                value={clip.color}
                disabled={disabled}
                onChange={(e) => onUpdate({ color: e.target.value })}
              />
            </div>
            <div className="line">
              <span className="aurorLabel">Dimensione</span>
              <input
                className="aurorInput"
                style={{ width: 80 }}
                type="number"
                min={12}
                max={200}
                value={clip.fontSize}
                disabled={disabled}
                onChange={(e) => onUpdate({ fontSize: Number(e.target.value) })}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function Editor({ projectId }: { projectId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const setProjectId = useProjectStore((s) => s.setProjectId);
  const project = useProjectStore((s) => s.project);
  const media = useProjectStore((s) => s.media);
  const selectedClipId = useProjectStore((s) => s.selectedClipId);
  const selectClip = useProjectStore((s) => s.selectClip);
  const addVideoTrack = useProjectStore((s) => s.addVideoTrack);
  const addTextTrack = useProjectStore((s) => s.addTextTrack);
  const removeTrack = useProjectStore((s) => s.removeTrack);
  const importMediaToTrack = useProjectStore((s) => s.importMediaToTrack);
  const addTextClip = useProjectStore((s) => s.addTextClip);
  const moveClip = useProjectStore((s) => s.moveClip);
  const resizeClipStart = useProjectStore((s) => s.resizeClipStart);
  const resizeClipEnd = useProjectStore((s) => s.resizeClipEnd);
  const updateClip = useProjectStore((s) => s.updateClip);
  const removeClip = useProjectStore((s) => s.removeClip);

  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    setProjectId(projectId);
  }, [projectId, setProjectId]);

  const engine = useClipEngine(canvasRef, project, media);
  const isExporting = engine.exportState.status === "running";
  const isEmpty = project.tracks.every((t) => t.clips.length === 0);

  const selectedClip: Clip | null =
    project.tracks.flatMap((t) => t.clips).find((c) => c.id === selectedClipId) ?? null;

  const onImportToTrack = async (trackId: string, file: File) => {
    setImportError(null);
    try {
      await importMediaToTrack(trackId, file);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import fallito");
    }
  };

  return (
    <div className="appShell editorShell">
      <div className="dsHeaderRail">
        <header className="dsHeader">
          <div className="dsBrand">
            <span className="dsBrandMark">T</span>
            <span>tanys</span>
          </div>
          <div style={{ flex: 1 }} />
          <span
            className={`badgeSm ${engine.capabilities.hardwareAccelerated ? "dsTag--brand" : ""}`}
            title={engine.capabilities.gpuRenderer ?? "GPU non rilevata dal browser"}
          >
            GPU: {engine.capabilities.hardwareAccelerated ? "sì" : "no"}
          </span>
          <div className="dsHeaderRight">
            <ThemeToggle />
          </div>
        </header>
      </div>

      <main className="appMain editorMain">
        <section className="card viewportCard">
          <div className="cardBody">
            <div className="stage">
              <div className="frame" style={{ aspectRatio: `${project.width} / ${project.height}` }}>
                <canvas ref={canvasRef} />
              </div>
              {isEmpty && (
                <div className="emptyState">
                  <span>Importa un video da una traccia qui sotto per iniziare.</span>
                  {importError && (
                    <span className="small" style={{ color: "var(--danger)" }}>
                      {importError}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="transport">
              <button
                className="aurorBtn playBtn"
                type="button"
                disabled={!engine.ready || isExporting}
                onClick={() => (engine.playing ? engine.pause() : engine.play())}
              >
                {engine.playing ? "❚❚" : "▶"}
              </button>
              <div className="scrub">
                <input
                  className="seekInput"
                  type="range"
                  min={0}
                  max={Math.max(engine.duration, 0.01)}
                  step={0.01}
                  value={engine.currentTime}
                  disabled={!engine.ready || isExporting}
                  onChange={(e) => void engine.seek(Number(e.target.value))}
                />
              </div>
              <span className="small" style={{ whiteSpace: "nowrap" }}>
                {formatTime(engine.currentTime)} / {formatTime(engine.duration)}
              </span>
            </div>
          </div>
        </section>

        <aside className="controls">
          {selectedClip && (
            <ClipProperties
              clip={selectedClip}
              disabled={isExporting}
              onUpdate={(patch) => updateClip(selectedClip.id, patch)}
            />
          )}

          <div className="card">
            <div className="cardHeader">
              <h3>Export</h3>
            </div>
            <div className="cardBody stack">
              <div className="small">Per ora esporta solo la prima clip video della timeline.</div>
              <button
                className="aurorBtn primary"
                type="button"
                disabled={isExporting || isEmpty}
                onClick={() => void engine.runExport(project.fps)}
              >
                Esporta MP4
              </button>
              {engine.exportState.status === "running" && (
                <div className="small">
                  {engine.exportState.message} {Math.round(engine.exportState.progress * 100)}%
                </div>
              )}
              {engine.exportState.status === "error" && (
                <div className="small" style={{ color: "var(--danger)" }}>
                  {engine.exportState.message}
                </div>
              )}
              {engine.exportState.status === "done" && engine.exportState.url && (
                <a className="aurorBtn" href={engine.exportState.url} download={`${project.name}.mp4`}>
                  Scarica {project.name}.mp4
                </a>
              )}
            </div>
          </div>
        </aside>

        <Timeline
          project={project}
          selectedClipId={selectedClipId}
          currentTime={engine.currentTime}
          onSeek={(t) => void engine.seek(t)}
          onSelectClip={selectClip}
          onMoveClip={moveClip}
          onResizeClipStart={resizeClipStart}
          onResizeClipEnd={resizeClipEnd}
          onAddVideoTrack={addVideoTrack}
          onAddTextTrack={addTextTrack}
          onRemoveTrack={removeTrack}
          onImportToTrack={onImportToTrack}
          onAddTextClip={addTextClip}
          onRemoveClip={removeClip}
        />
      </main>
    </div>
  );
}
