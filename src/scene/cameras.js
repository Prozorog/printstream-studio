import { Box3, MathUtils, Matrix4, Quaternion, Vector3 } from 'three'

export const CHAPTERS = ['hero', 'suppressor', 'receiver', 'magazine', 'stock', 'finish']
const look = new Matrix4()
const quaternion = new Quaternion()
const right = new Vector3()
const up = new Vector3()
const forward = new Vector3()
const offset = new Vector3()
const corner = new Vector3()

const definitions = {
  hero: { center: [0, -0.35, 0], direction: [-0.14, 0.17, 1], width: 11.6, height: 4.4, screenX: 0, screenY: -0.05 },
  left: { center: [0, -0.4, 0], direction: [0, 0.015, 1], width: 11.4, height: 4.4 },
  right: { center: [0, -0.4, 0], direction: [0, 0.015, -1], width: 11.4, height: 4.4 },
  top: { center: [0, -0.2, 0], direction: [0, 1, 0.01], width: 11.5, height: 4 },
  muzzle: { center: [-3.8, 0, 0], direction: [-1, 0.16, 0.22], width: 3.3, height: 3.2 },
  closeup: { center: [1.03, -0.02, 0], direction: [-0.28, 0.2, 1], width: 3.5, height: 2.7 },
  suppressor: { center: [-4.0, 0, 0], direction: [-0.25, 0.23, 1], width: 5.2, height: 3.1 },
  receiver: { center: [1.0, -0.12, 0], direction: [0.1, 0.16, -1], width: 5.5, height: 3.5 },
  magazine: { center: [0.65, -1.25, 0], direction: [-0.16, 0.14, 1], width: 4.9, height: 4.4 },
  stock: { center: [3.9, -0.35, 0], direction: [0.25, 0.19, 1], width: 5.2, height: 3.2 },
  finish: { center: [-0.85, 0, 0], direction: [-0.35, 0.34, 1], width: 6.5, height: 3.5 },
}

export function presetPose(name, aspect, { inspect = false, mobile = false } = {}) {
  const definition = definitions[name]
  if (!definition) return null
  const direction = new Vector3(...definition.direction).normalize()
  const target = new Vector3(...definition.center)
  const verticalFov = MathUtils.degToRad(32)
  const horizontalTangent = Math.tan(verticalFov / 2) * aspect
  let distance = Math.max(definition.width / (2 * horizontalTangent), definition.height / (2 * Math.tan(verticalFov / 2)))
  if (inspect && mobile) distance *= 1.14
  const position = target.clone().addScaledVector(direction, distance)
  return {
    px: position.x, py: position.y, pz: position.z,
    tx: target.x, ty: target.y, tz: target.z,
    sx: 0,
    sy: inspect && mobile ? 0.06 : definition.screenY ?? 0,
  }
}

export function fitBoxPose(box, camera, { mobile = false, view = 'hero' } = {}) {
  const bounds = box.clone().expandByScalar(0.24)
  const center = bounds.getCenter(new Vector3())
  forward.fromArray(definitions[view].direction).normalize()
  look.lookAt(forward, new Vector3(), new Vector3(0, 1, 0))
  quaternion.setFromRotationMatrix(look)
  right.set(1, 0, 0).applyQuaternion(quaternion)
  up.set(0, 1, 0).applyQuaternion(quaternion)
  const tangent = Math.tan(MathUtils.degToRad(camera.fov / 2))
  const verticalRoom = mobile ? 0.44 : 0.60
  const horizontalRoom = mobile ? 0.87 : 0.86
  let distance = 0
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z)
    offset.copy(corner).sub(center)
    const depth = offset.dot(forward)
    distance = Math.max(distance, Math.abs(offset.dot(right)) / (tangent * camera.aspect * horizontalRoom) + depth, Math.abs(offset.dot(up)) / (tangent * verticalRoom) + depth)
  }
  const position = center.clone().addScaledVector(forward, distance)
  return { px: position.x, py: position.y, pz: position.z, tx: center.x, ty: center.y, tz: center.z, sx: 0, sy: mobile ? 0.08 : 0.06 }
}

// The chapter Canvas occupies a real layout column (or the reserved mobile
// region above the copy). Fit semantic moving parts in that viewport rather
// than pushing a full-width close-up underneath the text with a view offset.
export function createChapterFramer(rig, camera) {
  const groupNames = {
    suppressor: ['Suppressor', 'Suppressor_Collar', 'FrontSight', 'Handguard_Top', 'Handguard_Bottom', 'HandguardCap', 'DeltaRing'],
    receiver: ['UpperReceiver', 'LowerReceiver', 'CarryHandle', 'RearSight', 'DustCover', 'ForwardAssist', 'ChargingHandle', 'Trigger', 'TriggerGuard', 'SelectorLever', 'BoltCatch', 'MagRelease', 'PistolGrip'],
    magazine: ['LowerReceiver', 'MagBody', 'MagFollower', 'MagSpring', 'MagBaseplate', 'Cartridge', 'Cartridge_02', 'Cartridge_03', 'Cartridge_04', 'Cartridge_05'],
    stock: ['UpperReceiver', 'CarryHandle', 'BufferTube', 'Stock', 'StockLever', 'ButtPad'],
    finish: [...rig.parts.keys()],
  }
  const groups = {}
  for (const [name, partNames] of Object.entries(groupNames)) {
    const meshes = []
    for (const partName of partNames) meshes.push(...rig.parts.get(partName).meshes)
    groups[name] = meshes
  }
  const bounds = new Box3()
  const meshBounds = new Box3()
  const center = new Vector3()
  const position = new Vector3()
  const origin = new Vector3()
  const vertical = new Vector3(0, 1, 0)

  return function frameChapter(target, name, mobile) {
    if (name === 'hero') return Object.assign(target, presetPose('hero', camera.aspect, { mobile }))
    const definition = definitions[name]
    bounds.makeEmpty()
    for (const mesh of groups[name]) {
      meshBounds.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld)
      bounds.union(meshBounds)
    }
    bounds.expandByScalar(0.18).getCenter(center)
    forward.fromArray(definition.direction).normalize()
    look.lookAt(forward, origin, vertical)
    quaternion.setFromRotationMatrix(look)
    right.set(1, 0, 0).applyQuaternion(quaternion)
    up.set(0, 1, 0).applyQuaternion(quaternion)
    const tangent = Math.tan(MathUtils.degToRad(camera.fov / 2))
    const horizontalRoom = 0.88
    const verticalRoom = 0.78
    let distance = Math.max(
      definition.width / (2 * tangent * camera.aspect * horizontalRoom),
      definition.height / (2 * tangent * verticalRoom),
    )
    for (let index = 0; index < 8; index++) {
      corner.set(index & 1 ? bounds.max.x : bounds.min.x, index & 2 ? bounds.max.y : bounds.min.y, index & 4 ? bounds.max.z : bounds.min.z)
      offset.copy(corner).sub(center)
      const depth = offset.dot(forward)
      distance = Math.max(distance, Math.abs(offset.dot(right)) / (tangent * camera.aspect * horizontalRoom) + depth, Math.abs(offset.dot(up)) / (tangent * verticalRoom) + depth)
    }
    position.copy(center).addScaledVector(forward, distance)
    target.px = position.x
    target.py = position.y
    target.pz = position.z
    target.tx = center.x
    target.ty = center.y
    target.tz = center.z
    target.sx = target.sy = 0
    return target
  }
}

export function blendPose(target, from, to, amount) {
  for (const key of ['px', 'py', 'pz', 'tx', 'ty', 'tz', 'sx', 'sy']) target[key] = MathUtils.lerp(from[key] ?? 0, to[key] ?? 0, amount)
  return target
}

export function liveBounds(root, target = new Box3()) {
  root.updateWorldMatrix(true, true)
  return target.setFromObject(root)
}
