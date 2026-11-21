import { useCallback, useEffect, useRef, useState } from 'react'
import { api, getToken, login, setToken, streamChat } from './api.js'
import { listen, speak, stopSpeaking } from './voice.js'
import { ActivityPanel, MemoryPanel, ProvidersPanel } from './panels.jsx'
import Chart from './Chart.jsx'

export default function App() {
  const [authed, setAuthed] = useState(!!getToken())
  useEffect(() => {
    const off = () => setAuthed(false)
    window.addEventListener('simon-logout', off)
    return () => window.removeEventListener('simon-logout', off)
  }, [])
  return authed ? <Shell /> : <Login onDone={() => setAuthed(true)} />
}

/* ------------------------------------------------------------------ orb */
export function Orb({ state = 'idle', size = 140 }) {
  return (
    <div className={`orb orb-${state}`} style={{ width: size, height: size }} aria-label={`SIMON is ${state}`}>
      <div className="ring r1" /><div className="ring r2" /><div className="ring r3" />
      <div className="core" />
    </div>
  )
}

/* ------------------------------------------------------------------ login */
function Login({ onDone }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const submit = async (e) => {
    e.preventDefault()
    try { await login(pw); onDone() } catch (x) { setErr(x.message) }
  }
  return (
    <div className="login">
      <Orb size={170} />
      <h1>SIMON</h1>
      <form onSubmit={submit}>
        <input type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        <button>Enter</button>
      </form>
      {err && <p className="error">{err}</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ shell */
const VIEWS = [['chat', 'Chat'], ['memory', 'Memory'], ['activity', 'Activity'], ['providers', 'AI Providers']]

function Shell() {
  const [view, setView] = useState('chat')
  const [me, setMe] = useState({ assistant_name: 'SIMON', speech_lang: 'en-US' })
  const [convs, setConvs] = useState([])
  const [convId, setConvId] = useState(null)
  const [menu, setMenu] = useState(false)
  const [alerts, setAlerts] = useState([])
  const seen = useRef(new Set())

  const refreshConvs = useCallback(() => api('/conversations').then(setConvs).catch(() => {}), [])

  useEffect(() => {
    api('/me').then(setMe).catch(() => {})
    refreshConvs()
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
          if ('Notification' in window && Notification.permission === 'granted') new Notification('SIMON', { body: r.text })
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

  return (
    <div className="shell">
      <aside className={menu ? 'side open' : 'side'}>
        <div className="brand"><Orb size={34} /> <span>{me.assistant_name}</span></div>
        <nav>
          {VIEWS.map(([k, label]) => (
            <button key={k} className={view === k ? 'active' : ''} onClick={() => { setView(k); setMenu(false) }}>{label}</button>
          ))}
        </nav>
        <div className="convs">
          <button className="new" onClick={() => open(null)}>+ New conversation</button>
          {convs.map((c) => (
            <button key={c.id} className={c.id === convId ? 'conv active' : 'conv'} onClick={() => open(c.id)}>{c.title}</button>
          ))}
        </div>
        <button className="logout" onClick={() => { setToken(null); location.reload() }}>Log out</button>
      </aside>

      <main>
        <header className="top">
          <button className="burger" onClick={() => setMenu(!menu)} aria-label="Menu">☰</button>
          <span>{VIEWS.find(([k]) => k === view)[1]}</span>
        </header>
        {alerts.map((r) => (
          <div key={r.id} className="alert">⏰ {r.text}<button onClick={() => dismiss(r.id)}>Done</button></div>
        ))}
        {view === 'chat' && <ChatView me={me} convId={convId} setConvId={setConvId} onChanged={refreshConvs} />}
        {view === 'memory' && <MemoryPanel />}
        {view === 'activity' && <ActivityPanel />}
        {view === 'providers' && <ProvidersPanel />}
      </main>
    </div>
  )
}

/* ------------------------------------------------------------------ chat */
function ChatView({ me, convId, setConvId, onChanged }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [orb, setOrb] = useState('idle')
  const [interim, setInterim] = useState('')
  const [voiceMode, setVoiceMode] = useState(false)
  const skipLoad = useRef(false)
  const listener = useRef(null)
  const bottom = useRef(null)
  const voiceRef = useRef(voiceMode)
  voiceRef.current = voiceMode
  const convRef = useRef(convId) // the voice loop calls send() from older renders
  convRef.current = convId

  useEffect(() => {
    if (skipLoad.current) { skipLoad.current = false; return }
    if (!convId) { setMessages([]); return }
    api(`/conversations/${convId}`).then((rows) => setMessages(rows.map((m) => ({ ...m, tools: [] })))).catch(() => {})
  }, [convId])

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, interim])

  const patchLast = (fn) => setMessages((ms) => {
    const copy = [...ms]
    copy[copy.length - 1] = fn({ ...copy[copy.length - 1] })
    return copy
  })

  const send = async (text, { allowPaid = false } = {}) => {
    if (busy) return
    setBusy(true)
    setOrb('thinking')
    stopSpeaking()
    setMessages((ms) => [...ms, ...(text ? [{ role: 'user', content: text }] : []),
      { role: 'assistant', content: '', cards: [], tools: [] }])
    let reply = ''
    try {
      await streamChat({ message: text, conversation_id: convRef.current, allow_paid: allowPaid }, (ev) => {
        if (ev.type === 'conversation' && ev.id !== convRef.current) {
          skipLoad.current = true
          convRef.current = ev.id
          setConvId(ev.id)
        }
        else if (ev.type === 'provider') patchLast((m) => ({ ...m, provider: ev.name, model: ev.model }))
        else if (ev.type === 'token') { reply += ev.text; patchLast((m) => ({ ...m, content: m.content + ev.text })) }
        else if (ev.type === 'tool') patchLast((m) => ({ ...m, tools: [...m.tools.filter((t) => t.name !== ev.name), ev] }))
        else if (['chart', 'link', 'approval'].includes(ev.type)) patchLast((m) => ({ ...m, cards: [...(m.cards || []), ev] }))
        else if (ev.type === 'paid_required') patchLast((m) => ({ ...m, paid: ev }))
        else if (ev.type === 'error') patchLast((m) => ({ ...m, error: ev.message }))
      })
    } catch (x) {
      patchLast((m) => ({ ...m, error: x.message }))
    }
    setBusy(false)
    onChanged()
    if (voiceRef.current && reply.trim()) {
      setOrb('speaking')
      await speak(reply, me.speech_lang)
      if (voiceRef.current) return startListening()
    }
    setOrb('idle')
  }

  const startListening = async () => {
    stopSpeaking()
    setOrb('listening')
    setInterim('')
    try {
      listener.current = listen(me.speech_lang, { onInterim: setInterim })
      const text = await listener.current.promise
      setInterim('')
      listener.current = null
      if (text) return send(text)
    } catch (x) {
      setInterim(`Microphone: ${x.message}`)
    }
    setOrb('idle')
  }

  const micClick = () => {
    if (orb === 'speaking') { stopSpeaking(); return }
    if (listener.current) { listener.current.stop(); return }
    startListening()
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
    e.preventDefault()
    const text = input.trim()
    if (!text) return
    setInput('')
    send(text)
  }

  const empty = messages.length === 0

  return (
    <div className="chat">
      <div className={empty ? 'hero big' : 'hero'}>
        <Orb state={orb} size={empty ? 180 : 64} />
        {empty && <p className="hint">Talk or type. Try: “What’s the weather tomorrow?” or “Show me the Bitcoin chart”.</p>}
      </div>

      <div className="messages">
        {messages.map((m, i) => (
          <div key={m.id || i} className={`msg ${m.role}`}>
            {m.tools?.length > 0 && (
              <div className="tools">{m.tools.map((t) => <span key={t.name} className={`chip ${t.status}`}>⚙ {t.name}</span>)}</div>
            )}
            {m.content && <div className="bubble">{renderText(m.content)}</div>}
            {m.cards?.map((c, k) => <Card key={k} card={c} onDecide={(id, v) => decide(i, id, v)} />)}
            {m.paid && (
              <div className="card paid">
                <b>All free AI providers are unavailable.</b>
                <p>Use <b>{m.paid.provider}</b> ({m.paid.model}) once? Estimated cost: {m.paid.cost_note}.</p>
                <small>{m.paid.reason}</small>
                <div className="row">
                  <button onClick={() => send(null, { allowPaid: true })}>Approve paid model</button>
                  <button className="ghost" onClick={() => patchLast((x) => ({ ...x, paid: null }))}>Cancel</button>
                </div>
              </div>
            )}
            {m.error && <div className="error">{m.error}</div>}
            {m.role === 'assistant' && m.provider && <div className="meta">{m.provider} · {m.model}</div>}
            {m.role === 'assistant' && !m.content && busy && i === messages.length - 1 && !m.error && <div className="typing"><i /><i /><i /></div>}
          </div>
        ))}
        {interim && <div className="msg user interim"><div className="bubble">{interim}</div></div>}
        <div ref={bottom} />
      </div>

      <form className="composer" onSubmit={submit}>
        <button type="button" className={`mic ${orb}`} onClick={micClick} title="Speak">🎙</button>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={`Message ${me.assistant_name}…`} />
        <button disabled={busy || !input.trim()}>Send</button>
        <label className="voice-toggle" title="Speak answers and keep listening">
          <input type="checkbox" checked={voiceMode} onChange={(e) => setVoiceMode(e.target.checked)} /> Voice
        </label>
      </form>
    </div>
  )
}

function Card({ card, onDecide }) {
  if (card.type === 'chart') return <div className="card"><Chart {...card} /></div>
  if (card.type === 'link') return <a className="card link" href={card.url} target="_blank" rel="noreferrer">🗺 {card.title} ↗</a>
  if (card.type === 'approval') {
    const a = card.action
    return (
      <div className={`card approval ${a.status}`}>
        <div><b>Confirmation required</b> · #{a.id}</div>
        <p>{a.summary}</p>
        {a.status === 'pending' ? (
          <div className="row">
            <button onClick={() => onDecide(a.id, 'approve')}>Confirm</button>
            <button className="ghost" onClick={() => onDecide(a.id, 'reject')}>Reject</button>
          </div>
        ) : (
          <small>Status: {a.status}{a.result?.reason ? ` — ${a.result.reason}` : ''}</small>
        )}
      </div>
    )
  }
  return null
}

/* Minimal, safe text rendering: line breaks, **bold**, links. */
function renderText(text) {
  return text.split('\n').map((line, i) => (
    <p key={i}>{line.split(/(\*\*[^*]+\*\*|https?:\/\/\S+)/g).map((part, k) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={k}>{part.slice(2, -2)}</strong>
      if (/^https?:\/\//.test(part)) return <a key={k} href={part} target="_blank" rel="noreferrer">{part}</a>
      return part
    })}</p>
  ))
}
