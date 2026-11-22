// Full-size views: opened from the tab bar (phone, tablet) or from a wing panel's expand button (desktop).
import { useEffect, useState } from 'react'
import { api } from './api.js'
import { Brain, CATS, Feed, KIND_LABELS, Panel, ProviderList, Sessions, Telemetry } from './hud.jsx'
import Icon from './icons.jsx'

function ViewHead({ title, code, children, onBack }) {
  return (
    <header className="view-head">
      {onBack && (
        <button className="back" onClick={onBack}><Icon name="back" size={16} /> Core</button>
      )}
      <p className="eyebrow">{code}</p>
      <h2 className="view-title">{title}</h2>
      {children && <p className="view-sub">{children}</p>}
    </header>
  )
}

export function MemoryPanel({ onBack, onChanged }) {
  const [items, setItems] = useState([])
  const [all, setAll] = useState([])
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState({ content: '', category: 'profile' })
  const [editing, setEditing] = useState(null)

  const load = () => api(`/memories?q=${encodeURIComponent(q)}`).then((rows) => {
    setItems(rows)
    if (!q) setAll(rows) // the graph always shows everything
  }).catch(() => {})
  useEffect(() => { load() }, [q]) // eslint-disable-line react-hooks/exhaustive-deps
  const changed = () => { load(); onChanged?.() }

  const add = async (e) => {
    e.preventDefault()
    if (!draft.content.trim()) return
    await api('/memories', { method: 'POST', body: draft })
    setDraft({ ...draft, content: '' })
    changed()
  }
  const save = async () => {
    await api(`/memories/${editing.id}`, { method: 'PUT', body: { content: editing.content, category: editing.category } })
    setEditing(null)
    changed()
  }
  const remove = async (id) => {
    if (!confirm('Delete this memory permanently?')) return
    await api(`/memories/${id}`, { method: 'DELETE' })
    changed()
  }

  return (
    <div className="view">
      <ViewHead title="Memory bank" code="02 · Second brain" onBack={onBack}>
        What Simon knows about you, learned from your conversations. Correct or delete anything at any time.
      </ViewHead>
      <Panel title="Knowledge graph" meta={`${all.length} ${all.length === 1 ? 'memory' : 'memories'}`} className="brain-panel">
        <Brain memories={all} onPick={(m) => setEditing(m)} />
      </Panel>
      <div className="field-search">
        <Icon name="search" size={18} />
        <input placeholder="Search memory" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search memory" />
      </div>
      <form className="add-row" onSubmit={add}>
        <input placeholder="Tell Simon something to remember…" value={draft.content}
               onChange={(e) => setDraft({ ...draft, content: e.target.value })} aria-label="New memory" />
        <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} aria-label="Category">
          {CATS.map((c) => <option key={c}>{c}</option>)}
        </select>
        <button className="btn primary" disabled={!draft.content.trim()}>Store</button>
      </form>
      <ul className="rows">
        {items.map((m) => (
          <li key={m.id} className="row">
            {editing?.id === m.id ? (
              <div className="edit-row">
                <input value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} aria-label="Memory text" autoFocus />
                <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} aria-label="Category">
                  {CATS.map((c) => <option key={c}>{c}</option>)}
                </select>
                <button className="btn primary small" onClick={save}>Save</button>
                <button className="btn ghost small" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            ) : (
              <>
                <span className={`tag cat-${m.category}`}>{m.category}</span>
                <span className="row-text">{m.content}</span>
                <span className="row-meta">{m.source === 'auto' ? 'learned' : 'added'}</span>
                <span className="row-actions">
                  <button className="icon-btn" onClick={() => setEditing(m)} aria-label="Edit"><Icon name="edit" size={18} /></button>
                  <button className="icon-btn danger" onClick={() => remove(m.id)} aria-label="Delete"><Icon name="trash" size={18} /></button>
                </span>
              </>
            )}
          </li>
        ))}
        {!items.length && <li className="empty">{q ? 'Nothing matches that search.' : 'Nothing stored yet. Simon learns as you talk.'}</li>}
      </ul>
    </div>
  )
}

export function ActivityPanel({ onBack }) {
  const [items, setItems] = useState([])
  useEffect(() => {
    const load = () => api('/activity?limit=200').then(setItems).catch(() => {})
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="view">
      <ViewHead title="Activity log" code="03 · Every step" onBack={onBack}>
        Every step Simon took: tools used, provider switches, approvals and memories learned.
      </ViewHead>
      <ol className="timeline">
        {items.map((a) => (
          <li key={a.id} className={`k-${a.kind}`}>
            <time>{new Date(a.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
            <span className="kind">{KIND_LABELS[a.kind] || a.kind}</span>
            <span className="row-text">{a.summary}</span>
          </li>
        ))}
        {!items.length && <li className="empty">No activity yet.</li>}
      </ol>
    </div>
  )
}

export function SystemsPanel({ onBack, providers, stats }) {
  return (
    <div className="view">
      <ViewHead title="Systems" code="04 · Neural core" onBack={onBack}>
        Free first. Simon tries these providers in order and moves to the next one when a provider is busy or out of
        quota. A paid model is only used after you approve it.
      </ViewHead>
      <Panel title="Telemetry"><Telemetry stats={stats} /></Panel>
      <Panel title="Neural core" meta={`${providers.length} ${providers.length === 1 ? 'model' : 'models'}`}>
        <ProviderList providers={providers} stats={stats} detailed />
      </Panel>
      <Panel title="Live feed"><ActivityMini /></Panel>
    </div>
  )
}

function ActivityMini() {
  const [items, setItems] = useState([])
  useEffect(() => { api('/activity?limit=12').then(setItems).catch(() => {}) }, [])
  return <Feed items={items} limit={12} />
}

export function HistoryPanel({ onBack, convs, convId, onOpen, onNew, onChanged }) {
  const remove = async (c) => {
    if (!confirm(`Delete “${c.title}” permanently?`)) return
    await api(`/conversations/${c.id}`, { method: 'DELETE' })
    onChanged?.(c.id)
  }
  return (
    <div className="view">
      <ViewHead title="Sessions" code="01 · History" onBack={onBack}>
        Every conversation is saved and searchable by Simon. Open one to continue where you left off.
      </ViewHead>
      <button className="btn primary wide" onClick={onNew}><Icon name="plus" size={18} /> New session</button>
      <Sessions convs={convs} convId={convId} onOpen={onOpen} onDelete={remove} />
    </div>
  )
}
