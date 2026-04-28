# Andromeda Recorder — MVP

A professional screen and video recording application built with vanilla JS,
MediaRecorder API, and WebRTC. No frameworks, no dependencies, no backend.

---

## Project Structure

```
andromeda-recorder/
├── index.html        ← Main application shell + UI markup
├── styles.css        ← Full design system + component styles
├── script.js         ← All recording logic, state management, event binding
└── README.md         ← This file
```

---

## Quick Start (30 seconds)

### Option A — Drag and Drop (Simplest)
1. Download all 3 files into one folder
2. Open `index.html` in **Google Chrome** or **Microsoft Edge**
3. Done — the app runs entirely in the browser

> ⚠️ Firefox partially supports MediaRecorder but does NOT support
> `getDisplayMedia` screen capture in all configurations. Use Chrome or Edge.

### Option B — Local Dev Server (Recommended for development)
If you have Node.js installed:

```bash
# Install a simple static server (one time)
npm install -g serve

# Run it from the project folder
cd andromeda-recorder
serve .

# Open in browser
# → http://localhost:3000
```

Or with Python (no install needed):
```bash
# Python 3
python -m http.server 8080

# Open: http://localhost:8080
```

> 📌 Running via a local server (localhost) is recommended because some
> browsers restrict `getUserMedia` and `getDisplayMedia` on `file://` URLs.

---

## Features

| Feature | Status | Notes |
|---|---|---|
| Full screen capture | ✅ | Via `getDisplayMedia` |
| Window / tab capture | ✅ | User selects in browser dialog |
| 720p / 1080p recording | ✅ | Select in sidebar |
| 30fps / 60fps | ✅ | Select in sidebar |
| Microphone recording | ✅ | With level meter |
| System audio capture | ✅ | Chrome only — user must tick "Share audio" |
| Webcam overlay | ✅ | Draggable, resizable, 4 corner positions |
| Start / Pause / Stop | ✅ | Full state machine |
| Cancel + discard | ✅ | Confirmation dialog |
| Live timer | ✅ | HH:MM:SS + indicator |
| Recording size display | ✅ | Updates live |
| WebM export | ✅ | Default — best compatibility |
| MP4 export | ✅ | Chrome VP8/H264 codec |
| Download to disk | ✅ | Native browser download |
| Trim editor | ✅ | Drag handles + numeric inputs |
| Recordings list | ✅ | With thumbnail preview |
| Watermark overlay | ✅ | Customisable text |
| Keyboard shortcuts | ✅ | Space / S / W / M / Esc |
| Dark theme | ✅ | Professional studio aesthetic |

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Start recording (or Pause/Resume if active) |
| `S` | Stop recording |
| `W` | Toggle webcam overlay on/off |
| `M` | Toggle microphone mute |
| `Esc` | Cancel recording (or close editor modal) |

---

## Browser Compatibility

| Browser | Screen Capture | Mic | System Audio | Recommended |
|---|---|---|---|---|
| Chrome 72+ | ✅ | ✅ | ✅ (tick "Share audio") | ⭐ Yes |
| Edge 79+ | ✅ | ✅ | ✅ | ⭐ Yes |
| Firefox 66+ | ⚠️ Partial | ✅ | ❌ | Use for testing only |
| Safari 14+ | ❌ | ✅ | ❌ | Not recommended |
| Brave | ✅ | ✅ | ✅ | Yes |

---

## How System Audio Works

System audio capture is only available in **Chromium-based browsers**.

1. Enable "System Audio" toggle in the sidebar
2. Click "START"
3. In the browser's screen share dialog, **check the "Share audio" or "Share tab audio" checkbox**
4. Click Share

Without ticking that box, system audio will not be captured (microphone still works).

---

## Output Files

Recordings are saved with a timestamp filename:

```
rec_YYYYMMDD_HHMMSS.webm
rec_YYYYMMDD_HHMMSS.mp4
```

Example: `rec_20250115_143022.webm`

Files are held in browser memory until downloaded. They are lost on page refresh.
**Always download your recordings before closing the tab.**

---

## Trim Editor

The trim editor is a visual start/end point selector.

1. Click **✂ Edit** on any recording in the list
2. Drag the **cyan handles** on the timeline to set start and end
3. Click **▶ Preview Trim** to watch the trimmed segment
4. Click **✂ Export Trimmed** to download

> **Note:** Browser-based trim uses timestamp markers in the filename.
> For frame-accurate cuts without re-encoding, import the downloaded file into
> **DaVinci Resolve** (free), **Kdenlive** (free), or **Adobe Premiere**.
> Full WASM-based trim (using FFmpeg.wasm) is available as a Pro upgrade — see below.

---

## Watermark

1. Toggle "Watermark" in the sidebar Output section
2. Type your brand name in the text field
3. The watermark appears as a subtle overlay in the bottom-right of the preview

---

## Scaling to Pro-Level — Upgrade Path

### 1. Frame-Accurate Trim (FFmpeg WASM)
```bash
npm install @ffmpeg/ffmpeg @ffmpeg/util
```
Replace `EditorModal.exportTrimmed()` with FFmpeg WASM calls:
```js
import { FFmpeg } from '@ffmpeg/ffmpeg';
const ffmpeg = new FFmpeg();
await ffmpeg.load();
await ffmpeg.writeFile('input.webm', await fetchFile(blob));
await ffmpeg.exec(['-i', 'input.webm', '-ss', startSec, '-to', endSec, '-c', 'copy', 'output.webm']);
const data = await ffmpeg.readFile('output.webm');
```

### 2. Cloud Storage (Supabase / S3)
```js
// After recording stops, upload to Supabase Storage
const { data } = await supabase.storage
  .from('recordings')
  .upload(recording.name, blob, { contentType: 'video/webm' });
```

### 3. Electron Desktop App
Wrap with Electron for:
- True system audio capture (via `desktopCapturer`)
- Native file system access (no size limits)
- Menu bar controls
- Auto-updater

```bash
npm install electron electron-builder
```

### 4. Virtual Camera Output
Use the **Screen Capture API** + **Canvas** composition to layer webcam + screen
into a single canvas element, then stream it as a virtual camera.

### 5. Real-Time Compression
```js
// Use VideoEncoder API (Chrome 94+) for hardware-accelerated encoding
const encoder = new VideoEncoder({
  output: (chunk) => { /* write to file */ },
  error:  (e)     => console.error(e),
});
encoder.configure({ codec: 'avc1.42001f', width: 1920, height: 1080, bitrate: 5_000_000 });
```

### 6. Recording Annotations
Add a canvas overlay for drawing arrows, text boxes, and highlights during recording
using the Canvas 2D API composited over the preview video.

### 7. Multi-Track Timeline Editor
Full non-linear editing with multiple video/audio tracks using the Web Audio API
timeline and Canvas rendering — similar to a lightweight DaVinci Resolve in the browser.

---

## Architecture Notes

```
RecorderState     — Single source of truth for all app state
MediaManager      — Acquires + merges streams using Web Audio API
TimerManager      — Elapsed time tracking with pause support
UIController      — DOM updates, driven by state changes only
RecordingsList    — In-memory recording catalogue (with blob URLs)
EditorModal       — Trim UI, drag handles, preview + export
```

### Audio Merging (Web Audio API)
```
Microphone Stream ──┐
                    ├──► AudioContext.createMediaStreamDestination() ──► Final Stream
System Audio Stream ┘
```

### Stream Composition
```
getDisplayMedia() → video tracks ──┐
                                   ├──► MediaStream → MediaRecorder → Blob → Download
Web Audio destination → audio  ────┘
```

---

## Known Limitations

1. **No persistent storage** — recordings live in RAM. Download before closing.
2. **Trim is metadata-only** — not a true re-encode (FFmpeg WASM needed for that).
3. **System audio (macOS)** — Chrome on macOS does not support system audio via getDisplayMedia. Use Loopback or BlackHole audio routing software.
4. **Tab capture audio** — Works well in Chrome when "Share tab audio" is enabled.
5. **Very long recordings** — May exhaust browser memory on low-RAM devices. Consider chunked upload for sessions > 30 minutes.
6. **Mobile** — Screen capture API is not available on mobile browsers. Webcam-only recording works on mobile Chrome/Safari.

---

## License

MIT — free to use, modify, and distribute.
Built for Andromeda Inc Uganda · 2025
