import { useState } from 'react'

const W = 640
const H = 220
const PAD = 8

export default function Chart({ title, currency, points }) {
  const [hover, setHover] = useState(null)
  if (!points?.length) return null
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)]
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)]
  const sx = (x) => PAD + ((x - x0) / (x1 - x0 || 1)) * (W - PAD * 2)
  const sy = (y) => H - PAD - ((y - y0) / (y1 - y0 || 1)) * (H - PAD * 2)
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ')
  const area = `${line} L${sx(x1)},${H} L${sx(x0)},${H} Z`
  const up = ys[ys.length - 1] >= ys[0]
  const change = ((ys[ys.length - 1] / ys[0] - 1) * 100).toFixed(2)
  const fmt = (v) => v.toLocaleString(undefined, { maximumFractionDigits: v < 10 ? 4 : 2 })
  const shown = hover ?? points[points.length - 1]

  const move = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = x0 + ((e.clientX - rect.left) / rect.width) * (x1 - x0)
    setHover(points.reduce((best, p) => (Math.abs(p[0] - x) < Math.abs(best[0] - x) ? p : best)))
  }

  return (
    <div className="chart">
      <div className="chart-head">
        <span>{title}</span>
        <span className={up ? 'up' : 'down'}>{fmt(shown[1])} {currency} · {up ? '▲' : '▼'} {change}%</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onMouseMove={move} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity=".35" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#fill)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {hover && <line x1={sx(hover[0])} x2={sx(hover[0])} y1="0" y2={H} stroke="var(--muted)" strokeDasharray="4 4" />}
      </svg>
      <div className="chart-foot">
        <span>{new Date(shown[0]).toLocaleString()}</span>
        <span>low {fmt(y0)} · high {fmt(y1)}</span>
      </div>
    </div>
  )
}
