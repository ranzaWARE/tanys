import * as THREE from "three";

/**
 * Compositor WebGL2 per la preview e per l'export. Fase 1: un solo quad
 * full-screen che mostra la texture video corrente (stesso pattern
 * "OrthographicCamera + quad + ShaderMaterial" del prototipo 360, qui con
 * un materiale semplice invece dello shader di stitch). Le fasi successive
 * (multitraccia, effetti, 360) aggiungono altri layer sopra questa base.
 */
export class Compositor {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private material: THREE.MeshBasicMaterial;
  private mesh: THREE.Mesh;
  private texture: THREE.VideoTexture | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.material = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.mesh);
  }

  setSize(width: number, height: number) {
    if (width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
  }

  setSourceVideo(video: HTMLVideoElement) {
    this.texture?.dispose();
    const texture = new THREE.VideoTexture(video);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    this.material.map = texture;
    this.material.color.set(0xffffff);
    this.material.needsUpdate = true;
    this.texture = texture;
  }

  clearSource() {
    this.texture?.dispose();
    this.texture = null;
    this.material.map = null;
    this.material.color.set(0x000000);
    this.material.needsUpdate = true;
  }

  renderFrame() {
    if (this.texture) this.texture.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.texture?.dispose();
    this.renderer.dispose();
  }
}
