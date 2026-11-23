import { useEffect, useRef } from 'react'
import { voiceLevel } from './voice.js'

const TAU = Math.PI * 2
const GOLDEN = 2.39996

function readColors(el) {
  const cs = getComputedStyle(el)
  const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback
  const blend = v('--reactor-blend', 'lighter')
  return {
    line: v('--hud', '#3fd8ff'),
    hi: v('--hud-hi', '#c8f6ff'),
    amber: v('--amber', '#ffb547'),
    ok: v('--ok', '#45e2a0'),
    core: v('--core', '#22d3ee'),
    coreHi: v('--core-hi', '#f0feff'),
    glow: parseFloat(v('--glow', '1')) || 0,
    dark: blend === 'lighter',
  }
}

/** Same colour with zero alpha, so gradients fade out without passing through grey. */
function clear(color) {
  const m = /^#([0-9a-f]{6})$/i.exec(color)
  if (!m) return 'rgba(255,255,255,0)'
  const n = parseInt(m[1], 16)
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},0)`
}

/** Small deterministic random generator: the sphere looks the same on every visit. */
function random(seed) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

/** Points on (and slightly inside) a sphere, plus a sparse web linking near neighbours. */
function buildSphere(n) {
  const rnd = random(11)
  const pts = new Float32Array(n * 3)
  const phase = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2
    const rad = Math.sqrt(1 - y * y)
    const th = i * GOLDEN + (rnd() - 0.5) * 0.3
    const depth = rnd() < 0.82 ? 0.9 + rnd() * 0.1 : 0.35 + rnd() * 0.5 // most on the shell, some inside
    pts[i * 3] = Math.cos(th) * rad * depth
    pts[i * 3 + 1] = y * depth
    pts[i * 3 + 2] = Math.sin(th) * rad * depth
    phase[i] = rnd() * TAU
  }
  const pairs = new Set()
  for (let i = 0; i < n; i++) {
    let b1 = -1, b2 = -1, d1 = 9, d2 = 9
    for (let j = 0; j < n; j++) {
      if (j === i) continue
      const dx = pts[i * 3] - pts[j * 3], dy = pts[i * 3 + 1] - pts[j * 3 + 1], dz = pts[i * 3 + 2] - pts[j * 3 + 2]
      const d = dx * dx + dy * dy + dz * dz
      if (d < d1) { d2 = d1; b2 = b1; d1 = d; b1 = j } else if (d < d2) { d2 = d; b2 = j }
    }
    for (const j of [b1, b2]) if (j >= 0) pairs.add(i < j ? i * 65536 + j : j * 65536 + i)
  }
  const edges = new Uint16Array(pairs.size * 2)
  let k = 0
  for (const p of pairs) { edges[k++] = Math.floor(p / 65536); edges[k++] = p % 65536 }
  return { pts, phase, edges }
}

function buildShards(count) {
  const rnd = random(5)
  return Array.from({ length: count }, () => ({
    r: 1.38 + rnd() * 0.42,
    tilt: (rnd() - 0.5) * 1.4,
    roll: (rnd() - 0.5) * 0.8,
    speed: (0.08 + rnd() * 0.12) * (rnd() < 0.5 ? -1 : 1),
    a: rnd() * TAU,
    size: 0.6 + rnd() * 0.7,
    spin: rnd() * TAU,
  }))
}

// flat, crossing orbit rings (seen almost edge-on, like rings around a planet)
const RINGS = [
  { r: 1.62, tilt: 0.12, roll: 0.3, speed: 0.55 },
  { r: 1.82, tilt: -0.06, roll: -0.4, speed: -0.38 },
]

/**
 * Simon's core: a slowly turning particle sphere with a glowing heart, orbit rings and drifting
 * crystals. It ripples while listening, spins up while working, and its surface waves with the
 * real loudness of Simon's voice while speaking. Fills its container; `compact` for small sizes.
 */
export default function Reactor({ state = 'idle', compact: forceCompact = false }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    let W = 0
    let H = 0
    let dpr = 1
    let colors = readColors(canvas)
    let paint = null // repaints at once after a resize (resizing a canvas clears it)
    let model = null
    let compact = forceCompact

    const fit = () => {
      const r = wrapRef.current.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      W = Math.max(1, Math.floor(r.width))
      H = Math.max(1, Math.floor(r.height))
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      canvas.style.width = `${W}px`
      canvas.style.height = `${H}px`
      const small = forceCompact || Math.min(W, H) < 110
      if (!model || small !== compact) {
        compact = small
        model = { sphere: buildSphere(compact ? 150 : 680), shards: compact ? [] : buildShards(11) }
        sx = new Float32Array(model.sphere.pts.length / 3)
        sy = new Float32Array(sx.length)
        sz = new Float32Array(sx.length)
      }
      paint?.()
    }
    let sx, sy, sz
    const ro = new ResizeObserver(fit)
    ro.observe(wrapRef.current)
    fit()
    const mo = new MutationObserver(() => { colors = readColors(canvas) })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let energy = 0.25
    let speed = 1
    let think = 0
    let hear = 0
    let lvlS = 0
    let rotY = 0.6
    let last = performance.now()
    let raf = 0
    let timer = 0

    const draw = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const s = stateRef.current
      const T = still ? 0 : now / 1000
      let lvl = 0
      if (s === 'speaking') {
        const real = voiceLevel()
        lvl = real ?? (0.45 + 0.35 * Math.sin(T * 11) * Math.sin(T * 4.3))
      }
      const k = still ? 1 : Math.min(1, dt * 6)
      lvlS += (lvl - lvlS) * (still ? 1 : Math.min(1, dt * 18))
      energy += (({ listening: 0.7, thinking: 0.6, speaking: 0.45 + 0.55 * lvlS }[s] ?? 0.22) - energy) * k
      speed += (({ listening: 1.6, thinking: 4.2, speaking: 1.4 }[s] ?? 1) - speed) * Math.min(1, dt * 2.5)
      think += ((s === 'thinking' ? 1 : 0) - think) * k
      hear += ((s === 'listening' ? 1 : 0) - hear) * k
      if (!still) rotY += dt * 0.16 * speed

      const { sphere, shards } = model
      const n = sx.length
      const cx = W / 2
      const cy = H / 2
      const half = Math.min(W, H) / 2
      const Rs = half * (compact ? 0.74 : W / H < 1.25 ? 0.44 : 0.52) // narrow screens: keep the rings inside
      const tilt = 0.34 + 0.07 * Math.sin(T * 0.27)
      const cY = Math.cos(rotY), sY = Math.sin(rotY), cX = Math.cos(tilt), sX = Math.sin(tilt)
      const dark = colors.dark
      const boost = dark ? 1 : 1.5
      const glow = colors.glow
      const pointColor = dark ? colors.hi : colors.line
      const accent = hear > 0.5 ? colors.ok : think > 0.5 ? colors.amber : colors.hi

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over'

      // ---- halo behind the sphere
      const halo = ctx.createRadialGradient(cx, cy, Rs * 0.1, cx, cy, Rs * 1.7)
      halo.addColorStop(0, colors.core)
      halo.addColorStop(1, clear(colors.core))
      ctx.globalAlpha = (0.1 + 0.22 * energy) * glow
      ctx.fillStyle = halo
      ctx.fillRect(0, 0, W, H)

      // ---- horizontal light streak across the whole stage
      if (!compact) {
        const a = (0.22 + 0.55 * energy + 0.5 * lvlS) * (dark ? 1 : 0.7)
        const g = ctx.createLinearGradient(0, 0, W, 0)
        g.addColorStop(0, clear(colors.core))
        g.addColorStop(0.5, colors.core)
        g.addColorStop(1, clear(colors.core))
        ctx.fillStyle = g
        ctx.globalAlpha = a * 0.18
        ctx.fillRect(0, cy - 9, W, 18)
        ctx.globalAlpha = a
        ctx.fillRect(0, cy - 0.75, W, 1.5)
        ctx.globalAlpha = a * 0.35
        ctx.fillRect(W * 0.12, cy - 7, W * 0.76, 1)
        ctx.fillRect(W * 0.2, cy + 6, W * 0.6, 1)
      }

      // ---- orbit rings (back halves first) and crystals behind the sphere
      const ringPts = (ring) => {
        const out = []
        const roll = ring.roll + 0.12 * Math.sin(T * 0.2 + ring.r)
        const cT = Math.cos(ring.tilt), sT = Math.sin(ring.tilt), cR = Math.cos(roll), sR = Math.sin(roll)
        for (let i = 0; i <= 96; i++) {
          const a = (i / 96) * TAU
          let x = Math.cos(a) * ring.r, y = 0, z = Math.sin(a) * ring.r
          const y1 = y * cT - z * sT; const z1 = y * sT + z * cT; y = y1; z = z1
          const x2 = x * cR - y * sR; const y2 = x * sR + y * cR; x = x2; y = y2
          const y3 = y * cX - z * sX; const z3 = y * sX + z * cX
          const p = 3 / (3 - z3)
          out.push([cx + x * Rs * p, cy + y3 * Rs * p, z3])
        }
        return out
      }
      const rings = (compact ? RINGS.slice(0, 1) : RINGS).map(ringPts)
      const strokeRing = (pts, front) => {
        ctx.beginPath()
        for (let i = 0; i < pts.length - 1; i++) {
          const z = (pts[i][2] + pts[i + 1][2]) / 2
          if ((z >= 0) !== front) continue
          ctx.moveTo(pts[i][0], pts[i][1])
          ctx.lineTo(pts[i + 1][0], pts[i + 1][1])
        }
        ctx.lineWidth = compact ? 1 : 1.3
        ctx.strokeStyle = colors.line
        ctx.globalAlpha = (front ? 0.75 : 0.25) * (0.7 + 0.4 * energy)
        ctx.stroke()
      }
      rings.forEach((pts) => strokeRing(pts, false))

      const shardPos = shards.map((sh) => {
        const a = sh.a + T * sh.speed * speed
        const r = sh.r + 0.28 * lvlS + 0.04 * Math.sin(T + sh.spin)
        let x = Math.cos(a) * r, y = 0, z = Math.sin(a) * r
        const cT = Math.cos(sh.tilt), sT = Math.sin(sh.tilt)
        const y1 = y * cT - z * sT; const z1 = y * sT + z * cT; y = y1; z = z1
        const x2 = x * Math.cos(sh.roll) - y * Math.sin(sh.roll); const y2 = x * Math.sin(sh.roll) + y * Math.cos(sh.roll); x = x2; y = y2
        const y3 = y * cX - z * sX; const z3 = y * sX + z * cX
        const p = 3 / (3 - z3)
        return { sh, x: cx + x * Rs * p, y: cy + y3 * Rs * p, z: z3, p }
      })
      const drawShard = ({ sh, x, y, z, p }) => {
        const size = Rs * 0.045 * sh.size * p
        const rot = sh.spin + T * 0.6 * Math.sign(sh.speed)
        ctx.beginPath()
        for (let i = 0; i < 4; i++) {
          const a = rot + (i * Math.PI) / 2
          const rr = i % 2 ? size * 0.62 : size
          ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr)
        }
        ctx.closePath()
        const depth = 0.35 + 0.65 * ((z + 1.8) / 3.6)
        ctx.globalAlpha = 0.16 * depth * boost
        ctx.fillStyle = pointColor
        ctx.fill()
        ctx.globalAlpha = 0.75 * depth
        ctx.lineWidth = 1
        ctx.strokeStyle = pointColor
        ctx.stroke()
        ctx.beginPath() // a facet line gives the crystal some volume
        ctx.moveTo(x + Math.cos(rot) * size, y + Math.sin(rot) * size)
        ctx.lineTo(x + Math.cos(rot + Math.PI) * size, y + Math.sin(rot + Math.PI) * size)
        ctx.globalAlpha = 0.35 * depth
        ctx.stroke()
      }
      shardPos.filter((q) => q.z < 0).forEach(drawShard)

      // ---- plasma body and rim light
      const bodyR = Rs * (1.04 + 0.06 * lvlS)
      const body = ctx.createRadialGradient(cx, cy, 0, cx, cy, bodyR)
      body.addColorStop(0, colors.core)
      body.addColorStop(0.7, colors.core)
      body.addColorStop(1, clear(colors.core))
      ctx.globalAlpha = (0.08 + 0.1 * energy) * (dark ? 1 : 0.6)
      ctx.fillStyle = body
      ctx.beginPath()
      ctx.arc(cx, cy, bodyR, 0, TAU)
      ctx.fill()
      if (!compact) {
        ctx.globalAlpha = 0.22 + 0.25 * energy
        ctx.lineWidth = 1.2
        ctx.strokeStyle = colors.line
        ctx.beginPath()
        ctx.arc(cx, cy, Rs * (1.02 + 0.05 * lvlS), 0, TAU)
        ctx.stroke()
      }

      // ---- sphere: displace, rotate, project
      const { pts, phase, edges } = sphere
      for (let i = 0; i < n; i++) {
        const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2]
        const ph = phase[i]
        let f = 1 + 0.02 * Math.sin(T * 0.9) + 0.012 * Math.sin(T * 1.4 + ph)
        if (hear > 0.01) f += hear * 0.06 * Math.sin(T * 6 - y * 7 + ph * 0.3)
        if (think > 0.01) f += think * 0.035 * Math.sin(T * 9 + ph)
        if (lvlS > 0.01) f += lvlS * (0.05 + 0.17 * (0.5 + 0.5 * Math.sin(y * 6 + T * 11 + ph * 0.7)))
        const x1 = (x * cY - z * sY) * f
        const z1 = (x * sY + z * cY) * f
        const y1 = y * f
        const y2 = y1 * cX - z1 * sX
        const z2 = y1 * sX + z1 * cX
        const p = 3 / (3 - z2)
        sx[i] = cx + x1 * Rs * p
        sy[i] = cy + y2 * Rs * p
        sz[i] = z2
      }

      // web between neighbours, three depth layers
      if (!compact) {
        const layers = [new Path2D(), new Path2D(), new Path2D()]
        for (let e = 0; e < edges.length; e += 2) {
          const a = edges[e], b = edges[e + 1]
          const z = (sz[a] + sz[b]) / 2
          const L = layers[z < -0.3 ? 0 : z < 0.35 ? 1 : 2]
          L.moveTo(sx[a], sy[a])
          L.lineTo(sx[b], sy[b])
        }
        ctx.lineWidth = 0.7
        ctx.strokeStyle = colors.line
        const base = (0.75 + 0.6 * energy) * boost
        ;[0.07, 0.14, 0.26].forEach((a, i) => { ctx.globalAlpha = Math.min(1, a * base); ctx.stroke(layers[i]) })
      }

      // particles, three depth layers, plus a few bright "hot" ones
      const sizes = compact ? [0.9, 1.2, 1.6] : [1.1, 1.6, 2.2]
      const alphas = [0.3, 0.55, 0.95]
      ctx.fillStyle = pointColor
      for (let L = 0; L < 3; L++) {
        ctx.globalAlpha = alphas[L] * (0.75 + 0.35 * energy)
        const sz2 = sizes[L]
        ctx.beginPath()
        for (let i = 0; i < n; i++) {
          const z = sz[i]
          const layer = z < -0.3 ? 0 : z < 0.35 ? 1 : 2
          if (layer !== L) continue
          ctx.rect(sx[i] - sz2 / 2, sy[i] - sz2 / 2, sz2, sz2)
        }
        ctx.fill()
      }
      if (!compact) {
        for (let i = 0; i < n; i += 19) {
          if (sz[i] < 0) continue
          const tw = 0.5 + 0.5 * Math.sin(T * 2.3 + phase[i] * 3)
          ctx.globalAlpha = (0.25 + 0.5 * tw) * (dark ? 0.6 : 0.5)
          ctx.fillStyle = accent
          ctx.beginPath()
          ctx.arc(sx[i], sy[i], 3.2 + 1.6 * tw, 0, TAU)
          ctx.fill()
          ctx.globalAlpha = 0.95
          ctx.fillStyle = dark ? colors.coreHi : colors.hi
          ctx.beginPath()
          ctx.arc(sx[i], sy[i], 1.4, 0, TAU)
          ctx.fill()
        }
      }

      // ---- heart of the sphere with a small reticle
      const rc = Rs * ((compact ? 0.42 : 0.24) + 0.06 * energy + 0.2 * lvlS)
      const heart = ctx.createRadialGradient(cx, cy, 0, cx, cy, rc)
      heart.addColorStop(0, colors.coreHi)
      heart.addColorStop(0.28, colors.coreHi)
      heart.addColorStop(0.55, colors.core)
      heart.addColorStop(1, clear(colors.core))
      ctx.globalAlpha = 0.85 + 0.15 * energy
      ctx.fillStyle = heart
      ctx.beginPath()
      ctx.arc(cx, cy, rc, 0, TAU)
      ctx.fill()
      if (!compact) {
        ctx.strokeStyle = colors.line
        ctx.lineWidth = 1
        for (const [r, dash, dir] of [[0.32, 6, 1], [0.4, 14, -1]]) {
          ctx.globalAlpha = 0.45 + 0.3 * energy
          ctx.beginPath()
          const seg = TAU / dash
          for (let i = 0; i < dash; i++) {
            const a = i * seg + T * 0.5 * dir * speed
            ctx.moveTo(cx + Math.cos(a) * Rs * r, cy + Math.sin(a) * Rs * r)
            ctx.arc(cx, cy, Rs * r, a, a + seg * 0.55)
          }
          ctx.stroke()
        }
        ctx.globalAlpha = 0.16 // faint crosshair
        ctx.beginPath()
        ctx.moveTo(cx, cy - Rs * 1.05); ctx.lineTo(cx, cy + Rs * 1.05)
        ctx.stroke()
      }

      // ---- front halves of the rings, their travelling lights, and the near crystals
      rings.forEach((pts, i) => {
        strokeRing(pts, true)
        const pos = ((T * RINGS[i].speed * speed * 0.25) % 1 + 1) % 1
        const q = pts[Math.floor(pos * 96)]
        if (q[2] < 0 && compact) return
        ctx.globalAlpha = q[2] < 0 ? 0.35 : 1
        ctx.fillStyle = accent
        ctx.beginPath()
        ctx.arc(q[0], q[1], compact ? 1.6 : 2.6, 0, TAU)
        ctx.fill()
      })
      shardPos.filter((q) => q.z >= 0).forEach(drawShard)

      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
    }

    paint = () => draw(performance.now())
    paint()
    const loop = (now) => {
      draw(now)
      raf = requestAnimationFrame(loop)
    }
    if (still) {
      const tick = () => { draw(performance.now()); timer = setTimeout(tick, 300) }
      tick()
    } else raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      ro.disconnect()
      mo.disconnect()
    }
  }, [forceCompact])

  return (
    <span ref={wrapRef} className={`reactor reactor-${state}`}>
      <canvas ref={canvasRef} aria-hidden="true" />
    </span>
  )
}
