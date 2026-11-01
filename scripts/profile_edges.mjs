import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import path from 'node:path'
const { values } = parseArgs({ options: { phase: { type: 'string', default: 'final' }, url: { type: 'string', default: 'http://localhost:4105' }, 'motion-only': { type: 'boolean', default: false } } })
const out = path.resolve('artifacts/edge-diagnostics', values.phase)
await mkdir(out, { recursive: true })
const priorMeasurements = values['motion-only'] ? JSON.parse(await readFile(path.join(out, 'performance-motion.json'))).measurements : []
const report = { phase: values.phase, url: values.url, measurements: priorMeasurements, motion: [], errors: [] }
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--force-high-performance-gpu', '--disable-background-timer-throttling'] })
const frames = (page, n) => page.evaluate(count => new Promise(resolve => { let i = 0; function tick() { if (++i >= count) resolve(); else requestAnimationFrame(tick) } requestAnimationFrame(tick) }), n)
async function measure(page, label) {
  const result = await page.evaluate(async () => {
    const intervals = [], calls = [], triangles = []
    let previous
    await new Promise(resolve => { function tick(now) {
      if (previous !== undefined) intervals.push(now - previous)
      previous = now
      const api = window.__PRINTSTREAM__, gl = api.diagnostics?.gl
      calls.push(gl?.info.render.calls ?? api.stats.drawCalls)
      triangles.push(gl?.info.render.triangles ?? api.stats.triangles)
      if (intervals.length >= 240) resolve(); else requestAnimationFrame(tick)
    } requestAnimationFrame(tick) })
    const canvas = document.querySelector('canvas'), gl = canvas.getContext('webgl2'), extension = gl.getExtension('WEBGL_debug_renderer_info')
    const sorted = intervals.toSorted((a, b) => a - b)
    return { fps: 1000 * intervals.length / intervals.reduce((a, b) => a + b, 0), p95FrameMs: sorted[Math.floor(sorted.length * .95)],
      minDrawCalls: Math.min(...calls), maxDrawCalls: Math.max(...calls), minTriangles: Math.min(...triangles), maxTriangles: Math.max(...triangles),
      renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      buffer: [canvas.width, canvas.height], devicePixelRatio, stats: { ...window.__PRINTSTREAM__.stats }, samples: intervals.length }
  })
  report.measurements.push({ label, ...result }); console.log(JSON.stringify({ label, ...result }))
}
try {
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 2560 / dpr, height: 1440 / dpr }, deviceScaleFactor: dpr })
    const page = await context.newPage()
    page.on('pageerror', e => report.errors.push(e.message))
    page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()) })
    await page.goto(`${values.url}/${values.phase === 'final' ? '?verify=1' : ''}`, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => window.__PRINTSTREAM__?.ready, null, { timeout: 90000 })
    await page.evaluate(() => window.__PRINTSTREAM__.diagnostics?.setIdleFrozen(false))
    await frames(page, 120)
    if (!values['motion-only']) await measure(page, `2560x1440 physical / DPR ${dpr} / live idle`)
    if (values.phase === 'final') {
      for (let i = 0; i < 4; i++) {
        await frames(page, 25)
        const image = `idle-dpr${dpr}-${i}.png`
        const state = await page.evaluate(() => ({ model: window.__PRINTSTREAM__.model.matrixWorld.elements.slice(), camera: window.__PRINTSTREAM__.camera.matrixWorld.elements.slice(), projection: window.__PRINTSTREAM__.camera.projectionMatrix.elements.slice() }))
        await page.screenshot({ path: path.join(out, image) })
        report.motion.push({ type: 'idle', dpr, image, state })
      }
    }
    await page.evaluate(() => { const e = window.__PRINTSTREAM__; e.enterInspect(); e.preset('hero', { immediate: true }); if (e.getState().hotspots) e.action('hotspots'); e.action('autoRotate') })
    await frames(page, 90)
    if (!values['motion-only']) await measure(page, `2560x1440 physical / DPR ${dpr} / camera moving`)
    if (values.phase === 'final') {
      await page.evaluate(() => {
        const e = window.__PRINTSTREAM__
        if (e.getState().autoRotate) e.action('autoRotate')
        e.preset('hero', { immediate: true })
        const probe = e.diagnostics, controls = probe.controls
        controls.enableDamping = false; controls.update()
        const target = controls.target.clone(), offset = e.camera.position.clone().sub(target), axis = offset.clone().set(0, 1, 0)
        window.__EDGE_ORBIT__ = { progress: 0, done: false }
        window.__EDGE_START_ORBIT__ = () => {
          const start = performance.now()
          function tick(now) {
            const progress = Math.min(1, (now - start) / 8000)
            e.camera.position.copy(offset).applyAxisAngle(axis, progress * Math.PI * 2).add(target)
            controls.update(); e.camera.updateMatrixWorld(true)
            window.__EDGE_ORBIT__.progress = progress
            if (progress < 1) requestAnimationFrame(tick); else window.__EDGE_ORBIT__.done = true
          }
          requestAnimationFrame(tick)
        }
      })
      const captureOrbit = async i => {
        const state = await page.evaluate(() => ({ progress: window.__EDGE_ORBIT__.progress, camera: window.__PRINTSTREAM__.camera.matrixWorld.elements.slice(), projection: window.__PRINTSTREAM__.camera.projectionMatrix.elements.slice() }))
        const image = `orbit-dpr${dpr}-${String(i).padStart(2, '0')}.png`
        await page.screenshot({ path: path.join(out, image) })
        report.motion.push({ type: 'orbit', dpr, image, state })
      }
      await frames(page, 2)
      await captureOrbit(0)
      await page.evaluate(() => window.__EDGE_START_ORBIT__())
      for (let i = 1; i <= 12; i++) {
        await page.waitForFunction(t => window.__EDGE_ORBIT__.progress >= t, i / 12)
        await captureOrbit(i)
      }
    }
    await context.close()
  }
  if (report.errors.length) throw new Error(report.errors.join('\n'))
  if (!values['motion-only'] && values.phase === 'final' && report.measurements.some(m => m.fps < 55)) throw new Error('1440p performance is below 55 FPS')
  report.success = true
} catch (error) { report.success = false; report.failure = error.stack; process.exitCode = 1; console.error(error) }
finally { await browser.close(); await writeFile(path.join(out, 'performance-motion.json'), JSON.stringify(report, null, 2)) }
