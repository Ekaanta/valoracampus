import { useEffect, useRef } from 'react'
import { voiceLevel } from './voice.js'

const TAU = Math.PI * 2

/** Same colour with zero alpha, so gradients fade out without passing through grey. */
function clear(color) {
  const m = /^#([0-9a-f]{6})$/i.exec(color)
  if (!m) return 'rgba(255,255,255,0)'
  const n = parseInt(m[1], 16)
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},0)`
}

function readColors(el) {
  const cs = getComputedStyle(el)
  const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback
  return {
    line: v('--hud', '#3fd8ff'),
    hi: v('--hud-hi', '#c8f6ff'),
    amber: v('--amber', '#ffb547'),
    core: v('--core', '#22d3ee'),
    coreHi: v('--core-hi', '#f0feff'),
    glow: parseFloat(v('--glow', '1')) || 0,
    blend: v('--reactor-blend', 'lighter'),
  }
}

/**
 * Simon's arc reactor. Rings turn slowly when idle, ripple while listening, spin up and sweep
 * while thinking, and the core pulses with the real loudness of Simon's voice while speaking.
 * Fills its container (square); `compact` draws fewer layers for small sizes.
 */
export default function Reactor({ state = 'idle', compact = false }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    let W = 0
    let dpr = 1
    let colors = readColors(canvas)
    let paint = null // repaints at once after a resize (resizing a canvas clears it)

    const fit = () => {
      const r = wrapRef.current.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      W = Math.max(1, Math.floor(Math.min(r.width, r.height)))
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(W * dpr)
      canvas.style.width = `${W}px`
      canvas.style.height = `${W}px`
      paint?.()
    }
    const ro = new ResizeObserver(fit)
    ro.observe(wrapRef.current)
    fit()
    const mo = new MutationObserver(() => { colors = readColors(canvas) })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const N = compact ? 40 : 90
    const bars = new Float32Array(N)
    let energy = 0.25
    let speed = 1
    let think = 0
    let hear = 0
    let phase = 0
    let last = performance.now()
    let raf = 0
    let timer = 0

    const ring = (r, a0, a1, lw, color, alpha) => {
      ctx.beginPath()
      ctx.arc(0, 0, r, a0, a1)
      ctx.lineWidth = lw
      ctx.strokeStyle = color
      ctx.globalAlpha = alpha
      ctx.stroke()
    }
    const dashes = (r, count, gap, rot, lw, color, alpha) => {
      const seg = TAU / count
      ctx.beginPath()
      for (let k = 0; k < count; k++) {
        const a = rot + k * seg
        ctx.moveTo(Math.cos(a + gap * seg / 2) * r, Math.sin(a + gap * seg / 2) * r)
        ctx.arc(0, 0, r, a + gap * seg / 2, a + seg - gap * seg / 2)
      }
      ctx.lineWidth = lw
      ctx.strokeStyle = color
      ctx.globalAlpha = alpha
      ctx.stroke()
    }

    const draw = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const s = stateRef.current
      const T = still ? 0 : now / 1000
      let lvl = 0
      if (s === 'speaking') {
        const real = voiceLevel()
        lvl = real ?? (0.4 + 0.3 * Math.sin(T * 11) * Math.sin(T * 4.3))
      }
      const targetE = { listening: 0.75, thinking: 0.6, speaking: 0.45 + 0.55 * lvl }[s] ?? 0.25
      const targetS = { listening: 1.8, thinking: 3.4, speaking: 1.5 }[s] ?? 1
      const k = still ? 1 : Math.min(1, dt * 6)
      energy += (targetE - energy) * k
      speed += (targetS - speed) * Math.min(1, dt * 2.5)
      think += ((s === 'thinking' ? 1 : 0) - think) * k
      hear += ((s === 'listening' ? 1 : 0) - hear) * k
      phase += dt * speed
      const t = still ? 0 : phase

      const c = W / 2
      const R = c * 0.96
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, W)
      ctx.translate(c, c)
      ctx.lineCap = 'butt'
      const glow = colors.glow

      // ---- outer instrument ring: fine ticks and a slow orbit
      if (!compact) {
        const major = new Path2D()
        const minor = new Path2D()
        for (let i = 0; i < 120; i++) {
          const a = (i / 120) * TAU + t * 0.03
          const big = i % 10 === 0
          const r2 = R * 0.995
          const r1 = r2 - (big ? R * 0.055 : R * 0.025)
          const p = big ? major : minor
          p.moveTo(Math.cos(a) * r1, Math.sin(a) * r1)
          p.lineTo(Math.cos(a) * r2, Math.sin(a) * r2)
        }
        ctx.lineWidth = Math.max(1, R * 0.006)
        ctx.strokeStyle = colors.line
        ctx.globalAlpha = 0.22
        ctx.stroke(minor)
        ctx.globalAlpha = 0.6
        ctx.stroke(major)
        ring(R * 0.925, 0, TAU, Math.max(1, R * 0.004), colors.line, 0.2)
        const oa = t * 0.45
        ctx.globalAlpha = 0.95
        ctx.fillStyle = colors.hi
        ctx.beginPath()
        ctx.arc(Math.cos(oa) * R * 0.925, Math.sin(oa) * R * 0.925, Math.max(1.5, R * 0.013), 0, TAU)
        ctx.fill()
      }

      // ---- segmented ring with an amber marker
      const r2 = R * (compact ? 0.95 : 0.86)
      const rot2 = -t * 0.1
      const lw2 = Math.max(1, R * (compact ? 0.03 : 0.012))
      for (const [a0, a1] of [[0, 0.3], [0.36, 0.58], [0.64, 0.92]]) ring(r2, rot2 + a0 * TAU, rot2 + a1 * TAU, lw2, colors.line, 0.55)
      if (!compact) ring(r2, t * 0.32, t * 0.32 + 0.2, R * 0.024, colors.amber, 0.9)

      // ---- listening ripples
      if (hear > 0.02 && !compact) {
        for (let i = 0; i < 3; i++) {
          const f = ((T * 0.7 + i / 3) % 1)
          ring(R * (0.42 + f * 0.56), 0, TAU, Math.max(1, R * 0.008), colors.hi, (1 - f) * 0.5 * hear)
        }
      }

      // ---- thinking sweep
      if (think > 0.02) {
        const base = T * 2.6
        const rs = R * (compact ? 0.8 : 0.765)
        for (let i = 0; i < 10; i++) {
          ring(rs, base - (i + 1) * 0.09, base - i * 0.09, R * (compact ? 0.12 : 0.085), colors.line, (1 - i / 10) * 0.35 * think)
        }
      }

      // ---- spectrum bars (voice / listening / thinking)
      const b0 = R * (compact ? 0.66 : 0.68)
      const bl = R * (compact ? 0.2 : 0.14)
      ctx.lineWidth = Math.max(1, R * (compact ? 0.035 : 0.011))
      ctx.strokeStyle = colors.hi
      ctx.lineCap = 'round'
      for (let i = 0; i < N; i++) {
        let target
        if (s === 'listening') target = 0.2 + 0.8 * Math.abs(Math.sin(T * 6.3 + i * 1.7) * Math.sin(T * 2.1 + i * 0.6))
        else if (s === 'speaking') target = 0.08 + lvl * (0.35 + 0.65 * Math.abs(Math.sin(i * 0.93 + T * 9)))
        else if (s === 'thinking') {
          const d = ((((i / N) - ((T * 0.42) % 1)) % 1) + 1) % 1
          target = 0.1 + 0.9 * Math.max(0, 1 - d * 5)
        } else target = 0.1 + 0.1 * (0.5 + 0.5 * Math.sin(T * 1.2 - i * 0.25))
        bars[i] += (target - bars[i]) * (still ? 1 : Math.min(1, dt * 10))
        const a = (i / N) * TAU - Math.PI / 2
        const r1 = b0
        const rr = b0 + R * 0.015 + bl * bars[i]
        ctx.globalAlpha = 0.2 + 0.75 * bars[i]
        ctx.beginPath()
        ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1)
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
        ctx.stroke()
      }
      ctx.lineCap = 'butt'

      // ---- heavy dashed ring (glowing)
      ctx.shadowColor = colors.line
      ctx.shadowBlur = R * 0.07 * glow * (0.5 + energy)
      dashes(R * (compact ? 0.5 : 0.58), compact ? 8 : 10, 0.34, t * 0.22, R * (compact ? 0.09 : 0.048), colors.line, 0.88)
      ctx.shadowBlur = 0

      if (!compact) {
        dashes(R * 0.48, 24, 0.45, -t * 0.36, R * 0.022, colors.line, 0.7)
        ring(R * 0.415, 0, TAU, Math.max(1, R * 0.005), colors.line, 0.35)
      }

      // ---- core
      const rc = R * ((compact ? 0.3 : 0.27) + 0.05 * energy + 0.05 * lvl)
      ctx.globalCompositeOperation = colors.blend === 'lighter' ? 'lighter' : 'source-over'
      const halo = ctx.createRadialGradient(0, 0, rc * 0.3, 0, 0, R * 0.8)
      halo.addColorStop(0, colors.core)
      halo.addColorStop(1, clear(colors.core))
      ctx.globalAlpha = (0.18 + 0.3 * energy) * glow
      ctx.fillStyle = halo
      ctx.beginPath()
      ctx.arc(0, 0, R * 0.8, 0, TAU)
      ctx.fill()

      const body = ctx.createRadialGradient(0, 0, 0, 0, 0, rc)
      body.addColorStop(0, colors.coreHi)
      body.addColorStop(0.32, colors.coreHi)
      body.addColorStop(0.62, colors.core)
      body.addColorStop(1, clear(colors.core))
      ctx.globalAlpha = 0.75 + 0.25 * energy
      ctx.fillStyle = body
      ctx.beginPath()
      ctx.arc(0, 0, rc, 0, TAU)
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'

      // plasma threads turning inside the core
      if (!compact) {
        for (let i = 0; i < 3; i++) {
          const a = t * (1.2 + i * 0.35) + i * 2.1
          ring(rc * (0.55 + i * 0.12), a, a + 1.1, Math.max(1, R * 0.006), colors.coreHi, 0.35 + 0.3 * energy)
        }
      }
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
  }, [compact])

  return (
    <span ref={wrapRef} className={`reactor reactor-${state}`}>
      <canvas ref={canvasRef} aria-hidden="true" />
    </span>
  )
}
