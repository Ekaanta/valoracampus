// Interface language (German by default, English on request). The choice is saved per device.
import { useEffect, useState } from 'react'

const KEY = 'simon_lang'
const listeners = new Set()

export const LANGS = { de: 'Deutsch', en: 'English' }

let current = (() => {
  try { const v = localStorage.getItem(KEY); if (v === 'de' || v === 'en') return v } catch { /* private mode */ }
  return 'de'
})()

/** Locale for dates and numbers, e.g. "de-DE". */
export const locale = () => (current === 'de' ? 'de-DE' : 'en-GB')
/** Language code for speech recognition and the browser voice. */
export const speechLang = () => (current === 'de' ? 'de-DE' : 'en-US')
export const currentLang = () => current

function setLang(lang) {
  current = lang
  try { localStorage.setItem(KEY, lang) } catch { /* private mode */ }
  document.documentElement.lang = lang
  listeners.forEach((fn) => fn(lang))
}

/** [lang, setLang, t] — t('key', {n: 3}) returns the text in the current language. */
export function useLang() {
  const [lang, set] = useState(current)
  useEffect(() => {
    listeners.add(set)
    document.documentElement.lang = current
    return () => listeners.delete(set)
  }, [])
  return [lang, setLang, t]
}

export function t(key, vars) {
  const s = (STR[current] && STR[current][key]) ?? STR.en[key] ?? key
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''))
}

/** Picks the singular or plural key: plural('answer', 3) uses "answers". */
export const plural = (key, n) => t(n === 1 ? key : `${key}s`, { n })

const EN = {
  // shell
  edition: 'Agent OS · personal edition',
  freeMode: 'Free mode · active',
  paidCalls: 'Paid calls · {n}',
  brain: 'AI',
  answersPill: 'Answers · {n}',
  memoriesPill: 'Memories · {n}',
  toolsPill: 'Tools · {n}',
  toLight: 'Switch to light theme', toDark: 'Switch to dark theme',
  lightTheme: 'Light theme', darkTheme: 'Dark theme',
  langSwitch: 'Sprache: Deutsch',
  logout: 'Log out',
  setupTitle: 'Setup not finished.',
  done: 'Done',
  reminder: 'Reminder: {text}',
  tabCore: 'Core', tabSessions: 'Sessions', tabMemory: 'Memory', tabActivity: 'Activity', tabSystems: 'Systems',
  // wings
  neuralCore: 'Neural core', model: '{n} model', models: '{n} models',
  telemetry: 'Telemetry',
  gFree: 'Free', gReliable: 'Reliable', gMemory: 'Memory',
  rQuestions: 'Questions', rTools: 'Tools run', rSwitches: 'Switches', rPaid: 'Paid calls',
  pFree: 'Free', pPaid: 'Paid · asks first', pActive: 'Active', online: 'Online', ready: 'Ready', cooldown: 'Cooling down',
  answer: '{n} answer', answers: '{n} answers',
  noProvider: 'No AI provider is configured yet.',
  secondBrain: 'Second brain', note: '{n} note', notes: '{n} notes',
  nothingLearned: 'Nothing learned yet',
  sessions: 'Sessions', newSession: 'New session', noSessions: 'Your conversations will appear here.',
  liveFeed: 'Live feed', noActivity: 'No activity yet.',
  open: 'Open', delete: 'Delete',
  // categories
  cat_profile: 'profile', cat_preference: 'preference', cat_project: 'project', cat_decision: 'decision', cat_task: 'task', cat_other: 'other',
  // activity kinds
  k_tool: 'tool', k_memory: 'memory', k_llm_failover: 'switch', k_llm_error: 'error', k_approval_requested: 'approval',
  k_approval_executed: 'confirmed', k_approval_rejected: 'rejected', k_paid_approval_needed: 'paid?', k_memory_error: 'error',
  learned: 'Learned {n} new fact(s)',
  failover: '{name} was busy, switched provider',
  limitHit: 'Free usage limit reached', aiDown: 'No AI provider reachable',
  // states
  s_idle: 'Standby', s_listening: 'Listening', s_thinking: 'Working', s_speaking: 'Speaking',
  h_idle: 'Tap the core to talk', h_listening: 'Listening — tap to stop', h_thinking: 'Working on it', h_speaking: 'Speaking — tap to stop',
  morning: 'Good morning', day: 'Good afternoon', evening: 'Good evening',
  online2: 'All systems online.',
  welcomeSub: '{hint}, or type below. Simon remembers what matters and asks before anything that costs money.',
  tagline: 'Personal assistant · Agent OS',
  // chat
  sWeather: 'Weather', qWeather: 'What will the weather be like tomorrow?',
  sMarkets: 'Markets', qMarkets: 'How is Bitcoin doing this week?',
  sReminder: 'Reminder', qReminder: 'Remind me to call the bank in one hour',
  sMemory: 'Memory', qMemory: 'What do you remember about me?',
  new: 'New', startNew: 'Start a new session',
  you: 'You', live: 'live', via: 'via {p}',
  readAloud: 'Read aloud', readAloudLong: 'Read this answer aloud',
  running: 'running', failed: 'failed', finished: 'done',
  thinking: 'Thinking',
  retry: 'Try again', retryIn: 'Try again in {s}s',
  paidNeeded: 'Paid model needed', approval: 'Approval',
  paidBody: 'All free AI providers are busy. Use {provider} ({model}) for this answer?',
  cost: 'Estimated cost: {c}',
  usePaid: 'Use paid model once', notNow: 'Not now',
  mic: 'Microphone: {m}',
  placeholder: 'Message Simon…', listeningPh: 'Listening…', send: 'Send', message: 'Message',
  handsFree: 'Hands-free', enterHint: 'Enter to send · Shift + Enter for a new line',
  maps: 'Open in Google Maps',
  authRequired: 'Authorization required', no: 'No.',
  confirm: 'Confirm', reject: 'Reject',
  st_done: 'Executed', st_failed: 'Not executed', st_rejected: 'Rejected',
  chartAria: '{name} price chart, {dir} {p} percent', up: 'up', down: 'down',
  // tools
  t_get_weather: 'Checking the weather', t_get_crypto: 'Reading crypto markets', t_get_stock: 'Reading stock markets',
  t_web_search: 'Searching the web', t_read_webpage: 'Reading a page', t_show_route: 'Planning the route',
  t_create_reminder: 'Setting a reminder', t_list_reminders: 'Checking reminders', t_cancel_reminder: 'Cancelling a reminder',
  t_remember: 'Saving to memory', t_search_memory: 'Searching memory', t_prepare_crypto_trade: 'Preparing the order',
  t_confirm_action: 'Confirming', t_cancel_action: 'Cancelling',
  // views
  back: 'Core',
  memTitle: 'Memory bank', memCode: '02 · Second brain',
  memSub: 'What Simon knows about you, learned from your conversations. Correct or delete anything at any time.',
  graph: 'Knowledge graph', mem: '{n} memory', mems: '{n} memories',
  searchMem: 'Search memory', newMem: 'Tell Simon something to remember…', newMemAria: 'New memory', category: 'Category',
  store: 'Store', save: 'Save', cancel: 'Cancel', edit: 'Edit', memText: 'Memory text',
  srcAuto: 'learned', srcUser: 'added',
  delMem: 'Delete this memory permanently?',
  noMatch: 'Nothing matches that search.', noMem: 'Nothing stored yet. Simon learns as you talk.',
  actTitle: 'Activity log', actCode: '03 · Every step',
  actSub: 'Every step Simon took: tools used, provider switches, approvals and memories learned.',
  sysTitle: 'Systems', sysCode: '04 · Neural core',
  sysSub: 'Free first. Simon tries these providers in order and moves to the next one when a provider is busy or out of quota. A paid model is only used after you approve it.',
  histTitle: 'Sessions', histCode: '01 · History',
  histSub: 'Every conversation is saved and searchable by Simon. Open one to continue where you left off.',
  delSession: 'Delete “{title}” permanently?',
  // login
  loginNeeded: 'Authorization required', password: 'Password', signIn: 'Sign in',
}

const DE = {
  edition: 'Agent OS · Persönliche Edition',
  freeMode: 'Gratis-Modus · aktiv',
  paidCalls: 'Bezahlte Aufrufe · {n}',
  brain: 'KI',
  answersPill: 'Antworten · {n}',
  memoriesPill: 'Erinnerungen · {n}',
  toolsPill: 'Werkzeuge · {n}',
  toLight: 'Zum hellen Design wechseln', toDark: 'Zum dunklen Design wechseln',
  lightTheme: 'Helles Design', darkTheme: 'Dunkles Design',
  langSwitch: 'Language: English',
  logout: 'Abmelden',
  setupTitle: 'Einrichtung nicht abgeschlossen.',
  done: 'Erledigt',
  reminder: 'Erinnerung: {text}',
  tabCore: 'Kern', tabSessions: 'Sitzungen', tabMemory: 'Gedächtnis', tabActivity: 'Aktivität', tabSystems: 'System',
  neuralCore: 'Neuronaler Kern', model: '{n} Modell', models: '{n} Modelle',
  telemetry: 'Telemetrie',
  gFree: 'Gratis', gReliable: 'Stabil', gMemory: 'Wissen',
  rQuestions: 'Fragen', rTools: 'Werkzeuge', rSwitches: 'Wechsel', rPaid: 'Bezahlt',
  pFree: 'Gratis', pPaid: 'Bezahlt · fragt vorher', pActive: 'Aktiv', online: 'Online', ready: 'Bereit', cooldown: 'Pause',
  answer: '{n} Antwort', answers: '{n} Antworten',
  noProvider: 'Noch kein KI-Anbieter eingerichtet.',
  secondBrain: 'Zweites Gehirn', note: '{n} Notiz', notes: '{n} Notizen',
  nothingLearned: 'Noch nichts gelernt',
  sessions: 'Sitzungen', newSession: 'Neue Sitzung', noSessions: 'Ihre Gespräche erscheinen hier.',
  liveFeed: 'Live-Protokoll', noActivity: 'Noch keine Aktivität.',
  open: 'Öffnen', delete: 'Löschen',
  cat_profile: 'Profil', cat_preference: 'Vorliebe', cat_project: 'Projekt', cat_decision: 'Entscheidung', cat_task: 'Aufgabe', cat_other: 'Sonstiges',
  k_tool: 'Werkzeug', k_memory: 'Gedächtnis', k_llm_failover: 'Wechsel', k_llm_error: 'Fehler', k_approval_requested: 'Freigabe',
  k_approval_executed: 'bestätigt', k_approval_rejected: 'abgelehnt', k_paid_approval_needed: 'bezahlt?', k_memory_error: 'Fehler',
  learned: '{n} neue Information(en) gelernt',
  failover: '{name} war ausgelastet, Anbieter gewechselt',
  limitHit: 'Kostenloses Limit erreicht', aiDown: 'Kein KI-Anbieter erreichbar',
  s_idle: 'Bereit', s_listening: 'Hört zu', s_thinking: 'Arbeitet', s_speaking: 'Spricht',
  h_idle: 'Tippen Sie auf den Kern, um zu sprechen', h_listening: 'Ich höre zu – zum Beenden tippen',
  h_thinking: 'Einen Moment, ich arbeite daran', h_speaking: 'Ich spreche – zum Stoppen tippen',
  morning: 'Guten Morgen', day: 'Guten Tag', evening: 'Guten Abend',
  online2: 'Alle Systeme bereit.',
  welcomeSub: '{hint} oder schreiben Sie unten. Simon merkt sich, was wichtig ist, und fragt nach, bevor etwas Geld kostet.',
  tagline: 'Persönlicher Assistent · Agent OS',
  sWeather: 'Wetter', qWeather: 'Wie wird das Wetter morgen?',
  sMarkets: 'Märkte', qMarkets: 'Wie entwickelt sich Bitcoin diese Woche?',
  sReminder: 'Erinnerung', qReminder: 'Erinnere mich in einer Stunde daran, die Bank anzurufen',
  sMemory: 'Gedächtnis', qMemory: 'Was weißt du über mich?',
  new: 'Neu', startNew: 'Neue Sitzung starten',
  you: 'Sie', live: 'live', via: 'über {p}',
  readAloud: 'Vorlesen', readAloudLong: 'Diese Antwort vorlesen',
  running: 'läuft', failed: 'fehlgeschlagen', finished: 'fertig',
  thinking: 'Denkt nach',
  retry: 'Erneut versuchen', retryIn: 'Erneut in {s} s',
  paidNeeded: 'Bezahltes Modell nötig', approval: 'Freigabe',
  paidBody: 'Alle kostenlosen KI-Anbieter sind ausgelastet. {provider} ({model}) für diese Antwort verwenden?',
  cost: 'Geschätzte Kosten: {c}',
  usePaid: 'Einmal bezahlt nutzen', notNow: 'Jetzt nicht',
  mic: 'Mikrofon: {m}',
  placeholder: 'Nachricht an Simon…', listeningPh: 'Ich höre zu…', send: 'Senden', message: 'Nachricht',
  handsFree: 'Freisprechen', enterHint: 'Enter zum Senden · Umschalt + Enter für eine neue Zeile',
  maps: 'In Google Maps öffnen',
  authRequired: 'Freigabe erforderlich', no: 'Nr.',
  confirm: 'Bestätigen', reject: 'Ablehnen',
  st_done: 'Ausgeführt', st_failed: 'Nicht ausgeführt', st_rejected: 'Abgelehnt',
  chartAria: 'Kursverlauf {name}, {dir} {p} Prozent', up: 'plus', down: 'minus',
  t_get_weather: 'Prüfe das Wetter', t_get_crypto: 'Lese Kryptomärkte', t_get_stock: 'Lese Aktienmärkte',
  t_web_search: 'Suche im Web', t_read_webpage: 'Lese eine Seite', t_show_route: 'Plane die Route',
  t_create_reminder: 'Lege eine Erinnerung an', t_list_reminders: 'Prüfe Erinnerungen', t_cancel_reminder: 'Lösche eine Erinnerung',
  t_remember: 'Speichere im Gedächtnis', t_search_memory: 'Durchsuche das Gedächtnis', t_prepare_crypto_trade: 'Bereite die Order vor',
  t_confirm_action: 'Bestätige', t_cancel_action: 'Breche ab',
  back: 'Kern',
  memTitle: 'Gedächtnis', memCode: '02 · Zweites Gehirn',
  memSub: 'Was Simon über Sie weiß, gelernt aus Ihren Gesprächen. Sie können alles jederzeit korrigieren oder löschen.',
  graph: 'Wissensnetz', mem: '{n} Erinnerung', mems: '{n} Erinnerungen',
  searchMem: 'Gedächtnis durchsuchen', newMem: 'Etwas, das Simon sich merken soll…', newMemAria: 'Neue Erinnerung', category: 'Kategorie',
  store: 'Merken', save: 'Speichern', cancel: 'Abbrechen', edit: 'Bearbeiten', memText: 'Text der Erinnerung',
  srcAuto: 'gelernt', srcUser: 'eingetragen',
  delMem: 'Diese Erinnerung endgültig löschen?',
  noMatch: 'Keine Treffer für diese Suche.', noMem: 'Noch nichts gespeichert. Simon lernt, während Sie sprechen.',
  actTitle: 'Aktivität', actCode: '03 · Jeder Schritt',
  actSub: 'Jeder Schritt von Simon: genutzte Werkzeuge, Anbieterwechsel, Freigaben und gelernte Erinnerungen.',
  sysTitle: 'System', sysCode: '04 · Neuronaler Kern',
  sysSub: 'Kostenlos zuerst. Simon nutzt diese Anbieter der Reihe nach und wechselt zum nächsten, wenn einer ausgelastet ist oder sein Kontingent verbraucht hat. Ein bezahltes Modell wird nur nach Ihrer Freigabe genutzt.',
  histTitle: 'Sitzungen', histCode: '01 · Verlauf',
  histSub: 'Jedes Gespräch wird gespeichert und ist für Simon durchsuchbar. Öffnen Sie eines, um dort weiterzumachen, wo Sie aufgehört haben.',
  delSession: '„{title}“ endgültig löschen?',
  loginNeeded: 'Anmeldung erforderlich', password: 'Passwort', signIn: 'Anmelden',
}

const STR = { en: EN, de: DE }
