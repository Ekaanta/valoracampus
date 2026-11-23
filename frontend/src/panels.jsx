// Full-size views: opened from the tab bar (phone, tablet) or from a wing panel's expand button (desktop).
import { useEffect, useState } from 'react'
import { api } from './api.js'
import { Brain, CATS, Feed, Panel, ProviderList, Sessions, Telemetry, activityText } from './hud.jsx'
import { locale, plural, t } from './i18n.js'
import Icon from './icons.jsx'

function ViewHead({ title, code, children, onBack }) {
  return (
    <header className="view-head">
      {onBack && (
        <button className="back" onClick={onBack}><Icon name="back" size={16} /> {t('back')}</button>
      )}
      <p className="eyebrow">{code}</p>
      <h2 className="view-title">{title}</h2>
      {children && <p className="view-sub">{children}</p>}
    </header>
  )
}

const CatOptions = () => CATS.map((c) => <option key={c} value={c}>{t(`cat_${c}`)}</option>)

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
    if (!confirm(t('delMem'))) return
    await api(`/memories/${id}`, { method: 'DELETE' })
    changed()
  }

  return (
    <div className="view">
      <ViewHead title={t('memTitle')} code={t('memCode')} onBack={onBack}>{t('memSub')}</ViewHead>
      <Panel title={t('graph')} meta={plural('mem', all.length)} className="brain-panel">
        <Brain memories={all} onPick={(m) => setEditing(m)} />
      </Panel>
      <div className="field-search">
        <Icon name="search" size={18} />
        <input placeholder={t('searchMem')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('searchMem')} />
      </div>
      <form className="add-row" onSubmit={add}>
        <input placeholder={t('newMem')} value={draft.content}
               onChange={(e) => setDraft({ ...draft, content: e.target.value })} aria-label={t('newMemAria')} />
        <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} aria-label={t('category')}>
          <CatOptions />
        </select>
        <button className="btn primary" disabled={!draft.content.trim()}>{t('store')}</button>
      </form>
      <ul className="rows">
        {items.map((m) => (
          <li key={m.id} className="row">
            {editing?.id === m.id ? (
              <div className="edit-row">
                <input value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} aria-label={t('memText')} autoFocus />
                <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} aria-label={t('category')}>
                  <CatOptions />
                </select>
                <button className="btn primary small" onClick={save}>{t('save')}</button>
                <button className="btn ghost small" onClick={() => setEditing(null)}>{t('cancel')}</button>
              </div>
            ) : (
              <>
                <span className={`tag cat-${m.category}`}>{t(`cat_${m.category}`)}</span>
                <span className="row-text">{m.content}</span>
                <span className="row-meta">{m.source === 'auto' ? t('srcAuto') : t('srcUser')}</span>
                <span className="row-actions">
                  <button className="icon-btn" onClick={() => setEditing(m)} aria-label={t('edit')}><Icon name="edit" size={18} /></button>
                  <button className="icon-btn danger" onClick={() => remove(m.id)} aria-label={t('delete')}><Icon name="trash" size={18} /></button>
                </span>
              </>
            )}
          </li>
        ))}
        {!items.length && <li className="empty">{q ? t('noMatch') : t('noMem')}</li>}
      </ul>
    </div>
  )
}

export function ActivityPanel({ onBack }) {
  const [items, setItems] = useState([])
  useEffect(() => {
    const load = () => api('/activity?limit=200').then(setItems).catch(() => {})
    load()
    const timer = setInterval(load, 10000)
    return () => clearInterval(timer)
  }, [])
  return (
    <div className="view">
      <ViewHead title={t('actTitle')} code={t('actCode')} onBack={onBack}>{t('actSub')}</ViewHead>
      <ol className="timeline">
        {items.map((a) => (
          <li key={a.id} className={`k-${a.kind}`}>
            <time>{new Date(a.at).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
            <span className="kind">{t(`k_${a.kind}`) === `k_${a.kind}` ? a.kind : t(`k_${a.kind}`)}</span>
            <span className="row-text">{activityText(a)}</span>
          </li>
        ))}
        {!items.length && <li className="empty">{t('noActivity')}</li>}
      </ol>
    </div>
  )
}

export function SystemsPanel({ onBack, providers, stats }) {
  return (
    <div className="view">
      <ViewHead title={t('sysTitle')} code={t('sysCode')} onBack={onBack}>{t('sysSub')}</ViewHead>
      <Panel title={t('telemetry')}><Telemetry stats={stats} /></Panel>
      <Panel title={t('neuralCore')} meta={plural('model', providers.length)}>
        <ProviderList providers={providers} stats={stats} detailed />
      </Panel>
      <Panel title={t('liveFeed')}><ActivityMini /></Panel>
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
    if (!confirm(t('delSession', { title: c.title }))) return
    await api(`/conversations/${c.id}`, { method: 'DELETE' })
    onChanged?.(c.id)
  }
  return (
    <div className="view">
      <ViewHead title={t('histTitle')} code={t('histCode')} onBack={onBack}>{t('histSub')}</ViewHead>
      <button className="btn primary wide" onClick={onNew}><Icon name="plus" size={18} /> {t('newSession')}</button>
      <Sessions convs={convs} convId={convId} onOpen={onOpen} onDelete={remove} />
    </div>
  )
}
