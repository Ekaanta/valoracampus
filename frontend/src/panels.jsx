import { useEffect, useState } from 'react'
import { api } from './api.js'

const CATS = ['profile', 'preference', 'project', 'decision', 'task', 'other']

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
      <p className="sub">Everything SIMON remembers about you. Edit or delete anything at any time.</p>
      <input className="search" placeholder="Search memory…" value={q} onChange={(e) => setQ(e.target.value)} />
      <form className="row add" onSubmit={add}>
        <input placeholder="Add something SIMON should know…" value={draft.content}
               onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
        <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
          {CATS.map((c) => <option key={c}>{c}</option>)}
        </select>
        <button>Add</button>
      </form>
      <ul className="list">
        {items.map((m) => (
          <li key={m.id}>
            {editing?.id === m.id ? (
              <div className="row">
                <input value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} />
                <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                  {CATS.map((c) => <option key={c}>{c}</option>)}
                </select>
                <button onClick={save}>Save</button>
                <button className="ghost" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            ) : (
              <>
                <span className="tag">{m.category}</span>
                <span className="grow">{m.content}</span>
                <small>{m.source}</small>
                <button className="ghost" onClick={() => setEditing(m)}>Edit</button>
                <button className="ghost danger" onClick={() => remove(m.id)}>Delete</button>
              </>
            )}
          </li>
        ))}
        {!items.length && <li className="empty">Nothing stored yet.</li>}
      </ul>
    </div>
  )
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
      <p className="sub">Everything SIMON did: tools used, provider switches, approvals, memories learned.</p>
      <ul className="list log">
        {items.map((a) => (
          <li key={a.id}>
            <small>{new Date(a.at).toLocaleString()}</small>
            <span className={`tag k-${a.kind}`}>{a.kind}</span>
            <span className="grow">{a.summary}</span>
          </li>
        ))}
        {!items.length && <li className="empty">No activity yet.</li>}
      </ul>
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
      <p className="sub">
        Free first: FreeLLMAPI (rotates across the free cloud providers) → local Ollama → a paid model only after
        your approval. Provider keys, quotas and the model catalog are managed in the FreeLLMAPI dashboard.
      </p>
      <div className="providers">
        {items.map((p, i) => (
          <div key={p.name} className="card provider">
            <div className="row"><b>{i + 1}. {p.name}</b>{p.paid ? <span className="tag paid">paid · approval</span> : <span className="tag free">free</span>}</div>
            <small>model: {p.model}</small>
            <div className="row stats">
              <span className={p.cooling_down ? 'dot warn' : p.last_ok_at ? 'dot ok' : 'dot'} />
              <span>{p.cooling_down ? 'cooling down' : p.last_ok_at ? 'working' : 'not used yet'}</span>
              <span>✓ {p.ok_count}</span><span>✗ {p.fail_count}</span>
            </div>
            {p.last_error && <small className="error">{p.last_error}</small>}
          </div>
        ))}
      </div>
    </div>
  )
}
