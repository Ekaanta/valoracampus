import { useCallback, useEffect, useRef, useState } from 'react'
import { api, getToken, login, setToken, streamChat } from './api.js'
import { listen, speak, stopSpeaking, unlockAudio } from './voice.js'
import { ActivityPanel, HistoryPanel, MemoryPanel, SystemsPanel } from './panels.jsx'
import { Brain, Feed, Panel, ProviderList, Sessions, Telemetry } from './hud.jsx'
import { currentLang, locale, plural, speechLang, t, useLang } from './i18n.js'
import { useTheme } from './theme.js'
import Chart from './Chart.jsx'
import Reactor from './Reactor.jsx'
import Icon from './icons.jsx'

export default function App() {
  useLang() // re-render everything when the interface language changes
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
    <button className="icon-btn" onClick={toggle} aria-label={theme === 'dark' ? t('toLight') : t('toDark')}
            title={theme === 'dark' ? t('lightTheme') : t('darkTheme')}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  )
}

function LangToggle() {
  const [lang, setLang] = useLang()
  return (
    <button className="lang-btn" onClick={() => setLang(lang === 'de' ? 'en' : 'de')} aria-label={t('langSwitch')} title={t('langSwitch')}>
      <span className={lang === 'de' ? 'on' : ''}>DE</span><span className={lang === 'en' ? 'on' : ''}>EN</span>
    </button>
  )
}

function Wordmark({ big = false }) {
  return <span className={big ? 'wordmark big' : 'wordmark'} aria-label="Simon">S.I.M.O.N</span>
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
      <div className="login-theme"><LangToggle /><ThemeToggle /></div>
      <div className="login-card">
        <div className="login-reactor"><Reactor state={busy ? 'thinking' : 'idle'} /></div>
        <Wordmark big />
        <p className="eyebrow">{t('loginNeeded')}</p>
        <form onSubmit={submit} className="login-form">
          <input type="password" placeholder={t('password')} value={pw} onChange={(e) => setPw(e.target.value)}
                 autoFocus autoComplete="current-password" aria-label={t('password')} />
          <button className="btn primary icon-only" disabled={!pw || busy} aria-label={t('signIn')}><Icon name="arrowUp" className="rot90" /></button>
        </form>
        <p className="login-err" role="alert">{err}</p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ shell */
const TABS = [
  ['core', 'tabCore', 'core'],
  ['history', 'tabSessions', 'history'],
  ['memory', 'tabMemory', 'memory'],
  ['activity', 'tabActivity', 'activity'],
  ['systems', 'tabSystems', 'cpu'],
]

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  return (
    <span className="clock">
      <span className="clock-time">{now.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</span>
      <span className="clock-date">{now.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })}</span>
    </span>
  )
}

function Shell({ canLogout }) {
  const [view, setView] = useState('core')
  const [convs, setConvs] = useState([])
  const [convId, setConvId] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [setup, setSetup] = useState([]) // server setup problems (missing database / AI key)
  const [stats, setStats] = useState(null)
  const [providers, setProviders] = useState([])
  const [memories, setMemories] = useState([])
  const [activity, setActivity] = useState([])
  const [orb, setOrb] = useState('idle') // shared with the telemetry panel
  const seen = useRef(new Set())

  const refreshConvs = useCallback(() => api('/conversations').then(setConvs).catch(() => {}), [])
  const refreshDeck = useCallback(() => {
    api('/stats').then(setStats).catch(() => {})
    api('/providers').then(setProviders).catch(() => {})
    api('/memories').then(setMemories).catch(() => {})
    api('/activity?limit=40').then(setActivity).catch(() => {})
  }, [])
  const refreshAll = useCallback(() => { refreshConvs(); refreshDeck() }, [refreshConvs, refreshDeck])

  useEffect(() => {
    refreshAll()
    fetch('/api/health').then((r) => r.json()).then((h) => setSetup(h.problems || [])).catch(() => {})
    const timer = setInterval(() => { if (!document.hidden) refreshDeck() }, 15000)
    return () => clearInterval(timer)
  }, [refreshAll, refreshDeck])

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
        speak(t('reminder', { text: fresh.map((r) => r.text).join('. ') }), speechLang())
      } catch { /* offline */ }
    }
    poll()
    const timer = setInterval(poll, 20000)
    return () => clearInterval(timer)
  }, [])

  const dismiss = (id) => {
    setAlerts((a) => a.filter((r) => r.id !== id))
    api(`/reminders/${id}/done`, { method: 'POST' }).catch(() => {})
  }

  const open = (id) => { setConvId(id); setView('core') }
  const back = () => setView('core')
  const free = !stats?.paid_answers

  return (
    <div className={`os view-${view}`}>
      <header className="topbar hud">
        <Wordmark />
        <span className="edition">{t('edition')}</span>
        <span className="grow" />
        <div className="pills" aria-label="Status">
          <span className={`pill ${free ? 'ok' : 'amber'}`}><i />{free ? t('freeMode') : t('paidCalls', { n: stats.paid_answers })}</span>
          <span className="pill">{t('brain')} · {stats?.last_provider || providers[0]?.name || '—'}</span>
          <span className="pill wide-only">{t('answersPill', { n: stats?.answers ?? '—' })}</span>
          <span className="pill wide-only">{t('memoriesPill', { n: stats?.memories ?? '—' })}</span>
          <span className="pill wide-only">{t('toolsPill', { n: stats?.tools_run ?? '—' })}</span>
        </div>
        <Clock />
        <LangToggle />
        <ThemeToggle />
        {canLogout && (
          <button className="icon-btn" onClick={() => { setToken(null); location.reload() }} aria-label={t('logout')} title={t('logout')}><Icon name="logout" /></button>
        )}
      </header>

      <div className="deck">
        <aside className="wing wing-left" aria-label={t('neuralCore')}>
          <Panel title={t('neuralCore')} meta={plural('model', providers.length)} onOpen={() => setView('systems')} className="grow-panel">
            <div className="hud-scroll"><ProviderList providers={providers} stats={stats} /></div>
          </Panel>
          <Panel title={t('telemetry')} meta={t(`s_${orb}`)}>
            <Telemetry stats={stats} />
          </Panel>
        </aside>

        <main className="stage hud">
          <div className="alerts" aria-live="polite">
            {setup.length > 0 && (
              <div className="alert setup" role="alert">
                <Icon name="warn" size={18} />
                <span className="grow">
                  <b>{t('setupTitle')}</b>
                  {setup.map((p) => <span key={p} className="setup-line">{p}</span>)}
                </span>
              </div>
            )}
            {alerts.map((r) => (
              <div key={r.id} className="alert">
                <Icon name="bell" size={18} />
                <span className="grow">{r.text}</span>
                <button className="btn small" onClick={() => dismiss(r.id)}>{t('done')}</button>
              </div>
            ))}
          </div>
          {view === 'core' && (
            <ChatView convId={convId} setConvId={setConvId} onChanged={refreshAll} orb={orb} setOrb={setOrb} onNew={() => open(null)} />
          )}
          {view === 'memory' && <MemoryPanel onBack={back} onChanged={refreshDeck} />}
          {view === 'activity' && <ActivityPanel onBack={back} />}
          {view === 'systems' && <SystemsPanel onBack={back} providers={providers} stats={stats} />}
          {view === 'history' && (
            <HistoryPanel onBack={back} convs={convs} convId={convId} onOpen={open} onNew={() => open(null)}
                          onChanged={(id) => { if (id === convId) setConvId(null); refreshAll() }} />
          )}
        </main>

        <aside className="wing wing-right" aria-label={t('secondBrain')}>
          <Panel title={t('secondBrain')} meta={plural('note', memories.length)} onOpen={() => setView('memory')}>
            <Brain memories={memories} onPick={() => setView('memory')} />
          </Panel>
          <Panel title={t('sessions')} meta={convs.length} onOpen={() => setView('history')} className="grow-panel">
            <button className="btn-new" onClick={() => open(null)}><Icon name="plus" size={16} /> {t('newSession')}</button>
            <div className="hud-scroll"><Sessions convs={convs} convId={view === 'core' ? convId : null} onOpen={open} /></div>
          </Panel>
          <Panel title={t('liveFeed')} onOpen={() => setView('activity')} className="grow-panel">
            <div className="hud-scroll"><Feed items={activity} /></div>
          </Panel>
        </aside>
      </div>

      <nav className="tabbar" aria-label="Navigation">
        {TABS.map(([k, label, icon]) => (
          <button key={k} className={view === k ? 'active' : ''} onClick={() => setView(k)} aria-current={view === k ? 'page' : undefined}>
            <Icon name={icon} size={20} /><span>{t(label)}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

/* ------------------------------------------------------------------ chat */
const SUGGESTIONS = [['sWeather', 'qWeather'], ['sMarkets', 'qMarkets'], ['sReminder', 'qReminder'], ['sMemory', 'qMemory']]
const STATES = ['idle', 'listening', 'thinking', 'speaking']

function greeting() {
  const h = new Date().getHours()
  return h >= 5 && h < 12 ? t('morning') : h >= 12 && h < 18 ? t('day') : t('evening')
}

const timeOf = (m) => new Date(m.created_at || m.at || Date.now()).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
const toolLabel = (name) => (t(`t_${name}`) === `t_${name}` ? name : t(`t_${name}`))

function ChatView({ convId, setConvId, onChanged, orb, setOrb, onNew }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
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
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`
  }, [input])

  useEffect(() => () => { listener.current?.stop(); stopSpeaking(); setOrb('idle') }, [setOrb])

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
        await speak(reply, speechLang())
        if (handsFreeRef.current) return startListening()
      }
      setOrb('idle')
    }
    try {
      await streamChat({ message: text, conversation_id: convRef.current, allow_paid: allowPaid, language: currentLang() }, (ev) => {
        if (ev.type === 'conversation' && ev.id !== convRef.current) {
          skipLoad.current = true
          convRef.current = ev.id
          setConvId(ev.id)
        } else if (ev.type === 'status') patchLast((m) => ({ ...m, status: ev.text }))
        else if (ev.type === 'provider') patchLast((m) => ({ ...m, provider: ev.name, model: ev.model }))
        else if (ev.type === 'token') { reply += ev.text; patchLast((m) => ({ ...m, status: null, content: m.content + ev.text })) }
        else if (ev.type === 'tool') patchLast((m) => ({ ...m, tools: [...m.tools.filter((x) => x.name !== ev.name), ev] }))
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
      listener.current = listen(speechLang(), { onInterim: setInterim })
      const text = await listener.current.promise
      setInterim('')
      listener.current = null
      if (text) return send(text)
    } catch (x) {
      listener.current = null
      setInterim('')
      setMessages((ms) => [...ms, { role: 'assistant', content: '', error: t('mic', { m: x.message }), tools: [], cards: [] }])
    }
    setOrb('idle')
  }

  const micClick = () => {
    if (orb === 'speaking') { stopSpeaking(); setOrb('idle'); return }
    if (listener.current) { listener.current.stop(); return }
    if (!busy) startListening()
  }

  const speakAgain = async (text) => {
    if (busy) return
    unlockAudio()
    setOrb('speaking')
    await speak(text, speechLang())
    setOrb('idle')
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
  const hint = t(`h_${orb}`)
  const lastAi = [...messages].reverse().find((m) => m.role === 'assistant')
  const caption = interim || (orb === 'thinking' ? (lastAi?.status || t('thinking')) : null)

  return (
    <div className={empty ? 'core welcome' : 'core live'}>
      <div className="core-body">
        <section className="reactor-stage" aria-label="Simon">
          <button className="reactor-frame" onClick={micClick} aria-label={hint} title={hint}>
            <Reactor state={orb} />
          </button>
          <div className="stage-text">
            {empty && <p className="core-name" aria-hidden="true">SIMON</p>}
            <div className="pill-row">
              <div className="states" role="status" aria-label={t(`s_${orb}`)}>
                {STATES.map((s) => <span key={s} className={s === orb ? `on ${s}` : ''}>{t(`s_${s}`)}</span>)}
              </div>
              {!empty && (
                <button className="new-session" onClick={onNew} title={t('startNew')}><Icon name="plus" size={13} /> {t('new')}</button>
              )}
            </div>
            {empty ? (
              <>
                <h1 className="welcome-title">{greeting()}. <span>{t('online2')}</span></h1>
                <p className="welcome-sub">{t('welcomeSub', { hint })}</p>
              </>
            ) : (
              <p className="caption" aria-live="polite">{caption || hint}</p>
            )}
          </div>
        </section>

        <div className="scroll">
          {empty ? (
            <div className="suggestions">
              {SUGGESTIONS.map(([tag, q]) => (
                <button key={q} onClick={() => send(t(q))}><span className="sugg-tag">{t(tag)}</span>{t(q)}</button>
              ))}
            </div>
          ) : (
            <div className="thread">
              {messages.map((m, i) => m.role === 'user' ? (
                <div key={m.id || i} className="msg-user">
                  <span className="msg-label">{t('you')} · {timeOf(m)}</span>
                  <p>{m.content}</p>
                </div>
              ) : (
                <article key={m.id || i} className="msg-ai">
                  <header className="meta">
                    <span className="meta-name">Simon</span><span>{timeOf(m)}</span>
                    {m.provider && <span>{t('via', { p: m.provider })}</span>}
                    <span className="grow" />
                    {m.content && !(busy && i === messages.length - 1) && (
                      <button className="replay" onClick={() => speakAgain(m.content)} aria-label={t('readAloudLong')} title={t('readAloud')}>
                        <Icon name="speaker" size={15} />
                      </button>
                    )}
                  </header>
                  {m.tools?.length > 0 && (
                    <ul className="toollog">
                      {m.tools.map((x) => (
                        <li key={x.name} className={x.status}>
                          <span className="tick" />{toolLabel(x.name)}
                          <span className="toolstate">{x.status === 'running' ? t('running') : x.status === 'error' ? t('failed') : t('finished')}</span>
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
                      <div className="ticket-head"><span>{t('paidNeeded')}</span><span>{t('approval')}</span></div>
                      <p className="ticket-body">{t('paidBody', { provider: m.paid.provider, model: m.paid.model })}</p>
                      <p className="ticket-note">{t('cost', { c: m.paid.cost_note })}</p>
                      <div className="ticket-actions">
                        <button className="btn primary" onClick={() => send(null, { allowPaid: true })}>{t('usePaid')}</button>
                        <button className="btn ghost" onClick={() => patchLast((x) => ({ ...x, paid: null }))}>{t('notNow')}</button>
                      </div>
                    </div>
                  )}
                  {m.error && <p className="msg-error">{m.error}</p>}
                  {!m.content && !m.error && !m.paid && busy && i === messages.length - 1 && (
                    <p className="thinking">{m.status || t('thinking')}<span className="dots"><i /><i /><i /></span></p>
                  )}
                </article>
              ))}
              {interim && <div className="msg-user interim"><span className="msg-label">{t('you')} · {t('live')}</span><p>{interim}</p></div>}
              <div ref={bottom} className="thread-end" />
            </div>
          )}
        </div>
      </div>

      <form className="composer" onSubmit={submit}>
        <div className={`composer-box ${orb}`}>
          <button type="button" className={`mic ${orb}`} onClick={micClick} aria-label={hint} title={hint}>
            <Icon name={orb === 'listening' ? 'stop' : orb === 'speaking' ? 'speaker' : 'mic'} size={18} />
          </button>
          <textarea ref={textarea} rows={1} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey}
                    placeholder={orb === 'listening' ? t('listeningPh') : t('placeholder')} aria-label={t('message')} />
          <button className="send" disabled={busy || !input.trim()} aria-label={t('send')}><Icon name="arrowUp" size={18} /></button>
        </div>
        <div className="composer-meta">
          <label className="switch">
            <input type="checkbox" checked={handsFree} onChange={(e) => setHandsFree(e.target.checked)} />
            <span className="track"><span className="thumb" /></span>
            {t('handsFree')}
          </label>
          <span className="hint">{t('enterHint')}</span>
        </div>
      </form>
    </div>
  )
}

function Card({ card, onDecide }) {
  if (card.type === 'chart') return <Chart {...card} />
  if (card.type === 'link') {
    return (
      <a className="linkcard" href={card.url} target="_blank" rel="noreferrer">
        <span className="linkcard-icon"><Icon name="pin" /></span>
        <span className="grow"><b>{card.title}</b><small>{t('maps')}</small></span>
        <Icon name="external" size={18} />
      </a>
    )
  }
  if (card.type === 'approval') {
    const a = card.action
    return (
      <div className={`ticket ${a.status}`}>
        <div className="ticket-head"><span>{t('authRequired')}</span><span>{t('no')} {String(a.id).padStart(4, '0')}</span></div>
        <p className="ticket-body">{a.summary}</p>
        {a.status === 'pending' ? (
          <div className="ticket-actions">
            <button className="btn primary" onClick={() => onDecide(a.id, 'approve')}><Icon name="check" size={18} /> {t('confirm')}</button>
            <button className="btn ghost" onClick={() => onDecide(a.id, 'reject')}>{t('reject')}</button>
          </div>
        ) : (
          <div className="ticket-result">
            <span className={`stamp ${a.status}`}>{t(`st_${a.status}`) === `st_${a.status}` ? a.status : t(`st_${a.status}`)}</span>
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
