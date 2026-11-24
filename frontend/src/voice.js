import { transcribe, ttsFetch } from './api.js'

const Recognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)

/**
 * Listens once and resolves with the spoken text.
 * Uses the browser's built-in recognition (Chrome, Edge, Safari); otherwise records
 * audio and sends it to the server (FreeLLMAPI or Groq Whisper).
 */
export function listen(lang, { onInterim } = {}) {
  if (Recognition) {
    let rec
    const promise = new Promise((resolve, reject) => {
      rec = new Recognition()
      rec.lang = lang
      rec.interimResults = true
      rec.continuous = false
      let finalText = ''
      rec.onresult = (e) => {
        let interim = ''
        for (const r of e.results) {
          if (r.isFinal) finalText = r[0].transcript
          else interim += r[0].transcript
        }
        onInterim?.(finalText || interim)
      }
      rec.onerror = (e) => (e.error === 'no-speech' || e.error === 'aborted' ? resolve('') : reject(new Error(e.error)))
      rec.onend = () => resolve(finalText.trim())
      rec.start()
    })
    return { promise, stop: () => rec?.stop() }
  }
  return recordAndTranscribe(lang)
}

function recordAndTranscribe(lang) {
  let recorder
  const promise = (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    recorder = new MediaRecorder(stream)
    const chunks = []
    recorder.ondataavailable = (e) => chunks.push(e.data)
    const stopped = new Promise((r) => (recorder.onstop = r))
    recorder.start()
    setTimeout(() => recorder.state === 'recording' && recorder.stop(), 15000)
    await stopped
    stream.getTracks().forEach((t) => t.stop())
    return transcribe(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }), lang?.slice(0, 2))
  })()
  return { promise, stop: () => recorder?.state === 'recording' && recorder.stop() }
}

/* ---------------------------------------------------------------- speaking
 * Simon speaks sentence by sentence: the first sentence is sent to the voice as soon as it is
 * written, the next ones are fetched while the current one plays. So he starts talking about one
 * sentence after the answer begins, instead of after the whole answer and the whole audio.
 * Audio runs through one AudioContext that is unlocked on the first tap (iOS and Android block
 * audio that starts after an async fetch); its analyser gives the sphere the voice loudness.
 */
let ctx = null
let source = null // the audio piece playing right now
let analyser = null
let levels = null
let browserVoice = false // true while the browser's own voice speaks (no analyser available)
let active = null // the speaker that is talking right now

/* The chosen voice per language and the speaking speed, saved on this device: { de: 'jens', en: 'jarvis', speed: 0.9 } */
const PREFS = 'simon_voice'
export function voicePrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS)) || {} } catch { return {} }
}
export function setVoicePrefs(patch) {
  const next = { ...voicePrefs(), ...patch }
  try { localStorage.setItem(PREFS, JSON.stringify(next)) } catch { /* private mode */ }
  return next
}

/**
 * Loudness of Simon's voice right now, as the sphere expects it ("target", 0 to 0.7; 0 between words
 * and sentences), or null while the browser's own voice is used. Formula from the client's sphere spec.
 */
export function voiceLevel() {
  if (source && analyser) {
    analyser.getByteFrequencyData(levels)
    let s = 0
    for (let i = 4; i < 64; i++) s += levels[i]
    const l = Math.min(1, (s / 60 / 255) * 2.4)
    return l < 0.06 ? 0 : Math.min(0.7, l * 0.75)
  }
  return browserVoice ? null : 0
}

export function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    ctx = ctx || new AC()
    if (ctx.state === 'suspended') ctx.resume()
  } catch { /* audio not available */ }
}

export function stopSpeaking() {
  active?.stop()
  window.speechSynthesis?.cancel()
}

/**
 * Text as it should be spoken: no Markdown signs, no emoji, table rows as short sentences,
 * "€50k" as "50 thousand euros" and "50–55" as "50 to 55" (the voice would read the symbols).
 */
function plain(text, lang) {
  const de = (lang || '').startsWith('de')
  const thousand = de ? ' Tausend' : ' thousand'
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[Action #\d+[^\]]*\]/g, '')
    .split('\n').map((line, i, all) => {
      const separator = (l) => /^\s*\|[\s|:-]*$/.test(l || '')
      if (/^\s*([-*_]\s*){3,}$/.test(line)) return '' // horizontal rule
      if (separator(line)) return '' // table separator |---|---|
      if (/^\s*\|/.test(line) && separator(all[i + 1])) return '' // table header row
      if (/^\s*#{1,6}\s+/.test(line)) { // a heading becomes its own short sentence (a pause after it)
        return line.replace(/^\s*#{1,6}\s+/, '').trim().replace(/[.:!?]?$/, '.')
      }
      let l = line
      if (/^\s*\|/.test(l)) { // table row -> "cell: cell."
        l = l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()).filter(Boolean).join(': ') + '.'
      }
      return l
    }).join('\n')
    .replace(/\p{Extended_Pictographic}\uFE0F?/gu, '')
    .replace(/(\d\s?k?)\s?[–—]\s?(?=[€$]?\s?\d)/gi, `$1 ${de ? 'bis' : 'to'} `)
    .replace(/(?:€|EUR)\s?(\d+(?:[.,]\d+)?)\s?k\b/gi, `$1${thousand} ${de ? 'Euro' : 'euros'}`)
    .replace(/\$\s?(\d+(?:[.,]\d+)?)\s?k\b/gi, `$1${thousand} ${de ? 'Dollar' : 'dollars'}`)
    .replace(/(\d+(?:[.,]\d+)?)\s?k\s?(?:€|EUR)/gi, `$1${thousand} ${de ? 'Euro' : 'euros'}`)
    .replace(/[*_#>`|]/g, '')
    .replace(/https?:\/\/\S+/g, 'Link')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Where the text can be cut after at least `min` characters: after . ! ? … : ; followed by a space,
 * or at a line break. A dot after a digit is skipped ("24. November", "1. Platz").
 */
function cutAt(text, min) {
  const boundary = /[.!?…:;](?=\s)|\n+/g
  let m
  while ((m = boundary.exec(text))) {
    const end = m.index + m[0].length
    if (text[m.index] === '.' && /\d/.test(text[m.index - 1] || '')) continue
    if (end >= min) return end
  }
  return -1
}

function ensureAnalyser() {
  if (analyser) return
  analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  analyser.smoothingTimeConstant = 0.4
  levels = new Uint8Array(analyser.frequencyBinCount)
  analyser.connect(ctx.destination)
}

// At most two voice requests at a time (Fish Audio's free tier allows five in parallel).
let busySlots = 0
const waitingSlots = []
function slot() {
  return new Promise((resolve) => {
    const give = () => {
      busySlots++
      let freed = false
      resolve(() => { if (freed) return; freed = true; busySlots--; waitingSlots.shift()?.() })
    }
    if (busySlots < 2) give()
    else waitingSlots.push(give)
  })
}

/** Plays raw 16-bit mono PCM while it is still arriving (Fish Audio), in pieces of ~120 ms. */
async function playPcm(res, rate, setStop) {
  ensureAnalyser()
  const reader = res.body.getReader()
  const nodes = new Set()
  let stopped = false
  let at = ctx.currentTime + 0.12 // a small head start against network jitter
  let carry = -1 // a byte left over when a network chunk ends in the middle of a sample
  let batch = []
  let batchLen = 0
  const minLen = Math.round(rate * 0.12)
  setStop(() => {
    stopped = true
    reader.cancel().catch(() => {})
    nodes.forEach((n) => { try { n.stop() } catch { /* not started */ } })
  })
  const flush = () => {
    if (!batchLen || stopped) return
    const samples = new Float32Array(batchLen)
    let o = 0
    for (const b of batch) { samples.set(b, o); o += b.length }
    batch = []
    batchLen = 0
    const buf = ctx.createBuffer(1, samples.length, rate)
    buf.copyToChannel(samples, 0)
    const node = ctx.createBufferSource()
    node.buffer = buf
    node.connect(analyser) // the sphere reads the voice level from here
    if (at < ctx.currentTime + 0.02) at = ctx.currentTime + 0.02
    node.start(at)
    at += buf.duration
    nodes.add(node)
    node.onended = () => nodes.delete(node)
    source = node
  }
  for (;;) {
    let r
    try { r = await reader.read() } catch { break }
    if (r.done || stopped) break
    let bytes = r.value
    if (carry >= 0) {
      const joined = new Uint8Array(bytes.length + 1)
      joined[0] = carry
      joined.set(bytes, 1)
      bytes = joined
      carry = -1
    }
    if (bytes.length % 2) { carry = bytes[bytes.length - 1]; bytes = bytes.subarray(0, bytes.length - 1) }
    const n = bytes.length / 2
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length)
    const f = new Float32Array(n)
    for (let i = 0; i < n; i++) f[i] = view.getInt16(i * 2, true) / 32768
    batch.push(f)
    batchLen += n
    if (batchLen >= minLen) flush()
  }
  flush()
  while (!stopped && ctx.currentTime < at - 0.01) await new Promise((r) => setTimeout(r, 40))
  source = null
}

function playBuffer(buffer, setStop) {
  return new Promise((resolve) => {
    const src = ctx.createBufferSource()
    src.buffer = buffer
    ensureAnalyser()
    src.connect(analyser) // the sphere reads the voice level from here
    source = src
    src.onended = () => { if (source === src) source = null; resolve() }
    setStop(() => { try { src.stop() } catch { resolve() } })
    src.start()
  })
}

function browserSay(text, lang, setStop) {
  if (!window.speechSynthesis) return Promise.resolve()
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = lang
    browserVoice = true
    u.onend = u.onerror = () => { browserVoice = false; resolve() }
    setStop(() => window.speechSynthesis.cancel())
    window.speechSynthesis.speak(u)
  })
}

/**
 * A speaker for one answer. push() text as it streams in, end() when the answer is complete.
 * `done` resolves when everything has been spoken (or stop() was called; then `stopped` is true).
 * onStart() fires when the first word becomes audible, onSentence(text) for every piece spoken.
 */
export function createSpeaker(lang, { onStart, onSentence } = {}) {
  stopSpeaking()
  const queue = []
  let pending = ''
  let ended = false
  let running = false
  let started = false
  let finished = false
  let stopCurrent = null
  let resolveDone
  const speaker = {
    stopped: false,
    done: new Promise((r) => { resolveDone = r }),
    push(text) {
      if (speaker.stopped || ended || !text) return
      pending += text
      let end
      // The first piece is short so Simon starts quickly. Later pieces hold two or three sentences,
      // so the voice keeps a natural melody across them instead of restarting every sentence.
      while ((end = cutAt(pending, queue.length || started ? 170 : 20)) > 0) {
        enqueue(pending.slice(0, end))
        pending = pending.slice(end)
      }
      run()
    },
    end() {
      if (ended) return
      ended = true
      if (pending.trim()) enqueue(pending)
      pending = ''
      if (!running) queue.length ? run() : finish()
    },
    stop() {
      if (speaker.stopped) return
      speaker.stopped = true
      for (const item of queue) { // free waiting requests and close their audio streams
        item.release?.()
        item.audio.then((a) => a?.pcm?.body?.cancel().catch(() => {}))
      }
      queue.length = 0
      pending = ''
      stopCurrent?.()
      finish()
    },
  }

  function enqueue(text) {
    const clean = plain(text, lang)
    if (!clean) return
    // the audio is requested right away, so the next sentence is ready when the current one ends
    const item = { text: clean, release: null }
    item.audio = ctx
      ? slot().then((release) => {
        item.release = release
        if (speaker.stopped) { release(); return null }
        const short = (lang || 'de').slice(0, 2)
        const prefs = voicePrefs()
        return ttsFetch(clean, short, prefs[short], prefs.speed).then(async (res) => {
          if ((res.headers.get('Content-Type') || '').includes('audio/pcm')) {
            return { pcm: res, rate: Number(res.headers.get('X-Sample-Rate')) || 24000 } // Fish Audio, streamed
          }
          return { buffer: await ctx.decodeAudioData(await res.arrayBuffer()) } // standard voice, one MP3
        })
      }).catch(() => null)
      : Promise.resolve(null)
    queue.push(item)
  }

  async function run() {
    if (running || speaker.stopped) return
    running = true
    while (!speaker.stopped && queue.length) {
      const item = queue.shift()
      const audio = await item.audio
      if (!speaker.stopped) {
        if (!started) { started = true; onStart?.() }
        onSentence?.(item.text)
        const setStop = (fn) => { stopCurrent = fn }
        if (audio?.pcm) await playPcm(audio.pcm, audio.rate, setStop)
        else if (audio?.buffer) await playBuffer(audio.buffer, setStop)
        else await browserSay(item.text, lang, setStop)
      } else audio?.pcm?.body?.cancel().catch(() => {}) // stopped before it played
      item.release?.()
    }
    running = false
    if (speaker.stopped || (ended && !queue.length)) finish()
  }

  function finish() {
    if (finished) return
    finished = true
    speaker.finished = true
    if (active === speaker) active = null
    resolveDone()
  }

  active = speaker
  return speaker
}

/** Speaks a finished text (replay button, reminders). Resolves when done. */
export function speak(text, lang, callbacks) {
  const speaker = createSpeaker(lang, callbacks)
  speaker.push(text)
  speaker.end()
  return speaker.done
}

/* ---------------------------------------------------------------- the conversation microphone
 * A real conversation: one tap opens the microphone and it stays open, like a phone call, until the
 * next tap. Whenever the user talks, Simon notices it within a fraction of a second, also while he is
 * thinking or speaking (then he stops at once). The user's words are recorded with the moment before
 * the detection (so the first word is not lost) until a real pause, then written out on the server
 * (Whisper). A short breath in the middle of a sentence does not end it.
 * The browser's echo cancellation removes most of Simon's own voice from the microphone. What is left
 * is compared with how loud Simon is right now, so his own voice does not count as the user talking.
 * The numbers below can be tuned without touching the logic (see docs/FRONTEND.md).
 */
export const MIC = {
  startMs: 200, // this much clear speech starts the user's turn while Simon is silent ...
  startOverSimonMs: 280, // ... and while he speaks (a little longer: what is left of his echo must not do it)
  endSilenceMs: 1300, // the user has finished after this much quiet
  minSpeechMs: 350, // shorter sounds (a cough, a door) are not sent to speech recognition
  maxMs: 30000, // longest single recording
  preRollMs: 500, // kept from just before the detection
  warmupMs: 300, // the first moments after opening only learn the room noise
  minLevel: 0.012, // the quietest level (RMS, 0 to 1) that can count as speech
  overNoise: 3, // speech must be this many times louder than the room noise ...
  overEcho: 2.4, // ... and this many times louder than what is left of Simon's voice
  closeAfterMs: 120000, // the conversation ends by itself after this long without anybody talking
}

export const micSupported = () => typeof window !== 'undefined'
  && !!(navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext))

let userLevel = 0
/** How loud the user is talking right now (RMS, 0 to 1; the sphere moves with it), 0 while they are silent. */
export const micLevel = () => userLevel

let outBuf = null
/** How loud Simon's voice leaves the speakers right now (RMS, 0 to 1). */
function outputLevel() {
  if (browserVoice) return 0.15 // the browser's own voice cannot be measured: assume a normal level
  if (!analyser) return 0
  if (!outBuf || outBuf.length !== analyser.fftSize) outBuf = new Uint8Array(analyser.fftSize)
  analyser.getByteTimeDomainData(outBuf)
  let s = 0
  for (let i = 0; i < outBuf.length; i++) { const v = (outBuf[i] - 128) / 128; s += v * v }
  return Math.sqrt(s / outBuf.length)
}

/** 16 kHz mono 16-bit WAV (what speech recognition expects) from microphone frames at `rate`. */
function toWav(frames, rate) {
  const total = frames.reduce((n, f) => n + f.length, 0)
  const all = new Float32Array(total)
  let o = 0
  for (const f of frames) { all.set(f, o); o += f.length }
  let peak = 0
  for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(all[i]))
  const gain = peak > 0 ? Math.min(20, 0.9 / peak) : 1 // recorded without automatic gain: make it clearly audible
  const step = rate / 16000
  const n = Math.floor(total / step)
  const view = new DataView(new ArrayBuffer(44 + n * 2))
  const text = (at, s) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)) }
  text(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) { // average over each step: a simple filter against aliasing
    const a = Math.floor(i * step)
    const b = Math.max(a + 1, Math.min(total, Math.floor((i + 1) * step)))
    let s = 0
    for (let j = a; j < b; j++) s += all[j]
    const v = Math.max(-1, Math.min(1, (s / (b - a)) * gain))
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true)
  }
  return new Blob([view.buffer], { type: 'audio/wav' })
}

/**
 * Opens the microphone for a conversation. onSpeech() fires the moment the user starts talking (return
 * false to ignore it, e.g. when talking over Simon is switched off); onUtterance(wav, speechMs) fires after
 * the pause that ends what they said. Resolves with { close(), finish(), talking }, or null when there is
 * no microphone (or the user did not allow it).
 */
export async function openMic({ onSpeech, onUtterance }) {
  unlockAudio()
  if (!ctx || !micSupported()) return null
  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // No automatic gain: it would raise what is left of Simon's echo until it sounds like the user.
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 },
    })
  } catch { return null }
  const M = MIC
  const rate = ctx.sampleRate
  const size = 2048
  const frameMs = (size / rate) * 1000
  const source = ctx.createMediaStreamSource(stream)
  const proc = ctx.createScriptProcessor(size, 1, 1)
  const mute = ctx.createGain()
  mute.gain.value = 0 // the processor only runs when connected to the output; nothing is heard
  source.connect(proc)
  proc.connect(mute)
  mute.connect(ctx.destination)

  // For tuning on a real device: localStorage.simon_mic_debug = '1' keeps every measurement in window.__micLog
  let debug = false
  try { debug = localStorage.getItem('simon_mic_debug') === '1' } catch { /* private mode */ }
  if (debug) window.__micLog = []
  const opened = performance.now()
  let closed = false
  let talking = false
  let floor = null // room noise
  let echo = 0.25 // how much of Simon's voice reaches the microphone after echo cancellation (learned)
  let outHold = 0 // Simon's recent loudness (his echo arrives a little later than the sound leaves)
  const windowFrames = Math.max(4, Math.round(500 / frameMs))
  const recent = [] // loud or not, for the last half second
  let quietMs = 0
  let speechMs = 0
  let frames = [] // the pre-roll while waiting, the recording while the user talks
  let length = 0

  const close = () => {
    if (closed) return
    closed = true
    talking = false
    userLevel = 0
    proc.onaudioprocess = null
    try { source.disconnect(); proc.disconnect(); mute.disconnect() } catch { /* already disconnected */ }
    stream.getTracks().forEach((tr) => tr.stop())
  }
  const finish = () => {
    if (!talking) return
    const recorded = frames
    const said = speechMs
    talking = false
    userLevel = 0
    frames = []
    length = 0
    onUtterance?.(toWav(recorded, rate), said)
  }

  proc.onaudioprocess = (e) => {
    if (closed) return
    const x = new Float32Array(e.inputBuffer.getChannelData(0)) // a copy: the browser reuses the buffer
    let s = 0
    for (let i = 0; i < x.length; i++) s += x[i] * x[i]
    const r = Math.sqrt(s / x.length)
    frames.push(x)
    length += x.length
    outHold = Math.max(outputLevel(), outHold * 0.8)
    if (floor === null) floor = r
    const threshold = Math.max(M.minLevel, floor * M.overNoise, echo * outHold * M.overEcho)
    const loud = r > threshold
    if (debug) {
      window.__micLog.push({ ms: Math.round(performance.now() - opened), talking, mic: +r.toFixed(4),
        threshold: +threshold.toFixed(4), simon: +outHold.toFixed(3), echo: +echo.toFixed(3), noise: +floor.toFixed(4) })
    }

    if (talking) {
      const voiced = r > Math.max(M.minLevel * 0.8, floor * 2)
      userLevel = voiced ? r : userLevel * 0.6
      if (voiced) speechMs += frameMs
      quietMs = voiced ? 0 : quietMs + frameMs
      if (quietMs >= M.endSilenceMs || (length / rate) * 1000 >= M.maxMs) finish()
      return
    }

    // waiting: keep only the last moments as pre-roll
    const keep = Math.ceil((M.preRollMs / 1000) * rate)
    while (length - frames[0].length >= keep) length -= frames.shift().length
    if (!loud) { // learn the room and the echo from moments without the user's voice
      floor = r < floor ? floor * 0.7 + r * 0.3 : floor * 0.98 + r * 0.02
      if (outHold > 0.02) {
        const seen = r / outHold
        echo = Math.min(1.5, echo + (seen - echo) * (seen > echo ? 0.2 : 0.02))
      }
    }
    if (performance.now() - opened < M.warmupMs) return
    // speech in the last half second (a short first word like "Stopp," followed by a breath still counts)
    recent.push(loud)
    if (recent.length > windowFrames) recent.shift()
    const voicedMs = recent.filter(Boolean).length * frameMs
    if (loud && voicedMs >= (outHold > 0.02 ? M.startOverSimonMs : M.startMs)) {
      recent.length = 0
      if (onSpeech?.() === false) return // ignored: keep waiting
      talking = true
      quietMs = 0
      speechMs = voicedMs
    }
  }

  return { close, finish, get talking() { return talking } }
}

/** Whisper writes subtitle credits for noise ("Untertitel im Auftrag des ZDF") or only "hm"; those are not the user. */
export function realSpeech(text) {
  const t = (text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
  if (t.length < 2) return false
  if (/^(hm+|mhm|äh+m?|ah+|oh+|uh+|um+|eh+)$/.test(t)) return false
  return !/untertitel|amara org|im auftrag des|fürs zuschauen|for watching|abonnier|subscribe/.test(t)
}
