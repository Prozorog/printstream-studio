import { useSyncExternalStore } from 'react'

export const MODEL_URL = `${import.meta.env.BASE_URL}models/m4a1s-printstream.glb`
export const CAMERA_PRESETS = ['hero', 'left', 'right', 'top', 'muzzle', 'closeup']
export const ACTION_NAMES = ['suppressor', 'dustCover', 'chargingHandle', 'magazine', 'trigger', 'selector', 'stock', 'fieldstrip', 'reassemble', 'reset', 'autoRotate', 'hotspots']

// GSAP attaches an enumerable, circular _gsap cache to animated targets.
// Publish only the seven numeric controls, never the animation target itself.
export function copyMechanicalState(source) {
  return {
    suppressor: source.suppressor,
    dustCover: source.dustCover,
    chargingHandle: source.chargingHandle,
    magazine: source.magazine,
    trigger: source.trigger,
    selector: source.selector,
    stock: source.stock,
  }
}

const listeners = new Set()
let snapshot = {
  ready: false, loaded: false, loadStage: 'Loading the asset', loadProgress: 0, error: null,
  inspect: false, chapter: 'hero', preset: 'hero', cameraOwner: 'scroll',
  explode: 0, exploding: false, motion: false, autoRotate: false, hotspots: true,
  light: 35, selected: null, message: '', ao: true,
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  mechanical: { suppressor: 0, dustCover: 0, chargingHandle: 0, magazine: 0, trigger: 0, selector: 0, stock: 0 },
}

export const runtime = {
  controller: null, root: null, parts: null, camera: null, controls: null,
  diagnostics: null,
  startedAt: performance.now(), verify: new URLSearchParams(window.location.search).has('verify'),
  scroll: { chapter: 0 }, labels: [], hovered: null,
  stats: { FPS: 0, fps: 0, triangles: 0, drawCalls: 0, loadMs: 0, frameMs: 0, ao: 'half-resolution / 8 samples', dpr: 0, renderWidth: 0, renderHeight: 0, aoWidth: 0, aoHeight: 0, aoRefreshes: 0, aoCachedFrames: 0 },
}

export function updateState(patch) {
  snapshot = { ...snapshot, ...patch }
  for (const listener of listeners) listener()
}

export function getSnapshot() { return snapshot }
export function useExperience() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, getSnapshot)
}

function command(name, ...args) {
  if (!runtime.controller || !snapshot.ready) {
    const reason = snapshot.error ? 'The 3D asset could not be loaded.' : 'The asset is still being assembled.'
    updateState({ message: reason })
    return { ok: false, reason }
  }
  return runtime.controller[name](...args)
}

export const experience = {
  get ready() { return snapshot.ready },
  get stats() { return runtime.stats },
  get model() { return runtime.root },
  get parts() { return runtime.parts },
  get camera() { return runtime.camera },
  get diagnostics() { return runtime.diagnostics },
  actionNames: ACTION_NAMES,
  cameraPresets: CAMERA_PRESETS,
  getState() {
    return {
      ...snapshot,
      mechanical: copyMechanicalState(snapshot.mechanical),
      hovered: runtime.hovered,
      cameraPosition: runtime.camera?.position.toArray() ?? null,
      cameraTarget: runtime.controls?.target.toArray() ?? null,
      labels: runtime.labels.map((label) => ({ ...label })),
      stats: { ...runtime.stats },
    }
  },
  action: (name) => command('action', name),
  preset: (name, options) => command('preset', name, options),
  setExplode: (progress, options) => command('setExplode', progress, options),
  setLight: (angle, options) => command('setLight', angle, options),
  setMechanical: (name, progress, options) => command('setMechanical', name, progress, options),
  inspectMotion: (options) => command('inspectMotion', options),
  enterInspect: () => command('enterInspect'),
  exitInspect: () => command('exitInspect'),
  setAO: (enabled) => { updateState({ ao: Boolean(enabled) }); return { ok: true } },
  selectPart: (name) => command('selectPart', name),
}

window.__PRINTSTREAM__ = experience
