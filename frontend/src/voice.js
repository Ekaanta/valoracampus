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
