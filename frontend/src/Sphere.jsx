import { useEffect, useRef } from 'react'
import { micLevel, voiceLevel } from './voice.js'

/* =============================================================================
 * SIMON'S SPHERE: the client's "Jarvis sphere", running on Simon's real voice.
 *
 * Everything you may want to change is in SPHERE below: amounts, sizes, speeds
 * and the colours for the dark and the light theme. The sphere is drawn in a
 * 1000 x 1000 box that is scaled to fit its container.
 *
 * Behaviour (from the client's description):
 * - speaking: the sphere grows a little and deforms softly, the inner spheres
 *   fade in and glow; every syllable gives a pulse (from the voice loudness),
 *   pauses between words and sentences calm it down
 * - done: the inner spheres fade out, the sphere settles and breathes gently
 * - at rest: light and dark patches drift, and now and then a soft pulse of
 *   light runs through the network like current
 * Added for Simon: while working, the current pulses run more often; while
 * listening, the sphere breathes a little stronger.
 * ========================================================================== */
export const SPHERE = {
  points: 1150, // nodes of the surface network
  linkDistance: 0.03, // squared distance up to which two nodes are linked (bigger = more lines)
  glitter: 2400, // fine sparkle dust close to the surface
  rays: 40, // faint light rays behind the sphere
  radius: 290, // sphere radius inside the 1000 x 1000 box
  grow: 46, // extra radius at full voice
  spin: 0.28, // rotation speed
  pulseGap: [2.5, 3], // seconds between current pulses at rest: minimum + random extra
  pulseGapWorking: [0.5, 0.7], // the same while Simon is working
  inner: [ // the inner spheres that appear while Simon speaks
    { rad: 0.74, n: 150, spd: 0.12, tilt: 0.5, ph: 0 },
    { rad: 0.52, n: 100, spd: -0.16, tilt: -0.4, ph: 2.1 },
    { rad: 0.32, n: 60, spd: 0.2, tilt: 0.2, ph: 4.2 },
  ],
  dark: {
    blend: 'lighter', // light adds up on the dark background
    line: [140, 185, 255], // network lines
    innerLine: [180, 215, 255],
    ray: [110, 150, 255],
    cross: 'rgb(220,235,255)', // the little star crosses on big sparkles
    sprite: ['rgba(255,255,255,1)', 'rgba(200,220,255,.85)', 'rgba(80,130,255,.2)'], // glowing dot: centre → edge
    glow: 1, // strength of the rim glow
    bottomLight: true, // bright light source under the sphere
    alpha: 1,
  },
  light: {
    blend: 'source-over',
    line: [25, 75, 190],
    innerLine: [40, 95, 210],
    ray: [60, 110, 220],
    cross: 'rgb(30,80,190)',
    sprite: ['rgba(20,60,170,1)', 'rgba(40,95,205,.8)', 'rgba(80,130,255,.18)'],
    glow: 0.55,
    bottomLight: false,
    alpha: 1.25,
  },
}

const CX = 500

function fib(n) {
  const p = []
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n
    const r = Math.sqrt(1 - y * y)
    const a = i * 2.399963
    p.push({ x: Math.cos(a) * r, y, z: Math.sin(a) * r, ph: Math.random() * 6.28 })
  }
  return p
}

function links(p, th) {
  const e = []
  for (let i = 0; i < p.length; i++) {
    for (let j = i + 1; j < p.length; j++) {
      const dx = p[i].x - p[j].x, dy = p[i].y - p[j].y, dz = p[i].z - p[j].z
      if (dx * dx + dy * dy + dz * dz < th) e.push(i, j)
    }
  }
  return Uint16Array.from(e)
}

/** Point counts shrink on small screens (a tiny sphere does not need 1150 nodes). */
function buildModel(size) {
  const k = size < 130 ? 0.2 : size < 320 ? 0.6 : 1
  const n = Math.round(SPHERE.points * k)
  const P = fib(n)
  const E = links(P, SPHERE.linkDistance * (SPHERE.points / n))
  const G = []
  for (let i = 0; i < Math.round(SPHERE.glitter * (k < 0.5 ? 0 : k * k)); i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * 6.283, r = Math.sqrt(1 - u * u)
    const d = 1 + Math.pow(Math.random(), 2.5) * 0.28
    G.push({ x: Math.cos(a) * r * d, y: u * d, z: Math.sin(a) * r * d, ph: Math.random() * 6.28,
             s: Math.random() < 0.04 ? 2.4 : Math.random() * 0.8 + 0.2 })
  }
  const IS = k < 0.5 ? [] : SPHERE.inner.map((s) => {
    const p = fib(s.n)
    return { ...s, p, e: links(p, 28.3 / s.n) }
  })
  return { k, P, E, G, IS, NG: new Float32Array(n), PU: [], nextP: 1.2 }
}

function makeSprite(stops) {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const s = c.getContext('2d')
  const g = s.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, stops[0]); g.addColorStop(0.15, stops[1]); g.addColorStop(0.45, stops[2]); g.addColorStop(1, 'rgba(0,0,0,0)')
  s.fillStyle = g
  s.fillRect(0, 0, 64, 64)
  return c
}

const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`

function rot(p, k, cy, sy, cx, sx) {
  const X = p.x * k, Y = p.y * k, Z = p.z * k
  const X2 = X * cy + Z * sy, Z2 = -X * sy + Z * cy
  return [X2, Y * cx - Z2 * sx, Y * sx + Z2 * cx]
}

export default function Sphere({ state = 'idle' }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    const c = canvasRef.current
    const x = c.getContext('2d')
    let W = 1, H = 1, S = 1, dpr = 1, model = null, paint = null
    let pal = null, sprite = null

    const theme = () => {
      pal = document.documentElement.dataset.theme === 'light' ? SPHERE.light : SPHERE.dark
      sprite = makeSprite(pal.sprite)
    }
    theme()
    const mo = new MutationObserver(theme)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    const fit = () => {
      if (!wrapRef.current) return // already removed from the page
      const r = wrapRef.current.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      W = Math.max(1, Math.floor(r.width))
      H = Math.max(1, Math.floor(r.height))
      S = Math.min(W, H)
      c.width = Math.round(W * dpr)
      c.height = Math.round(H * dpr)
      c.style.width = `${W}px`
      c.style.height = `${H}px`
      const k = S < 130 ? 0.2 : S < 320 ? 0.6 : 1
      if (!model || model.k !== k) model = buildModel(S)
      paint?.()
    }
    const ro = new ResizeObserver(fit)
    ro.observe(wrapRef.current)
    fit()

    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let amp = 0, sm = 0, vis = 0, raf = 0, timer = 0

    // When the voice does not pass through the analyser (browser voice fallback), syllables are imitated.
    const fakeSyllables = (T) => {
      const word = (T * 2.1) % 1 // ~2 words per second with short gaps between them
      if (word > 0.78) return 0
      const syl = Math.abs(Math.sin(T * 15.5))
      return (0.35 + 0.4 * syl) * (0.8 + 0.2 * Math.sin(T * 3.7))
    }

    const draw = (ms) => {
      const T = still ? 0 : ms / 1000
      const st = stateRef.current
      const speaking = st === 'speaking'
      const { P, E, G, IS, NG, PU } = model
      const big = S >= 130
      const boost = Math.min(5, Math.max(1, 300 / S)) // keeps dots and lines visible when the sphere is small

      // loudness of Simon's voice drives everything (0 … 0.7)
      let target = 0
      if (speaking) {
        const v = voiceLevel()
        target = v ?? fakeSyllables(T)
      }
      // while listening it also moves with the user's own voice
      const rest = st === 'listening' ? 0.12 + 0.05 * Math.sin(T * 3) + Math.min(0.4, micLevel() * 4) : 0.05 + 0.03 * Math.sin(T * 1.6)
      vis += ((speaking ? 1 : 0) - vis) * 0.05
      sm += ((speaking ? target : rest) - sm) * 0.5
      amp += (sm - amp) * 0.3

      const def = (p) => amp * 0.14 * (Math.sin(p.x * 2.2 + T * 1.1) + Math.sin(p.y * 2.6 - T * 0.9) + Math.sin(p.z * 2.0 + T * 1.3)) / 3
      const lum = (p) => {
        const v = (Math.sin(p.x * 3.1 + T * 0.5) + Math.sin(p.y * 2.7 - T * 0.4 + 1.3) + Math.sin(p.z * 3.4 + T * 0.35 + 2.1)) / 3
        const f = 0.45 + 1.1 * (v * 0.5 + 0.5)
        return 1 + (f - 1) * (1 + amp * 1.2)
      }

      const scale = S / 1000
      x.setTransform(dpr, 0, 0, dpr, 0, 0)
      x.globalCompositeOperation = 'source-over'
      x.globalAlpha = 1
      x.clearRect(0, 0, W, H)
      x.setTransform(scale * dpr, 0, 0, scale * dpr, ((W - S) / 2) * dpr, ((H - S) / 2) * dpr)

      const R = SPHERE.radius + amp * SPHERE.grow
      const ry = T * SPHERE.spin + amp * 0.06
      const rx = 0.3 + Math.sin(T * 0.2) * 0.12
      const cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx)
      x.globalCompositeOperation = pal.blend

      // soft multi-step glow: almost dark inside, bright rim
      const a0 = amp * 0.12, F = R * 1.25, gl = pal.glow
      let g = x.createRadialGradient(CX, CX, 0, CX, CX, F)
      g.addColorStop(0, `rgba(10,25,90,${0.03 * gl})`); g.addColorStop(0.4, `rgba(15,35,110,${0.05 * gl})`)
      g.addColorStop(0.58, `rgba(25,55,150,${0.1 * gl})`); g.addColorStop(0.68, `rgba(50,90,210,${(0.2 + a0) * gl})`)
      g.addColorStop(0.75, `rgba(90,140,255,${(0.4 + a0) * gl})`); g.addColorStop(0.8, `rgba(150,190,255,${(0.62 + a0) * gl})`)
      g.addColorStop(0.86, `rgba(90,140,255,${0.2 * gl})`); g.addColorStop(0.93, `rgba(40,80,200,${0.06 * gl})`); g.addColorStop(1, 'rgba(0,0,0,0)')
      x.fillStyle = g
      x.beginPath(); x.arc(CX, CX, F, 0, 7); x.fill()

      if (pal.bottomLight) { // bright light source at the bottom edge
        const hy = CX + R * 0.97
        g = x.createRadialGradient(CX, hy, 0, CX, hy, R * 0.5)
        g.addColorStop(0, `rgba(255,255,255,${0.45 + amp * 0.25})`); g.addColorStop(0.2, 'rgba(150,190,255,.3)'); g.addColorStop(1, 'rgba(0,0,0,0)')
        x.fillStyle = g
        x.beginPath(); x.arc(CX, hy, R * 0.5, 0, 7); x.fill()
        g = x.createLinearGradient(CX - R * 0.7, hy, CX + R * 0.7, hy)
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(220,235,255,.5)'); g.addColorStop(1, 'rgba(0,0,0,0)')
        x.fillStyle = g
        x.fillRect(CX - R * 0.7, hy - 0.8, R * 1.4, 1.6)
      }

      if (big) { // fine rays
        x.lineWidth = 0.8
        for (let i = 0; i < SPHERE.rays; i++) {
          const a = i * 0.157 + T * 0.04, L = R * (1.35 + 0.35 * Math.sin(i * 3 + T * 0.5))
          g = x.createLinearGradient(CX, CX, CX + Math.cos(a) * L, CX + Math.sin(a) * L)
          g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.7, rgba(pal.ray, (0.035 + amp * 0.03) * pal.alpha)); g.addColorStop(1, 'rgba(0,0,0,0)')
          x.strokeStyle = g
          x.beginPath(); x.moveTo(CX, CX); x.lineTo(CX + Math.cos(a) * L, CX + Math.sin(a) * L); x.stroke()
        }
      }

      // inner spheres: appear while speaking and move out and in with the voice
      if (vis > 0.01) {
        for (const s of IS) {
          const rs = R * s.rad * (0.8 + 0.2 * vis + 0.03 * Math.sin(T * 0.8 + s.ph) + sm * 0.45)
          const iy = T * s.spd, ix = s.tilt + Math.sin(T * 0.3 + s.ph) * 0.2
          const icy = Math.cos(iy), isy = Math.sin(iy), icx = Math.cos(ix), isx = Math.sin(ix)
          const Q = s.p.map((p) => { const r = rot(p, 1 + def(p) * 0.25, icy, isy, icx, isx); return [CX + r[0] * rs, CX + r[1] * rs, r[2]] })
          x.lineWidth = 0.6 * boost
          for (let e = 0; e < s.e.length; e += 2) {
            const a = Q[s.e[e]], d = Q[s.e[e + 1]], limb = 1 - Math.abs((a[2] + d[2]) / 2)
            x.strokeStyle = rgba(pal.innerLine, vis * (0.07 + 0.24 * limb * limb + amp * 0.3) * pal.alpha)
            x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(d[0], d[1]); x.stroke()
          }
          for (const q of Q) {
            const limb = 1 - Math.abs(q[2]), sz = (1.5 + limb * limb * 3.5 + amp * 2) * boost
            x.globalAlpha = Math.min(1, vis * (0.3 + 0.6 * limb * limb + amp * 0.6))
            x.drawImage(sprite, q[0] - sz, q[1] - sz, sz * 2, sz * 2)
          }
          x.globalAlpha = 1
        }
      }

      // the surface network
      const n = P.length
      const QX = new Float32Array(n), QY = new Float32Array(n), QZ = new Float32Array(n), QB = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        const p = P[i]
        const k = 1 + 0.025 * Math.sin(T * 0.8 + p.ph * 5) + 0.015 * Math.sin(T * 1.7 + p.ph * 2) + def(p)
        const r = rot(p, k, cy, sy, cx, sx)
        QX[i] = CX + r[0] * R; QY[i] = CX + r[1] * R; QZ[i] = r[2]; QB[i] = lum(p)
      }

      // current pulses gliding over the sphere (more often while Simon works)
      if (big) {
        const gap = st === 'thinking' ? SPHERE.pulseGapWorking : SPHERE.pulseGap
        if (T > model.nextP && PU.length < (st === 'thinking' ? 4 : 3)) {
          const a = Math.random() * 6.283, u = Math.random() * 2 - 1, r = Math.sqrt(1 - u * u)
          PU.push({ x: Math.cos(a) * r, y: u, z: Math.sin(a) * r, t0: T })
          model.nextP = T + gap[0] + Math.random() * gap[1]
        }
        if (model.nextP - T > 8) model.nextP = T + 1 // after switching tabs
        for (let i = PU.length - 1; i >= 0; i--) if ((T - PU[i].t0) * 0.6 > 4.6 || T < PU[i].t0) PU.splice(i, 1)
        NG.fill(0)
        for (const pu of PU) {
          const f = (T - pu.t0) * 0.6, fade = Math.max(0, 1 - f / 4.2)
          if (fade <= 0) continue
          for (let i = 0; i < n; i++) {
            const q = P[i]
            const ang = Math.acos(Math.max(-1, Math.min(1, q.x * pu.x + q.y * pu.y + q.z * pu.z)))
            const dl = f - ang
            NG[i] += (dl < 0 ? Math.exp(dl / 0.09) : Math.exp(-dl / 0.55)) * fade * 0.9
          }
        }
        for (let i = 0; i < n; i++) if (NG[i] > 1) NG[i] = 1
      }

      // links, batched by brightness so thousands of lines stay fast
      const buckets = new Map()
      for (let e = 0; e < E.length; e += 2) {
        const i = E[e], j = E[e + 1]
        const limb = 1 - Math.abs((QZ[i] + QZ[j]) / 2)
        const base = (0.07 + 0.45 * limb * limb * limb) * ((QB[i] + QB[j]) / 2)
        const gp = big ? (NG[i] + NG[j]) / 2 : 0
        const glowing = gp > 0.015
        const alpha = Math.min(1, glowing ? base + gp * 0.4 : base + amp * 0.06) * pal.alpha
        const key = (glowing ? 100 + Math.round(gp * 8) * 20 : 0) + Math.round(Math.min(1, alpha) * 19)
        let path = buckets.get(key)
        if (!path) { path = new Path2D(); buckets.set(key, path) }
        path.moveTo(QX[i], QY[i]); path.lineTo(QX[j], QY[j])
      }
      for (const [key, path] of buckets) {
        const a = (key % 20) / 19
        if (key >= 100) {
          const gp = Math.floor((key - 100) / 20) / 8
          x.strokeStyle = pal.blend === 'lighter'
            ? `rgba(${140 + gp * 50 | 0},${185 + gp * 35 | 0},255,${a})`
            : `rgba(${10 + gp * 20 | 0},${60 + gp * 40 | 0},${200 + gp * 40 | 0},${a})`
          x.lineWidth = (0.7 + gp * 0.5) * boost
        } else {
          x.strokeStyle = rgba(pal.line, a)
          x.lineWidth = 0.7 * boost
        }
        x.stroke(path)
      }

      // nodes
      for (let i = 0; i < n; i++) {
        const limb = 1 - Math.abs(QZ[i]), s = (1.8 + Math.pow(limb, 3) * 6 + amp * 2) * boost
        x.globalAlpha = Math.min(1, (0.35 + 0.65 * limb * limb) * QB[i])
        x.drawImage(sprite, QX[i] - s, QY[i] - s, s * 2, s * 2)
      }

      // sparkle dust
      x.lineWidth = 0.6
      for (const q of G) {
        const r = rot(q, 1 + def(q), cy, sy, cx, sx)
        const X = CX + r[0] * R, Y = CX + r[1] * R, tw = 0.5 + 0.5 * Math.sin(T * 3 + q.ph), limb = 1 - Math.abs(r[2])
        const s = (1 + q.s * 2.6) * (0.5 + tw * 0.8) * (0.5 + limb * 0.7) + amp
        x.globalAlpha = Math.min(1, (0.3 + 0.7 * limb * limb) * (0.35 + 0.65 * tw) * lum(q))
        x.drawImage(sprite, X - s, Y - s, s * 2, s * 2)
        if (q.s > 2 && tw > 0.65) {
          x.globalAlpha = 0.6 * tw
          x.strokeStyle = pal.cross
          x.beginPath(); x.moveTo(X - s * 3, Y); x.lineTo(X + s * 3, Y); x.moveTo(X, Y - s * 3); x.lineTo(X, Y + s * 3); x.stroke()
        }
      }
      x.globalAlpha = 1
      x.globalCompositeOperation = 'source-over'
    }

    paint = () => draw(performance.now())
    paint()
    const loop = (ms) => { draw(ms); raf = requestAnimationFrame(loop) }
    if (still) {
      const tick = () => { draw(performance.now()); timer = setTimeout(tick, 250) }
      tick()
    } else raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      ro.disconnect()
      mo.disconnect()
    }
  }, [])

  return (
    <span ref={wrapRef} className={`reactor reactor-${state}`}>
      <canvas ref={canvasRef} aria-hidden="true" />
    </span>
  )
}
