import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { explode as blenderExplode } from '../../artifacts/geometry-stats.json'

export const PART_NAMES = [
  'Suppressor', 'Suppressor_Collar', 'Barrel', 'FrontSight', 'BayonetLug', 'GasBlock',
  'Handguard_Top', 'Handguard_Bottom', 'DeltaRing', 'HandguardCap', 'UpperReceiver',
  'CarryHandle', 'RearSight', 'DustCover', 'ForwardAssist', 'ChargingHandle', 'BoltCarrier', 'Bolt',
  'LowerReceiver', 'Trigger', 'TriggerGuard', 'Hammer', 'SelectorLever', 'BoltCatch', 'MagRelease',
  'TakedownPin_Front', 'TakedownPin_Rear', 'Magazine', 'MagBody', 'MagFollower', 'MagSpring',
  'MagBaseplate', 'Cartridge', 'Cartridge_02', 'Cartridge_03', 'Cartridge_04', 'Cartridge_05',
  'PistolGrip', 'BufferTube', 'BufferSpring', 'Buffer', 'Stock', 'StockLever', 'ButtPad',
]
const knownNames = new Set(PART_NAMES)
const magazineParts = new Set(['Magazine', 'MagBody', 'MagFollower', 'MagSpring', 'MagBaseplate', 'Cartridge', 'Cartridge_02', 'Cartridge_03', 'Cartridge_04', 'Cartridge_05'])
const stockParts = new Set(['Stock', 'StockLever', 'ButtPad'])
const upperAssembly = new Set(['UpperReceiver', 'CarryHandle', 'RearSight'])
const upperInternals = new Set(['ChargingHandle', 'BoltCarrier', 'Bolt'])
const barrelAssembly = new Set(['Barrel', 'FrontSight', 'BayonetLug', 'GasBlock', 'DeltaRing', 'HandguardCap', 'Handguard_Top', 'Handguard_Bottom'])
const bufferAssembly = new Set(['BufferTube', 'BufferSpring', 'Buffer'])
const cartridgeColumn = ['Cartridge', 'Cartridge_02', 'Cartridge_03', 'Cartridge_04', 'Cartridge_05']

function stage(progress, start, end) {
  const value = Math.max(0, Math.min(1, (progress - start) / (end - start)))
  return value * value * (3 - 2 * value)
}

export function partLabel(name) {
  return name.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace('Mag ', 'Magazine ')
}

// glTF exporters can put a named pivot above several material primitives. Resolve
// semantic ancestors, never assume that gltf.nodes[name] is the moving mesh.
export function namedAncestor(object, root) {
  let part = null
  let cursor = object
  while (cursor && cursor !== root.parent) {
    if (knownNames.has(cursor.name)) {
      if (!part || cursor.name === part.name) part = cursor
      else break
    }
    cursor = cursor.parent
  }
  return part
}

export function createRig(root) {
  root.updateWorldMatrix(true, true)
  const nodes = new Map()
  root.traverse((object) => {
    if (knownNames.has(object.name)) {
      const current = nodes.get(object.name)
      if (!current || current.isMesh && !object.isMesh) nodes.set(object.name, object)
    }
  })
  const missing = PART_NAMES.filter((name) => !nodes.has(name))
  if (missing.length) throw new Error(`The GLB is missing required named pivots: ${missing.join(', ')}. Re-export the complete asset with its part names preserved.`)

  const inverseRoot = new Matrix4().copy(root.matrixWorld).invert()
  const rootQuaternion = root.getWorldQuaternion(new Quaternion())
  const inverseRootQuaternion = rootQuaternion.clone().invert()
  const parts = new Map()
  for (const [name, node] of nodes) {
    let depth = 0
    for (let parent = node.parent; parent; parent = parent.parent) depth++
    parts.set(name, {
      name, node, depth, meshes: [], box: new Box3(),
      restPosition: node.position.clone(), restQuaternion: node.quaternion.clone(), restScale: node.scale.clone(),
      origin: node.getWorldPosition(new Vector3()).applyMatrix4(inverseRoot),
      orientation: node.getWorldQuaternion(new Quaternion()).premultiply(inverseRootQuaternion),
      destination: new Vector3(), center: new Vector3(), size: new Vector3(),
      offset: new Vector3(), rotation: new Euler(),
    })
  }
  const matrix = new Matrix4()
  const meshBox = new Box3()
  root.traverse((mesh) => {
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.layers.enable(1)
    const ancestor = namedAncestor(mesh, root)
    if (!ancestor) return
    const part = parts.get(ancestor.name)
    part.meshes.push(mesh)
    mesh.geometry.computeBoundingBox()
    matrix.multiplyMatrices(inverseRoot, mesh.matrixWorld)
    meshBox.copy(mesh.geometry.boundingBox).applyMatrix4(matrix)
    part.box.union(meshBox)
  })
  for (const part of parts.values()) {
    if (part.box.isEmpty()) part.box.set(part.origin.clone(), part.origin.clone())
    part.box.getCenter(part.center)
    part.box.getSize(part.size)
  }
  for (const part of parts.values()) {
    const center = part.name === 'Magazine' ? parts.get('MagBody').center : part.center
    part.anchor = part.node.worldToLocal(center.clone().applyMatrix4(root.matrixWorld))
  }

  // The Blender asset owns the anatomical layout. These are offsets, not
  // destinations: glTF axes are (Blender X, Blender Z, -Blender Y).
  const magazineDelta = new Vector3(
    blenderExplode.Magazine[0], blenderExplode.Magazine[2], -blenderExplode.Magazine[1],
  )
  for (const part of parts.values()) {
    const offset = blenderExplode[part.name]
    if (offset) part.destination.set(offset[0], offset[2], -offset[1])
    else part.destination.set(0, 0, 0)
    if (magazineParts.has(part.name) && part.name !== 'Magazine') part.destination.add(magazineDelta)
  }
  // Root-space motion explicitly includes the magazine ancestor once. Keep its
  // internals in the canonical vertical column; add only measured Y clearance.
  const clearance = 0.075
  const body = parts.get('MagBody')
  const follower = parts.get('MagFollower')
  const spring = parts.get('MagSpring')
  const baseplate = parts.get('MagBaseplate')
  const bodyTop = body.box.max.y + body.destination.y
  const bodyBottom = body.box.min.y + body.destination.y
  follower.destination.y += Math.max(0, bodyTop + clearance - (follower.box.min.y + follower.destination.y))
  spring.destination.y -= Math.max(0, spring.box.max.y + spring.destination.y - (bodyBottom - clearance))
  baseplate.destination.y -= Math.max(0, baseplate.box.max.y + baseplate.destination.y - (spring.box.min.y + spring.destination.y - clearance))
  let columnTop = follower.box.max.y + follower.destination.y + clearance
  for (const name of cartridgeColumn) {
    const part = parts.get(name)
    part.destination.y += Math.max(0, columnTop - (part.box.min.y + part.destination.y))
    columnTop = part.box.max.y + part.destination.y + clearance
  }
  const explodedBox = new Box3()
  for (const part of parts.values()) {
    if (part.meshes.length) explodedBox.union(part.box.clone().translate(part.destination))
  }

  function anatomicalOffset(part, progress, offset) {
    const { name, destination } = part
    offset.set(0, 0, 0)
    if (name === 'LowerReceiver') return
    if (name === 'Suppressor' || name === 'Suppressor_Collar') {
      offset.x = destination.x * stage(progress, 0, 0.34)
      return
    }
    if (magazineParts.has(name)) {
      // Drop first, move the complete magazine column clear, then reveal it.
      offset.y = magazineDelta.y * stage(progress, 0.04, 0.30)
      offset.x = magazineDelta.x * stage(progress, 0.30, 0.50)
      offset.z = magazineDelta.z
      const reveal = stage(progress, 0.52, 1)
      offset.x += (destination.x - magazineDelta.x) * reveal
      offset.y += (destination.y - magazineDelta.y) * reveal
      offset.z += (destination.z - magazineDelta.z) * reveal
      return
    }
    if (stockParts.has(name)) {
      const stockBack = blenderExplode.Stock[0]
      offset.x = stockBack * stage(progress, 0, 0.42)
      offset.x += (destination.x - stockBack) * stage(progress, 0.68, 0.9)
      offset.y = destination.y * stage(progress, 0.68, 1)
      return
    }
    if (upperAssembly.has(name)) {
      offset.y = destination.y * stage(progress, 0.12, 0.46)
      return
    }
    if (upperInternals.has(name)) {
      const upperRise = blenderExplode.UpperReceiver[2]
      offset.y = upperRise * stage(progress, 0.12, 0.46)
      offset.x = destination.x * stage(progress, 0.46, 0.80)
      offset.y += (destination.y - upperRise) * stage(progress, 0.80, 1)
      return
    }
    if (name === 'DustCover' || name === 'ForwardAssist') {
      const upperRise = blenderExplode.UpperReceiver[2]
      offset.y = upperRise * stage(progress, 0.12, 0.46)
      offset.z = destination.z * stage(progress, 0.50, 0.70)
      offset.x = destination.x * stage(progress, 0.70, 0.85)
      offset.y += (destination.y - upperRise) * stage(progress, 0.85, 1)
      return
    }
    if (barrelAssembly.has(name)) {
      offset.x = destination.x * stage(progress, 0.12, 0.42)
      offset.y = destination.y * stage(progress, 0.42, 0.72)
      return
    }
    if (bufferAssembly.has(name)) {
      offset.x = destination.x * stage(progress, 0.44, 0.80)
      offset.y = destination.y * stage(progress, 0.80, 1)
      return
    }
    // Pins leave on their authored transverse axis before the lower details
    // separate. No arbitrary depth arcs or global shelf reordering are used.
    const pin = name === 'TakedownPin_Front' || name === 'TakedownPin_Rear'
    offset.z = destination.z * stage(progress, pin ? 0.02 : 0.70, pin ? 0.22 : 0.84)
    offset.y = destination.y * stage(progress, 0.50, 0.70)
    offset.x = destination.x * stage(progress, 0.84, 1)
  }
  const ordered = [...parts.values()].sort((a, b) => a.depth - b.depth)
  const worldPosition = new Vector3()
  const worldQuaternion = new Quaternion()
  const parentQuaternion = new Quaternion()
  const rotationQuaternion = new Quaternion()
  const rootWorldQuaternion = new Quaternion()
  const assembledBox = new Box3().setFromObject(root)

  function apply(mechanical, explode, assembly = 1) {
    root.updateWorldMatrix(true, false)
    root.getWorldQuaternion(rootWorldQuaternion)
    for (const part of ordered) {
      const { name, node } = part
      const offset = part.offset.set(0, 0, 0)
      part.rotation.set(0, 0, 0)
      if (name === 'Suppressor') {
        offset.x = -1.75 * mechanical.suppressor
        part.rotation.x = -Math.PI * 4 * mechanical.suppressor
      }
      if (name === 'DustCover') part.rotation.x = -Math.PI * 0.7 * mechanical.dustCover
      if (name === 'ChargingHandle') offset.x = 0.62 * mechanical.chargingHandle
      if (name === 'BoltCarrier' || name === 'Bolt') offset.x = 0.52 * mechanical.chargingHandle
      if (magazineParts.has(name)) offset.y = -1.6 * mechanical.magazine
      if (stockParts.has(name)) offset.x = 0.62 * mechanical.stock
      if (name === 'SelectorLever') part.rotation.z = -Math.PI / 2 * mechanical.selector
      if (name === 'Trigger') part.rotation.z = -0.22 * mechanical.trigger
      if (name === 'Hammer') part.rotation.z = 0.4 * mechanical.trigger
      if (name === 'MagRelease') offset.z = -0.05 * mechanical.magazine

      const separation = assembly < 1 ? (1 - assembly) * 0.32 : explode
      if (separation > 0) {
        anatomicalOffset(part, separation, offset)
        part.rotation.set(0, 0, 0)
      }
      worldPosition.copy(part.origin).add(offset).applyMatrix4(root.matrixWorld)
      node.parent.updateWorldMatrix(true, false)
      node.position.copy(node.parent.worldToLocal(worldPosition))
      rotationQuaternion.setFromEuler(part.rotation)
      worldQuaternion.copy(rootWorldQuaternion).multiply(part.orientation).multiply(rotationQuaternion)
      node.parent.getWorldQuaternion(parentQuaternion).invert()
      node.quaternion.copy(parentQuaternion.multiply(worldQuaternion))
      node.scale.copy(part.restScale)
      node.updateWorldMatrix(false, false)
    }
    root.updateWorldMatrix(false, true)
  }

  function restore() {
    for (const part of parts.values()) {
      part.node.position.copy(part.restPosition)
      part.node.quaternion.copy(part.restQuaternion)
      part.node.scale.copy(part.restScale)
    }
  }

  return { root, parts, assembledBox, explodedBox, apply, restore }
}
