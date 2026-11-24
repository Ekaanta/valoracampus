const TOKEN_KEY = 'simon_token'

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}

export function setToken(token) {
  try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY) } catch { /* private mode */ }
}

function headers(extra = {}) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() || ''}`, ...extra }
}

async function check(res) {
  if (res.status === 401) {
    setToken(null)
    window.dispatchEvent(new Event('simon-logout'))
    throw new Error('Not logged in')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    // HTTP/2 hosts (Vercel) send no status text, so always fall back to a readable message.
    throw new Error(body.detail || res.statusText || `The server had a problem (error ${res.status}). Please try again.`)
  }
  return res
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await check(await fetch(`/api${path}`, { method, headers: headers(), body: body && JSON.stringify(body) }))
  return res.json()
}

export async function login(password) {
  const res = await fetch('/api/auth/login', { method: 'POST', headers: headers(), body: JSON.stringify({ password }) })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(res.status === 401 ? 'Wrong password' : body.detail || 'Login failed')
  }
  const { token } = await res.json()
  setToken(token)
}

/** POST /api/chat and call onEvent for every server-sent event. */
export async function streamChat(body, onEvent, signal) {
  const res = await check(await fetch('/api/chat', { method: 'POST', headers: headers(), body: JSON.stringify(body), signal }))
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      if (line.startsWith('data: ')) onEvent(JSON.parse(line.slice(6)))
    }
  }
}

/** Simon's voice for one piece of text: MP3 (standard voice) or streamed raw PCM (Fish Audio). */
export async function ttsFetch(text, lang, voiceKey, speed) {
  const body = JSON.stringify({ text, lang, voice_key: voiceKey, speed })
  return check(await fetch('/api/tts', { method: 'POST', headers: headers(), body }))
}

export async function transcribe(blob, lang) {
  const form = new FormData()
  const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : blob.type.includes('wav') ? 'wav' : 'webm'
  form.append('file', blob, `speech.${ext}`) // iPhones record mp4, Chrome/Firefox webm or ogg
  if (lang) form.append('language', lang)
  const res = await check(await fetch('/api/stt', { method: 'POST', headers: { Authorization: `Bearer ${getToken() || ''}` }, body: form }))
  return (await res.json()).text
}
