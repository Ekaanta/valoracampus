import { transcribe, ttsAudio } from './api.js'

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

function plain(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[Action #\d+[^\]]*\]/g, '')
    .replace(/[*_#>`]/g, '')
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

function playBuffer(buffer, setStop) {
  return new Promise((resolve) => {
    const src = ctx.createBufferSource()
    src.buffer = buffer
    if (!analyser) {
      analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.4
      levels = new Uint8Array(analyser.frequencyBinCount)
      analyser.connect(ctx.destination)
    }
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
      // the first piece is short so Simon starts quickly; later pieces are longer (fewer requests)
      while ((end = cutAt(pending, queue.length || started ? 70 : 20)) > 0) {
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
      queue.length = 0
      pending = ''
      stopCurrent?.()
      finish()
    },
  }

  function enqueue(text) {
    const clean = plain(text)
    if (!clean) return
    // the audio is fetched right away, so the next sentence is ready when the current one ends
    const audio = ctx
      ? ttsAudio(clean, lang?.slice(0, 2)).then((blob) => blob.arrayBuffer()).then((data) => ctx.decodeAudioData(data)).catch(() => null)
      : Promise.resolve(null)
    queue.push({ text: clean, audio })
  }

  async function run() {
    if (running || speaker.stopped) return
    running = true
    while (!speaker.stopped && queue.length) {
      const item = queue.shift()
      const buffer = await item.audio
      if (speaker.stopped) break
      if (!started) { started = true; onStart?.() }
      onSentence?.(item.text)
      if (buffer) await playBuffer(buffer, (fn) => { stopCurrent = fn })
      else await browserSay(item.text, lang, (fn) => { stopCurrent = fn })
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
