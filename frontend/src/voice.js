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
  return recordAndTranscribe()
}

function recordAndTranscribe() {
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
    return transcribe(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
  })()
  return { promise, stop: () => recorder?.state === 'recording' && recorder.stop() }
}

/* ---------------------------------------------------------------- speaking
 * Audio is played through one AudioContext that is unlocked on the first tap,
 * because iOS and Android block audio that starts after an async fetch.
 */
let ctx = null
let source = null
let finishCurrent = null
let analyser = null
let levels = null

/** Loudness of Simon's voice right now (0–1), or null when nothing is playing through the audio context. */
export function voiceLevel() {
  if (!source || !analyser) return null
  analyser.getByteTimeDomainData(levels)
  let sum = 0
  for (let i = 0; i < levels.length; i++) { const v = (levels[i] - 128) / 128; sum += v * v }
  return Math.min(1, Math.sqrt(sum / levels.length) * 3.2)
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
  try { source?.stop() } catch { /* already stopped */ }
  source = null
  finishCurrent?.()
  window.speechSynthesis?.cancel()
}

function plain(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[Action #\d+[^\]]*\]/g, '')
    .replace(/[*_#>`]/g, '')
    .replace(/https?:\/\/\S+/g, 'link')
    .trim()
}

/** Speaks text with the server's natural voice; falls back to the browser voice. Resolves when done. */
export async function speak(text, lang) {
  stopSpeaking()
  const clean = plain(text)
  if (!clean) return
  try {
    if (!ctx) throw new Error('no audio context')
    const data = await (await ttsAudio(clean)).arrayBuffer()
    const buffer = await ctx.decodeAudioData(data)
    await new Promise((resolve) => {
      source = ctx.createBufferSource()
      source.buffer = buffer
      if (!analyser) {
        analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        levels = new Uint8Array(analyser.fftSize)
        analyser.connect(ctx.destination)
      }
      source.connect(analyser) // the reactor reads the voice level from here
      finishCurrent = () => { finishCurrent = null; resolve() }
      source.onended = () => { source = null; finishCurrent?.() }
      source.start()
    })
  } catch {
    if (!window.speechSynthesis) return
    await new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(clean)
      u.lang = lang
      u.onend = u.onerror = resolve
      window.speechSynthesis.speak(u)
    })
  }
}
