import { chromium } from 'playwright'
import sharp from 'sharp'
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { parseArgs } from 'node:util'
import path from 'node:path'

const { values } = parseArgs({ options: {
  phase: { type: 'string', default: 'before' },
  url: { type: 'string', default: 'http://localhost:4102' },
  probe: { type: 'string', default: '' },
} })
if (!['before', 'final'].includes(values.phase)) throw new Error('Use --phase before or final')
if (values.probe && values.probe !== 'shading') throw new Error('The supported supplementary probe is --probe shading')
const phase = values.probe ? 'shading-probes' : values.phase
const out = path.resolve('artifacts/edge-diagnostics', phase)
await mkdir(out, { recursive: true })
const variants = values.probe ? ['F', 'G', 'H', 'I', 'J', 'K', 'L'] : ['A', 'B', 'C', 'D', 'E']
const poses = values.probe ? ['hero'] : ['hero', 'left', 'suppressor']
const dprs = values.probe ? [1] : [1, 2]
const labels = { A: 'As shipped', B: 'Screen AO off', C: 'Baked AO off', D: 'Both off', E: 'Coat roughness >= .12',
  F: 'Baseline', G: 'Normal map off', H: 'Clearcoat off', I: 'Iridescence off', J: 'Roughness .5 / coat .3', K: 'Diffuse only', L: 'Texture maps off' }
const regions = ['suppressor-top', 'handguard-top', 'white-rounded-edge']
const report = { phase, url: values.url, viewport: { width: 1440, height: 900 }, captures: [], errors: [] }
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--force-high-performance-gpu', '--disable-background-timer-throttling'],
})
const frames = (page, count = 40) => page.evaluate(n => new Promise(resolve => {
  let i = 0
  function step() { if (++i >= n) resolve(); else requestAnimationFrame(step) }
  requestAnimationFrame(step)
}), count)
const xml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const caption = (text, width, height = 28) => Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f3f3f0"/><text x="8" y="19" font-family="sans-serif" font-size="14" fill="#242424">${xml(text)}</text></svg>`)
try {
  for (const dpr of dprs) {
    const context = await browser.newContext({ viewport: report.viewport, deviceScaleFactor: dpr })
    const page = await context.newPage()
    page.on('pageerror', error => report.errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()) })
    await page.goto(`${values.url}/?verify=1`, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => window.__PRINTSTREAM__?.ready, null, { timeout: 90000 })
    await page.evaluate(async () => {
      const e = window.__PRINTSTREAM__
      let probe = e.diagnostics
      if (!probe) {
        // Before correction: inspect the existing dev runtime, without modifying source.
        const fiberUrl = performance.getEntriesByType('resource').find(r => r.name.includes('/@react-three_fiber.js'))?.name
        if (!fiberUrl) throw new Error('Production diagnostics hook is unavailable')
        const { _roots } = await import(fiberUrl)
        const { runtime } = await import('/src/experience.js')
        const store = _roots.get(document.querySelector('canvas')).store.getState()
        probe = { gl: store.gl, scene: store.scene, camera: store.camera, get controls() { return runtime.controls }, setIdleFrozen(value) { runtime.verify = value } }
      }
      const mats = new Set()
      e.model.traverse(o => { if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.add(m) })
      const saved = [...mats].map(m => ({ m, ao: m.aoMapIntensity, coat: m.clearcoatRoughness,
        original: Object.fromEntries(['normalMap', 'map', 'roughnessMap', 'metalnessMap', 'metalness', 'roughness', 'clearcoat', 'iridescence', 'specularIntensity', 'onBeforeCompile'].map(key => [key, m[key]])) }))
      window.__EDGE_DIAGNOSTICS__ = { probe, saved }
      probe.setIdleFrozen(true)
      e.enterInspect()
      if (e.getState().hotspots) e.action('hotspots')
      await document.fonts.ready
    })
    await frames(page, 90)
    for (const pose of poses) {
      await page.evaluate(poseName => {
        const e = window.__PRINTSTREAM__, { probe } = window.__EDGE_DIAGNOSTICS__
        e.preset(poseName === 'suppressor' ? 'left' : poseName, { immediate: true })
        if (poseName === 'suppressor') {
          // Front assembly close-up, retaining the handguard in frame for the same three crops.
          const camera = e.camera, target = probe.controls.target
          target.set(-2.65, 0.04, 0)
          const distance = 5.6 / (2 * Math.tan(camera.fov * Math.PI / 360) * camera.aspect)
          camera.clearViewOffset()
          camera.position.set(target.x, target.y + distance * 0.015, distance)
          probe.controls.enableDamping = false
          probe.controls.update()
          camera.updateMatrixWorld(true)
        }
      }, pose)
      await frames(page, 60)
      const setup = await page.evaluate(() => {
        const e = window.__PRINTSTREAM__, { probe, saved } = window.__EDGE_DIAGNOSTICS__
        const camera = e.camera, canvas = probe.gl.domElement, rect = canvas.getBoundingClientRect()
        const Vector3 = camera.position.constructor
        const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
        up.x = 0; up.normalize()
        const anchors = [[-4.25, 0, 0.218], [-0.93, 0.008, 0.303], [-3.285, 0, 0.23]]
        const rois = anchors.map(([x, y, radius]) => {
          const p = new Vector3(x, y, 0).addScaledVector(up, radius).project(camera)
          const ratio = probe.gl.getPixelRatio()
          const left = Math.round((rect.left + (p.x + 1) * rect.width / 2 - 40) * ratio)
          const top = Math.round((rect.top + (1 - p.y) * rect.height / 2 - 11) * ratio)
          const width = Math.round(80 * ratio), height = Math.round(22 * ratio)
          if (left < 0 || top < 0 || left + width > canvas.width || top + height > canvas.height) throw new Error('Crop lies outside viewport')
          return { left, top, width, height }
        })
        const rim = probe.scene.getObjectByName('InspectHoverRim')
        return { camera: [...camera.matrixWorld.elements, ...camera.projectionMatrix.elements], root: e.model.matrixWorld.elements.slice(), rois,
          dpr: probe.gl.getPixelRatio(), buffer: [canvas.width, canvas.height], screenAOAvailable: typeof e.setAO === 'function', hoverRimVisible: rim?.visible ?? false,
          materials: saved.map(({ m, ao, coat }) => ({ name: m.name, aoIntensity: ao, clearcoatRoughness: coat, aoMap: m.aoMap ? { channel: m.aoMap.channel, anisotropy: m.aoMap.anisotropy, mipmaps: m.aoMap.generateMipmaps, minFilter: m.aoMap.minFilter } : null })) }
      })
      if (setup.dpr !== dpr) throw new Error(`DPR mismatch ${setup.dpr} != ${dpr}`)
      if (setup.hoverRimVisible) throw new Error('Hover overlay must be invisible during diagnosis')
      for (const variant of variants) {
        await page.evaluate(async v => {
          const e = window.__PRINTSTREAM__, { saved } = window.__EDGE_DIAGNOSTICS__
          if (e.setAO) e.setAO(!['B', 'D'].includes(v))
          for (const { m, ao, coat, original } of saved) {
            Object.assign(m, original)
            m.aoMapIntensity = ['C', 'D'].includes(v) ? 0 : ao
            if (typeof coat === 'number') m.clearcoatRoughness = v === 'E' ? Math.max(0.12, coat) : coat
            if (v === 'G') m.normalMap = null
            if (v === 'H') m.clearcoat = 0
            if (v === 'I') m.iridescence = 0
            if (v === 'J') { m.roughnessMap = null; m.roughness = 0.5; m.clearcoatRoughness = 0.3 }
            if (v === 'K') { m.normalMap = null; m.roughnessMap = null; m.metalness = 0; m.roughness = 1; m.clearcoat = 0; m.iridescence = 0; m.specularIntensity = 0 }
            if (v === 'L') { m.normalMap = null; m.map = null; m.roughnessMap = null; m.metalnessMap = null; m.aoMapIntensity = 0 }
            m.needsUpdate = true
          }
        }, variant)
        await frames(page, 45)
        const state = await page.evaluate(() => {
          const e = window.__PRINTSTREAM__
          return { camera: [...e.camera.matrixWorld.elements, ...e.camera.projectionMatrix.elements], root: e.model.matrixWorld.elements.slice(), stats: { ...e.stats } }
        })
        if (JSON.stringify(state.camera) !== JSON.stringify(setup.camera) || JSON.stringify(state.root) !== JSON.stringify(setup.root)) throw new Error('Pose moved between variants')
        const stem = `${pose}-dpr${dpr}-${variant}`
        const imagePath = path.join(out, `${stem}.png`)
        await page.screenshot({ path: imagePath, animations: 'disabled' })
        const crops = []
        for (let i = 0; i < regions.length; i++) {
          const cropPath = path.join(out, `${stem}-${regions[i]}-4x.png`)
          await sharp(imagePath).extract(setup.rois[i]).resize(setup.rois[i].width * 4, setup.rois[i].height * 4, { kernel: 'nearest' }).png().toFile(cropPath)
          crops.push(path.relative(process.cwd(), cropPath).replaceAll('\\', '/'))
        }
        report.captures.push({ pose, dpr, variant, image: path.relative(process.cwd(), imagePath).replaceAll('\\', '/'), crops, setup, stats: state.stats })
        console.log(`${values.phase}: ${stem} captured`)
      }
    }
    await context.close()
  }
} finally {
  await browser.close()
}
// One lossless contact sheet: every crop is exactly 400% of its native device pixels.
const columnWidth = values.probe ? 320 : 640, sheetWidth = columnWidth * variants.length, composites = []
let y = 0
for (const pose of poses) for (const dpr of dprs) {
  const block = report.captures.filter(c => c.pose === pose && c.dpr === dpr)
  const local = []
  let localY = 0
  local.push({ input: caption(`${phase.toUpperCase()} | ${pose} | DPR ${dpr} | native pixels enlarged 400% nearest-neighbour`, sheetWidth), left: 0, top: localY }); localY += 28
  for (let region = 0; region < regions.length; region++) {
    const height = block[0].setup.rois[region].height * 4
    for (let column = 0; column < variants.length; column++) {
      local.push({ input: caption(`${variants[column]}: ${labels[variants[column]]} | ${regions[region]}`, columnWidth), left: column * columnWidth, top: localY })
      local.push({ input: await readFile(block[column].crops[region]), left: column * columnWidth, top: localY + 28 })
    }
    localY += height + 36
  }
  const sheet = await sharp({ create: { width: sheetWidth, height: localY, channels: 3, background: '#f3f3f0' } }).composite(local).png().toBuffer()
  await writeFile(path.join(out, `${pose}-dpr${dpr}-contact-sheet.png`), sheet)
  composites.push({ input: sheet, left: 0, top: y }); y += localY + 12
}
await sharp({ create: { width: sheetWidth, height: y, channels: 3, background: '#f3f3f0' } }).composite(composites).png().toFile(path.join(out, 'contact-sheet-400pct.png'))
const glb = await readFile('public/models/m4a1s-printstream.glb')
report.glb = { bytes: (await stat('public/models/m4a1s-printstream.glb')).size, sha256: createHash('sha256').update(glb).digest('hex') }
await writeFile(path.join(out, 'captures.json'), JSON.stringify(report, null, 2))
if (report.errors.length) throw new Error(`Browser errors: ${report.errors.join('\n')}`)
console.log(`Saved ${report.captures.length} captures and contact sheets to ${out}`)
