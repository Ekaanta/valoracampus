# Changing Simon's interface yourself

The interface is a React app in `frontend/`. Every change you push to GitHub is deployed
automatically (Vercel now, your server later). You do not need to touch the backend for any of
the changes below.

## Try a change on your computer first

```bash
cd frontend
npm install        # once
npm run dev        # opens http://localhost:5173 and reloads on every save
```

The chat needs the backend running too (see the main README); the sphere, colours and texts can be
checked without it.

## Where to change what

| I want to change… | File | What to edit |
|---|---|---|
| The sphere (size, number of nodes and lines, glitter, rays, rotation speed, light pulses) | `frontend/src/Sphere.jsx` | the `SPHERE` block at the top; every value has a comment |
| The sphere's colours | `frontend/src/Sphere.jsx` | `SPHERE.dark` and `SPHERE.light` (RGB values) |
| How strongly the sphere reacts to the voice | `frontend/src/voice.js` | `voiceLevel()` (your formula: bins 4–64, ×2.4, threshold 0.06, max 0.7) |
| How the conversation microphone reacts | `frontend/src/voice.js` | the `MIC` block (how loud and how long you must speak, how long a pause ends your turn, when the conversation closes) |
| Interface colours (background, panels, accent) | `frontend/src/styles.css` | the colour tokens at the top: `:root` = light theme, `:root[data-theme="dark"]` = dark theme |
| Any text, in German or English | `frontend/src/i18n.js` | `DE` and `EN` lists; the key on the left must stay the same |
| Start in German or English | `frontend/src/i18n.js` | the line `return 'de'` near the top |
| Start in the dark or light theme | `frontend/index.html` | the line `var t = 'dark'` |
| Fonts | `frontend/index.html` + `--display`, `--sans`, `--mono` in `styles.css` | Google Fonts link and the three font tokens |
| The layout (top bar, side panels, chat) | `frontend/src/App.jsx` | `Shell` (page layout) and `ChatView` (sphere, conversation, input) |
| Side panels (AI models, telemetry, memory graph, activity) | `frontend/src/hud.jsx` | one function per panel |
| Full pages (Memory, Activity, System, Sessions) | `frontend/src/panels.jsx` | one function per page |
| App name and icon on the phone home screen | `frontend/public/manifest.webmanifest`, `frontend/public/icon.svg` | name, colours, icon |

## The sphere's states

| Simon is… | The sphere |
|---|---|
| at rest | breathes gently; light and dark patches drift; now and then a pulse of light runs through the network |
| listening | breathes a little stronger |
| working | the light pulses run more often (current through the network) |
| speaking | grows slightly and deforms softly with every syllable of the real voice; the inner spheres fade in |

The value that drives it is `target` (0 to 0.7), read from Simon's real voice through the Web
Audio analyser in `voice.js`, exactly as described in your sphere specification.

## Talking with Simon (conversation mode)

One tap on the sphere starts a conversation and the microphone stays open, like a phone call, until
the next tap (or two minutes in which nobody talks). You simply talk; there is nothing to tap between
questions:

- **Simon is silent:** he notices within a fraction of a second that you talk and listens. A short
  breath in the middle of a sentence does not end it; about 1.3 seconds of quiet does.
- **You paused and went on:** if you continue while Simon is still thinking, or has only just begun
  to answer, he stops and waits for the rest; both parts become one question, which replaces the half one.
- **You talk over his answer:** he stops at once and answers what you said. He is told how much of his
  previous answer you heard, so he does not repeat it and can carry on from there ("go on").

**The input box** (two rows, like ChatGPT): new conversation and the voice chip (voice and speaking pace)
on the left; on the right the **mic** for dictation (speak, the words appear in the box, nothing is sent
until you press send) and the **mode button**: the speech bubble switches to text mode, the sound waves
switch to voice mode and start the conversation. As soon as there is text in the box it becomes the send
button.

**Voice mode layout:** the title SIMON stays under the sphere; below it one line for your words and one
line for Simon (bottom menu folded, no frame) or three lines in a rounded box (bottom menu shown). The lines
have a fixed height, so nothing moves while the text changes. On phones and tablets the arrow under the
input folds and unfolds the bottom menu; the choice is kept on the device.

What you say is written out on the server (Whisper, via FreeLLMAPI or Groq). The microphone uses the
browser's echo cancellation; what is left of Simon's own voice is measured against his current
loudness, so it does not count as you talking. Headphones avoid the echo completely.

To tune it for a device (all values are in the `MIC` block in `frontend/src/voice.js`): open the browser
console, run `localStorage.simon_mic_debug = '1'`, reload, have a short conversation, then look at
`window.__micLog` (`mic` = your level, `threshold` = what is needed, `simon` = his loudness). Raise
`minLevel` or `overEcho` if Simon stops by himself, lower them if he does not notice you; raise
`endSilenceMs` if he still answers before you have finished.

## Publishing a change

```bash
git add -A
git commit -m "Describe your change"
git push
```

A minute later the new version is live.
