import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'
import { HOTSPOTS } from './scene/hotspots'
import { PART_NAMES, partLabel } from './scene/rig'
import { CAMERA_PRESETS, experience, getSnapshot, runtime, updateState, useExperience } from './experience'

gsap.registerPlugin(ScrollTrigger, useGSAP)
const Viewer = lazy(() => import('./scene/Viewer'))

const chapters = [
  { id: 'suppressor', number: '01', label: 'The signature', title: <>Quiet by design.<br />Impossible to miss.</>, body: 'A long, uninterrupted surface. Dot glyphs, precise lines, and a pearl finish that refuses to stay just white.', note: 'ROTATE. DETACH. LOOK CLOSER.' },
  { id: 'receiver', number: '02', label: 'The details', title: <>A language<br />of small things.</>, body: 'A pair of Xs. A tiny heart. A barcode, a bracket, a line of microtype. Every mark has its place in the composition.', note: 'GRAPHIC PRECISION / BOTH SIDES' },
  { id: 'magazine', number: '03', label: 'The construction', title: <>More than<br />the surface.</>, body: 'The print continues around the curved magazine. Pull it away, then unfold the asset to see the individual forms within.', note: 'ILLUSTRATIVE INTERNALS / GAME ASSET' },
  { id: 'stock', number: '04', label: 'The contrast', title: <>Soft light.<br />Hard contrast.</>, body: 'Dark polymer gives the white coating its edge. Stipple, ribbing, and restrained markings bring a different kind of detail.', note: 'FOUR POSITIONS / ONE SILHOUETTE' },
  { id: 'finish', number: '05', label: 'The finish', title: <>White, until<br />the light moves.</>, body: 'Pearl shifts into violet, green, and pink. Turn the studio light and watch the thin-film layer respond over the pearl coat.', note: 'PEARLESCENT / ANGLE DEPENDENT' },
]

function Arrow({ down = false }) { return <span className="arrow" aria-hidden="true">{down ? '↓' : '↗'}</span> }
function Mark() { return <span className="brand-mark" aria-hidden="true"><i /><i /></span> }

function MechanicalButton({ name, children, active, className = '' }) {
  const state = useExperience()
  const unavailable = !state.ready || state.explode > 0.001 || state.exploding || state.motion
  return <button className={`text-action ${className}`} data-action={name} aria-pressed={active === undefined ? undefined : active} aria-disabled={unavailable} onClick={() => experience.action(name)}>{children}<Arrow /></button>
}

function LightControl({ compact = false }) {
  const state = useExperience()
  return (
    <label className={`light-control ${compact ? 'light-control-compact' : ''}`}>
      <span><span className="control-label">Studio light</span><output>{Math.round(state.light)}°</output></span>
      <input aria-label="Studio light angle" type="range" min="-180" max="180" step="1" value={state.light} onChange={(event) => experience.setLight(Number(event.target.value))} disabled={!state.ready} />
      {!compact && <span className="range-caption"><span>−180°</span><span>DRAG TO CHANGE THE FINISH</span><span>+180°</span></span>}
    </label>
  )
}

function StockControl() {
  const state = useExperience()
  const unavailable = !state.ready || state.explode > 0.001 || state.exploding || state.motion
  return (
    <div className="stock-control">
      <span className="control-label">Stock position</span>
      <div className="stock-range">
        <input type="range" data-control="stock" aria-label="Stock position" aria-valuetext={`Position ${Math.round(state.mechanical.stock * 3) + 1} of 4`} min="0" max="3" step="1" value={Math.round(state.mechanical.stock * 3)} disabled={unavailable} onChange={(event) => experience.setMechanical('stock', Number(event.target.value) / 3)} />
        <div className="detents" role="group" aria-label="Stock detents">{[0, 1, 2, 3].map((position) => <button key={position} aria-pressed={Math.round(state.mechanical.stock * 3) === position} aria-disabled={unavailable} onClick={() => experience.setMechanical('stock', position / 3)}>{String(position + 1).padStart(2, '0')}</button>)}</div>
      </div>
    </div>
  )
}

function ChapterActions({ id }) {
  const state = useExperience()
  if (id === 'suppressor') return <MechanicalButton name="suppressor" active={state.mechanical.suppressor > 0.5}>{state.mechanical.suppressor > 0.5 ? 'Attach suppressor' : 'Detach suppressor'}</MechanicalButton>
  if (id === 'receiver') return <><MechanicalButton name="dustCover" active={state.mechanical.dustCover > 0.5}>{state.mechanical.dustCover > 0.5 ? 'Close dust cover' : 'Open dust cover'}</MechanicalButton><MechanicalButton name="chargingHandle">Cycle charging handle</MechanicalButton></>
  if (id === 'magazine') return <><MechanicalButton name="magazine" active={state.mechanical.magazine > 0.5}>{state.mechanical.magazine > 0.5 ? 'Insert magazine' : 'Remove magazine'}</MechanicalButton><button className="text-action" onClick={() => { experience.enterInspect(); experience.setExplode(1) }}>Explore the fieldstrip <Arrow /></button></>
  if (id === 'stock') return <StockControl />
  return <LightControl />
}

function Loader() {
  const state = useExperience()
  if (state.error) return null
  return (
    <div className={`loader ${state.loaded ? 'loader-assembling' : ''} ${state.ready ? 'loader-ready' : ''}`} aria-hidden={state.ready}>
      <div className="loader-lockup"><Mark /><span className="eyebrow">PRINTSTREAM / DIGITAL STUDY</span></div>
      <div className="loader-status" role="status" aria-live="polite">
        <span>{state.loadStage}</span><span>{state.loaded ? '01 / 01' : `${Math.round(state.loadProgress)}%`}</span>
        <div className="load-track"><i style={{ transform: `scaleX(${state.loaded ? 1 : state.loadProgress / 100})` }} /></div>
        <small>{state.loaded ? 'Every piece, in its place.' : 'Geometry. Print. Pearl.'}</small>
      </div>
    </div>
  )
}

function InspectPanel() {
  const state = useExperience()
  const panel = useRef(null)
  const close = useRef(null)
  const [sheetOpen, setSheetOpen] = useState(() => window.matchMedia('(min-width: 760px)').matches)
  useEffect(() => {
    if (!state.inspect) return
    const query = window.matchMedia('(min-width: 760px)')
    const update = () => setSheetOpen(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [state.inspect])
  useEffect(() => {
    if (!state.inspect) return
    const previousFocus = document.activeElement
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    close.current?.focus({ preventScroll: true })
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); experience.exitInspect(); return }
      if (event.key !== 'Tab') return
      const nodes = [...document.querySelectorAll('.inspect-ui button, .inspect-ui input, .inspect-ui summary, .model-label')].filter((node) => !node.disabled && getComputedStyle(node).visibility !== 'hidden' && node.getClientRects().length)
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && (document.activeElement === first || !nodes.includes(document.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previousFocus?.focus?.({ preventScroll: true })
      ScrollTrigger.refresh()
    }
  }, [state.inspect])
  if (!state.inspect) return null
  const exploded = state.explode > 0.001 || state.exploding
  const selected = HOTSPOTS.find((spot) => spot.name === state.selected)
  return (
    <section className="inspect-ui" role="dialog" aria-modal="true" aria-labelledby="inspect-title" ref={panel}>
      <div className="inspect-header">
        <div><span className="eyebrow">THE INTERACTIVE STUDY</span><h2 id="inspect-title">M4A1-S <span>Printstream</span></h2></div>
        <button className="close-button" ref={close} onClick={() => experience.exitInspect()} aria-label="Close inspect mode"><span>Close</span><b aria-hidden="true">×</b></button>
      </div>
      <nav className="camera-presets" aria-label="Camera presets">
        {CAMERA_PRESETS.map((name) => <button key={name} aria-pressed={state.preset === name} onClick={() => experience.preset(name)}>{name === 'closeup' ? 'Detail' : name}</button>)}
      </nav>
      <div className="inspect-tools">
        <button className="tool-button" onClick={() => experience.action('autoRotate')} aria-pressed={state.autoRotate} title={state.reducedMotion ? 'Automatic rotation is unavailable with reduced motion enabled' : 'Slow automatic rotation'}>Auto rotate <span aria-hidden="true">↻</span></button>
        <button className="tool-button" onClick={() => experience.action('hotspots')} aria-pressed={state.hotspots}>Labels <span aria-hidden="true">⊕</span></button>
        <button className="tool-button" onClick={() => experience.action('reset')}>Reset <span aria-hidden="true">↺</span></button>
      </div>
      {state.selected && <aside className="part-detail" aria-label="Selected part">
        <button className="part-close" aria-label="Close part detail" onClick={() => updateState({ selected: null })}>×</button>
        <span className="eyebrow">{partLabel(state.selected)}</span>
        <h3>{selected?.title ?? partLabel(state.selected)}</h3>
        <p>{selected?.body ?? 'An individually named component of the visual-game asset. Its transform and material remain independent in the downloadable model. This is an illustrative breakdown, not a mechanical or servicing reference.'}</p>
        {selected?.action && <MechanicalButton name={selected.action}>{selected.button}</MechanicalButton>}
      </aside>}
      <div className="inspect-bottom">
        <div className="inspect-hint"><span className="orbit-symbol" aria-hidden="true">◎</span><span>Drag to orbit <i>·</i> Pinch or scroll to zoom <i>·</i> Right-drag to pan</span><button className="motion-button" aria-disabled={exploded || state.motion} onClick={() => experience.inspectMotion()}>{state.motion ? 'Inspecting…' : 'CS2 Inspect'} <Arrow /></button></div>
        <details className="inspect-controls-sheet" open={sheetOpen} onToggle={(event) => { if (event.target === event.currentTarget) setSheetOpen(event.currentTarget.open) }}>
          <summary><span>Controls, fieldstrip &amp; light<small>{exploded ? `Exploded / ${Math.round(state.explode * 100)}% — reassemble to operate` : 'Assembled / seven part controls'}</small></span><b aria-hidden="true">{sheetOpen ? '−' : '+'}</b></summary>
          <div className="inspect-sheet-content">
        <div className="fieldstrip-control">
          <button className="fieldstrip-button" onClick={() => experience.setExplode(exploded ? 0 : 1)}>{exploded ? 'Reassemble' : 'Fieldstrip'}<span aria-hidden="true">{exploded ? '−' : '+'}</span></button>
          <label><span className="control-label">Assembly / exploded</span><input type="range" aria-label="Fieldstrip progress" min="0" max="1" step="0.005" value={state.explode} onChange={(event) => experience.setExplode(Number(event.target.value), { immediate: true })} /></label>
          <output className="explode-value">{String(Math.round(state.explode * 100)).padStart(3, '0')}<span>%</span></output>
          <LightControl compact />
        </div>
        <div className="operation-status" role="status">{exploded ? <><b>Reassemble to operate.</b> Part controls are unavailable in the exploded view.</> : <>Assembled <span aria-hidden="true">/</span> Select a part or use the controls below.</>}</div>
        <div className="mechanical-controls" aria-label="Mechanical controls">
          <MechanicalButton name="suppressor" active={state.mechanical.suppressor > 0.5}>Suppressor</MechanicalButton>
          <MechanicalButton name="dustCover" active={state.mechanical.dustCover > 0.5}>Dust cover</MechanicalButton>
          <MechanicalButton name="chargingHandle">Charging handle</MechanicalButton>
          <MechanicalButton name="magazine" active={state.mechanical.magazine > 0.5}>Magazine</MechanicalButton>
          <MechanicalButton name="trigger" active={state.mechanical.trigger > 0.5}>Trigger</MechanicalButton>
          <MechanicalButton name="selector" active={state.mechanical.selector > 0.5}>Selector</MechanicalButton>
          <StockControl />
          <details className="parts-index"><summary>All parts <span>{PART_NAMES.length}</span></summary><div>{PART_NAMES.map((name) => <button key={name} onClick={() => experience.selectPart(name)}>{partLabel(name)}</button>)}</div></details>
        </div>
        <p className="illustrative-note">Visual-game asset study. Internals and motion are illustrative, not a manufacturing or service reference.</p>
          </div>
        </details>
      </div>
    </section>
  )
}

export default function App() {
  const state = useExperience()
  const main = useRef(null)
  const chapterElements = useRef([])
  useGSAP(() => {
    const tracks = chapters.map(() => ({ progress: 0 }))
    const reduced = state.reducedMotion
    const update = () => {
      const progress = tracks.reduce((sum, track) => sum + track.progress, 0)
      runtime.scroll.chapter = reduced ? Math.round(progress) : progress
      const index = Math.round(progress)
      const name = index === 0 ? 'hero' : chapters[index - 1].id
      if (getSnapshot().chapter !== name) updateState({ chapter: name })
    }
    chapterElements.current.forEach((element, index) => {
      gsap.to(tracks[index], {
        progress: 1, ease: 'none',
        scrollTrigger: { id: `chapter-${chapters[index].id}`, trigger: element, start: 'top 65%', end: 'top 12%', scrub: reduced ? true : 0.65 },
        onUpdate: update,
      })
    })
    document.fonts.ready.then(() => ScrollTrigger.refresh())
  }, { scope: main, dependencies: [state.reducedMotion], revertOnUpdate: true })
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => updateState({ reducedMotion: query.matches, autoRotate: false })
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  useEffect(() => {
    if (!state.message) return
    const message = state.message
    const timer = window.setTimeout(() => {
      if (getSnapshot().message === message) updateState({ message: '' })
    }, 4200)
    return () => window.clearTimeout(timer)
  }, [state.message])
  return (
    <>
      <a className="skip-link" href="#study">Skip to the study</a>
      <header className="site-header" inert={state.inspect}>
        <a className="brand" href="#top" aria-label="Printstream, back to top"><Mark /><span>PRINTSTREAM<span className="brand-sub">AN INTERACTIVE STUDY</span></span></a>
        <span className="header-edition">M4A1-S / FINISH No. 984</span>
        <nav aria-label="Main navigation"><a href="#downloads">Downloads <Arrow down /></a><button className="header-inspect" onClick={() => experience.enterInspect()} aria-disabled={!state.ready}>Inspect <span aria-hidden="true">⤢</span></button></nav>
      </header>
      <Suspense fallback={null}><Viewer /></Suspense>
      <main ref={main} inert={state.inspect} id="study">
        <section className="hero" id="top" aria-labelledby="hero-title">
          <div className="hero-heading"><p className="eyebrow">A STUDY IN CONTRAST</p><h1 id="hero-title">M4A1-S<span className="title-star" aria-hidden="true">*</span></h1><div className="hero-subtitle"><span>PRINTSTREAM</span><span className="holo-rule" /><span className="mono">PEARLESCENT FINISH</span></div></div>
          <div className="hero-side-note"><span>WHITE / BLACK</span><span>LIGHT / IRIDESCENCE</span><i aria-hidden="true" /></div>
          <div className="hero-bottom">
            <div><p className="hero-statement">An icon.<br />In a different light.</p><p className="hero-caption">A real-time exploration of form,<br />finish, and the details in between.</p></div>
            <button className="button button-dark hero-cta" onClick={() => experience.enterInspect()} aria-disabled={!state.ready}>Enter the studio <span aria-hidden="true">⤢</span></button>
            <a className="scroll-cue" href="#suppressor"><span>SCROLL TO DISCOVER</span><Arrow down /></a>
          </div>
          <div className="hero-baseline"><span className="live-indicator"><i /> LIVE 3D / NOT A RENDER</span><span>UNOFFICIAL FAN-MADE STUDY</span><span className="barcode" aria-hidden="true" /></div>
        </section>
        {chapters.map((chapter, index) => <section className={`chapter chapter-${chapter.id}`} key={chapter.id} id={chapter.id} ref={(node) => { chapterElements.current[index] = node }} aria-labelledby={`${chapter.id}-title`}>
          <div className="chapter-copy">
            <p className="chapter-kicker"><span>{chapter.number}</span><span>{chapter.label}</span></p>
            <h2 id={`${chapter.id}-title`}>{chapter.title}</h2>
            <p className="chapter-body">{chapter.body}</p>
            <div className="chapter-actions"><ChapterActions id={chapter.id} /></div>
            <p className="chapter-note">{chapter.note}</p>
          </div>
        </section>)}
        <section className="downloads" id="downloads" aria-labelledby="downloads-title">
          <div className="download-heading"><span className="eyebrow">TAKE A CLOSER LOOK</span><h2 id="downloads-title">The study.<br />Yours to explore.</h2><p>Open the source. Inspect the materials.<br />See how every detail comes together.</p></div>
          <div className="download-links">
            <a href={`${import.meta.env.BASE_URL}models/m4a1s-printstream.glb`} download><span><b>3D model</b><small>GLB / DRACO + WEBP</small></span><Arrow down /></a>
            <a href={`${import.meta.env.BASE_URL}downloads/m4a1s-printstream.blend`} download><span><b>Blender project</b><small>BLEND / EDITABLE SOURCE</small></span><Arrow down /></a>
            <a href={`${import.meta.env.BASE_URL}downloads/renders.zip`} download><span><b>Studio renders</b><small>PNG / COMPLETE IMAGE SET</small></span><Arrow down /></a>
          </div>
          <div className="render-index" aria-label="Individual studio renders"><span className="eyebrow">INDIVIDUAL VIEWS / PNG</span>{[['hero', 'Hero'], ['left-profile', 'Left profile'], ['suppressor-handguard', 'Suppressor & handguard'], ['receiver', 'Receiver detail'], ['exploded', 'Exploded study'], ['reference-comparison', 'Reference comparison']].map(([file, title]) => <a key={file} href={`${import.meta.env.BASE_URL}renders/${file}.png`} target="_blank" rel="noreferrer">{title} <Arrow /></a>)}</div>
          <div className="download-bottom"><span className="holo-rule" /><p>A visual-game asset. Not a physical object or technical blueprint.</p><button className="text-action" onClick={() => experience.enterInspect()}>Back to the studio <Arrow /></button></div>
        </section>
        <footer className="site-footer"><div><Mark /><span>PRINTSTREAM / M4A1-S</span></div><p>Unofficial fan-made study. Counter-Strike and Printstream belong to their respective owners. No affiliation.<br />Type: <a href={`${import.meta.env.BASE_URL}licenses/Space-Grotesk-OFL.txt`}>Space Grotesk</a> / <a href={`${import.meta.env.BASE_URL}licenses/IBM-Plex-Mono-OFL.txt`}>IBM Plex Mono</a> — SIL OFL 1.1.</p><a href="#top">Back to top ↑</a></footer>
      </main>
      <div className={`chapter-rail ${state.inspect ? 'is-hidden' : ''}`} aria-label="Study chapters"><a href="#top" aria-current={state.chapter === 'hero' ? 'step' : undefined} aria-label="Hero"><i /></a>{chapters.map((chapter) => <a key={chapter.id} href={`#${chapter.id}`} aria-current={state.chapter === chapter.id ? 'step' : undefined} aria-label={chapter.label}><i /><span>{chapter.number}</span></a>)}</div>
      <InspectPanel />
      <div className={`toast ${state.message ? 'toast-visible' : ''}`} role="status" aria-live="polite">{state.message}</div>
      <Loader />
    </>
  )
}
