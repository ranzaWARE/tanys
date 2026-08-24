"use client";

import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "@/lib/store/project-store";
import { useClipEngine } from "../use-clip-engine";
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

export function Editor({ projectId }: { projectId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const setProjectId = useProjectStore((s) => s.setProjectId);
  const importMedia = useProjectStore((s) => s.importMedia);
  const setTrim = useProjectStore((s) => s.setTrim);
  const project = useProjectStore((s) => s.project);
  const media = useProjectStore((s) => s.media);

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    setProjectId(projectId);
  }, [projectId, setProjectId]);

  const clip = project.tracks[0]?.clips[0] ?? null;
  const asset = clip ? (media[clip.mediaId] ?? null) : null;

  const engine = useClipEngine(canvasRef, asset);

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    setImportError(null);
    try {
      await importMedia(file);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import fallito");
    } finally {
      setImporting(false);
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
              <div
                className="frame"
                style={asset ? { aspectRatio: `${asset.width} / ${asset.height}` } : { width: "100%", height: "100%" }}
              >
                <canvas ref={canvasRef} />
              </div>
              {!asset && (
                <div className="emptyState">
                  <span>Importa un video per iniziare.</span>
                  {importing && <span className="small">Caricamento…</span>}
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
                disabled={!engine.ready}
                onClick={() => (engine.playing ? engine.pause() : engine.play())}
              >
                {engine.playing ? "❚❚" : "▶"}
              </button>
              <div className="scrub">
                <input
                  className="seekInput"
                  type="range"
                  min={0}
                  max={Math.max(asset?.duration ?? 0, 0.01)}
                  step={0.01}
                  value={engine.currentTime}
                  disabled={!engine.ready}
                  onChange={(e) => void engine.seek(Number(e.target.value))}
                />
              </div>
              <span className="small" style={{ whiteSpace: "nowrap" }}>
                {formatTime(engine.currentTime)} / {formatTime(asset?.duration ?? 0)}
              </span>
            </div>
          </div>
        </section>

        <aside className="controls">
          <div className="card">
            <div className="cardHeader">
              <h3>Sorgente</h3>
            </div>
            <div className="cardBody stack">
              <label className="aurorBtn primary" style={{ cursor: "pointer" }}>
                {asset ? "Sostituisci video" : "Importa video"}
                <input type="file" accept="video/*" style={{ display: "none" }} onChange={onImport} />
              </label>
              {asset && (
                <div className="small">
                  {asset.fileName} — {asset.width}×{asset.height}
                </div>
              )}
            </div>
          </div>

          {asset && clip && (
            <div className="card">
              <div className="cardHeader">
                <h3>Trim</h3>
              </div>
              <div className="cardBody stack">
                <div className="line">
                  <span className="aurorLabel">Inizio</span>
                  <input
                    className="aurorInput"
                    style={{ width: 90 }}
                    type="number"
                    min={0}
                    max={Math.max(clip.sourceOut - 0.1, 0)}
                    step={0.1}
                    value={clip.sourceIn.toFixed(1)}
                    onChange={(e) =>
                      setTrim(clip.id, Math.min(Number(e.target.value), clip.sourceOut - 0.1), clip.sourceOut)
                    }
                  />
                </div>
                <div className="line">
                  <span className="aurorLabel">Fine</span>
                  <input
                    className="aurorInput"
                    style={{ width: 90 }}
                    type="number"
                    min={clip.sourceIn + 0.1}
                    max={asset.duration}
                    step={0.1}
                    value={clip.sourceOut.toFixed(1)}
                    onChange={(e) =>
                      setTrim(clip.id, clip.sourceIn, Math.max(Number(e.target.value), clip.sourceIn + 0.1))
                    }
                  />
                </div>
              </div>
            </div>
          )}

          {asset && clip && (
            <div className="card">
              <div className="cardHeader">
                <h3>Export</h3>
              </div>
              <div className="cardBody stack">
                <button
                  className="aurorBtn primary"
                  type="button"
                  disabled={engine.exportState.status === "running"}
                  onClick={() => void engine.runExport(clip, project.fps)}
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
          )}
        </aside>
      </main>
    </div>
  );
}
