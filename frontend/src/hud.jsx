// Dashboard widgets shared by the side wings (desktop) and the full views (phone and tablet).
import Icon from './icons.jsx'

export const CATS = ['profile', 'preference', 'project', 'decision', 'task', 'other']

export const pad = (n, w = 2) => String(n ?? 0).padStart(w, '0')
const num = (n) => (n == null ? '—' : Number(n).toLocaleString())

export function relDate(iso) {
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d) / 86400000)
  if (days < 1) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

/** A framed dashboard panel with a spaced, monospaced title row. */
export function Panel({ title, meta, onOpen, className = '', children }) {
  return (
    <section className={`hud ${className}`}>
      <header className="hud-head">
        <span className="hud-title">{title}</span>
        <span className="grow" />
        {meta != null && <span className="hud-meta">{meta}</span>}
        {onOpen && (
          <button className="hud-open" onClick={onOpen} aria-label={`Open ${title}`} title="Open">
            <Icon name="expand" size={14} />
          </button>
        )}
      </header>
      {children}
    </section>
  )
}

/* ------------------------------------------------------------------ gauges */
export function Gauge({ value, max = 100, display, label, tone = '' }) {
  const r = 26
  const C = 2 * Math.PI * r
  const f = Math.max(0, Math.min(1, (value || 0) / max))
  return (
    <div className={`gauge ${tone}`}>
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r={r} className="g-track" />
        <circle cx="32" cy="32" r={r} className="g-val" strokeDasharray={`${(f * C).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90 32 32)" />
        <circle cx="32" cy="32" r="20" className="g-inner" />
      </svg>
      <span className="g-num">{display}</span>
      <span className="g-label">{label}</span>
    </div>
  )
}

export function Telemetry({ stats }) {
  const s = stats || {}
  const free = s.answers ? Math.round(100 * (1 - (s.paid_answers || 0) / s.answers)) : 100
  return (
    <div className="telemetry">
      <div className="gauges">
        <Gauge value={free} display={`${free}%`} label="Free" tone="ok" />
        <Gauge value={s.reliability ?? 100} display={`${s.reliability ?? 100}%`} label="Reliable" />
        <Gauge value={s.memories || 0} max={Math.max(50, s.memories || 0)} display={num(s.memories)} label="Memories" tone="hi" />
      </div>
      <dl className="readout">
        <div><dt>Questions</dt><dd>{num(s.questions)}</dd></div>
        <div><dt>Tools run</dt><dd>{num(s.tools_run)}</dd></div>
        <div><dt>Switches</dt><dd>{num(s.switches)}</dd></div>
        <div><dt>Paid calls</dt><dd className={s.paid_answers ? 'amber' : ''}>{num(s.paid_answers)}</dd></div>
      </dl>
    </div>
  )
}

/* ------------------------------------------------------------------ AI providers */
export function ProviderList({ providers, stats, detailed = false }) {
  if (!providers.length) return <p className="hud-empty">No AI provider is configured yet.</p>
  return (
    <ol className="pcards">
      {providers.map((p, i) => {
        const answers = stats?.by_provider?.[p.name] || 0
        const share = stats?.answers ? answers / stats.answers : 0
        const active = stats?.last_provider === p.name
        const state = p.cooling_down ? 'cooldown' : p.last_ok_at ? 'online' : 'ready'
        return (
          <li key={p.name} className={`pcard ${active ? 'active' : ''} ${p.paid ? 'paid' : ''}`}>
            <div className="pcard-top">
              <span className="pcard-name">{p.name}</span>
              <span className="pcard-rank">{pad(i + 1)}</span>
            </div>
            <div className="pcard-model">{p.model}</div>
            <div className="pcard-tags">
              <span className={`chip ${p.paid ? 'amber' : 'ok'}`}>{p.paid ? 'Paid · asks first' : 'Free'}</span>
              <span className={`chip ${active ? 'live' : state}`}>{active ? 'Active' : state}</span>
            </div>
            <div className="meter"><i style={{ width: `${Math.max(2, share * 100)}%` }} /></div>
            <div className="pcard-foot">
              <span>{answers} {answers === 1 ? 'answer' : 'answers'}</span>
              <span>{Math.round(share * 100)}%</span>
            </div>
            {detailed && p.cooling_down && p.last_error && <p className="pcard-err">{p.last_error}</p>}
          </li>
        )
      })}
    </ol>
  )
}

/* ------------------------------------------------------------------ second brain (memory graph) */
const GOLDEN = 2.39996

export function Brain({ memories, onPick }) {
  const W = 320
  const H = 200
  const cx = W / 2
  const cy = H / 2
  const cats = CATS.filter((c) => memories.some((m) => m.category === c))
  const hubs = cats.map((c, i) => {
    const a = (i / Math.max(1, cats.length)) * Math.PI * 2 - Math.PI / 2 + 0.35
    return { c, x: cx + Math.cos(a) * 96, y: cy + Math.sin(a) * 58 }
  })
  const nodes = []
  hubs.forEach((h) => {
    memories.filter((m) => m.category === h.c).slice(0, 16).forEach((m, j) => {
      const a = j * GOLDEN
      const r = 13 + 5.2 * Math.sqrt(j)
      nodes.push({ m, h, x: h.x + Math.cos(a) * r * 1.25, y: h.y + Math.sin(a) * r * 0.9, j })
    })
  })
  return (
    <svg className="brain" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${memories.length} memories grouped by category`}>
      {hubs.map((h) => <line key={h.c} x1={cx} y1={cy} x2={h.x} y2={h.y} className="b-spoke" />)}
      {nodes.map(({ m, h, x, y }) => <line key={`l${m.id}`} x1={h.x} y1={h.y} x2={x} y2={y} className="b-link" />)}
      {nodes.map(({ m, x, y, j }) => (
        <circle key={m.id} cx={x} cy={y} r="2.6" className={`b-node cat-${m.category}`} style={{ animationDelay: `${(j * 0.37) % 4}s` }}
                onClick={() => onPick?.(m)}>
          <title>{m.content}</title>
        </circle>
      ))}
      {hubs.map((h) => (
        <g key={`h${h.c}`} className={`b-hub cat-${h.c}`}>
          <circle cx={h.x} cy={h.y} r="4.5" />
          <text x={h.x} y={h.y - 9} textAnchor="middle">{h.c}</text>
        </g>
      ))}
      <circle cx={cx} cy={cy} r="9" className="b-core-halo" />
      <circle cx={cx} cy={cy} r="4.5" className="b-core" />
      {!memories.length && <text x={cx} y={cy + 26} textAnchor="middle" className="b-empty">Nothing learned yet</text>}
    </svg>
  )
}

/* ------------------------------------------------------------------ activity feed */
export const KIND_LABELS = {
  tool: 'tool', memory: 'memory', llm_failover: 'switch', llm_error: 'error', approval_requested: 'approval',
  approval_executed: 'confirmed', approval_rejected: 'rejected', paid_approval_needed: 'paid?', memory_error: 'error',
}

export function Feed({ items, limit = 30 }) {
  if (!items.length) return <p className="hud-empty">No activity yet.</p>
  return (
    <ol className="feed">
      {items.slice(0, limit).map((a) => (
        <li key={a.id} className={`k-${a.kind}`}>
          <time>{new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</time>
          <span className="kind">{KIND_LABELS[a.kind] || a.kind}</span>
          <span className="feed-text">{a.summary}</span>
        </li>
      ))}
    </ol>
  )
}

/* ------------------------------------------------------------------ sessions */
export function Sessions({ convs, convId, onOpen, onDelete }) {
  if (!convs.length) return <p className="hud-empty">Your conversations will appear here.</p>
  return (
    <ul className="sessions">
      {convs.map((c) => (
        <li key={c.id} className={c.id === convId ? 'active' : ''}>
          <button className="session" onClick={() => onOpen(c.id)}>
            <span className="session-title">{c.title}</span>
            <span className="session-date">{relDate(c.updated_at)}</span>
          </button>
          {onDelete && (
            <button className="icon-btn danger" onClick={() => onDelete(c)} aria-label={`Delete ${c.title}`} title="Delete">
              <Icon name="trash" size={16} />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
