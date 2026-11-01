import sharp from 'sharp'
import { readFile, writeFile } from 'node:fs/promises'
const base = 'artifacts/edge-diagnostics'
const before = JSON.parse(await readFile(`${base}/before/captures.json`))
const after = JSON.parse(await readFile(`${base}/final/captures.json`))
const results = { unchangedGLB: before.glb.sha256 === after.glb.sha256, comparisons: [], isolation: [] }
if (!results.unchangedGLB) throw new Error('This rendering-only correction must not change the GLB')
const label = (text, width) => Buffer.from(`<svg width="${width}" height="28" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f3f3f0"/><text x="8" y="19" font-family="sans-serif" font-size="14" fill="#202020">${text}</text></svg>`)
const raw = async file => sharp(file).removeAlpha().raw().toBuffer()
function difference(a, b) {
  if (a.length !== b.length) throw new Error('Comparison dimensions differ')
  let sum = 0, max = 0, changed = 0
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); sum += d; max = Math.max(max, d); if (d) changed++ }
  return { maxChannelDelta: max, meanAbsoluteChannelDelta: sum / a.length, changedChannelFraction: changed / a.length }
}
for (const old of before.captures.filter(c => c.variant === 'A')) {
  const current = after.captures.find(c => c.pose === old.pose && c.dpr === old.dpr && c.variant === 'A')
  for (const key of ['camera', 'root', 'rois', 'materials']) if (JSON.stringify(old.setup[key]) !== JSON.stringify(current.setup[key])) throw new Error(`Comparison changed ${key}: ${old.pose} / DPR ${old.dpr}`)
  const width = old.setup.rois[0].width * 4, height = old.setup.rois[0].height * 4
  const composite = [], names = ['Suppressor top', 'Handguard top', 'Rounded white collar']
  for (let i = 0; i < names.length; i++) {
    const top = i * (height + 36)
    composite.push({ input: label(`BEFORE | ${old.pose} DPR ${old.dpr} | ${names[i]} | 400%`, width), left: 0, top })
    composite.push({ input: label(`AFTER | ${old.pose} DPR ${old.dpr} | ${names[i]} | 400%`, width), left: width, top })
    composite.push({ input: await readFile(old.crops[i]), left: 0, top: top + 28 })
    composite.push({ input: await readFile(current.crops[i]), left: width, top: top + 28 })
    for (const v of ['B', 'C', 'D', 'E']) {
      const isolated = before.captures.find(c => c.pose === old.pose && c.dpr === old.dpr && c.variant === v)
      results.isolation.push({ pose: old.pose, dpr: old.dpr, region: names[i], variant: v, ...difference(await raw(old.crops[i]), await raw(isolated.crops[i])) })
    }
  }
  const file = `${base}/before-after-${old.pose}-dpr${old.dpr}-400pct.png`
  await sharp({ create: { width: width * 2, height: (height + 36) * 3, channels: 3, background: '#f3f3f0' } }).composite(composite).png().toFile(file)
  results.comparisons.push({ pose: old.pose, dpr: old.dpr, file })
}
// Preserve a full-scale side-by-side, not only the edge crops.
const heroOld = before.captures.find(c => c.pose === 'hero' && c.dpr === 1 && c.variant === 'A')
const heroNew = after.captures.find(c => c.pose === 'hero' && c.dpr === 1 && c.variant === 'A')
const size = await sharp(heroOld.image).metadata()
await sharp({ create: { width: size.width * 2, height: size.height + 28, channels: 3, background: '#f3f3f0' } }).composite([
  { input: label('BEFORE | original materials, baked AO + screen AO + contact shadows', size.width), left: 0, top: 0 },
  { input: label('AFTER | same pose, materials, lighting and occlusion', size.width), left: size.width, top: 0 },
  { input: await readFile(heroOld.image), left: 0, top: 28 },
  { input: await readFile(heroNew.image), left: size.width, top: 28 },
]).png().toFile(`${base}/before-after-hero.png`)
// Receiver joints, magazine well and trigger opening: identical crop for contact-darkening evidence.
const camera = heroOld.setup.camera, world = camera.slice(0, 16), projection = camera.slice(16)
function project(point) {
  // Camera axes are orthonormal; inverse rotation is its transpose.
  const v = point.map((x, i) => x - world[12 + i])
  const p = [0, 1, 2].map(i => world[i * 4] * v[0] + world[i * 4 + 1] * v[1] + world[i * 4 + 2] * v[2])
  const clip = [0, 1, 2, 3].map(i => projection[i] * p[0] + projection[4 + i] * p[1] + projection[8 + i] * p[2] + projection[12 + i])
  return [(clip[0] / clip[3] + 1) * size.width / 2, (1 - clip[1] / clip[3]) * size.height / 2]
}
const a = project([0.12, 0.4, .22]), b = project([2.05, -1.0, .22])
const roi = { left: Math.floor(Math.min(a[0], b[0])) - 8, top: Math.floor(Math.min(a[1], b[1])) - 8, width: Math.ceil(Math.abs(a[0] - b[0])) + 16, height: Math.ceil(Math.abs(a[1] - b[1])) + 16 }
const oldCrop = await sharp(heroOld.image).extract(roi).png().toBuffer(), newCrop = await sharp(heroNew.image).extract(roi).png().toBuffer()
results.contactDarkening = { roi, ...difference(await raw(oldCrop), await raw(newCrop)) }
await sharp({ create: { width: roi.width * 4, height: roi.height * 2 + 28, channels: 3, background: '#f3f3f0' } }).composite([
  { input: label('BEFORE | receiver contacts / 200%', roi.width * 2), left: 0, top: 0 },
  { input: label('AFTER | same crevices / 200%', roi.width * 2), left: roi.width * 2, top: 0 },
  { input: await sharp(oldCrop).resize(roi.width * 2, roi.height * 2, { kernel: 'nearest' }).toBuffer(), left: 0, top: 28 },
  { input: await sharp(newCrop).resize(roi.width * 2, roi.height * 2, { kernel: 'nearest' }).toBuffer(), left: roi.width * 2, top: 28 },
]).png().toFile(`${base}/before-after-contact-darkening.png`)
await writeFile(`${base}/comparison.json`, JSON.stringify(results, null, 2))
console.log(JSON.stringify({ unchangedGLB: results.unchangedGLB, contactDarkening: results.contactDarkening, comparisons: results.comparisons }))
