import gsap from 'gsap'
import { Box3, MathUtils, Vector3 } from 'three'
import { ACTION_NAMES, CAMERA_PRESETS, copyMechanicalState, getSnapshot, runtime, updateState } from '../experience'
import { blendPose, CHAPTERS, createChapterFramer, fitBoxPose, liveBounds, presetPose } from './cameras'

const restMechanical = { suppressor: 0, dustCover: 0, chargingHandle: 0, magazine: 0, trigger: 0, selector: 0, stock: 0 }
const mechanicalKeys = Object.keys(restMechanical)
const clamp = (value) => Math.max(0, Math.min(1, value))

export function createController({ camera, controls, rig, motionRoot, size }) {
  const mechanical = { ...restMechanical }
  const animation = { explode: 0, assembly: 0, light: 35 }
  const mobileLayout = window.matchMedia('(max-width: 759px)')
  const framedMechanical = { ...restMechanical }
  let viewport = size
  let owner = 'scroll'
  let cameraTween = null
  let explodeTween = null
  let inspectTimeline = null
  let disposed = false
  let lastPublish = 0
  let sceneTime = 0
  let previousScroll = -1
  let previousExplode = -1
  let previousAssembly = -1
  let lastSize = ''
  let rememberedPreset = 'hero'
  const bounds = new Box3()
  const focusMeshBox = new Box3()
  const focusCenter = new Vector3()
  const focusDirection = new Vector3()
  const focusSize = new Vector3()
  const focusPosition = new Vector3()
  const pose = presetPose('hero', camera.aspect, { mobile: mobileLayout.matches })
  const scrollPose = { ...pose }
  const targetPose = { ...pose }
  const chapterFrom = { ...pose }
  const chapterTo = { ...pose }
  const frameChapter = createChapterFramer(rig, camera)
  const gsapContext = gsap.context(() => {})
  const tweens = new Set()
  runtime.camera = camera
  runtime.controls = controls
  runtime.root = rig.root
  runtime.parts = Object.fromEntries([...rig.parts].map(([name, part]) => [name, part.node]))

  const reduced = () => getSnapshot().reducedMotion
  function publish(force = false) {
    const now = performance.now()
    if (!force && now - lastPublish < 65) return
    lastPublish = now
    updateState({ mechanical: copyMechanicalState(mechanical), explode: animation.explode })
  }
  function tween(target, values) {
    let result
    gsapContext.add(() => {
      result = gsap.to(target, { ...values, onComplete: () => { tweens.delete(result); values.onComplete?.() } })
      tweens.add(result)
    })
    return result
  }
  function setOwner(value) {
    if (owner === value) return
    owner = value
    controls.enabled = value === 'orbit'
    updateState({ cameraOwner: value })
  }
  function currentPose() {
    return { px: camera.position.x, py: camera.position.y, pz: camera.position.z, tx: controls.target.x, ty: controls.target.y, tz: controls.target.z, sx: pose.sx, sy: pose.sy }
  }
  function syncOrbit() {
    // Flush residual drag momentum before handing the camera back.
    const damping = controls.enableDamping
    controls.enableDamping = false
    controls.update()
    applyCamera()
    controls.update()
    controls.enableDamping = damping
  }
  function moveCamera(next, { immediate = false, nextOwner = getSnapshot().inspect ? 'orbit' : 'preset', duration = 0.85 } = {}) {
    cameraTween?.kill()
    Object.assign(pose, currentPose())
    setOwner('transition')
    if (immediate || reduced()) {
      Object.assign(pose, next)
      applyCamera()
      syncOrbit()
      setOwner(nextOwner)
      return
    }
    cameraTween = tween(pose, {
      ...next, duration, ease: 'power2.inOut', overwrite: true,
      onComplete: () => { applyCamera(); syncOrbit(); setOwner(nextOwner) },
    })
  }
  function applyCamera() {
    camera.position.set(pose.px, pose.py, pose.pz)
    controls.target.set(pose.tx, pose.ty, pose.tz)
    camera.up.set(0, 1, 0)
    camera.lookAt(controls.target)
    const sx = Math.abs(pose.sx) < 0.00001 ? 0 : pose.sx
    const sy = Math.abs(pose.sy) < 0.00001 ? 0 : pose.sy
    if (sx || sy) camera.setViewOffset(viewport.width, viewport.height, viewport.width * sx, viewport.height * sy, viewport.width, viewport.height)
    else if (camera.view?.enabled) camera.clearViewOffset()
    camera.updateMatrixWorld()
  }
  function unavailable() {
    if (animation.explode > 0.001 || getSnapshot().exploding) {
      const reason = 'Reassemble the model to operate its controls. The exploded layout is an illustrative asset breakdown.'
      updateState({ message: reason })
      return { ok: false, reason }
    }
    if (inspectTimeline?.isActive()) {
      const reason = 'Let the inspect motion return before operating a part.'
      updateState({ message: reason })
      return { ok: false, reason }
    }
    return null
  }
  function stopInspectMotion() {
    inspectTimeline?.kill()
    inspectTimeline = null
    motionRoot.position.set(0, 0, 0)
    motionRoot.rotation.set(0, 0, 0)
    updateState({ motion: false })
  }
  function setMechanical(name, progress, { immediate = false } = {}) {
    if (!(name in mechanical) || !Number.isFinite(progress)) return { ok: false, reason: 'Unknown mechanical control or non-finite progress.' }
    const blocked = unavailable()
    if (blocked) return blocked
    const value = name === 'stock' ? Math.round(clamp(progress) * 3) / 3 : clamp(progress)
    gsap.killTweensOf(mechanical, name)
    if (immediate || reduced()) {
      mechanical[name] = value
      rig.apply(mechanical, animation.explode, animation.assembly)
      publish(true)
    } else {
      tween(mechanical, { [name]: value, duration: name === 'suppressor' ? 1.05 : 0.52, ease: 'power2.inOut', onUpdate: publish, onComplete: () => publish(true) })
    }
    return { ok: true, name, progress: value }
  }
  function pulse(name) {
    const blocked = unavailable()
    if (blocked) return blocked
    gsap.killTweensOf(mechanical, name)
    if (name === 'chargingHandle') setMechanical('dustCover', 1)
    if (reduced()) {
      mechanical[name] = mechanical[name] > 0.5 ? 0 : 1
      publish(true)
      return { ok: true }
    }
    gsapContext.add(() => {
      const timeline = gsap.timeline({ onUpdate: publish, onComplete: () => publish(true) })
      timeline.to(mechanical, { [name]: 1, duration: name === 'trigger' ? 0.16 : 0.32, ease: 'power2.out' })
        .to(mechanical, { [name]: 0, duration: name === 'trigger' ? 0.22 : 0.42, ease: 'power2.inOut' }, '+=0.12')
    })
    return { ok: true }
  }
  function setExplode(progress, { immediate = false } = {}) {
    if (!Number.isFinite(progress)) return { ok: false, reason: 'Explode progress must be finite.' }
    const value = clamp(progress)
    explodeTween?.kill()
    cameraTween?.kill()
    stopInspectMotion()
    const wasMoving = Object.values(mechanical).some((p) => p > 0.001)
    gsap.killTweensOf(mechanical)
    updateState({ exploding: !immediate && !reduced(), autoRotate: false, selected: null, message: value > 0 ? 'Reassemble to operate the controls.' : 'Returning every part to its original transform.' })
    setOwner('explode')
    if (immediate || reduced()) {
      Object.assign(mechanical, restMechanical)
      animation.explode = value
      rig.apply(mechanical, value, 1)
      if (value > 0) Object.assign(pose, fitBoxPose(liveBounds(rig.root, bounds), camera, { mobile: mobileLayout.matches, view: rememberedPreset }))
      else Object.assign(pose, presetPose(rememberedPreset, camera.aspect, { inspect: getSnapshot().inspect, mobile: mobileLayout.matches }))
      applyCamera()
      syncOrbit()
      updateState({ exploding: false })
      setOwner(getSnapshot().inspect ? 'orbit' : value > 0 ? 'exploded' : 'preset')
      publish(true)
      return { ok: true, progress: value }
    }
    const duration = Math.max(0.2, 2.2 * Math.abs(value - animation.explode))
    gsapContext.add(() => {
      explodeTween = gsap.timeline({
        onUpdate: publish,
        onComplete: () => {
          updateState({ exploding: false, message: value > 0 ? 'Exploded view. Reassemble to operate the controls.' : 'Assembled. All controls are available.' })
          syncOrbit()
          setOwner(getSnapshot().inspect ? 'orbit' : value > 0 ? 'exploded' : 'preset')
          publish(true)
        },
      })
      if (wasMoving) explodeTween.to(mechanical, { ...restMechanical, duration: Math.min(0.25, duration / 3), ease: 'power2.inOut' })
      explodeTween.to(animation, { explode: value, duration: duration - (wasMoving ? Math.min(0.25, duration / 3) : 0), ease: 'none' })
    })
    return { ok: true, progress: value }
  }
  function preset(name, options = {}) {
    if (!CAMERA_PRESETS.includes(name)) return { ok: false, reason: `Choose a camera: ${CAMERA_PRESETS.join(', ')}.` }
    stopInspectMotion()
    rememberedPreset = name
    updateState({ preset: name, autoRotate: false, selected: null })
    let next
    if (animation.explode > 0.001) {
      liveBounds(rig.root, bounds)
      if (name === 'closeup') {
        bounds.makeEmpty()
        for (const mesh of rig.parts.get('UpperReceiver').meshes) bounds.expandByObject(mesh)
        updateState({ selected: 'UpperReceiver' })
      }
      next = fitBoxPose(bounds, camera, { mobile: mobileLayout.matches, view: name })
    } else {
      next = presetPose(name, camera.aspect, { inspect: getSnapshot().inspect, mobile: mobileLayout.matches })
    }
    moveCamera(next, options)
    return { ok: true, preset: name }
  }
  function setLight(angle, { immediate = false } = {}) {
    if (!Number.isFinite(angle)) return { ok: false, reason: 'Light angle must be finite.' }
    const value = MathUtils.clamp(angle, -180, 180)
    gsap.killTweensOf(animation, 'light')
    updateState({ light: value })
    if (immediate || reduced()) animation.light = value
    else tween(animation, { light: value, duration: 0.5, ease: 'power2.out' })
    return { ok: true, angle: value }
  }
  function enterInspect() {
    if (getSnapshot().inspect) return { ok: true }
    updateState({ inspect: true, selected: null })
    if (animation.explode > 0.001) moveCamera(fitBoxPose(liveBounds(rig.root, bounds), camera, { mobile: mobileLayout.matches, view: rememberedPreset }), { nextOwner: 'orbit' })
    else preset('hero')
    return { ok: true }
  }
  function exitInspect() {
    stopInspectMotion()
    updateState({ inspect: false, selected: null, autoRotate: false })
    if (animation.explode > 0.001) setExplode(0)
    else moveCamera(scrollPose, { nextOwner: 'scroll' })
    return { ok: true }
  }
  function inspectMotion({ progress } = {}) {
    const blocked = unavailable()
    if (blocked) return blocked
    cameraTween?.kill()
    stopInspectMotion()
    updateState({ motion: true, autoRotate: false, selected: null })
    const returnOwner = getSnapshot().inspect ? 'orbit' : 'preset'
    Object.assign(pose, presetPose('hero', camera.aspect, { inspect: getSnapshot().inspect, mobile: mobileLayout.matches }))
    setOwner('inspect-motion')
    gsapContext.add(() => {
      inspectTimeline = gsap.timeline({
        paused: Number.isFinite(progress),
        onComplete: () => { updateState({ motion: false }); setOwner(returnOwner) },
      })
      inspectTimeline
        .to(motionRoot.position, { x: 0.34, y: 0.45, duration: 0.55, ease: 'power2.inOut' }, 0)
        .to(motionRoot.rotation, { x: -0.13, y: 0.48, z: 0.11, duration: 0.75, ease: 'power2.inOut' }, 0.15)
        .to(motionRoot.rotation, { x: 0.24, y: -Math.PI + 0.12, z: -0.12, duration: 0.95, ease: 'power2.inOut' }, 1.0)
        .to(motionRoot.rotation, { x: -0.08, y: -Math.PI + 0.28, z: 0.17, duration: 0.65, ease: 'power2.inOut' }, 2.15)
        .to(motionRoot.rotation, { x: 0, y: 0, z: 0, duration: 0.8, ease: 'power2.inOut' }, 3.0)
        .to(motionRoot.position, { x: 0, y: 0, z: 0, duration: 0.8, ease: 'power2.inOut' }, 3.0)
      if (Number.isFinite(progress)) inspectTimeline.progress(clamp(progress))
      else if (reduced()) { inspectTimeline.progress(1); updateState({ message: 'Inspect motion skipped because reduced motion is enabled.' }) }
    })
    return { ok: true, duration: 3.8 }
  }
  function focusPart(part, immediate = false) {
    const meshes = part.name === 'Magazine' ? rig.parts.get('MagBody').meshes : part.meshes
    bounds.makeEmpty()
    rig.root.updateWorldMatrix(true, true)
    for (const mesh of meshes) {
      focusMeshBox.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld)
      bounds.union(focusMeshBox)
    }
    bounds.getCenter(focusCenter)
    const radius = bounds.getSize(focusSize).length() * 0.5
    const mobile = mobileLayout.matches
    const tangent = Math.tan(MathUtils.degToRad(camera.fov * 0.5))
    const distance = Math.max(2.2, radius / (tangent * (mobile ? 0.20 : 0.55)), radius / (tangent * camera.aspect * (mobile ? 0.78 : 0.62)))
    focusDirection.copy(camera.position).sub(controls.target).normalize()
    focusPosition.copy(focusCenter).addScaledVector(focusDirection, distance)
    moveCamera({
      px: focusPosition.x, py: focusPosition.y, pz: focusPosition.z,
      tx: focusCenter.x, ty: focusCenter.y, tz: focusCenter.z,
      sx: mobile ? 0 : -0.12, sy: mobile ? 0.18 : 0,
    }, { immediate, duration: 0.85, nextOwner: 'orbit' })
  }
  function selectPart(name) {
    const part = rig.parts.get(name)
    if (!part) return { ok: false, reason: 'Part not found.' }
    const state = getSnapshot()
    if (state.motion || state.exploding) {
      const reason = 'Let the current motion settle before focusing a part.'
      updateState({ message: reason })
      return { ok: false, reason }
    }
    if (!state.inspect) enterInspect()
    updateState({ selected: name, preset: 'closeup', autoRotate: false })
    focusPart(part)
    return { ok: true, part: name }
  }
  function reset() {
    stopInspectMotion()
    cameraTween?.kill()
    setLight(35)
    rememberedPreset = 'hero'
    updateState({ selected: null, autoRotate: false, hotspots: true, preset: 'hero', message: 'Restoring the original assembly, camera, and studio lighting.' })
    if (animation.explode > 0.001 || getSnapshot().exploding) {
      setExplode(0)
    } else {
      gsap.killTweensOf(mechanical)
      tween(mechanical, { ...restMechanical, duration: reduced() ? 0 : 0.65, ease: 'power2.inOut', onUpdate: publish, onComplete: () => publish(true) })
      preset('hero')
    }
    return { ok: true }
  }
  function action(name) {
    if (!ACTION_NAMES.includes(name)) return { ok: false, reason: `Unknown action: ${name}.` }
    if (name === 'reset') return reset()
    if (name === 'fieldstrip') return setExplode(animation.explode > 0.5 ? 0 : 1)
    if (name === 'reassemble') return setExplode(0)
    if (name === 'hotspots') { updateState({ hotspots: !getSnapshot().hotspots, selected: null }); return { ok: true } }
    if (name === 'autoRotate') {
      if (reduced()) {
        const reason = 'Automatic rotation is unavailable while reduced motion is enabled. You can still drag to orbit.'
        updateState({ message: reason, autoRotate: false })
        return { ok: false, reason }
      }
      if (!getSnapshot().inspect) enterInspect()
      updateState({ autoRotate: !getSnapshot().autoRotate })
      return { ok: true }
    }
    if (name === 'chargingHandle' || name === 'trigger') return pulse(name)
    if (name === 'stock') return setMechanical('stock', mechanical.stock > 0.99 ? 0 : mechanical.stock + 1 / 3)
    return setMechanical(name, mechanical[name] > 0.5 ? 0 : 1)
  }

  function frame(delta, currentSize) {
    if (disposed) return
    viewport = currentSize
    sceneTime += delta
    const mobile = mobileLayout.matches
    const state = getSnapshot()
    const scroll = MathUtils.clamp(runtime.scroll.chapter, 0, 5)
    const sizeKey = `${viewport.width}/${viewport.height}`
    const resized = sizeKey !== lastSize
    let mechanicalChanged = false
    for (const key of mechanicalKeys) {
      if (mechanical[key] !== framedMechanical[key]) { mechanicalChanged = true; break }
    }
    if (!state.motion) {
      motionRoot.position.set(0, 0, 0)
      motionRoot.rotation.set(0, 0, 0)
      if (!runtime.verify && !reduced() && animation.explode === 0 && !state.inspect) motionRoot.position.y = Math.sin(sceneTime * 0.55) * 0.018
    }
    rig.apply(mechanical, animation.explode, animation.assembly)
    // Measure after the named pivots have moved. Cache settled poses; bounds
    // update only for a scroll/resize or an actual moving-part change.
    const restored = previousExplode > 0 && animation.explode === 0
    if (animation.explode === 0 && (scroll !== previousScroll || resized || mechanicalChanged || restored || (scroll > 0 && previousAssembly !== animation.assembly))) {
      const low = Math.floor(scroll)
      const high = Math.min(5, low + 1)
      frameChapter(chapterFrom, CHAPTERS[low], mobile)
      frameChapter(chapterTo, CHAPTERS[high], mobile)
      blendPose(scrollPose, chapterFrom, chapterTo, scroll - low)
      for (const key of mechanicalKeys) framedMechanical[key] = mechanical[key]
    }
    previousAssembly = animation.assembly
    if (resized) {
      lastSize = sizeKey
      if (state.ready && !state.motion && !state.exploding && owner !== 'scroll') {
        if (!state.inspect && animation.explode === 0) moveCamera(scrollPose, { immediate: true, nextOwner: 'scroll' })
        else if (state.selected) focusPart(rig.parts.get(state.selected), true)
        else {
          const next = animation.explode > 0.001 ? fitBoxPose(liveBounds(rig.root, bounds), camera, { mobile, view: state.preset }) : presetPose(state.preset, camera.aspect, { inspect: state.inspect, mobile })
          moveCamera(next, { immediate: true })
        }
      }
    }
    if (scroll !== previousScroll && !state.inspect && !state.motion && animation.explode < 0.001 && !state.exploding) {
      cameraTween?.kill()
      setOwner('scroll')
    }
    previousScroll = scroll
    if (owner === 'scroll') {
      if (animation.assembly < 1) blendPose(pose, fitBoxPose(liveBounds(rig.root, bounds), camera, { mobile }), scrollPose, animation.assembly)
      else Object.assign(pose, scrollPose)
    }
    if (owner === 'explode') {
      const assembled = presetPose(rememberedPreset, camera.aspect, { inspect: state.inspect, mobile })
      const expanded = fitBoxPose(liveBounds(rig.root, bounds), camera, { mobile, view: rememberedPreset })
      blendPose(targetPose, assembled, expanded, Math.min(1, animation.explode * 5))
      // The fieldstrip playhead owns both pose and framing, in either direction.
      Object.assign(pose, targetPose)
    }
    if (owner !== 'orbit') applyCamera()
    controls.enabled = owner === 'orbit' && state.inspect && !state.motion
    controls.autoRotate = controls.enabled && state.autoRotate && !reduced()
    if (previousExplode !== animation.explode) publish()
    previousExplode = animation.explode
  }

  function assemble() {
    updateState({ loaded: true, loadStage: 'Assembling the study', loadProgress: 100 })
    runtime.stats.loadMs = performance.now() - runtime.startedAt
    animation.assembly = reduced() ? 1 : 0
    tween(animation, {
      assembly: 1, duration: reduced() ? 0 : 1.8, ease: 'power3.out',
      onComplete: () => {
        if (disposed) return
        animation.assembly = 1
        updateState({ ready: true, loadStage: 'Ready', message: '' })
      },
    })
  }
  function dispose() {
    disposed = true
    gsapContext.revert()
    tweens.forEach((item) => item.kill())
    rig.restore()
    controls.enabled = false
    runtime.controller = null
    runtime.root = null
    runtime.parts = null
  }

  return { action, preset, setExplode, setLight, setMechanical, inspectMotion, enterInspect, exitInspect, selectPart, frame, assemble, dispose, animation, mechanical, rig }
}
