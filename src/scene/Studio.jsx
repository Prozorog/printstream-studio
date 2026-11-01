import { memo, useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import { BackSide, BoxGeometry, Color, Mesh, MeshBasicMaterial, PlaneGeometry, PMREMGenerator, Scene } from 'three'
import { getSnapshot, runtime, useExperience } from '../experience'

// PMREM's sole VNDF call fixes V=(0,0,1), so T1=X, T2=Y and s=1.
// Its projected disk has t1²+t2²=Xi.x: use that identity instead of subtracting
// squared cardinal-angle trig residuals from one (ANGLE's X4122 cancellation).
class StudioPMREM extends PMREMGenerator {
  _allocateTargets() {
    const target = super._allocateTargets()
    this._ggxMaterial.fragmentShader = this._ggxMaterial.fragmentShader
      .replace(
        /vec3 importanceSampleGGX_VNDF\(vec2 Xi, vec3 V, float roughness\) \{[^}]*\}/,
        `vec3 importanceSampleGGXNormal(vec2 Xi, float roughness) {
          float alpha = roughness * roughness;
          float radius = sqrt(Xi.x);
          float phi = 2.0 * PI * Xi.y;
          vec2 disk = radius * vec2(cos(phi), sin(phi));
          float height = sqrt(max(0.0, 1.0 - Xi.x));
          return normalize(vec3(alpha * disk, height));
        }`,
      )
      .replace(
        'importanceSampleGGX_VNDF(Xi, vec3(0.0, 0.0, 1.0), roughness)',
        'importanceSampleGGXNormal(Xi, roughness)',
      )
    return target
  }
}

const CachedContactShadow = memo(function CachedContactShadow({ revision }) {
  const captured = useRef(null)
  useFrame(() => {
    if (captured.current !== revision) {
      runtime.contactShadowFrame = runtime.renderFrame
      captured.current = revision
    }
  }, -0.5)
  return <ContactShadows position={[0, -2.05, 0]} scale={18} opacity={0.22} blur={2.8} far={5} resolution={256} color="#555851" frames={1} />
})

function mechanicalSignature({ suppressor, dustCover, chargingHandle, magazine, trigger, selector, stock }) {
  return `${suppressor}|${dustCover}|${chargingHandle}|${magazine}|${trigger}|${selector}|${stock}`
}

export default function Studio() {
  const { gl, scene } = useThree()
  const light = useRef()
  const shadow = useRef()
  const state = useExperience()
  const [shadowPose, setShadowPose] = useState(() => mechanicalSignature(getSnapshot().mechanical))
  const mechanicalPose = mechanicalSignature(state.mechanical)
  useEffect(() => {
    if (!state.ready || state.motion || state.explode > 0.001 || shadowPose === mechanicalPose) return
    const timer = window.setTimeout(() => setShadowPose(mechanicalPose), 180)
    return () => window.clearTimeout(timer)
  }, [state.ready, state.motion, state.explode, shadowPose, mechanicalPose])
  useEffect(() => {
    const room = new Scene()
    room.background = new Color(0.075, 0.075, 0.075)
    const shell = new Mesh(new BoxGeometry(30, 24, 30), new MeshBasicMaterial({ color: new Color(0.11, 0.11, 0.11), side: BackSide }))
    room.add(shell)
    const panels = [
      { p: [-4, 8, 6], s: [11, 5], intensity: 5.5 },
      { p: [1, 5, -8], s: [12, 2], intensity: 3.2 },
      { p: [8, 2, 3], s: [3, 7], intensity: 2.1 },
      { p: [-10, 1, -2], s: [2, 7], intensity: 1.2 },
      { p: [0, -6, 4], s: [12, 4], intensity: 0.65 },
    ]
    for (const panel of panels) {
      const material = new MeshBasicMaterial({ color: new Color(panel.intensity, panel.intensity, panel.intensity), toneMapped: false })
      const mesh = new Mesh(new PlaneGeometry(...panel.s), material)
      mesh.position.set(...panel.p)
      mesh.lookAt(0, 0, 0)
      room.add(mesh)
    }
    const generator = new StudioPMREM(gl)
    const environment = generator.fromScene(room, 0.04, 0.1, 60)
    const previous = scene.environment
    const previousIntensity = scene.environmentIntensity
    scene.environment = environment.texture
    scene.environmentIntensity = 0.82
    generator.dispose()
    room.traverse((object) => { object.geometry?.dispose(); object.material?.dispose() })
    return () => {
      scene.environment = previous
      scene.environmentIntensity = previousIntensity
      environment.dispose()
    }
  }, [gl, scene])
  useFrame(() => {
    const angle = (runtime.controller?.animation.light ?? 35) * Math.PI / 180
    scene.environmentRotation.set(0, angle, 0)
    if (light.current) light.current.position.set(Math.sin(angle) * 7, 7, Math.cos(angle) * 7)
    if (shadow.current) shadow.current.visible = (runtime.controller?.animation.explode ?? 0) < 0.08 && !getSnapshot().motion
  }, -1)
  return (
    <>
      <directionalLight ref={light} position={[4, 7, 5]} intensity={1.8} color="#ffffff" />
      <directionalLight position={[-4, 2, -5]} intensity={0.6} color="#ffffff" />
      <directionalLight position={[0, 1.5, 6]} intensity={0.35} color="#ffffff" />
      <hemisphereLight intensity={0.4} color="#ffffff" groundColor="#9b9c98" />
      <group ref={shadow}>
        {state.ready && <CachedContactShadow revision={shadowPose} />}
      </group>
    </>
  )
}
