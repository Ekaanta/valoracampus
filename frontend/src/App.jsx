import { useCallback, useEffect, useRef, useState } from 'react'
import { api, getToken, login, setToken, streamChat } from './api.js'
import { listen, speak, stopSpeaking, unlockAudio } from './voice.js'
import { ActivityPanel, MemoryPanel, ProvidersPanel } from './panels.jsx'
import { useTheme } from './theme.js'
import Chart from './Chart.jsx'
import Dial from './Dial.jsx'
import Icon from './icons.jsx'

export default function App() {
  const [authed, setAuthed] = useState(!!getToken())
  const [needLogin, setNeedLogin] = useState(null) // asked from the server: login page on or off
  useEffect(() => {
    fetch('/api/config').then((r) => r.json()).then((c) => setNeedLogin(!!c.require_login)).catch(() => setNeedLogin(true))
  }, [])
  useEffect(() => {
    const off = () => setAuthed(false)
    window.addEventListener('simon-logout', off)
    // Mobile browsers only allow audio after a user gesture: unlock on the first one.
    const unlock = () => unlockAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => window.removeEventListener('simon-logout', off)
  }, [])
  if (needLogin === null) return null
  if (!needLogin) return <Shell canLogout={false} />
  return authed ? <Shell canLogout /> : <Login onDone={() => setAuthed(true)} />
}

function ThemeToggle() {
  const [theme, toggle] = useTheme()
  return (
    <button className="icon-btn" onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  )
}

/* ------------------------------------------------------------------ login */
function Login({ onDone }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try { await login(pw); onDone() } catch (x) { setErr(x.message) }
    setBusy(false)
  }
  return (
    <div className="login">
      <div className="login-theme"><ThemeToggle /></div>
      <div className="login-card">
        <Dial state={busy ? 'thinking' : 'idle'} size={132} />
        <h1 className="wordmark big">Simon</h1>
        <p className="eyebrow">Personal assistant</p>
        <form onSubmit={submit} className="login-form">
          <input type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)}
                 autoFocus autoComplete="current-password" aria-label="Password" />
          <button className="btn primary icon-only" disabled={!pw || busy} aria-label="Sign in"><Icon name="arrowUp" className="rot90" /></button>
        </form>
        <p className="login-err" role="alert">{err}</p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ shell */
const VIEWS = [
  ['chat', 'Conversation', 'chat'],
  ['memory', 'Memory', 'memory'],
  ['activity', 'Activity', 'activity'],
  ['providers', 'AI providers', 'cpu'],
]

function relDate(iso) {
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d) / 86400000)
  if (days < 1) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

function Shell({ canLogout }) {
  const [view, setView] = useState('chat')
  const [me, setMe] = useState({ assistant_name: 'SIMON', speech_lang: 'en-US' })
  const [convs, setConvs] = useState([])
  const [convId, setConvId] = useState(null)
  const [menu, setMenu] = useState(false)
  const [alerts, setAlerts] = useState([])
  const [setup, setSetup] = useState([]) // server setup problems (missing database / AI key)
  const seen = useRef(new Set())

  const refreshConvs = useCallback(() => api('/conversations').then(setConvs).catch(() => {}), [])

  useEffect(() => {
    api('/me').then(setMe).catch(() => {})
    refreshConvs()
    fetch('/api/health').then((r) => r.json()).then((h) => setSetup(h.problems || [])).catch(() => {})
  }, [refreshConvs])

  // Reminders: every open device polls; due reminders pop up and are spoken.
  useEffect(() => {
    const poll = async () => {
      try {
        const due = await api('/notifications')
        const fresh = due.filter((r) => !seen.current.has(r.id))
        fresh.forEach((r) => seen.current.add(r.id))
        if (!fresh.length) return
        setAlerts((a) => [...a, ...fresh])
        fresh.forEach((r) => {
          if ('Notification' in window && Notification.permission === 'granted') new Notification('Simon', { body: r.text })
        })
        speak(`Reminder: ${fresh.map((r) => r.text).join('. ')}`, me.speech_lang)
      } catch { /* offline */ }
    }
    poll()
    const t = setInterval(poll, 20000)
    return () => clearInterval(t)
  }, [me.speech_lang])

  const dismiss = (id) => {
    setAlerts((a) => a.filter((r) => r.id !== id))
    api(`/reminders/${id}/done`, { method: 'POST' }).catch(() => {})
  }

  const open = (id) => { setConvId(id); setView('chat'); setMenu(false) }
  const go = (k) => { setView(k); setMenu(false) }

  return (
    <div className="shell">
      <aside className={menu ? 'rail open' : 'rail'} aria-label="Navigation">
        <div className="rail-head">
          <span className="wordmark">Simon</span>
          <button className="icon-btn only-mobile" onClick={() => setMenu(false)} aria-label="Close menu"><Icon name="x" /></button>
        </div>
        <button className="btn-new" onClick={() => open(null)}><Icon name="plus" size={18} /> New conversation</button>
        <nav className="nav">
          {VIEWS.map(([k, label, icon]) => (
            <button key={k} className={view === k ? 'active' : ''} onClick={() => go(k)} aria-current={view === k ? 'page' : undefined}>
              <Icon name={icon} size={18} /> {label}
            </button>
          ))}
        </nav>
        <div className="eyebrow rail-label">Recent</div>
        <div className="convs">
          {convs.map((c) => (
            <button key={c.id} className={c.id === convId && view === 'chat' ? 'conv active' : 'conv'} onClick={() => open(c.id)}>
              <span className="conv-title">{c.title}</span>
              <span className="conv-date">{relDate(c.updated_at)}</span>
            </button>
          ))}
          {!convs.length && <p className="rail-empty">Your conversations will appear here.</p>}
        </div>
        <div className="rail-foot">
          <ThemeToggle />
          {canLogout && (
            <button className="icon-btn" onClick={() => { setToken(null); location.reload() }} aria-label="Log out" title="Log out"><Icon name="logout" /></button>
          )}
        </div>
      </aside>
      {menu && <div className="scrim" onClick={() => setMenu(false)} />}

      <main className="main">
        <header className="topbar">
          <button className="icon-btn only-mobile" onClick={() => setMenu(true)} aria-label="Open menu"><Icon name="menu" /></button>
          <span className="topbar-title">{VIEWS.find(([k]) => k === view)[1]}</span>
          <span className="grow" />
          <span className="only-mobile"><ThemeToggle /></span>
        </header>
        <div className="alerts" aria-live="polite">
          {setup.length > 0 && (
            <div className="alert setup" role="alert">
              <span className="grow">
                <b>Setup not finished.</b>
                {setup.map((p) => <span key={p} className="setup-line">{p}</span>)}
              </span>
            </div>
          )}
          {alerts.map((r) => (
            <div key={r.id} className="alert">
              <Icon name="bell" size={18} />
              <span className="grow">{r.text}</span>
              <button className="btn small" onClick={() => dismiss(r.id)}>Done</button>
            </div>
          ))}
        </div>
        {view === 'chat' && <ChatView me={me} convId={convId} setConvId={setConvId} onChanged={refreshConvs} />}
        {view === 'memory' && <MemoryPanel />}
        {view === 'activity' && <ActivityPanel />}
        {view === 'providers' && <ProvidersPanel />}
      </main>
    </div>
  )
}

/* ------------------------------------------------------------------ chat */
const TOOL_LABELS = {
  get_weather: 'Checking the weather', get_crypto: 'Reading crypto markets', get_stock: 'Reading stock markets',
  web_search: 'Searching the web', read_webpage: 'Reading a page', show_route: 'Planning the route',
  create_reminder: 'Setting a reminder', list_reminders: 'Checking reminders', cancel_reminder: 'Cancelling a reminder',
  remember: 'Saving to memory', search_memory: 'Searching memory', prepare_crypto_trade: 'Preparing the order',
  confirm_action: 'Confirming', cancel_action: 'Cancelling',
}

const SUGGESTIONS = [
  'What will the weather be like tomorrow?',
  'How is Bitcoin doing this week?',
  'Remind me to call the bank in one hour',
  'What do you remember about me?',
]

function greeting() {
  const h = new Date().getHours()
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

const timeOf = (m) => new Date(m.created_at || m.at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function ChatView({ me, convId, setConvId, onChanged }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [orb, setOrb] = useState('idle')
  const [interim, setInterim] = useState('')
  const [handsFree, setHandsFree] = useState(false)
  const skipLoad = useRef(false)
  const listener = useRef(null)
  const bottom = useRef(null)
  const textarea = useRef(null)
  const handsFreeRef = useRef(handsFree)
  handsFreeRef.current = handsFree
  const convRef = useRef(convId) // the hands-free loop calls send() from older renders
  convRef.current = convId

  useEffect(() => {
    if (skipLoad.current) { skipLoad.current = false; return }
    if (!convId) { setMessages([]); return }
    api(`/conversations/${convId}`).then((rows) => setMessages(rows.map((m) => ({ ...m, tools: [] })))).catch(() => {})
  }, [convId])

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, interim])

  useEffect(() => { // auto-grow the composer
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`
  }, [input])

  const patchLast = (fn) => setMessages((ms) => {
    const copy = [...ms]
    copy[copy.length - 1] = fn({ ...copy[copy.length - 1] })
    return copy
  })

  const send = async (text, { allowPaid = false } = {}) => {
    if (busy) return
    unlockAudio()
    setBusy(true)
    setOrb('thinking')
    stopSpeaking()
    const now = new Date().toISOString()
    setMessages((ms) => [...ms, ...(text ? [{ role: 'user', content: text, created_at: now }] : []),
      { role: 'assistant', content: '', cards: [], tools: [], created_at: now }])
    let reply = ''
    let finished = false
    const finish = async () => {
      if (finished) return
      finished = true
      setBusy(false)
      onChanged()
      if (handsFreeRef.current && reply.trim()) {
        setOrb('speaking')
        await speak(reply, me.speech_lang)
        if (handsFreeRef.current) return startListening()
      }
      setOrb('idle')
    }
    try {
      await streamChat({ message: text, conversation_id: convRef.current, allow_paid: allowPaid }, (ev) => {
        if (ev.type === 'conversation' && ev.id !== convRef.current) {
          skipLoad.current = true
          convRef.current = ev.id
          setConvId(ev.id)
        } else if (ev.type === 'status') patchLast((m) => ({ ...m, status: ev.text }))
        else if (ev.type === 'provider') patchLast((m) => ({ ...m, provider: ev.name, model: ev.model }))
        else if (ev.type === 'token') { reply += ev.text; patchLast((m) => ({ ...m, status: null, content: m.content + ev.text })) }
        else if (ev.type === 'tool') patchLast((m) => ({ ...m, tools: [...m.tools.filter((t) => t.name !== ev.name), ev] }))
        else if (['chart', 'link', 'approval'].includes(ev.type)) patchLast((m) => ({ ...m, cards: [...(m.cards || []), ev] }))
        else if (ev.type === 'paid_required') patchLast((m) => ({ ...m, paid: ev }))
        else if (ev.type === 'error') patchLast((m) => ({ ...m, error: ev.message }))
        else if (ev.type === 'done') finish() // the server keeps learning memories after this
      })
    } catch (x) {
      patchLast((m) => ({ ...m, error: x.message }))
    }
    finish()
  }

  const startListening = async () => {
    stopSpeaking()
    unlockAudio()
    setOrb('listening')
    setInterim('')
    try {
      listener.current = listen(me.speech_lang, { onInterim: setInterim })
      const text = await listener.current.promise
      setInterim('')
      listener.current = null
      if (text) return send(text)
    } catch (x) {
      listener.current = null
      setInterim('')
      setMessages((ms) => [...ms, { role: 'assistant', content: '', error: `Microphone: ${x.message}`, tools: [], cards: [] }])
    }
    setOrb('idle')
  }

  const micClick = () => {
    if (orb === 'speaking') { stopSpeaking(); setOrb('idle'); return }
    if (listener.current) { listener.current.stop(); return }
    if (!busy) startListening()
  }

  const decide = async (msgIndex, actionId, verdict) => {
    try {
      const res = await api(`/actions/${actionId}/${verdict}`, { method: 'POST' })
      setMessages((ms) => ms.map((m, i) => i !== msgIndex ? m : {
        ...m, cards: m.cards.map((c) => c.type === 'approval' && c.action.id === actionId
          ? { ...c, action: { ...c.action, status: res.status, result: res.result } } : c),
      }))
    } catch (x) { alert(x.message) }
  }

  const submit = (e) => {
    e?.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    send(text)
  }

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() }
  }

  const empty = messages.length === 0
  const stateLabel = { idle: 'Tap to talk', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking — tap to stop' }[orb]

  return (
    <div className="chat">
      <div className="scroll">
        {empty ? (
          <section className="welcome">
            <button className="welcome-dial" onClick={micClick} aria-label={stateLabel}>
              <Dial state={orb} size={176} />
            </button>
            <p className="eyebrow">{stateLabel}</p>
            <h2 className="welcome-title">{greeting()}.</h2>
            <p className="welcome-sub">Ask, tell or plan anything. Simon remembers what matters and asks before doing anything that costs money.</p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}
            </div>
          </section>
        ) : (
          <div className="thread">
            {messages.map((m, i) => m.role === 'user' ? (
              <div key={m.id || i} className="msg-user"><p>{m.content}</p></div>
            ) : (
              <article key={m.id || i} className="msg-ai">
                <header className="meta">
                  <span className="meta-name">Simon</span><span>{timeOf(m)}</span>
                  {m.provider && <span>via {m.provider}</span>}
                </header>
                {m.tools?.length > 0 && (
                  <ul className="toollog">
                    {m.tools.map((t) => (
                      <li key={t.name} className={t.status}>
                        <span className="tick" />{TOOL_LABELS[t.name] || t.name}
                        <span className="toolstate">{t.status === 'running' ? '…' : t.status === 'error' ? 'failed' : 'done'}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {/* charts and routes come before the answer (it refers to them), approvals after it */}
                {m.cards?.map((c, k) => c.type !== 'approval' && <Card key={k} card={c} />)}
                {m.content && <div className="prose">{renderText(m.content)}</div>}
                {m.cards?.map((c, k) => c.type === 'approval' && <Card key={k} card={c} onDecide={(id, v) => decide(i, id, v)} />)}
                {m.paid && (
                  <div className="ticket warn">
                    <div className="ticket-head"><span>Paid model needed</span><span>approval</span></div>
                    <p className="ticket-body">All free AI providers are busy. Use <b>{m.paid.provider}</b> ({m.paid.model}) for this answer?</p>
                    <p className="ticket-note">Estimated cost: {m.paid.cost_note}</p>
                    <div className="perf" />
                    <div className="ticket-actions">
                      <button className="btn primary" onClick={() => send(null, { allowPaid: true })}>Use paid model once</button>
                      <button className="btn ghost" onClick={() => patchLast((x) => ({ ...x, paid: null }))}>Not now</button>
                    </div>
                  </div>
                )}
                {m.error && <p className="msg-error">{m.error}</p>}
                {!m.content && !m.error && !m.paid && busy && i === messages.length - 1 && (
                  <p className="thinking">{m.status || 'Thinking'}<span className="dots"><i /><i /><i /></span></p>
                )}
              </article>
            ))}
            {interim && <div className="msg-user interim"><p>{interim}</p></div>}
            <div ref={bottom} className="thread-end" />
          </div>
        )}
      </div>

      <form className="composer" onSubmit={submit}>
        <div className={`composer-box ${orb}`}>
          <button type="button" className="mic" onClick={micClick} aria-label={stateLabel} title={stateLabel}>
            <Dial state={orb} size={46}><Icon name={orb === 'listening' ? 'stop' : orb === 'speaking' ? 'speaker' : 'mic'} size={18} /></Dial>
          </button>
          <textarea ref={textarea} rows={1} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey}
                    placeholder={orb === 'listening' ? 'Listening…' : 'Ask Simon anything…'} aria-label="Message" />
          <button className="send" disabled={busy || !input.trim()} aria-label="Send"><Icon name="arrowUp" size={18} /></button>
        </div>
        <div className="composer-meta">
          <label className="switch">
            <input type="checkbox" checked={handsFree} onChange={(e) => setHandsFree(e.target.checked)} />
            <span className="track"><span className="thumb" /></span>
            Hands-free
          </label>
          <span className="hint">Enter to send · Shift + Enter for a new line</span>
        </div>
      </form>
    </div>
  )
}

const STAMPS = { done: 'Executed', failed: 'Not executed', rejected: 'Rejected' }

function Card({ card, onDecide }) {
  if (card.type === 'chart') return <Chart {...card} />
  if (card.type === 'link') {
    return (
      <a className="linkcard" href={card.url} target="_blank" rel="noreferrer">
        <span className="linkcard-icon"><Icon name="pin" /></span>
        <span className="grow"><b>{card.title}</b><small>Open in Google Maps</small></span>
        <Icon name="external" size={18} />
      </a>
    )
  }
  if (card.type === 'approval') {
    const a = card.action
    return (
      <div className={`ticket ${a.status}`}>
        <div className="ticket-head"><span>Confirmation required</span><span>No. {String(a.id).padStart(4, '0')}</span></div>
        <p className="ticket-body">{a.summary}</p>
        <div className="perf" />
        {a.status === 'pending' ? (
          <div className="ticket-actions">
            <button className="btn primary" onClick={() => onDecide(a.id, 'approve')}><Icon name="check" size={18} /> Confirm</button>
            <button className="btn ghost" onClick={() => onDecide(a.id, 'reject')}>Reject</button>
          </div>
        ) : (
          <div className="ticket-result">
            <span className={`stamp ${a.status}`}>{STAMPS[a.status] || a.status}</span>
            {a.result?.reason && <p className="ticket-note">{a.result.reason}</p>}
          </div>
        )}
      </div>
    )
  }
  return null
}

/* Minimal, safe text rendering: paragraphs, bullet lines, **bold**, links. */
function renderText(text) {
  const inline = (line) => line.split(/(\*\*[^*]+\*\*|https?:\/\/\S+)/g).map((part, k) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={k}>{part.slice(2, -2)}</strong>
    if (/^https?:\/\//.test(part)) return <a key={k} href={part} target="_blank" rel="noreferrer">{part.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)}</a>
    return part
  })
  return text.split(/\n{2,}/).map((block, i) => {
    const lines = block.split('\n')
    if (lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l))) {
      return <ul key={i}>{lines.map((l, k) => <li key={k}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ''))}</li>)}</ul>
    }
    return <p key={i}>{lines.map((l, k) => <span key={k}>{k > 0 && <br />}{inline(l)}</span>)}</p>
  })
}
