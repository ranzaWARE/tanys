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

  /**
   * Seek deterministico: risolve dopo l'evento 'seeked', o comunque non oltre
   * 2s — rete di sicurezza contro un evento che non arriva mai (es. dati non
   * ancora bufferizzati a quel punto del file), che altrimenti lascerebbe la
   * promise pendente per sempre e bloccherebbe chi la aspetta.
   */
  seekTo(t: number): Promise<void> {
    const v = this.video;
    const target = Math.min(Math.max(t, 0), this.duration || t);
    if (Math.abs(v.currentTime - target) < 1e-4) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        v.removeEventListener("seeked", finish);
        clearTimeout(timer);
        resolve();
      };
      v.addEventListener("seeked", finish);
      const timer = setTimeout(finish, 2000);
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
