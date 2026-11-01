import { FrontSide, Group, Mesh, NormalBlending, ShaderMaterial } from 'three'

const ignoreRaycast = () => {}

// This material belongs only to the transient overlay. It never replaces or
// edits an asset material, and the geometry remains owned by the loaded GLB.
export function createHoverRim(rig, scene) {
  const sources = new Map()
  let capacity = 0
  let initialGeometry = null
  for (const [name, part] of rig.parts) {
    // Magazine is a semantic parent: its body is the visible outside envelope.
    const meshes = name === 'Magazine' ? rig.parts.get('MagBody').meshes : part.meshes
    sources.set(name, meshes)
    capacity = Math.max(capacity, meshes.length)
    if (!initialGeometry && meshes.length) initialGeometry = meshes[0].geometry
  }
  const material = new ShaderMaterial({
    name: 'PrintstreamHoverRim',
    uniforms: { strength: { value: 0 } },
    vertexShader: `
      varying vec3 viewNormal;
      varying vec3 viewPosition;
      void main() {
        viewNormal = normalize(normalMatrix * normal);
        vec4 positionVS = modelViewMatrix * vec4(position, 1.0);
        positionVS.xyz += viewNormal * 0.004;
        viewPosition = positionVS.xyz;
        gl_Position = projectionMatrix * positionVS;
      }
    `,
    fragmentShader: `
      uniform float strength;
      varying vec3 viewNormal;
      varying vec3 viewPosition;
      void main() {
        vec3 normalVS = normalize(viewNormal);
        vec3 toEye = normalize(-viewPosition);
        float edge = 1.0 - clamp(abs(dot(normalVS, toEye)), 0.0, 1.0);
        float rim = smoothstep(0.12, 0.96, pow(edge, 2.4));
        gl_FragColor = vec4(vec3(1.8), rim * strength);
      }
    `,
    transparent: true,
    blending: NormalBlending,
    side: FrontSide,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
    toneMapped: false,
  })
  const group = new Group()
  group.name = 'InspectHoverRim'
  group.layers.set(2)
  const pool = []
  for (let index = 0; index < capacity; index++) {
    const mesh = new Mesh(initialGeometry, material)
    mesh.name = `InspectHoverRim_${index}`
    mesh.layers.set(2)
    mesh.visible = false
    mesh.matrixAutoUpdate = false
    mesh.frustumCulled = false
    mesh.raycast = ignoreRaycast
    mesh.renderOrder = 20
    pool.push(mesh)
    group.add(mesh)
  }
  scene.add(group)
  let requestedName = null
  let activeSources = []
  let opacity = 0

  function setPart(name) {
    if (requestedName === name) return
    requestedName = name
    if (name && sources.has(name)) {
      activeSources = sources.get(name)
      opacity = 0
      for (let index = 0; index < pool.length; index++) {
        const source = activeSources[index]
        pool[index].visible = Boolean(source)
        if (source) pool[index].geometry = source.geometry
      }
    }
  }

  function frame(delta, reducedMotion) {
    const target = requestedName ? 0.72 : 0
    opacity = reducedMotion ? target : opacity + (target - opacity) * (1 - Math.exp(-16 * delta))
    material.uniforms.strength.value = opacity
    group.visible = opacity > 0.001
    if (!group.visible) return
    for (let index = 0; index < activeSources.length; index++) pool[index].matrix.copy(activeSources[index].matrixWorld)
    group.updateMatrixWorld(true)
  }

  function dispose() {
    scene.remove(group)
    group.clear()
    material.dispose()
    sources.clear()
    pool.length = 0
  }

  return { setPart, frame, dispose }
}
