import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { DataTexture, FloatType, HalfFloatType, Matrix4, RedFormat, RepeatWrapping, Vector2, Vector3, WebGLRenderTarget } from 'three'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { getSnapshot, runtime } from '../experience'

// MSAA only samples coverage. Sample grazing clearcoat shading four times per
// output pixel too; the existing linear HDR lookup resolves the 2x2 footprint.
const SHADING_SCALE = 2


class StudioAO extends SSAOPass {
  constructor(scene, camera, width, height, samples) {
    super(scene, camera, width, height, samples)
    this.cacheRoot = undefined
    this.meshes = []
    this.localCorners = new Float32Array(0)
    this.currentProjection = new Float32Array(0)
    this.cachedProjection = new Float32Array(0)
    this.currentVisibility = new Uint8Array(0)
    this.cachedVisibility = new Uint8Array(0)
    this.modelView = new Matrix4()
    this.clipMatrix = new Matrix4()
    this.point = new Vector3()
    this.refreshes = 0
    this.cachedFrames = 0
  }
  setSize(width, height) {
    super.setSize(Math.max(1, Math.round(width * 0.5)), Math.max(1, Math.round(height * 0.5)))
    this.hasResult = false
  }
  _generateSampleKernel(count) {
    for (let index = 0; index < count; index++) {
      const z = (index + 0.5) / count
      const angle = index * 2.399963229728653
      const radius = Math.sqrt(1 - z * z)
      this.kernel.push(new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, z).multiplyScalar(0.12 + 0.88 * z * z))
    }
  }
  _generateRandomKernelRotations() {
    const values = new Float32Array(16)
    for (let index = 0; index < 16; index++) values[index] = Math.sin(index * 12.9898 + 0.37) * 0.75
    this.noiseTexture = new DataTexture(values, 4, 4, RedFormat, FloatType)
    this.noiseTexture.wrapS = this.noiseTexture.wrapT = RepeatWrapping
    this.noiseTexture.needsUpdate = true
  }
  geometryChanged() {
    if (this.cacheRoot !== runtime.root) {
      this.cacheRoot = runtime.root
      this.meshes = []
      runtime.root?.traverse((object) => {
        if (object.isMesh && (object.layers.mask & 2)) this.meshes.push(object)
      })
      const length = this.meshes.length * 24
      this.localCorners = new Float32Array(length)
      this.currentProjection = new Float32Array(length)
      this.cachedProjection = new Float32Array(length)
      this.currentVisibility = new Uint8Array(this.meshes.length)
      this.cachedVisibility = new Uint8Array(this.meshes.length)
      for (let meshIndex = 0; meshIndex < this.meshes.length; meshIndex++) {
        const box = this.meshes[meshIndex].geometry.boundingBox
        for (let corner = 0; corner < 8; corner++) {
          const index = meshIndex * 24 + corner * 3
          this.localCorners[index] = corner & 1 ? box.max.x : box.min.x
          this.localCorners[index + 1] = corner & 2 ? box.max.y : box.min.y
          this.localCorners[index + 2] = corner & 4 ? box.max.z : box.min.z
        }
      }
      this.hasResult = false
    }
    let changed = !this.hasResult
    // Reuse only below a quarter of an AO texel and 1/64 of the AO radius
    // in view depth. Accumulated drift is compared with the last rendered mask,
    // not the previous frame; orbit, moving pivots and visibility invalidate it.
    const horizontalThreshold = 0.5 / this.width
    const verticalThreshold = 0.5 / this.height
    const depthThreshold = this.kernelRadius / 64
    for (let meshIndex = 0; meshIndex < this.meshes.length; meshIndex++) {
      const mesh = this.meshes[meshIndex]
      let visible = true
      for (let node = mesh; node && visible; node = node.parent) visible = node.visible
      this.currentVisibility[meshIndex] = visible ? 1 : 0
      if (this.currentVisibility[meshIndex] !== this.cachedVisibility[meshIndex]) changed = true
      if (!visible) continue
      this.modelView.multiplyMatrices(this.camera.matrixWorldInverse, mesh.matrixWorld)
      this.clipMatrix.multiplyMatrices(this.camera.projectionMatrix, this.modelView)
      const matrix = this.modelView.elements
      for (let corner = 0; corner < 8; corner++) {
        const index = meshIndex * 24 + corner * 3
        const x = this.localCorners[index]
        const y = this.localCorners[index + 1]
        const z = this.localCorners[index + 2]
        this.point.set(x, y, z).applyMatrix4(this.clipMatrix)
        const depth = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]
        this.currentProjection[index] = this.point.x
        this.currentProjection[index + 1] = this.point.y
        this.currentProjection[index + 2] = depth
        if (!changed && (
          Math.abs(this.point.x - this.cachedProjection[index]) > horizontalThreshold ||
          Math.abs(this.point.y - this.cachedProjection[index + 1]) > verticalThreshold ||
          Math.abs(depth - this.cachedProjection[index + 2]) > depthThreshold
        )) changed = true
      }
    }
    return changed
  }
  render(renderer) {
    const changed = this.geometryChanged()
    const contactRefresh = this.hasResult && runtime.contactShadowFrame === runtime.renderFrame
    if (!this.hasResult || (changed && !contactRefresh)) {
      const layers = this.camera.layers.mask
      this.camera.layers.set(1)
      this.ssaoMaterial.uniforms.cameraProjectionMatrix.value.copy(this.camera.projectionMatrix)
      this.ssaoMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(this.camera.projectionMatrixInverse)
      this.ssaoMaterial.uniforms.cameraNear.value = this.camera.near
      this.ssaoMaterial.uniforms.cameraFar.value = this.camera.far
      this._overrideVisibility()
      try {
        this._renderOverride(renderer, this.normalMaterial, this.normalRenderTarget, 0x7777ff, 1)
      } finally {
        this._restoreVisibility()
        this.camera.layers.mask = layers
      }
      this.ssaoMaterial.uniforms.kernelRadius.value = this.kernelRadius
      this.ssaoMaterial.uniforms.minDistance.value = this.minDistance
      this.ssaoMaterial.uniforms.maxDistance.value = this.maxDistance
      this._renderPass(renderer, this.ssaoMaterial, this.ssaoRenderTarget)
      this._renderPass(renderer, this.blurMaterial, this.blurRenderTarget)
      this.cachedProjection.set(this.currentProjection)
      this.cachedVisibility.set(this.currentVisibility)
      this.hasResult = true
      this.refreshes++
    } else {
      this.cachedFrames++
    }
  }
}

export default function Effects() {
  const { gl, scene, camera, size, viewport } = useThree()
  const pipeline = useRef(null)
  const sample = useRef({ elapsed: 0, frames: 0 })
  useEffect(() => {
    const drawingBuffer = gl.getDrawingBufferSize(new Vector2())
    const width = drawingBuffer.x * SHADING_SCALE
    const height = drawingBuffer.y * SHADING_SCALE
    const hdr = new WebGLRenderTarget(width, height, {
      type: HalfFloatType, stencilBuffer: false,
      samples: Math.min(4, gl.capabilities.maxSamples), resolveDepthBuffer: false,
    })
    hdr.texture.name = 'PrintstreamLinearHDR'
    const beauty = new RenderPass(scene, camera)
    const ao = new StudioAO(scene, camera, width, height, 8)
    ao.setSize(width, height)
    ao.kernelRadius = 0.14
    ao.minDistance = 0.00015
    ao.maxDistance = 0.004
    const output = new OutputPass()
    output.uniforms.tAO = { value: ao.blurRenderTarget.texture }
    output.uniforms.aoStrength = { value: 0.24 }
    output.material.depthTest = output.material.depthWrite = false
    output.renderToScreen = true
    // Apply the same restrained AO in linear HDR, then use Three's unmodified
    // NeutralToneMapping/sRGB functions. One pass replaces AO multiply + output.
    output.material.fragmentShader = output.material.fragmentShader
      .replace('uniform sampler2D tDiffuse;', `
        uniform sampler2D tDiffuse;
        uniform sampler2D tAO;
        uniform float aoStrength;
      `)
      .replace('gl_FragColor = texture2D( tDiffuse, vUv );', `
        gl_FragColor = texture2D( tDiffuse, vUv );
        gl_FragColor.rgb *= mix(1.0, texture2D(tAO, vUv).r, aoStrength);
      `)
    pipeline.current = { hdr, ao, beauty, output, drawingBuffer }
    if (runtime.verify) runtime.diagnostics = {
      gl, scene, camera,
      get controls() { return runtime.controls },
      setIdleFrozen(frozen) { runtime.verify = Boolean(frozen) },
    }
    const autoReset = gl.info.autoReset
    gl.info.autoReset = false
    return () => {
      pipeline.current = null
      if (runtime.diagnostics?.gl === gl) runtime.diagnostics = null
      beauty.dispose()
      ao.noiseTexture.dispose()
      ao.ssaoMaterial.dispose()
      ao.dispose()
      output.dispose()
      hdr.dispose()
      gl.info.autoReset = autoReset
    }
  }, [gl, scene, camera])
  useEffect(() => {
    const current = pipeline.current
    if (!current) return
    gl.getDrawingBufferSize(current.drawingBuffer)
    const width = current.drawingBuffer.x * SHADING_SCALE
    const height = current.drawingBuffer.y * SHADING_SCALE
    current.hdr.setSize(width, height)
    current.ao.setSize(width, height)
  }, [gl, size.width, size.height, viewport.dpr])
  useFrame(() => {
    gl.info.reset()
    runtime.renderFrame = (runtime.renderFrame ?? 0) + 1
  }, -100)
  useFrame((_, delta) => {
    const current = pipeline.current
    if (!current) return
    const aoEnabled = getSnapshot().ao
    const previousTarget = gl.getRenderTarget()
    const previousAutoClear = gl.autoClear
    gl.autoClear = false
    try {
      current.beauty.render(gl, null, current.hdr)
      if (aoEnabled) current.ao.render(gl)
      current.output.uniforms.aoStrength.value = aoEnabled ? 0.24 : 0
      current.output.render(gl, null, current.hdr)
    } finally {
      gl.setRenderTarget(previousTarget)
      gl.autoClear = previousAutoClear
    }
    const counters = sample.current
    counters.elapsed += delta
    counters.frames++
    if (counters.elapsed >= 0.5) {
      const fps = counters.frames / counters.elapsed
      runtime.stats.FPS = runtime.stats.fps = Math.round(fps * 10) / 10
      runtime.stats.frameMs = Math.round(10000 / fps) / 10
      runtime.stats.triangles = gl.info.render.triangles
      runtime.stats.drawCalls = gl.info.render.calls
      runtime.stats.dpr = gl.getPixelRatio()
      runtime.stats.msaaSamples = current.hdr.samples
      runtime.stats.renderWidth = current.hdr.width
      runtime.stats.renderHeight = current.hdr.height
      runtime.stats.aoWidth = current.ao.width
      runtime.stats.aoHeight = current.ao.height
      runtime.stats.aoRefreshes = current.ao.refreshes
      runtime.stats.aoCachedFrames = current.ao.cachedFrames
      counters.elapsed = counters.frames = 0
    }
  }, 1)
  return null
}
