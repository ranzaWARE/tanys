import * as THREE from "three";

export interface VideoLayer {
  id: string;
  kind: "video";
  video: HTMLVideoElement;
  opacity: number;
}

export interface TextLayer {
  id: string;
  kind: "text";
  text: string;
  color: string;
  fontSize: number;
  opacity: number;
}

export type Layer = VideoLayer | TextLayer;

interface LayerEntry {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  texture: THREE.Texture;
  kind: Layer["kind"];
  canvas?: HTMLCanvasElement;
  ctx?: CanvasRenderingContext2D;
  lastText?: string;
  lastColor?: string;
  lastFontSize?: number;
}

// Risoluzione della texture su cui si disegna il testo: fissa e indipendente
// dalla risoluzione del progetto, va bene per qualunque canvas di output dato
// che e' comunque mappata su un piano 2x2 a tutto schermo.
const TEXT_CANVAS_SIZE = { width: 1920, height: 1080 };

/**
 * Compositor WebGL2 multi-livello: uno strato per clip video/testo attiva
 * nel frame corrente, in ordine back-to-front (indice 0 = sotto). Preview ed
 * export condividono lo stesso compositor per garantire WYSIWYG.
 */
export class Compositor {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private layers = new Map<string, LayerEntry>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      preserveDrawingBuffer: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x000000, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(width: number, height: number) {
    if (width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
  }

  private createVideoEntry(): LayerEntry {
    const material = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.scene.add(mesh);
    // Placeholder: sostituita dalla vera VideoTexture al primo setLayers().
    return { mesh, material, texture: new THREE.Texture(), kind: "video" };
  }

  private createTextEntry(): LayerEntry {
    const canvas = document.createElement("canvas");
    canvas.width = TEXT_CANVAS_SIZE.width;
    canvas.height = TEXT_CANVAS_SIZE.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D non disponibile per il layer di testo.");
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.scene.add(mesh);
    return { mesh, material, texture, kind: "text", canvas, ctx };
  }

  private drawText(entry: LayerEntry, text: string, color: string, fontSize: number) {
    if (!entry.canvas || !entry.ctx) return;
    const { canvas, ctx } = entry;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(2, fontSize * 0.08);
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    entry.texture.needsUpdate = true;
  }

  /**
   * Riconcilia i layer attivi nel frame corrente (crea/aggiorna/rimuove le
   * mesh secondo necessita'). Va chiamato prima di renderFrame() ogni volta
   * che cambia l'insieme delle clip attive o la posizione sulla timeline.
   */
  setLayers(inputLayers: Layer[]) {
    const seen = new Set<string>();

    inputLayers.forEach((layer, index) => {
      seen.add(layer.id);
      let entry = this.layers.get(layer.id);
      if (!entry || entry.kind !== layer.kind) {
        if (entry) this.disposeEntry(entry);
        entry = layer.kind === "video" ? this.createVideoEntry() : this.createTextEntry();
        this.layers.set(layer.id, entry);
      }

      entry.mesh.renderOrder = index;
      entry.material.opacity = layer.opacity;

      if (layer.kind === "video") {
        const isSameVideo = entry.texture instanceof THREE.VideoTexture && entry.texture.image === layer.video;
        if (!isSameVideo) {
          entry.texture.dispose();
          const texture = new THREE.VideoTexture(layer.video);
          texture.minFilter = THREE.LinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.generateMipmaps = false;
          texture.colorSpace = THREE.SRGBColorSpace;
          entry.texture = texture;
          entry.material.map = texture;
          entry.material.needsUpdate = true;
        }
      } else {
        if (entry.lastText !== layer.text || entry.lastColor !== layer.color || entry.lastFontSize !== layer.fontSize) {
          this.drawText(entry, layer.text, layer.color, layer.fontSize);
          entry.lastText = layer.text;
          entry.lastColor = layer.color;
          entry.lastFontSize = layer.fontSize;
        }
      }
    });

    for (const [id, entry] of this.layers) {
      if (!seen.has(id)) {
        this.disposeEntry(entry);
        this.layers.delete(id);
      }
    }
  }

  renderFrame() {
    for (const entry of this.layers.values()) {
      if (entry.kind === "video") entry.texture.needsUpdate = true;
    }
    this.renderer.render(this.scene, this.camera);
  }

  private disposeEntry(entry: LayerEntry) {
    this.scene.remove(entry.mesh);
    entry.material.dispose();
    entry.texture.dispose();
    entry.mesh.geometry.dispose();
  }

  dispose() {
    for (const entry of this.layers.values()) this.disposeEntry(entry);
    this.layers.clear();
    this.renderer.dispose();
  }
}
