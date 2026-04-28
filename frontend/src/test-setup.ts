class WebGLRenderingContextStub {}
class WebGL2RenderingContextStub extends WebGLRenderingContextStub {}

const createCanvasGradient = () => ({
  addColorStop: () => undefined,
});

const createCanvasPattern = () => ({});

const createImageData = (width: number, height: number) => ({
  data: new Uint8ClampedArray(Math.max(0, width * height * 4)),
  width,
  height,
  colorSpace: 'srgb' as PredefinedColorSpace,
});

const createStorage = (): Storage => {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key: string) => {
      entries.delete(key);
    },
    setItem: (key: string, value: string) => {
      entries.set(key, String(value));
    },
  };
};

const createCanvas2dContext = (canvas: HTMLCanvasElement) => ({
  canvas,
  fillStyle: '#000000',
  font: '10px sans-serif',
  globalAlpha: 1,
  lineCap: 'butt',
  lineDashOffset: 0,
  lineJoin: 'miter',
  lineWidth: 1,
  miterLimit: 10,
  shadowBlur: 0,
  shadowColor: 'rgba(0, 0, 0, 0)',
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  strokeStyle: '#000000',
  textAlign: 'start',
  textBaseline: 'alphabetic',
  arc: () => undefined,
  arcTo: () => undefined,
  beginPath: () => undefined,
  bezierCurveTo: () => undefined,
  clearRect: () => undefined,
  clip: () => undefined,
  closePath: () => undefined,
  createImageData,
  createLinearGradient: createCanvasGradient,
  createPattern: createCanvasPattern,
  createRadialGradient: createCanvasGradient,
  drawImage: () => undefined,
  ellipse: () => undefined,
  fill: () => undefined,
  fillRect: () => undefined,
  fillText: () => undefined,
  getImageData: (_sx: number, _sy: number, sw: number, sh: number) => createImageData(sw, sh),
  getLineDash: () => [],
  isPointInPath: () => false,
  isPointInStroke: () => false,
  lineTo: () => undefined,
  measureText: (text: string) => ({ width: text.length * 8 }),
  moveTo: () => undefined,
  putImageData: () => undefined,
  quadraticCurveTo: () => undefined,
  rect: () => undefined,
  resetTransform: () => undefined,
  restore: () => undefined,
  rotate: () => undefined,
  roundRect: () => undefined,
  save: () => undefined,
  scale: () => undefined,
  setLineDash: () => undefined,
  setTransform: () => undefined,
  stroke: () => undefined,
  strokeRect: () => undefined,
  strokeText: () => undefined,
  transform: () => undefined,
  translate: () => undefined,
});

Object.defineProperties(globalThis, {
  localStorage: {
    configurable: true,
    value: createStorage(),
  },
  sessionStorage: {
    configurable: true,
    value: createStorage(),
  },
  WebGLRenderingContext: {
    configurable: true,
    value: globalThis.WebGLRenderingContext ?? WebGLRenderingContextStub,
  },
  WebGL2RenderingContext: {
    configurable: true,
    value: globalThis.WebGL2RenderingContext ?? WebGL2RenderingContextStub,
  },
});

if (typeof window !== 'undefined') {
  Object.defineProperties(window, {
    localStorage: {
      configurable: true,
      value: globalThis.localStorage,
    },
    sessionStorage: {
      configurable: true,
      value: globalThis.sessionStorage,
    },
  });
}

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value(contextId: string) {
    if (contextId === '2d') {
      return createCanvas2dContext(this);
    }

    return null;
  },
});

Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  configurable: true,
  value: () => Promise.resolve(),
});

Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
  configurable: true,
  value: () => undefined,
});
