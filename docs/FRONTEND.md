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
| When talking over Simon counts as an interruption | `frontend/src/voice.js` | the `BARGE_IN` block (how long and how loud the user must speak, how long a pause ends the sentence) |
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

## Interrupting Simon (barge-in)

While Simon speaks, the microphone stays open (with the browser's echo cancellation). When you talk over
him for about a quarter of a second, he stops at once, records what you say until a short pause, and
answers it. He is told how much of his previous answer you heard, so he does not repeat it and can carry
on from there ("go on", "and the price?"). The switch **Unterbrechen / Interrupt** under the input turns it
off; tapping the sphere still stops him at any time.

If a device stops Simon by itself (his own voice comes back through the microphone) or does not react
to you, tune it there: open the browser console and run `localStorage.simon_barge_debug = '1'`, reload,
let Simon speak, then look at `window.__bargeLog` (`mic` = your level, `threshold` = what is needed,
`simon` = his loudness). Raise `minLevel` or `overEcho` in `BARGE_IN` if he stops by himself, lower them
if he does not hear you. Headphones avoid the echo completely.

## Publishing a change

```bash
git add -A
git commit -m "Describe your change"
git push
```

A minute later the new version is live.
