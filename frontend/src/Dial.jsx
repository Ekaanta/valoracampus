import { useEffect, useRef } from 'react'

const TICKS = 56

/**
 * Simon's "presence": a ring of ticks that breathes when idle, ripples while listening,
 * sweeps while thinking and pulses while speaking.
 */
export default function Dial({ state = 'idle', size = 160, children }) {
  const svgRef = useRef(null)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    const lines = [...svgRef.current.querySelectorAll('line')]
    const amp = new Float32Array(TICKS)
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const start = performance.now()
    let raf

    const frame = (now) => {
      const t = (now - start) / 1000
      const s = stateRef.current
      for (let i = 0; i < TICKS; i++) {
        let target
        if (s === 'listening') target = 0.3 + 0.7 * Math.abs(Math.sin(t * 6.5 + i * 1.9) * Math.sin(t * 2.7 + i * 0.7))
        else if (s === 'speaking') target = 0.25 + 0.75 * Math.abs(Math.sin(t * 8 + i * 0.45)) * (0.55 + 0.45 * Math.sin(t * 2.1))
        else if (s === 'thinking') {
          const d = (((i / TICKS) - ((t * 0.9) % 1)) % 1 + 1) % 1
          target = 0.12 + 0.88 * Math.max(0, 1 - d * 4.5)
        } else target = 0.16 + 0.1 * (0.5 + 0.5 * Math.sin(t * 1.1 - i * 0.22))
        amp[i] += (target - amp[i]) * (still ? 1 : 0.16)
        const a = (i / TICKS) * Math.PI * 2 - Math.PI / 2
        const r1 = 38
        const r2 = r1 + 4 + 9 * amp[i]
        const ln = lines[i]
        ln.setAttribute('x1', (50 + r1 * Math.cos(a)).toFixed(2))
        ln.setAttribute('y1', (50 + r1 * Math.sin(a)).toFixed(2))
        ln.setAttribute('x2', (50 + r2 * Math.cos(a)).toFixed(2))
        ln.setAttribute('y2', (50 + r2 * Math.sin(a)).toFixed(2))
        ln.style.opacity = (0.3 + 0.7 * amp[i]).toFixed(2)
      }
      if (!still) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <span className={`dial dial-${state}`} style={{ width: size, height: size }}>
      <svg ref={svgRef} viewBox="0 0 100 100" aria-hidden="true">
        {Array.from({ length: TICKS }, (_, i) => <line key={i} strokeWidth="1.5" strokeLinecap="round" />)}
      </svg>
      {children && <span className="dial-center">{children}</span>}
    </span>
  )
}
