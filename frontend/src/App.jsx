import { useCallback, useEffect, useRef, useState } from 'react'
import { api, getToken, login, setupAdmin, signUp, streamChat, transcribe } from './api.js'
import {
  MIC, createSpeaker, listen, micSupported, openMic, realSpeech, setVoicePrefs, speak, stopSpeaking, unlockAudio, voicePrefs,
} from './voice.js'
import { AccountPanel, ActivityPanel, AdminPanel, HistoryPanel, MemoryPanel, SystemsPanel } from './panels.jsx'
import { Brain, Feed, Panel, ProviderList, Sessions, Telemetry } from './hud.jsx'
import { currentLang, locale, plural, speechLang, t, useLang } from './i18n.js'
import { useTheme } from './theme.js'
import Chart from './Chart.jsx'
import Sphere from './Sphere.jsx'
import Icon from './icons.jsx'

export default function App() {
  useLang() // re-render everything when the interface language changes
  const [authed, setAuthed] = useState(!!getToken())
  const [setupNeeded, setSetupNeeded] = useState(null) // true on the very first start (no account yet)
  const [allowSignup, setAllowSignup] = useState(false)
  useEffect(() => {
    fetch('/api/config').then((r) => r.json()).then((c) => {
      setSetupNeeded(!!c.setup_needed)
      setAllowSignup(!!c.allow_signup)
    }).catch(() => setSetupNeeded(false))
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
  if (setupNeeded === null) return null
  if (setupNeeded && !authed) return <Setup onDone={() => { setSetupNeeded(false); setAuthed(true) }} />
  return authed ? <Shell /> : <Login onDone={() => setAuthed(true)} allowSignup={allowSignup} />
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

/* ------------------------------------------------------------------ login and first-run setup */
function AuthFrame({ busy, title, sub, children }) {
  return (
    <div className="login">
      <div className="login-theme"><LangToggle /><ThemeToggle /></div>
      <div className="login-card">
        <div className="login-reactor"><Sphere state={busy ? 'thinking' : 'idle'} /></div>
        <Wordmark big />
        <p className="eyebrow">{title}</p>
        {sub && <p className="login-sub">{sub}</p>}
        {children}
      </div>
    </div>
  )
}

function Login({ onDone, allowSignup }) {
  const [signup, setSignup] = useState(false)
  const [form, setForm] = useState({ username: '', password: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try { await login(form.username, form.password); onDone() } catch (x) { setErr(x.status === 401 ? t('wrongLogin') : t('loginFailed')) }
    setBusy(false)
  }
  if (signup) return <AccountForm mode="signup" onDone={onDone} onSwitch={() => setSignup(false)} />
  return (
    <AuthFrame busy={busy} title={t('loginNeeded')}>
      <form onSubmit={submit} className="login-form stack">
        <input placeholder={t('username')} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
               autoFocus autoCapitalize="none" autoComplete="username" aria-label={t('username')} />
        <input type="password" placeholder={t('password')} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
               autoComplete="current-password" aria-label={t('password')} />
        <button className="btn primary" disabled={!form.username || !form.password || busy}>{t('signIn')}</button>
      </form>
      <p className="login-err" role="alert">{err}</p>
      {allowSignup && <button className="auth-switch" onClick={() => setSignup(true)}>{t('signupLink')}</button>}
    </AuthFrame>
  )
}

const Setup = ({ onDone }) => <AccountForm mode="setup" onDone={onDone} />

/** First administrator (mode "setup") or a new user signing up on the login page (mode "signup"). */
function AccountForm({ mode, onDone, onSwitch }) {
  const [form, setForm] = useState({ display_name: '', username: '', password: '', again: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    if (form.password !== form.again) return setErr(t('pwMismatch'))
    setBusy(true)
    setErr('')
    try {
      if (mode === 'signup') await signUp(form.username, form.password, form.display_name)
      else await setupAdmin(form.username, form.password, form.display_name)
      onDone()
    } catch (x) {
      setErr(x.status === 409 ? (mode === 'signup' ? t('userTaken') : t('alreadySetUp'))
        : x.status === 403 ? t('signupOff') : t('userRules'))
    }
    setBusy(false)
  }
  return (
    <AuthFrame busy={busy} title={mode === 'signup' ? t('signupTitle') : t('setupFirst')}
               sub={mode === 'signup' ? t('signupSub') : t('setupSub')}>
      <form onSubmit={submit} className="login-form stack">
        <input placeholder={t('displayName')} value={form.display_name} onChange={set('display_name')} autoFocus aria-label={t('displayName')} />
        <input placeholder={t('username')} value={form.username} onChange={set('username')} autoCapitalize="none" autoComplete="username" aria-label={t('username')} />
        <input type="password" placeholder={t('password')} value={form.password} onChange={set('password')} autoComplete="new-password" aria-label={t('password')} />
        <input type="password" placeholder={t('passwordAgain')} value={form.again} onChange={set('again')} autoComplete="new-password" aria-label={t('passwordAgain')} />
        <button className="btn primary" disabled={!form.username || !form.password || busy}>{t('createAccount')}</button>
      </form>
      <p className="login-err" role="alert">{err}</p>
      {onSwitch && <button className="auth-switch" onClick={onSwitch}>{t('haveAccount')}</button>}
    </AuthFrame>
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

function Shell() {
  const [view, setView] = useState('core')
  const [me, setMe] = useState(null) // the signed-in user
  const [, setLang] = useLang()
  const [convs, setConvs] = useState([])
  const [convId, setConvId] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [setup, setSetup] = useState([]) // server setup problems (missing database / AI key)
  const [stats, setStats] = useState(null)
  const [providers, setProviders] = useState([])
  const [memories, setMemories] = useState([])
  const [activity, setActivity] = useState([])
  const [voices, setVoices] = useState(null) // voice picker choices from the server
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
    api('/voices').then(setVoices).catch(() => {})
    api('/me').then((m) => {
      setMe(m)
      // a new device starts in the language the administrator chose
      try { if (!localStorage.getItem('simon_lang') && m.language) setLang(m.language) } catch { /* private mode */ }
    }).catch(() => {})
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
        {me?.role === 'admin' && (
          <button className="icon-btn admin-btn" onClick={() => setView('admin')} aria-label={t('adminTitle')} title={t('adminTitle')}><Icon name="gear" /></button>
        )}
        {me && (
          <button className="user-btn" onClick={() => setView('account')} aria-label={t('accTitle')} title={t('accTitle')}>
            <span className="avatar">{(me.display_name || me.username).slice(0, 1).toUpperCase()}</span>
            <span className="user-name">{me.display_name}</span>
          </button>
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
            <ChatView convId={convId} setConvId={setConvId} onChanged={refreshAll} orb={orb} setOrb={setOrb} onNew={() => open(null)} voices={voices} me={me} />
          )}
          {view === 'memory' && <MemoryPanel onBack={back} onChanged={refreshDeck} />}
          {view === 'activity' && <ActivityPanel onBack={back} />}
          {view === 'systems' && <SystemsPanel onBack={back} providers={providers} stats={stats} />}
          {view === 'account' && <AccountPanel me={me} onBack={back} onAdmin={() => setView('admin')} />}
          {view === 'admin' && me?.role === 'admin' && (
            <AdminPanel me={me} onBack={back} onSettingsChanged={() => api('/voices').then(setVoices).catch(() => {})} />
          )}
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

function ChatView({ convId, setConvId, onChanged, orb, setOrb, onNew, voices, me }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [interim, setInterim] = useState('')
  // A conversation (one tap on the sphere): the microphone stays open, like a phone call, until the next tap
  const [talk, setTalk] = useState(false)
  const talkRef = useRef(false)
  // talking over Simon stops him and he answers what was said
  const [bargeIn, setBargeInState] = useState(() => voicePrefs().bargeIn !== false)
  const setBargeIn = (on) => { setBargeInState(on); setVoicePrefs({ bargeIn: on }) }
  // voice: the sphere stays large and only the current words show below it; text: the full chat
  const [mode, setModeState] = useState(() => { try { return localStorage.getItem('simon_mode') || 'voice' } catch { return 'voice' } })
  const setMode = (m) => { setModeState(m); try { localStorage.setItem('simon_mode', m) } catch { /* private mode */ } }
  const [spoken, setSpoken] = useState('') // subtitle under the sphere while Simon speaks
  const turnRef = useRef(0) // the latest send/replay; older ones must not reset the state
  const skipLoad = useRef(false)
  const listener = useRef(null) // one-time listening (browsers without the conversation microphone)
  const bottom = useRef(null)
  const textarea = useRef(null)
  const convRef = useRef(convId) // callbacks from older renders call send()
  convRef.current = convId
  const busyRef = useRef(false) // callbacks from older renders must see the current value
  const markBusy = (on) => { busyRef.current = on; setBusy(on) }
  const bargeInRef = useRef(bargeIn)
  bargeInRef.current = bargeIn
  const abortRef = useRef(null) // stops the answer while it is still being written
  const heardRef = useRef('') // what Simon has already said aloud of the current answer
  const mic = useRef(null) // the open conversation microphone
  // the user's turn in a conversation: the pieces said so far and how they relate to Simon's last answer
  const talkState = useRef({
    parts: [], replaceLast: false, interrupted: null, lastQuestion: '', lastInterrupted: null,
    speakingSince: 0, replay: false, chain: Promise.resolve(), idle: null,
  })

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

  useEffect(() => () => {
    listener.current?.stop()
    mic.current?.close()
    clearTimeout(talkState.current.idle)
    abortRef.current?.abort()
    stopSpeaking()
    setOrb('idle')
  }, [setOrb])

  const patchLast = (fn) => setMessages((ms) => {
    const copy = [...ms]
    copy[copy.length - 1] = fn({ ...copy[copy.length - 1] })
    return copy
  })

  // spoken: the answer is read aloud (the question came by voice, or a conversation is open)
  // interrupted: the part of Simon's previous answer the user heard before talking over him
  // replaceLast: the user had only paused; this question completes the previous one and replaces it
  const send = async (text, { allowPaid = false, spoken = false, interrupted = null, replaceLast = false } = {}) => {
    if (busyRef.current) return
    unlockAudio()
    markBusy(true)
    setOrb('thinking')
    stopSpeaking()
    const turn = ++turnRef.current
    const ts = talkState.current
    heardRef.current = ''
    ts.speakingSince = 0
    ts.replay = false
    if (text) ts.lastQuestion = text
    // Voice answers start with the first finished sentence, while the rest is still being written.
    const speaker = spoken || talkRef.current
      ? createSpeaker(speechLang(), {
        onStart: () => { ts.speakingSince = performance.now(); setOrb('speaking') },
        onSentence: (s) => { heardRef.current += `${heardRef.current ? ' ' : ''}${s}`; setSpoken(s) },
      })
      : null
    const ctl = new AbortController()
    abortRef.current = ctl
    const now = new Date().toISOString()
    setMessages((ms) => [...ms, ...(text ? [{ role: 'user', content: text, created_at: now }] : []),
      { role: 'assistant', content: '', cards: [], tools: [], created_at: now }])
    let finished = false
    const finish = async () => {
      if (finished) return
      finished = true
      if (abortRef.current === ctl) abortRef.current = null // after "done" the server still learns memories
      if (turnRef.current === turn) markBusy(false) // (when the user cut in, that already happened)
      onChanged()
      if (speaker) {
        speaker.end()
        await speaker.done
        if (turnRef.current === turn) setSpoken('')
      }
      if (turnRef.current !== turn) return // a newer question, or the user cutting in, took over
      ts.speakingSince = 0
      setOrb(talkRef.current ? 'listening' : 'idle') // in a conversation Simon simply listens again
      armClose()
    }
    try {
      await streamChat({
        message: text, conversation_id: convRef.current, allow_paid: allowPaid, language: currentLang(),
        spoken: !!speaker, ...(interrupted !== null ? { interrupted } : {}), ...(replaceLast ? { replace_last: true } : {}),
      }, (ev) => {
        if (ev.type === 'conversation' && ev.id !== convRef.current) {
          skipLoad.current = true
          convRef.current = ev.id
          setConvId(ev.id)
        } else if (ev.type === 'status') patchLast((m) => ({ ...m, status: ev.text }))
        else if (ev.type === 'provider') patchLast((m) => ({ ...m, provider: ev.name, model: ev.model }))
        else if (ev.type === 'token') {
          speaker?.push(ev.text)
          patchLast((m) => ({ ...m, status: null, content: m.content + ev.text }))
        }
        else if (ev.type === 'tool') patchLast((m) => ({ ...m, tools: [...m.tools.filter((x) => x.name !== ev.name), ev] }))
        else if (['chart', 'link', 'approval'].includes(ev.type)) patchLast((m) => ({ ...m, cards: [...(m.cards || []), ev] }))
        else if (ev.type === 'paid_required') patchLast((m) => ({ ...m, paid: ev }))
        else if (ev.type === 'error') patchLast((m) => ({ ...m, error: ev.message, retryable: !!ev.retryable, retryAfter: ev.retry_after || 0 }))
        else if (ev.type === 'done') finish() // the server keeps learning memories after this
      }, ctl.signal)
    } catch (x) {
      if (!ctl.signal.aborted) patchLast((m) => ({ ...m, error: x.message, retryable: true, retryAfter: 0 }))
    }
    finish()
  }

  /* A real conversation: after one tap the microphone stays open. Whenever the user talks, Simon notices
     it at once. While he is silent, he listens. While he is still thinking, or has only just begun to
     answer, the user had not finished (they only paused): he stops, and what they say now is joined to
     the question before. In the middle of an answer he stops and answers what was said, knowing how much
     of his answer they heard. */
  const armClose = () => { // the conversation ends by itself after a long time without anybody talking
    const ts = talkState.current
    clearTimeout(ts.idle)
    if (!talkRef.current) return
    ts.idle = setTimeout(() => {
      if (!talkRef.current) return
      if (busyRef.current || ts.speakingSince || mic.current?.talking || ts.parts.length) { armClose(); return }
      endTalk()
    }, MIC.closeAfterMs)
  }

  const startTalk = async () => {
    if (talkRef.current) return
    unlockAudio()
    setMode('voice')
    if (!micSupported()) return startListening()
    talkRef.current = true
    setTalk(true)
    setInterim('')
    if (!busyRef.current && !talkState.current.speakingSince) setOrb('listening')
    const m = await openMic({ onSpeech: userStarts, onUtterance: userSaid })
    if (!talkRef.current) { m?.close(); return } // ended meanwhile
    if (!m) { // no microphone access: listen once the browser's way (it shows why)
      talkRef.current = false
      setTalk(false)
      return startListening()
    }
    mic.current = m
    armClose()
  }

  const endTalk = () => {
    const ts = talkState.current
    talkRef.current = false
    setTalk(false)
    mic.current?.close()
    mic.current = null
    clearTimeout(ts.idle)
    ts.parts = []
    ts.interrupted = null
    ts.replaceLast = false
    setInterim('')
    if (!busyRef.current && !ts.speakingSince) setOrb('idle')
  }

  const dropLastExchange = (ms) => {
    let i = ms.length
    if (ms[i - 1]?.role === 'assistant') i--
    if (ms[i - 1]?.role === 'user') i--
    return ms.slice(0, i)
  }

  // The microphone noticed the user talking. Returning false ignores it.
  const userStarts = () => {
    const ts = talkState.current
    clearTimeout(ts.idle)
    if (ts.replay) { // a replayed answer: simply stop it
      ++turnRef.current
      stopSpeaking()
      ts.replay = false
      ts.speakingSince = 0
      setSpoken('')
    } else if (busyRef.current || ts.speakingSince) {
      const continuing = !ts.speakingSince || performance.now() - ts.speakingSince < 2500
      if (!continuing && !bargeInRef.current) return false // talking over Simon is switched off
      ++turnRef.current // the answer that is cut off must not change the state any more
      abortRef.current?.abort()
      abortRef.current = null
      markBusy(false)
      stopSpeaking()
      setSpoken('')
      if (continuing) { // they had only paused: what comes now completes the last question
        ts.parts = [ts.lastQuestion, ...ts.parts].filter(Boolean)
        ts.replaceLast = true
        ts.interrupted = ts.lastInterrupted
        setMessages(dropLastExchange)
      } else {
        ts.interrupted = heardRef.current
        ts.replaceLast = false
        setMessages((ms) => {
          const copy = [...ms]
          const i = copy.length - 1
          if (copy[i]?.role === 'assistant') copy[i] = { ...copy[i], interrupted: true, status: null }
          return copy
        })
      }
      ts.speakingSince = 0
    }
    setOrb('listening')
    setInterim(t('listeningPh'))
    return true
  }

  // The user paused: write out what they said, and answer it once they have finished.
  const userSaid = (wav, speechMs) => {
    const ts = talkState.current
    ts.chain = ts.chain.then(async () => {
      if (!talkRef.current) return
      let text = ''
      let failed = false
      if (speechMs >= MIC.minSpeechMs) { // shorter: a cough or a click
        if (!mic.current?.talking) { setOrb('thinking'); setInterim('') }
        try {
          text = ((await transcribe(wav, speechLang().slice(0, 2))) || '').trim()
        } catch (x) {
          if (x.status === 503) { endTalk(); startListening(); return } // no speech-to-text on this server
          failed = true
        }
      }
      if (!talkRef.current) return
      if (realSpeech(text)) ts.parts.push(text)
      if (mic.current?.talking) return // they are talking again: wait for the rest
      if (!ts.parts.length) { // only a noise (or not understood)
        setInterim(failed ? t('notHeard') : '')
        if (!busyRef.current && !ts.speakingSince) setOrb('listening')
        armClose()
        return
      }
      const question = ts.parts.join(' ')
      const opts = { spoken: true, interrupted: ts.interrupted, replaceLast: ts.replaceLast }
      ts.parts = []
      ts.interrupted = null
      ts.replaceLast = false
      ts.lastInterrupted = opts.interrupted
      setInterim('')
      if (busyRef.current) { ++turnRef.current; abortRef.current?.abort(); abortRef.current = null; markBusy(false); stopSpeaking() }
      send(question, opts)
    })
  }

  // One question by voice, the browser's way (only where the conversation microphone is not available)
  const startListening = async () => {
    stopSpeaking()
    unlockAudio()
    setOrb('listening')
    setInterim('')
    setMode('voice')
    try {
      listener.current = listen(speechLang(), { onInterim: setInterim })
      const text = await listener.current.promise
      setInterim('')
      listener.current = null
      if (text) return send(text, { spoken: true })
    } catch (x) {
      listener.current = null
      setInterim('')
      setMessages((ms) => [...ms, { role: 'assistant', content: '', error: t('mic', { m: x.message }), tools: [], cards: [] }])
    }
    setOrb('idle')
  }

  const micClick = () => {
    if (talkRef.current) { endTalk(); stopSpeaking(); return } // tap again: the conversation ends
    if (listener.current) { listener.current.stop(); return }
    if (orb === 'speaking') { stopSpeaking(); setOrb(busy ? 'thinking' : 'idle'); return }
    startTalk()
  }

  // Ask the last question again: the failed answer is replaced, the server re-uses the saved question.
  const retry = () => {
    if (busy) return
    setMessages((ms) => ms.slice(0, -1))
    send(null)
  }

  const speakAgain = async (text) => {
    if (busy) return
    unlockAudio()
    const turn = ++turnRef.current
    const ts = talkState.current
    ts.replay = true
    setOrb('thinking')
    await speak(text, speechLang(), { onStart: () => { ts.speakingSince = performance.now(); setOrb('speaking') }, onSentence: setSpoken })
    if (turnRef.current !== turn) return
    ts.replay = false
    ts.speakingSince = 0
    setSpoken('')
    setOrb(talkRef.current ? 'listening' : 'idle')
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
    setMode('text')
    send(text)
  }

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() }
  }

  const empty = messages.length === 0
  const voiceMode = !empty && mode === 'voice'
  const hint = t(`h_${orb}`)
  const lastAi = [...messages].reverse().find((m) => m.role === 'assistant')
  const subtitle = orb === 'speaking' && spoken ? spoken.replace(/[*_#>`]/g, '').replace(/\s+/g, ' ').trim() : ''
  const caption = interim || subtitle || (orb === 'thinking' ? (lastAi?.status || t('thinking')) : null)

  return (
    <div className={empty || voiceMode ? 'core welcome' : 'core live'}>
      <div className="core-body">
        <section className="reactor-stage" aria-label="Simon">
          <button className="reactor-frame" onClick={micClick} aria-label={hint} title={hint}>
            <Sphere state={orb} />
          </button>
          <div className="stage-text">
            {empty && <p className="core-name" aria-hidden="true">SIMON</p>}
            <div className="pill-row">
              <div className="states" role="status" aria-label={t(`s_${orb}`)}>
                {STATES.map((s) => <span key={s} className={s === orb ? `on ${s}` : ''}>{t(`s_${s}`)}</span>)}
              </div>
              {!empty && (
                <button className="new-session" onClick={() => setMode(voiceMode ? 'text' : 'voice')}
                        title={voiceMode ? t('toText') : t('toVoice')}>
                  <Icon name={voiceMode ? 'chat' : 'core'} size={13} /> {voiceMode ? t('modeText') : t('modeVoice')}
                </button>
              )}
              {!empty && (
                <button className="new-session" onClick={onNew} title={t('startNew')}><Icon name="plus" size={13} /> {t('new')}</button>
              )}
            </div>
            {empty ? (
              <>
                <h1 className="welcome-title">{greeting()}{me?.display_name ? `, ${me.display_name}` : ''}. <span>{t('online2')}</span></h1>
                <p className="welcome-sub">{t('welcomeSub', { hint })}</p>
              </>
            ) : voiceMode ? (
              <VoiceStrip messages={messages} orb={orb} interim={interim} spoken={subtitle} hint={hint}
                          onOpenText={() => setMode('text')} />
            ) : (
              <p className="caption" aria-live="polite">{caption || hint}</p>
            )}
          </div>
        </section>

        <div className="scroll">
          {voiceMode ? null : empty ? (
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
                    {m.interrupted && <span className="cut-tag">{t('interrupted')}</span>}
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
                  {m.error && (
                    <div className="msg-error" role="alert">
                      <Icon name="warn" size={16} />
                      <p className="grow">{m.error}</p>
                      {m.retryable && i === messages.length - 1 && !busy && <RetryButton seconds={m.retryAfter} onRetry={retry} />}
                    </div>
                  )}
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
            <Icon name={talk || orb === 'listening' ? 'stop' : orb === 'speaking' ? 'speaker' : 'mic'} size={18} />
          </button>
          <textarea ref={textarea} rows={1} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey}
                    placeholder={orb === 'listening' ? t('listeningPh') : t('placeholder')} aria-label={t('message')} />
          <button className="send" disabled={busy || !input.trim()} aria-label={t('send')}><Icon name="arrowUp" size={18} /></button>
        </div>
        <div className="composer-meta">
          {micSupported() && (
            <label className="switch" title={t('bargeInHint')}>
              <input type="checkbox" checked={bargeIn} onChange={(e) => setBargeIn(e.target.checked)} />
              <span className="track"><span className="thumb" /></span>
              {t('bargeIn')}
            </label>
          )}
          <VoicePicker voices={voices} onPreview={() => speakAgain(t('voiceSample'))} />
          <span className="hint">{t('enterHint')}</span>
        </div>
      </form>
    </div>
  )
}

const speakable = (text) => (text || '').replace(/\|/g, ' ').replace(/[*_#>`]/g, '').replace(/\s+/g, ' ').trim()

/**
 * Voice mode: under the large sphere only the current exchange — your last words and what Simon
 * is saying right now (or the end of his last answer). Charts and confirmations open text mode.
 */
function VoiceStrip({ messages, orb, interim, spoken, hint, onOpenText }) {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const lastAi = [...messages].reverse().find((m) => m.role === 'assistant')
  let simon = ''
  if (orb === 'speaking' && spoken) simon = spoken
  else if (orb === 'thinking') simon = lastAi?.status || t('thinking')
  else if (lastAi?.error) simon = lastAi.error
  else if (lastAi?.content) {
    const all = speakable(lastAi.content)
    simon = all.length > 220 ? `… ${all.slice(-220).replace(/^\S*\s/, '')}` : all
  }
  const pending = lastAi?.cards?.some((c) => c.type === 'approval' && c.action?.status === 'pending')
  const hasCard = pending || lastAi?.cards?.length > 0
  return (
    <div className="voice-strip" aria-live="polite">
      {(interim || lastUser) && <p className={interim ? 'vs-user live' : 'vs-user'}>{interim || lastUser.content}</p>}
      <p className="vs-simon">{simon || hint}</p>
      {hasCard && (
        <button className={pending ? 'vs-card pending' : 'vs-card'} onClick={onOpenText}>
          <Icon name={pending ? 'warn' : 'expand'} size={13} /> {pending ? t('approvalInText') : t('cardInText')}
        </button>
      )}
    </div>
  )
}

/** Voice and speaking speed for the current language; a short sample plays after every change. */
function VoicePicker({ voices, onPreview }) {
  const [lang] = useLang()
  const [prefs, setPrefs] = useState(voicePrefs)
  const list = voices?.[lang] || []
  if (!list.length) return null
  const voice = list.some((v) => v.key === prefs[lang]) ? prefs[lang] : (voices[`default_${lang}`] || list[0].key)
  const speed = voices.speeds.includes(prefs.speed) ? prefs.speed : voices.default_speed
  const change = (patch) => { setPrefs(setVoicePrefs(patch)); onPreview() }
  const speedNames = [t('speedCalm'), t('speedNormal'), t('speedBrisk')]
  return (
    <span className="voice-picker">
      <Icon name="speaker" size={14} />
      <select value={voice} onChange={(e) => change({ [lang]: e.target.value })} aria-label={t('voiceLabel')} title={t('voiceLabel')}>
        {list.map((v) => <option key={v.key} value={v.key}>{v.fish ? v.name : `${v.name} · ${t('standardVoice')}`}</option>)}
      </select>
      <select value={speed} onChange={(e) => change({ speed: Number(e.target.value) })} aria-label={t('speedLabel')} title={t('speedLabel')}>
        {voices.speeds.map((s, i) => <option key={s} value={s}>{speedNames[i] || s}</option>)}
      </select>
    </span>
  )
}

/** "Try again" — counts down first while a free usage limit resets. */
function RetryButton({ seconds, onRetry }) {
  const [left, setLeft] = useState(Math.ceil(seconds || 0))
  useEffect(() => {
    if (left <= 0) return undefined
    const timer = setTimeout(() => setLeft((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [left])
  return (
    <button className="btn small" onClick={onRetry} disabled={left > 0}>
      <Icon name="history" size={14} /> {left > 0 ? t('retryIn', { s: left }) : t('retry')}
    </button>
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
const BULLET = /^\s*([-*•]|\d+\.)\s+/
const isRule = (l) => /^\s*([-*_]\s*){3,}$/.test(l)
const cellsOf = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
const isSeparator = (row) => cellsOf(row).every((c) => /^:?-{2,}:?$/.test(c))

function inline(line) {
  return line.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|https?:\/\/\S+)/g).map((part, k) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={k}>{part.slice(2, -2)}</strong>
    if (/^\*[^*\s][^*]*\*$/.test(part)) return <em key={k}>{part.slice(1, -1)}</em>
    if (/^https?:\/\//.test(part)) return <a key={k} href={part} target="_blank" rel="noreferrer">{part.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)}</a>
    return part
  })
}

function mdTable(rows, key) {
  const data = rows.filter((r) => !isSeparator(r)).map(cellsOf)
  const hasHead = rows.length > 1 && isSeparator(rows[1])
  const [head, ...body] = hasHead ? data : [null, ...data]
  return (
    <div key={key} className="md-table-wrap">
      <table className="md-table">
        {head && <thead><tr>{head.map((c, i) => <th key={i}>{inline(c)}</th>)}</tr></thead>}
        <tbody>{body.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

/* Small, safe Markdown: paragraphs, bullet lists, headings, tables, **bold**, *italic*, links. */
function renderText(text) {
  const out = []
  const lines = text.split('\n')
  let para = []
  const flush = () => {
    if (para.length) out.push(<p key={out.length}>{para.map((l, k) => <span key={k}>{k > 0 && <br />}{inline(l)}</span>)}</p>)
    para = []
  }
  for (let i = 0; i < lines.length;) {
    const line = lines[i]
    if (!line.trim() || isRule(line)) { flush(); i++; continue }
    if (/^\s*#{1,6}\s+/.test(line)) {
      flush()
      out.push(<h4 key={out.length} className="md-h">{inline(line.replace(/^\s*#{1,6}\s+/, ''))}</h4>)
      i++
      continue
    }
    if (/^\s*\|/.test(line)) {
      flush()
      const rows = []
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++])
      out.push(mdTable(rows, out.length))
      continue
    }
    if (BULLET.test(line)) {
      flush()
      const items = []
      while (i < lines.length && BULLET.test(lines[i])) items.push(lines[i++].replace(BULLET, ''))
      out.push(<ul key={out.length}>{items.map((l, k) => <li key={k}>{inline(l)}</li>)}</ul>)
      continue
    }
    para.push(line)
    i++
  }
  flush()
  return out
}
