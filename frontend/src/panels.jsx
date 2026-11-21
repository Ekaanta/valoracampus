import { useEffect, useState } from 'react'
import { api } from './api.js'
import Icon from './icons.jsx'

const CATS = ['profile', 'preference', 'project', 'decision', 'task', 'other']

function PanelHead({ title, children }) {
  return (
    <header className="panel-head">
      <h2 className="panel-title">{title}</h2>
      <p className="panel-sub">{children}</p>
    </header>
  )
}

export function MemoryPanel() {
  const [items, setItems] = useState([])
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState({ content: '', category: 'profile' })
  const [editing, setEditing] = useState(null)

  const load = () => api(`/memories?q=${encodeURIComponent(q)}`).then(setItems).catch(() => {})
  useEffect(() => { load() }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  const add = async (e) => {
    e.preventDefault()
    if (!draft.content.trim()) return
    await api('/memories', { method: 'POST', body: draft })
    setDraft({ ...draft, content: '' })
    load()
  }
  const save = async () => {
    await api(`/memories/${editing.id}`, { method: 'PUT', body: { content: editing.content, category: editing.category } })
    setEditing(null)
    load()
  }
  const remove = async (id) => {
    if (!confirm('Delete this memory permanently?')) return
    await api(`/memories/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div className="panel">
      <PanelHead title="Memory">
        What Simon knows about you, learned from your conversations. Correct or delete anything at any time.
      </PanelHead>
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
        <button className="btn primary" disabled={!draft.content.trim()}>Add</button>
      </form>
      <p className="count">{items.length} {items.length === 1 ? 'memory' : 'memories'}</p>
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
                <span className="tag">{m.category}</span>
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

const KIND_LABELS = {
  tool: 'tool', memory: 'memory', llm_failover: 'switch', llm_error: 'error', approval_requested: 'approval',
  approval_executed: 'confirmed', approval_rejected: 'rejected', paid_approval_needed: 'paid?', memory_error: 'error',
}

export function ActivityPanel() {
  const [items, setItems] = useState([])
  useEffect(() => {
    const load = () => api('/activity?limit=200').then(setItems).catch(() => {})
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="panel">
      <PanelHead title="Activity">Every step Simon took: tools used, provider switches, approvals and memories learned.</PanelHead>
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

export function ProvidersPanel() {
  const [items, setItems] = useState([])
  useEffect(() => {
    const load = () => api('/providers').then(setItems).catch(() => {})
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="panel">
      <PanelHead title="AI providers">
        Free first. Simon tries these in order and moves to the next one when a provider is busy or out of quota.
        A paid model is only used after you approve it.
      </PanelHead>
      <ol className="providers">
        {items.map((p, i) => {
          const state = p.cooling_down ? 'busy' : p.last_ok_at ? 'online' : 'standby'
          return (
            <li key={p.name} className="provider">
              <span className="provider-rank">{String(i + 1).padStart(2, '0')}</span>
              <div className="grow">
                <div className="provider-name">{p.name} <span className={`tag ${p.paid ? 'warn' : 'ok'}`}>{p.paid ? 'paid · asks first' : 'free'}</span></div>
                <div className="provider-model">{p.model}</div>
                {p.last_error && p.cooling_down && <div className="provider-err">{p.last_error}</div>}
              </div>
              <div className="provider-stats">
                <span className={`status ${state}`}><span className="dot" />{state}</span>
                <span className="mono-small">{p.ok_count} ok · {p.fail_count} failed</span>
              </div>
            </li>
          )
        })}
        {!items.length && <li className="empty">No AI provider is configured.</li>}
      </ol>
    </div>
  )
}
