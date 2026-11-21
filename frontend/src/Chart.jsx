import { useState } from 'react'

const W = 640
const H = 200
const PAD = 6

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
  const change = (ys[ys.length - 1] / ys[0] - 1) * 100
  const fmt = (v) => v.toLocaleString(undefined, { maximumFractionDigits: v < 10 ? 4 : 2 })
  const shown = hover ?? points[points.length - 1]
  const [name, ...rest] = (title || '').split(' · ')

  const move = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const x = x0 + ((clientX - rect.left) / rect.width) * (x1 - x0)
    setHover(points.reduce((best, p) => (Math.abs(p[0] - x) < Math.abs(best[0] - x) ? p : best)))
  }

  return (
    <figure className="chartcard">
      <figcaption className="chart-head">
        <div>
          <div className="eyebrow">{rest.join(' · ')}</div>
          <div className="chart-name">{name}</div>
        </div>
        <div className="chart-price">
          <span className="num">{fmt(shown[1])}</span> <span className="cur">{currency}</span>
          <span className={`delta ${up ? 'up' : 'down'}`}>{up ? '+' : ''}{change.toFixed(2)}%</span>
        </div>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onMouseMove={move} onTouchMove={move}
           onMouseLeave={() => setHover(null)} onTouchEnd={() => setHover(null)} role="img"
           aria-label={`${name} price chart, ${up ? 'up' : 'down'} ${Math.abs(change).toFixed(1)} percent`}>
        <defs>
          <linearGradient id="chartfill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity=".18" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} className="gridline" />)}
        <path d={area} fill="url(#chartfill)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {hover && <line x1={sx(hover[0])} x2={sx(hover[0])} y1="0" y2={H} className="cursor" />}
      </svg>
      <div className="chart-foot">
        <span>{new Date(shown[0]).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        <span>L {fmt(y0)} · H {fmt(y1)}</span>
      </div>
    </figure>
  )
}
