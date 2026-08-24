/**
 * Wrapper su un elemento <video> nativo usato come sorgente decode per una
 * clip. Il decode resta delegato al browser (hardware-accelerated quando
 * disponibile) invece di passare da un VideoDecoder manuale — stesso
 * approccio gia' provato in reframe360.html.
 */
export class ClipSource {
  readonly video: HTMLVideoElement;
  readonly ready: Promise<void>;
  duration = 0;
  width = 0;
  height = 0;

  private objectUrl: string | null = null;

  constructor(file: File | string) {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";

    if (typeof file === "string") {
      video.src = file;
    } else {
      this.objectUrl = URL.createObjectURL(file);
      video.src = this.objectUrl;
    }

    this.video = video;
    this.ready = new Promise((resolve, reject) => {
      const onLoaded = () => {
        this.duration = video.duration;
        this.width = video.videoWidth;
        this.height = video.videoHeight;
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("error", onError);
        resolve();
      };
      const onError = () => {
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("error", onError);
        reject(new Error("Impossibile leggere il file video (codec non supportato dal browser?)"));
      };
      video.addEventListener("loadedmetadata", onLoaded);
      video.addEventListener("error", onError);
    });

    video.load();
  }

  /** Seek deterministico: risolve solo dopo che il frame richiesto e' pronto. */
  seekTo(t: number): Promise<void> {
    const v = this.video;
    const target = Math.min(Math.max(t, 0), this.duration || t);
    if (Math.abs(v.currentTime - target) < 1e-4) return Promise.resolve();
    return new Promise((resolve) => {
      const onSeeked = () => {
        v.removeEventListener("seeked", onSeeked);
        resolve();
      };
      v.addEventListener("seeked", onSeeked);
      v.currentTime = target;
    });
  }

  dispose() {
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
  }
}
