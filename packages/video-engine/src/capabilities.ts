export interface EngineCapabilities {
  webCodecs: boolean;
  webgl2: boolean;
  gpuRenderer: string | null;
  hardwareAccelerated: boolean;
}

const SOFTWARE_RENDERER_PATTERN = /swiftshader|software|llvmpipe|microsoft basic render/i;

/**
 * Rileva cosa il browser corrente puo' offrire per decode/composizione/encode
 * lato client. Usata per il badge "GPU: si/no" e per scegliere fra pipeline
 * WebCodecs (hardware) e fallback MediaRecorder (software).
 */
export function detectCapabilities(): EngineCapabilities {
  const webCodecs =
    typeof window !== "undefined" && "VideoEncoder" in window && "VideoFrame" in window;

  let webgl2 = false;
  let gpuRenderer: string | null = null;

  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
    if (gl) {
      webgl2 = true;
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      if (ext) {
        const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
        gpuRenderer = typeof renderer === "string" ? renderer : null;
      }
    }
  }

  const hardwareAccelerated =
    webCodecs && webgl2 && !!gpuRenderer && !SOFTWARE_RENDERER_PATTERN.test(gpuRenderer);

  return { webCodecs, webgl2, gpuRenderer, hardwareAccelerated };
}
