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
  useEffect(() => {
    loadUsers()
    api('/admin/settings').then((r) => { setCfg(r.settings); setVoices(r.voices) }).catch(() => {})
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
            <label className="field wide"><span>{t('f_persona')}</span>
              <textarea rows={5} {...field('persona')} placeholder={t('personaHint')} /></label>
            <div className="form-actions">
              <button className="btn primary">{t('saveSettings')}</button>
              {cfgMsg && <span className={cfgMsg.bad ? 'form-msg bad' : 'form-msg'}>{cfgMsg.text}</span>}
            </div>
          </form>
        </Panel>
      )}
    </div>
  )
}
