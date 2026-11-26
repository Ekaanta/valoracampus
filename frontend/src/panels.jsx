// Full-size views: opened from the tab bar (phone, tablet) or from a wing panel's expand button (desktop).
import { useEffect, useState } from 'react'
import { api, setToken } from './api.js'
import { Brain, CATS, Feed, Panel, ProviderList, Sessions, Telemetry, activityText, relDate } from './hud.jsx'
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

/* ------------------------------------------------------------------ account (every user) */
const roleName = (role) => (role === 'admin' ? t('role_admin') : t('role_user'))

export function AccountPanel({ me, onBack, onAdmin }) {
  const [form, setForm] = useState({ current: '', next: '', again: '' })
  const [msg, setMsg] = useState(null)
  const save = async (e) => {
    e.preventDefault()
    if (form.next !== form.again) return setMsg({ bad: true, text: t('pwMismatch') })
    try {
      await api('/auth/password', { method: 'POST', body: { current: form.current, new: form.next } })
      setForm({ current: '', next: '', again: '' })
      setMsg({ text: t('pwChanged') })
    } catch (x) {
      setMsg({ bad: true, text: x.status === 400 ? (form.next.length < 6 ? t('pwShort') : t('pwWrong')) : x.message })
    }
  }
  const logout = () => { setToken(null); location.reload() }
  return (
    <div className="view">
      <ViewHead title={t('accTitle')} code={t('accCode')} onBack={onBack}>{t('accSub')}</ViewHead>
      <Panel title={t('profile')}>
        <dl className="kv">
          <div><dt>{t('displayName')}</dt><dd>{me?.display_name}</dd></div>
          <div><dt>{t('username')}</dt><dd>{me?.username}</dd></div>
          <div><dt>{t('roleLabel')}</dt><dd>{roleName(me?.role)}</dd></div>
        </dl>
      </Panel>
      <Panel title={t('changePw')}>
        <form className="form-grid" onSubmit={save}>
          <label className="field"><span>{t('currentPw')}</span>
            <input type="password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} /></label>
          <label className="field"><span>{t('newPw')}</span>
            <input type="password" autoComplete="new-password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} /></label>
          <label className="field"><span>{t('passwordAgain')}</span>
            <input type="password" autoComplete="new-password" value={form.again} onChange={(e) => setForm({ ...form, again: e.target.value })} /></label>
          <div className="form-actions">
            <button className="btn primary" disabled={!form.current || !form.next}>{t('save')}</button>
            {msg && <span className={msg.bad ? 'form-msg bad' : 'form-msg'}>{msg.text}</span>}
          </div>
        </form>
      </Panel>
      {me?.role === 'admin' && <button className="btn wide" onClick={onAdmin}><Icon name="gear" size={16} /> {t('openAdmin')}</button>}
      <button className="btn ghost wide" onClick={logout}><Icon name="logout" size={16} /> {t('logout')}</button>
    </div>
  )
}

/* ------------------------------------------------------------------ administration: AI models */
function TestResult({ r }) {
  if (!r) return null
  return <small className={r.busy ? 'test-res' : r.ok ? 'test-res ok' : 'test-res bad'}>
    {r.busy ? t('testing') : r.ok ? t('testOk', { s: r.seconds }) : t('testBad', { e: r.error })}
  </small>
}

function ModelsSection() {
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState(null) // the "add model" form (null: closed)
  const [msg, setMsg] = useState(null)
  const [tests, setTests] = useState({})
  useEffect(() => { api('/admin/models').then(setData).catch(() => {}) }, [])
  if (!data) return null
  const choose = (id) => {
    const p = data.presets.find((x) => x.id === id) || data.presets[0]
    setDraft({ preset: p.id, name: p.name, base_url: p.base_url, model: p.model, api_key: '', first: false, paid: false, key_url: p.key_url, hint: p.hint })
    setTests((s) => ({ ...s, draft: null }))
    setMsg(null)
  }
  const set = (patch) => setDraft({ ...draft, ...patch })
  const change = async (m, body) => {
    try { const r = await api(`/admin/models/${encodeURIComponent(m.key)}`, { method: 'PATCH', body }); setData({ ...data, models: r.models }) } catch (x) { alert(x.status === 400 ? t('keepOne') : x.message) }
  }
  const remove = async (m) => {
    if (!confirm(t('delModel', { name: m.name }))) return
    try { const r = await api(`/admin/models/${encodeURIComponent(m.key)}`, { method: 'DELETE' }); setData({ ...data, models: r.models }) } catch (x) { alert(x.message) }
  }
  const test = async (key, body) => {
    setTests((s) => ({ ...s, [key]: { busy: true } }))
    try { const r = await api('/admin/models/test', { method: 'POST', body }); setTests((s) => ({ ...s, [key]: r })) } catch (x) { setTests((s) => ({ ...s, [key]: { ok: false, error: x.message } })) }
  }
  const add = async (e) => {
    e.preventDefault()
    try {
      const { name, base_url, api_key, model, first, paid } = draft
      const r = await api('/admin/models', { method: 'POST', body: { name, base_url, api_key, model, first, paid } })
      setData({ ...data, models: r.models })
      setDraft(null)
      setMsg({ text: t('modelAdded') })
    } catch (x) {
      setMsg({ bad: true, text: x.status === 409 ? t('nameTaken') : x.message })
    }
  }
  return (
    <Panel title={t('modelsTitle')} meta={data.models.filter((m) => m.enabled).length}>
      <p className="panel-note">{t('modelsSub')}</p>
      <ul className="user-list model-list">
        {data.models.map((m) => (
          <li key={m.key} className={m.enabled ? '' : 'off'}>
            <span className="avatar"><Icon name={m.custom ? 'plug' : 'cpu'} size={16} /></span>
            <span className="user-main">
              <b>{m.name}</b>
              <small>{m.model}</small>
              <small>{[m.custom ? t('addedTag') : t('builtIn'), m.custom && m.first && !m.paid && t('firstTag'), m.paid && t('paidTag'),
                m.key_hint && `${t('f_key')} ${m.key_hint}`, !m.enabled && t('offTag')].filter(Boolean).join(' · ')}</small>
              <TestResult r={tests[m.key]} />
            </span>
            <span className="user-actions">
              <button className="btn small" onClick={() => test(m.key, { key: m.key })}>{t('testModel')}</button>
              {m.custom && !m.paid && <button className="btn small" onClick={() => change(m, { first: !m.first })}>{m.first ? t('useLater') : t('useFirst')}</button>}
              <button className="btn small" onClick={() => change(m, { enabled: !m.enabled })}>{m.enabled ? t('turnOff') : t('turnOn')}</button>
              {m.custom && <button className="icon-btn danger" onClick={() => remove(m)} aria-label={t('delete')} title={t('delete')}><Icon name="trash" size={16} /></button>}
            </span>
          </li>
        ))}
      </ul>
      {draft ? (
        <form className="form-grid new-user" onSubmit={add}>
          <label className="field"><span>{t('f_preset')}</span>
            <select value={draft.preset} onChange={(e) => choose(e.target.value)}>
              {data.presets.map((p) => <option key={p.id} value={p.id}>{p.name || t('customService')}</option>)}
            </select></label>
          <label className="field"><span>{t('f_mname')}</span><input value={draft.name} onChange={(e) => set({ name: e.target.value })} /></label>
          <label className="field wide"><span>{t('f_url')}</span>
            <input value={draft.base_url} placeholder="https://…/v1" autoCapitalize="none" onChange={(e) => set({ base_url: e.target.value })} /></label>
          <label className="field"><span>{t('f_model')}</span>
            <input value={draft.model} placeholder={draft.hint || ''} autoCapitalize="none" onChange={(e) => set({ model: e.target.value })} /></label>
          <label className="field"><span>{t('f_key')}</span>
            <input type="password" value={draft.api_key} autoComplete="off" onChange={(e) => set({ api_key: e.target.value })} />
            {draft.key_url && <a className="field-link" href={draft.key_url} target="_blank" rel="noreferrer">{t('getKey')}</a>}</label>
          <label className="check wide"><input type="checkbox" checked={draft.first} onChange={(e) => set({ first: e.target.checked })} /><span>{t('f_first')}</span></label>
          <label className="check wide"><input type="checkbox" checked={draft.paid} onChange={(e) => set({ paid: e.target.checked })} /><span>{t('f_paid')}</span></label>
          <div className="form-actions">
            <button type="button" className="btn" disabled={!draft.base_url || !draft.model}
                    onClick={() => test('draft', { base_url: draft.base_url, api_key: draft.api_key, model: draft.model })}>{t('testModel')}</button>
            <button className="btn primary" disabled={!draft.name || !draft.base_url || !draft.model}><Icon name="plus" size={16} /> {t('addModel')}</button>
            <button type="button" className="btn ghost" onClick={() => setDraft(null)}>{t('cancel')}</button>
            <TestResult r={tests.draft} />
            {msg && <span className={msg.bad ? 'form-msg bad' : 'form-msg'}>{msg.text}</span>}
          </div>
        </form>
      ) : (
        <div className="form-actions new-user">
          <button className="btn primary" onClick={() => choose(data.presets[0].id)}><Icon name="plus" size={16} /> {t('addModel')}</button>
          {msg && <span className={msg.bad ? 'form-msg bad' : 'form-msg'}>{msg.text}</span>}
        </div>
      )}
    </Panel>
  )
}

/* ------------------------------------------------------------------ administration: voices */
function VoicesSection({ onChanged }) {
  const [added, setAdded] = useState([])
  const [draft, setDraft] = useState({ lang: 'de', name: '', fish: '' })
  const [msg, setMsg] = useState(null)
  useEffect(() => { api('/admin/voices').then((r) => setAdded(r.added)).catch(() => {}) }, [])
  const add = async (e) => {
    e.preventDefault()
    try {
      const r = await api('/admin/voices', { method: 'POST', body: draft })
      setAdded(r.added)
      setDraft({ ...draft, name: '', fish: '' })
      setMsg({ text: t('voiceAdded') })
      onChanged?.()
    } catch (x) { setMsg({ bad: true, text: x.message }) }
  }
  const remove = async (v) => {
    if (!confirm(t('delVoice', { name: v.name }))) return
    try { const r = await api(`/admin/voices/${v.key}`, { method: 'DELETE' }); setAdded(r.added); onChanged?.() } catch (x) { alert(x.message) }
  }
  return (
    <Panel title={t('voicesTitle')} meta={added.length}>
      <p className="panel-note">{t('voicesSub')}</p>
      {added.length ? (
        <ul className="user-list">
          {added.map((v) => (
            <li key={v.key}>
              <span className="avatar"><Icon name="speaker" size={16} /></span>
              <span className="user-main"><b>{v.name}</b><small>{v.lang.toUpperCase()} · {v.fish}</small></span>
              <span className="user-actions">
                <button className="icon-btn danger" onClick={() => remove(v)} aria-label={t('delete')} title={t('delete')}><Icon name="trash" size={16} /></button>
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="hud-empty">{t('noAddedVoices')}</p>}
      <form className="form-grid new-user" onSubmit={add}>
        <label className="field"><span>{t('f_vname')}</span><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
        <label className="field"><span>{t('f_vlang')}</span>
          <select value={draft.lang} onChange={(e) => setDraft({ ...draft, lang: e.target.value })}><option value="de">Deutsch</option><option value="en">English</option></select></label>
        <label className="field wide"><span>{t('f_vurl')}</span>
          <input value={draft.fish} placeholder="https://fish.audio/m/…" autoCapitalize="none" onChange={(e) => setDraft({ ...draft, fish: e.target.value })} /></label>
        <div className="form-actions">
          <button className="btn primary" disabled={!draft.name || draft.fish.length < 32}><Icon name="plus" size={16} /> {t('addVoice')}</button>
          {msg && <span className={msg.bad ? 'form-msg bad' : 'form-msg'}>{msg.text}</span>}
        </div>
      </form>
    </Panel>
  )
}

/* ------------------------------------------------------------------ administration (admins only) */
const SPEED_KEYS = { 0.82: 'speedCalm', 0.9: 'speedNormal', 1: 'speedBrisk' }

export function AdminPanel({ me, onBack, onSettingsChanged }) {
  const [users, setUsers] = useState([])
  const [cfg, setCfg] = useState(null)
  const [voices, setVoices] = useState(null)
  const [draft, setDraft] = useState({ display_name: '', username: '', password: '', role: 'user' })
  const [userMsg, setUserMsg] = useState(null)
  const [cfgMsg, setCfgMsg] = useState(null)

  const loadUsers = () => api('/admin/users').then(setUsers).catch(() => {})
  const loadSettings = () => api('/admin/settings').then((r) => { setCfg(r.settings); setVoices(r.voices) }).catch(() => {})
  useEffect(() => {
    loadUsers()
    loadSettings()
  }, [])

  const create = async (e) => {
    e.preventDefault()
    try {
      await api('/admin/users', { method: 'POST', body: draft })
      setDraft({ display_name: '', username: '', password: '', role: 'user' })
      setUserMsg({ text: t('userCreated') })
      loadUsers()
    } catch (x) {
      setUserMsg({ bad: true, text: x.status === 409 ? t('userTaken') : t('userRules') })
    }
  }
  const patch = async (u, body) => {
    try { await api(`/admin/users/${u.id}`, { method: 'PATCH', body }); loadUsers() } catch (x) { alert(x.status === 400 ? t('lastAdmin') : x.message) }
  }
  const resetPw = (u) => {
    const pw = prompt(t('newPwPrompt', { name: u.display_name }))
    if (pw) patch(u, { password: pw })
  }
  const remove = async (u) => {
    if (!confirm(t('delUser', { name: u.display_name }))) return
    try { await api(`/admin/users/${u.id}`, { method: 'DELETE' }); loadUsers() } catch (x) { alert(x.status === 400 ? t('lastAdmin') : x.message) }
  }
  const saveCfg = async (e) => {
    e.preventDefault()
    try {
      const r = await api('/admin/settings', { method: 'PUT', body: cfg })
      setCfg(r.settings)
      setCfgMsg({ text: t('saved') })
      onSettingsChanged?.()
    } catch (x) {
      setCfgMsg({ bad: true, text: x.message })
    }
  }
  const field = (key) => ({ value: cfg?.[key] ?? '', onChange: (e) => setCfg({ ...cfg, [key]: e.target.value }) })

  return (
    <div className="view">
      <ViewHead title={t('adminTitle')} code={t('adminCode')} onBack={onBack}>{t('adminSub')}</ViewHead>

      <Panel title={t('users')} meta={users.length}>
        <ul className="user-list">
          {users.map((u) => (
            <li key={u.id} className={u.active ? '' : 'off'}>
              <span className="avatar">{(u.display_name || u.username).slice(0, 1).toUpperCase()}</span>
              <span className="user-main">
                <b>{u.display_name}{u.id === me?.id && ` ${t('thisIsYou')}`}</b>
                <small>@{u.username} · {roleName(u.role)}{u.active ? '' : ` · ${t('disabled')}`} · {t('lastLogin')}: {u.last_login_at ? relDate(u.last_login_at) : t('never')}</small>
                <small>{plural('mem', u.memories)} · {u.conversations} {t('sessions')}</small>
              </span>
              {u.id !== me?.id && (
                <span className="user-actions">
                  <button className="btn small" onClick={() => patch(u, { role: u.role === 'admin' ? 'user' : 'admin' })}>{u.role === 'admin' ? t('makeUser') : t('makeAdmin')}</button>
                  <button className="btn small" onClick={() => resetPw(u)}>{t('resetPw')}</button>
                  <button className="btn small" onClick={() => patch(u, { active: !u.active })}>{u.active ? t('deactivate') : t('activate')}</button>
                  <button className="icon-btn danger" onClick={() => remove(u)} aria-label={t('delete')} title={t('delete')}><Icon name="trash" size={16} /></button>
                </span>
              )}
            </li>
          ))}
        </ul>
        <form className="form-grid new-user" onSubmit={create}>
          <label className="field"><span>{t('personName')}</span>
            <input value={draft.display_name} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} /></label>
          <label className="field"><span>{t('username')}</span>
            <input value={draft.username} autoCapitalize="none" onChange={(e) => setDraft({ ...draft, username: e.target.value })} /></label>
          <label className="field"><span>{t('password')}</span>
            <input type="text" value={draft.password} autoComplete="new-password" onChange={(e) => setDraft({ ...draft, password: e.target.value })} /></label>
          <label className="field"><span>{t('roleLabel')}</span>
            <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>
              <option value="user">{t('role_user')}</option><option value="admin">{t('role_admin')}</option>
            </select></label>
          <div className="form-actions">
            <button className="btn primary" disabled={!draft.username || !draft.password}><Icon name="plus" size={16} /> {t('newUser')}</button>
            {userMsg && <span className={userMsg.bad ? 'form-msg bad' : 'form-msg'}>{userMsg.text}</span>}
          </div>
        </form>
      </Panel>

      {cfg && voices && (
        <Panel title={t('simonSettings')}>
          <form className="form-grid" onSubmit={saveCfg}>
            <label className="field"><span>{t('f_name')}</span><input {...field('assistant_name')} /></label>
            <label className="field"><span>{t('f_city')}</span><input {...field('city')} /></label>
            <label className="field"><span>{t('f_tz')}</span><input {...field('timezone')} placeholder="Europe/Berlin" /></label>
            <label className="field"><span>{t('f_lang')}</span>
              <select {...field('language')}><option value="de">Deutsch</option><option value="en">English</option></select></label>
            <label className="field"><span>{t('f_voice_de')}</span>
              <select {...field('voice_de')}>{voices.de.map((v) => <option key={v.key} value={v.key}>{v.name}</option>)}</select></label>
            <label className="field"><span>{t('f_voice_en')}</span>
              <select {...field('voice_en')}>{voices.en.map((v) => <option key={v.key} value={v.key}>{v.name}</option>)}</select></label>
            <label className="field"><span>{t('speedLabel')}</span>
              <select value={cfg.speed} onChange={(e) => setCfg({ ...cfg, speed: Number(e.target.value) })}>
                {voices.speeds.map((s) => <option key={s} value={s}>{t(SPEED_KEYS[s] || 'speedNormal')}</option>)}
              </select></label>
            <label className="check wide">
              <input type="checkbox" checked={!!cfg.allow_signup} onChange={(e) => setCfg({ ...cfg, allow_signup: e.target.checked })} />
              <span>{t('f_signup')}</span>
            </label>
            <label className="field wide"><span>{t('f_persona')}</span>
              <textarea rows={5} {...field('persona')} placeholder={t('personaHint')} /></label>
            <div className="form-actions">
              <button className="btn primary">{t('saveSettings')}</button>
              {cfgMsg && <span className={cfgMsg.bad ? 'form-msg bad' : 'form-msg'}>{cfgMsg.text}</span>}
            </div>
          </form>
        </Panel>
      )}

      <ModelsSection />
      <VoicesSection onChanged={() => { onSettingsChanged?.(); api('/admin/settings').then((r) => setVoices(r.voices)).catch(() => {}) }} />
    </div>
  )
}
