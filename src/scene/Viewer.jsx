import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, useGLTF, useProgress } from '@react-three/drei'
import { NeutralToneMapping, SRGBColorSpace, Vector3 } from 'three'
import { experience, getSnapshot, MODEL_URL, runtime, updateState, useExperience } from '../experience'
import { createRig, namedAncestor, PART_NAMES, partLabel } from './rig'
import { createController } from './controller'
import { HOTSPOTS } from './hotspots'
import Studio from './Studio'
import Effects from './Effects'
import { createHoverRim } from './hoverRim'
import { installSpecularAA } from './specularAA'

const DRACO_PATH = `${import.meta.env.BASE_URL}draco/`
useGLTF.setDecoderPath(DRACO_PATH)

function leaderHitsRect(line, rect) {
  let entry = 0
  let exit = 1
  for (let axis = 0; axis < 2; axis++) {
    const origin = axis ? line.y1 : line.x1
    const delta = axis ? line.y2 - line.y1 : line.x2 - line.x1
    const min = (axis ? rect.top : rect.left) - 3
    const max = (axis ? rect.bottom : rect.right) + 3
    if (Math.abs(delta) < 0.0001) {
      if (origin < min || origin > max) return false
    } else {
      const a = (min - origin) / delta
      const b = (max - origin) / delta
      entry = Math.max(entry, Math.min(a, b))
      exit = Math.min(exit, Math.max(a, b))
      if (entry > exit) return false
    }
  }
  return true
}

function leadersCross(a, b) {
  const ax = a.x2 - a.x1, ay = a.y2 - a.y1
  const bx = b.x2 - b.x1, by = b.y2 - b.y1
  const dx = b.x1 - a.x1, dy = b.y1 - a.y1
  const denominator = ax * by - ay * bx
  if (Math.abs(denominator) < 0.0001) {
    if (Math.abs(dx * ay - dy * ax) > 0.0001) return false
    return Math.max(Math.min(a.x1, a.x2), Math.min(b.x1, b.x2)) <= Math.min(Math.max(a.x1, a.x2), Math.max(b.x1, b.x2))
      && Math.max(Math.min(a.y1, a.y2), Math.min(b.y1, b.y2)) <= Math.min(Math.max(a.y1, a.y2), Math.max(b.y1, b.y2))
  }
  const t = (dx * by - dy * bx) / denominator
  const u = (dx * ay - dy * ax) / denominator
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
}

class AssetBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error) { updateState({ error: error.message, ready: false }) }
  render() {
    if (this.state.error) return (
      <div className="asset-error" role="alert">
        <span className="eyebrow">The studio could not open</span>
        <h2>The 3D asset is unavailable.</h2>
        <p>{this.state.error.message}</p>
        <p>Check that the model and its local decoder are deployed, then reload. You can still use the download links below.</p>
        <button className="button button-dark" onClick={() => window.location.reload()}>Reload the studio <span aria-hidden="true">↗</span></button>
      </div>
    )
    return this.props.children
  }
}

function WebGLUnavailable() {
  return <div className="asset-error"><h2>WebGL 2 is unavailable.</h2><p>Open this study in a browser with hardware acceleration. The downloadable model remains available below.</p></div>
}

function LoadProgress() {
  const { progress, active } = useProgress()
  useEffect(() => {
    if (!getSnapshot().loaded) updateState({ loadProgress: progress, loadStage: active ? 'Loading the asset' : 'Preparing the studio' })
  }, [progress, active])
  return null
}

function Rifle({ controls, motion, labels }) {
  const gltf = useGLTF(MODEL_URL, DRACO_PATH, true)
  const { camera, size, gl, scene } = useThree()
  const rig = useMemo(() => createRig(gltf.scene), [gltf.scene])
  useEffect(() => {
    const anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())
    const slots = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'iridescenceThicknessMap']
    const textures = new Set()
    const surfaceMaterials = new Set()
    gltf.scene.traverse((object) => {
      if (!object.isMesh) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) {
        surfaceMaterials.add(material)
        for (const slot of slots) if (material[slot]) textures.add(material[slot])
      }
    })
    for (const texture of textures) {
      if (texture.anisotropy >= anisotropy) continue
      texture.anisotropy = anisotropy
      texture.needsUpdate = true
    }
    const restoreAA = []
    for (const material of surfaceMaterials) {
      const restore = installSpecularAA(material)
      if (restore) restoreAA.push(restore)
    }
    return () => { for (const restore of restoreAA) restore() }
  }, [gl, gltf.scene])
  const controller = useRef(null)
  const rim = useRef(null)
  useEffect(() => {
    const control = createController({ camera, controls: controls.current, rig, motionRoot: motion.current, size })
    runtime.controller = controller.current = control
    control.assemble()
    const onContextLost = (event) => {
      event.preventDefault()
      updateState({ ready: false, error: 'The browser lost its graphics context. Reload the studio to restore the live model.' })
    }
    gl.domElement.addEventListener('webglcontextlost', onContextLost)
    return () => {
      gl.domElement.removeEventListener('webglcontextlost', onContextLost)
      control.dispose()
      document.body.style.cursor = ''
    }
  }, [camera, gl, rig, controls, motion])
  useEffect(() => {
    const previousLayers = camera.layers.mask
    camera.layers.enable(2)
    const overlay = createHoverRim(rig, scene)
    rim.current = overlay
    return () => {
      overlay.dispose()
      rim.current = null
      camera.layers.mask = previousLayers
      runtime.hovered = null
    }
  }, [camera, rig, scene])
  useFrame((frameState, delta) => {
    controller.current?.frame(Math.min(delta, 0.1), frameState.size)
    const current = getSnapshot()
    if ((!current.inspect || current.motion || current.exploding) && runtime.hovered) {
      runtime.hovered = null
      document.body.style.cursor = ''
    }
    rim.current?.setPart(runtime.hovered)
    rim.current?.frame(Math.min(delta, 0.1), current.reducedMotion)
  }, -2)
  const point = useMemo(() => new Vector3(), [])
  const frameTime = useRef(0)
  useFrame((state, delta) => {
    frameTime.current += delta
    if (frameTime.current < 0.075) return
    frameTime.current = 0
    const current = getSnapshot()
    const all = labels.current
    for (const item of all.values()) {
      item.element.style.visibility = 'hidden'
      item.line.style.visibility = 'hidden'
    }
    if (!current.ready || !current.inspect || !current.hotspots || current.motion || current.exploding) {
      runtime.labels = []
      return
    }
    const exploded = current.explode > 0.98
    if (current.explode > 0.001 && !exploded) { runtime.labels = []; return }
    const mobile = state.size.width < 760
    const names = exploded ? PART_NAMES.filter((name) => name !== 'Magazine') : HOTSPOTS.map((spot) => spot.name)
    const candidates = []
    for (const name of names) {
      const item = all.get(name)
      const part = rig.parts.get(name)
      if (!item || !part) continue
      point.copy(part.anchor)
      part.node.localToWorld(point)
      point.project(state.camera)
      if (point.z < -1 || point.z > 1) continue
      const x = (point.x * 0.5 + 0.5) * state.size.width
      const y = (-point.y * 0.5 + 0.5) * state.size.height
      if (x < 0 || x > state.size.width || y < 80 || y > state.size.height - 130) continue
      candidates.push({ name, x, y, item, priority: name === current.selected ? -2 : ['BoltCarrier', 'MagSpring', 'MagFollower', 'Suppressor', 'UpperReceiver', 'Stock', 'MagBody', 'BufferSpring'].includes(name) ? -1 : 0 })
    }
    candidates.sort((a, b) => a.priority - b.priority || a.y - b.y)
    const rects = []
    const leaders = []
    const visible = []
    if (!exploded) {
      const diameter = mobile ? 44 : 30
      const lower = state.size.height - (mobile ? 154 : 228)
      for (const { name, x, y, item } of candidates) {
        if (visible.length >= (mobile ? 4 : 40)) break
        const left = Math.max(12, Math.min(state.size.width - diameter - 12, x - diameter / 2))
        const top = Math.max(mobile ? 186 : 145, Math.min(lower, y - diameter / 2))
        const rect = { left, top, right: left + diameter, bottom: top + diameter }
        if (rects.some((other) => rect.left < other.right + 4 && rect.right > other.left - 4 && rect.top < other.bottom + 4 && rect.bottom > other.top - 4)) continue
        rects.push(rect)
        item.element.dataset.layout = 'marker'
        item.element.dataset.active = current.selected === name || runtime.hovered === name ? 'true' : 'false'
        item.element.dataset.tooltip = x < 96 ? 'left' : x > state.size.width - 96 ? 'right' : 'center'
        item.element.setAttribute('aria-pressed', current.selected === name ? 'true' : 'false')
        item.element.style.transform = `translate3d(${left}px,${top}px,0)`
        item.element.style.width = `${diameter}px`
        item.element.style.height = `${diameter}px`
        item.element.style.visibility = 'visible'
        visible.push({ name, x: left, y: top, width: diameter, height: diameter, leader: null })
      }
      runtime.labels = visible
      return
    }
    const maximum = mobile ? 7 : 40
    const width = mobile ? 122 : 150
    const height = mobile ? 44 : 27
    const lower = state.size.height - (mobile ? 318 : 228)
    for (const candidate of candidates) {
      const { name, x, y, item } = candidate
      item.line.style.visibility = 'hidden'
      if (visible.length >= maximum) continue
      const preferredLeft = x < state.size.width / 2
      let placed = null
      for (const dy of [0, -35, 35, -70, 70, -105, 105, -140, 140, -175, 175]) {
        const left = preferredLeft ? Math.max(12, x - width - 20) : Math.min(state.size.width - width - 12, x + 20)
        const top = Math.max(mobile ? 186 : 145, Math.min(lower, y - height / 2 + dy))
        const rect = { left, top, right: left + width, bottom: top + height }
        const leader = { x1: x, y1: y, x2: preferredLeft ? rect.right : rect.left, y2: top + height / 2 }
        const overlaps = rects.some((other) => rect.left < other.right + 8 && rect.right > other.left - 8 && rect.top < other.bottom + 5 && rect.bottom > other.top - 5)
        const obstructed = rects.some((other) => leaderHitsRect(leader, other)) || leaders.some((other) => leaderHitsRect(other, rect) || leadersCross(other, leader))
        if (!overlaps && !obstructed) {
          placed = { ...rect, leader }
          break
        }
      }
      if (!placed) continue
      rects.push(placed)
      leaders.push(placed.leader)
      item.element.style.transform = `translate3d(${placed.left}px,${placed.top}px,0)`
      item.element.style.width = `${width}px`
      item.element.style.height = `${height}px`
      item.element.dataset.layout = 'label'
      item.element.dataset.active = current.selected === name || runtime.hovered === name ? 'true' : 'false'
      item.element.setAttribute('aria-pressed', current.selected === name ? 'true' : 'false')
      item.element.style.visibility = 'visible'
      item.line.setAttribute('x1', x)
      item.line.setAttribute('y1', y)
      item.line.setAttribute('x2', placed.leader.x2)
      item.line.setAttribute('y2', placed.leader.y2)
      item.line.style.visibility = 'visible'
      visible.push({ name, x: placed.left, y: placed.top, width, height, leader: placed.leader })
    }
    runtime.labels = visible
  }, 0)

  function onPointerMove(event) {
    const current = getSnapshot()
    if (!current.inspect || current.motion || current.exploding) return
    const part = namedAncestor(event.object, rig.root)
    if (!part) return
    event.stopPropagation()
    runtime.hovered = part.name
    document.body.style.cursor = 'pointer'
  }
  function onPointerOut(event) {
    const part = namedAncestor(event.object, rig.root)
    if (runtime.hovered === part?.name) runtime.hovered = null
    document.body.style.cursor = runtime.hovered ? 'pointer' : ''
  }
  function onClick(event) {
    if (!getSnapshot().inspect || event.delta > 4) return
    const part = namedAncestor(event.object, rig.root)
    if (part) { event.stopPropagation(); experience.selectPart(part.name) }
  }
  return <primitive object={gltf.scene} dispose={null} onPointerMove={onPointerMove} onPointerOut={onPointerOut} onClick={onClick} />
}

function Scene({ labels }) {
  const controls = useRef()
  const motion = useRef()
  return (
    <>
      <OrbitControls ref={controls} makeDefault enabled={false} enableDamping dampingFactor={0.075} enablePan minDistance={1.6} maxDistance={120} minPolarAngle={0.015} maxPolarAngle={Math.PI - 0.015} rotateSpeed={0.65} zoomSpeed={0.7} panSpeed={0.7} autoRotateSpeed={0.55} />
      <Studio />
      <group ref={motion}>
        <Suspense fallback={null}><Rifle controls={controls} motion={motion} labels={labels} /></Suspense>
      </group>
      <Effects />
    </>
  )
}

function AnnotationLayer({ elements }) {
  const elementNodes = useRef(new Map())
  const lineNodes = useRef(new Map())
  function link(name) {
    const element = elementNodes.current.get(name)
    const line = lineNodes.current.get(name)
    if (element && line) elements.current.set(name, { element, line })
    else elements.current.delete(name)
  }
  return (
    <div className="annotations" aria-label="Model annotations">
      <svg className="annotation-lines" aria-hidden="true">{PART_NAMES.map((name) => <line key={name} ref={(node) => { lineNodes.current.set(name, node); link(name) }} />)}</svg>
      {PART_NAMES.map((name) => <button key={name} className="model-label" ref={(node) => { elementNodes.current.set(name, node); link(name) }} onPointerEnter={() => { runtime.hovered = name }} onPointerLeave={() => { if (runtime.hovered === name) runtime.hovered = null }} onFocus={() => { runtime.hovered = name }} onBlur={() => { if (runtime.hovered === name) runtime.hovered = null }} onClick={() => experience.selectPart(name)} aria-label={`Inspect ${partLabel(name)}`}><i aria-hidden="true" /><span>{partLabel(name)}</span></button>)}
    </div>
  )
}

export default function Viewer() {
  const state = useExperience()
  const labels = useRef(new Map())
  const host = useRef(null)
  useLayoutEffect(() => {
    if (state.inspect || state.chapter === 'hero') return
    const section = document.getElementById(state.chapter)
    const placeStage = () => {
      const top = section.getBoundingClientRect().top + window.scrollY
      host.current.style.setProperty('--chapter-top', `${top}px`)
    }
    placeStage()
    const observer = new ResizeObserver(placeStage)
    observer.observe(document.getElementById('study'))
    return () => observer.disconnect()
  }, [state.inspect, state.chapter])
  return (
    <div ref={host} className={`viewer ${state.inspect ? 'viewer-inspect' : state.chapter !== 'hero' ? 'viewer-chapter' : ''}`} aria-label="Interactive M4A1-S Printstream 3D model">
      <AssetBoundary>
        <Canvas
          camera={{ position: [-1.8, 2.1, 14], fov: 32, near: 0.05, far: 160 }}
          dpr={[1, 2]}
          gl={{ antialias: false, alpha: true, powerPreference: 'high-performance' }}
          onCreated={({ gl }) => { gl.toneMapping = NeutralToneMapping; gl.toneMappingExposure = 1; gl.outputColorSpace = SRGBColorSpace; gl.setClearColor(0x000000, 0); updateState({ error: null }) }}
          fallback={<WebGLUnavailable />}
        >
          <Scene labels={labels} />
        </Canvas>
        <AnnotationLayer elements={labels} />
      </AssetBoundary>
      <LoadProgress />
      {state.error && !state.ready && <div className="context-error" role="alert"><p>{state.error}</p><button onClick={() => window.location.reload()}>Reload studio</button></div>}
    </div>
  )
}
