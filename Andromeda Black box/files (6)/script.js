/**
 * ═══════════════════════════════════════════════════════════════
 *  ANDROMEDA RECORDER — script.js
 *  Web-based Screen & Video Recording Application
 *  Uses: MediaRecorder API, getDisplayMedia, getUserMedia, WebRTC
 * ═══════════════════════════════════════════════════════════════
 *
 *  ARCHITECTURE:
 *  ┌─────────────────────────────────────────────────┐
 *  │  RecorderState  — single source of truth         │
 *  │  MediaManager   — handles streams & merging      │
 *  │  TimerManager   — stopwatch + interval tracking  │
 *  │  RecordingsList — persists recordings in memory  │
 *  │  UIController   — DOM updates, event binding     │
 *  │  EditorModal    — trim UI & export logic         │
 *  └─────────────────────────────────────────────────┘
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   RECORDER STATE
   Central state object — all mutations go through here.
═══════════════════════════════════════════════════════════════ */
const RecorderState = {
  status:         'idle',    // idle | countdown | recording | paused | stopped
  mediaRecorder:  null,
  recordedChunks: [],
  screenStream:   null,
  micStream:      null,
  webcamStream:   null,
  mixedStream:    null,
  audioContext:   null,
  audioDestination: null,
  startTime:      null,
  pausedAt:       null,
  totalPausedMs:  0,
  timerInterval:  null,
  sizeInterval:   null,
  currentBlob:    null,
  micAnalyser:    null,
  micLevelFrame:  null,
};

/* ═══════════════════════════════════════════════════════════════
   RECORDINGS LIST (in-memory, with blob URLs)
═══════════════════════════════════════════════════════════════ */
const RecordingsList = {
  items: [],   // { id, name, blob, url, duration, size, format, timestamp }

  add(blob, durationMs, format) {
    const ts   = new Date();
    const name = `rec_${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.${format}`;
    const url  = URL.createObjectURL(blob);
    const item = {
      id:        Date.now(),
      name,
      blob,
      url,
      duration:  durationMs,
      size:      blob.size,
      format,
      timestamp: ts,
    };
    this.items.unshift(item);
    return item;
  },

  remove(id) {
    const idx = this.items.findIndex(i => i.id === id);
    if (idx === -1) return;
    URL.revokeObjectURL(this.items[idx].url);
    this.items.splice(idx, 1);
  },
};

/* ═══════════════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════════════ */
function pad(n) { return String(n).padStart(2, '0'); }

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDurationShort(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${pad(m)}:${pad(s)}`;
}

/* Show toast notification */
let toastTimeout;
function showToast(message, type = 'info', duration = 3200) {
  const toast = document.getElementById('toast');
  toast.textContent  = message;
  toast.className    = `toast show ${type}`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toast.classList.remove('show'); }, duration);
}

/* ═══════════════════════════════════════════════════════════════
   DOM REFERENCES
═══════════════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);
const DOM = {
  // Controls
  btnStart:         $('btnStart'),
  btnPause:         $('btnPause'),
  btnStop:          $('btnStop'),
  btnCancel:        $('btnCancel'),
  // Timer
  timerDisplay:     $('timerDisplay'),
  timerSub:         $('timerSub'),
  indicatorTimer:   $('indicatorTimer'),
  // Status
  statusPill:       $('statusPill'),
  statusText:       $('statusText'),
  statusSize:       $('statusSize'),
  recIndicator:     $('recIndicator'),
  // Preview
  previewIdle:      $('previewIdle'),
  previewVideo:     $('previewVideo'),
  // Webcam
  webcamOverlay:    $('webcamOverlay'),
  webcamVideo:      $('webcamVideo'),
  webcamResizeHandle: $('webcamResizeHandle'),
  // Overlays
  countdownOverlay: $('countdownOverlay'),
  countdownNum:     $('countdownNum'),
  pausedOverlay:    $('pausedOverlay'),
  watermark:        $('watermark'),
  // Toggles
  screenToggle:     $('screenToggle'),
  micToggle:        $('micToggle'),
  sysAudioToggle:   $('sysAudioToggle'),
  webcamToggle:     $('webcamToggle'),
  watermarkToggle:  $('watermarkToggle'),
  // Options
  screenQuality:    $('screenQuality'),
  frameRate:        $('frameRate'),
  outputFormat:     $('outputFormat'),
  webcamSize:       $('webcamSize'),
  webcamSizeVal:    $('webcamSizeVal'),
  webcamSubOptions: $('webcamSubOptions'),
  watermarkText:    $('watermarkText'),
  watermarkSubOptions: $('watermarkSubOptions'),
  // Recordings
  recordingsList:   $('recordingsList'),
  recordingsCount:  $('recordingsCount'),
  // Mic level
  micLevelFill:     $('micLevelFill'),
  // Editor
  editorBackdrop:   $('editorBackdrop'),
  editorVideo:      $('editorVideo'),
  editorFilename:   $('editorFilename'),
  editorClose:      $('editorClose'),
  trimTimeline:     $('trimTimeline'),
  trimStart:        $('trimStart'),
  trimEnd:          $('trimEnd'),
  trimSelection:    $('trimSelection'),
  trimPlayhead:     $('trimPlayhead'),
  trimStartLabel:   $('trimStartLabel'),
  trimEndLabel:     $('trimEndLabel'),
  trimStartInput:   $('trimStartInput'),
  trimEndInput:     $('trimEndInput'),
  btnPreviewTrim:   $('btnPreviewTrim'),
  btnApplyTrim:     $('btnApplyTrim'),
  btnDownloadOriginal: $('btnDownloadOriginal'),
};

/* ═══════════════════════════════════════════════════════════════
   TIMER MANAGER
═══════════════════════════════════════════════════════════════ */
const TimerManager = {
  start() {
    RecorderState.startTime   = Date.now();
    RecorderState.totalPausedMs = 0;
    this._tick();
    RecorderState.timerInterval = setInterval(() => this._tick(), 250);
  },

  pause() {
    RecorderState.pausedAt = Date.now();
    clearInterval(RecorderState.timerInterval);
    RecorderState.timerInterval = null;
  },

  resume() {
    if (RecorderState.pausedAt) {
      RecorderState.totalPausedMs += Date.now() - RecorderState.pausedAt;
      RecorderState.pausedAt = null;
    }
    RecorderState.timerInterval = setInterval(() => this._tick(), 250);
  },

  stop() {
    clearInterval(RecorderState.timerInterval);
    RecorderState.timerInterval = null;
  },

  reset() {
    this.stop();
    RecorderState.startTime     = null;
    RecorderState.pausedAt      = null;
    RecorderState.totalPausedMs = 0;
    DOM.timerDisplay.textContent = '00:00:00';
    DOM.indicatorTimer.textContent = '00:00';
  },

  _tick() {
    if (!RecorderState.startTime) return;
    const elapsed = Date.now() - RecorderState.startTime - RecorderState.totalPausedMs;
    const formatted = formatDuration(elapsed);
    DOM.timerDisplay.textContent  = formatted;
    DOM.indicatorTimer.textContent = formatted.slice(3); // MM:SS
  },

  getElapsedMs() {
    if (!RecorderState.startTime) return 0;
    const paused = RecorderState.pausedAt
      ? (Date.now() - RecorderState.pausedAt)
      : 0;
    return Date.now() - RecorderState.startTime - RecorderState.totalPausedMs - paused;
  },
};

/* ═══════════════════════════════════════════════════════════════
   MEDIA MANAGER
   Handles stream acquisition, audio merging with Web Audio API,
   and stream teardown.
═══════════════════════════════════════════════════════════════ */
const MediaManager = {

  /**
   * Acquire all requested streams and merge them.
   * Returns: { screenStream, mixedStream } or throws on failure.
   */
  async acquireStreams() {
    const quality  = parseInt(DOM.screenQuality.value, 10);
    const fps      = parseInt(DOM.frameRate.value, 10);
    const useMic   = DOM.micToggle.checked;
    const useSysAudio = DOM.sysAudioToggle.checked;
    const useWebcam   = DOM.webcamToggle.checked;

    /* ── SCREEN CAPTURE ── */
    let screenStream = null;
    if (DOM.screenToggle.checked) {
      const height = quality;
      const width  = quality === 720  ? 1280
                   : quality === 1080 ? 1920
                   : 2560;

      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width:     { ideal: width },
            height:    { ideal: height },
            frameRate: { ideal: fps, max: fps },
          },
          // Request system audio together with screen capture
          audio: useSysAudio,
        });
      } catch (err) {
        if (err.name === 'NotAllowedError') throw new Error('Screen capture permission denied. Please allow screen sharing.');
        throw err;
      }
    }

    /* ── MICROPHONE ── */
    let micStream = null;
    if (useMic) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 48000,
          },
          video: false,
        });
      } catch (err) {
        console.warn('Microphone not available:', err.message);
        showToast('Microphone unavailable — continuing without mic', 'info');
      }
    }

    /* ── WEBCAM ── */
    let webcamStream = null;
    if (useWebcam) {
      try {
        webcamStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
          audio: false,
        });
      } catch (err) {
        console.warn('Webcam not available:', err.message);
        showToast('Webcam not available — continuing without camera', 'info');
      }
    }

    /* ── AUDIO MERGING (Web Audio API) ──
       Combine system audio (from screen capture) + microphone
       into a single destination track.
    */
    const audioCtx  = new AudioContext({ sampleRate: 48000 });
    const destination = audioCtx.createMediaStreamDestination();

    let hasAudio = false;

    // System audio from screen share (Chrome passes audio tracks when user selects "Share audio")
    if (screenStream) {
      const sysAudioTracks = screenStream.getAudioTracks();
      if (sysAudioTracks.length > 0) {
        const sysSource = audioCtx.createMediaStreamSource(new MediaStream(sysAudioTracks));
        sysSource.connect(destination);
        hasAudio = true;
      }
    }

    // Microphone audio
    if (micStream && micStream.getAudioTracks().length > 0) {
      const micSource = audioCtx.createMediaStreamSource(micStream);
      micSource.connect(destination);
      hasAudio = true;

      // Set up analyser for visual level meter
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      micSource.connect(analyser);
      RecorderState.micAnalyser = analyser;
      MediaManager._startMicLevel(analyser);
    }

    /* ── BUILD FINAL MIXED STREAM ──
       Combine video tracks from screen capture with
       merged audio destination track.
    */
    const mixedTracks = [];

    if (screenStream) {
      screenStream.getVideoTracks().forEach(t => mixedTracks.push(t));
    }

    if (hasAudio) {
      destination.stream.getAudioTracks().forEach(t => mixedTracks.push(t));
    }

    const mixedStream = new MediaStream(mixedTracks);

    // Store references for cleanup
    RecorderState.screenStream     = screenStream;
    RecorderState.micStream        = micStream;
    RecorderState.webcamStream     = webcamStream;
    RecorderState.audioContext     = audioCtx;
    RecorderState.audioDestination = destination;

    return { screenStream, micStream, webcamStream, mixedStream };
  },

  /* Visualise mic level in real time */
  _startMicLevel(analyser) {
    const data  = new Uint8Array(analyser.frequencyBinCount);
    const step = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const pct = Math.min(100, (avg / 128) * 100);
      DOM.micLevelFill.style.width = pct + '%';
      RecorderState.micLevelFrame = requestAnimationFrame(step);
    };
    step();
  },

  /* Release all streams and Web Audio resources */
  releaseAll() {
    // Stop mic level animation
    if (RecorderState.micLevelFrame) {
      cancelAnimationFrame(RecorderState.micLevelFrame);
      RecorderState.micLevelFrame = null;
    }
    DOM.micLevelFill.style.width = '0%';
    RecorderState.micAnalyser = null;

    // Stop all stream tracks
    ['screenStream', 'micStream', 'webcamStream'].forEach(key => {
      const s = RecorderState[key];
      if (s) { s.getTracks().forEach(t => t.stop()); RecorderState[key] = null; }
    });

    // Close Web Audio context
    if (RecorderState.audioContext) {
      RecorderState.audioContext.close().catch(() => {});
      RecorderState.audioContext  = null;
      RecorderState.audioDestination = null;
    }

    // Clear preview
    DOM.previewVideo.srcObject = null;

    // Hide webcam overlay
    DOM.webcamVideo.srcObject  = null;
    DOM.webcamOverlay.style.display = 'none';
  },
};

/* ═══════════════════════════════════════════════════════════════
   UI CONTROLLER — state-driven DOM updates
═══════════════════════════════════════════════════════════════ */
const UIController = {

  setState(status) {
    RecorderState.status = status;
    this._updateButtons(status);
    this._updateStatus(status);
    this._updateIndicator(status);
  },

  _updateButtons(status) {
    DOM.btnStart.disabled  = status === 'recording' || status === 'countdown';
    DOM.btnPause.disabled  = status !== 'recording';
    DOM.btnStop.disabled   = status !== 'recording' && status !== 'paused';
    DOM.btnCancel.disabled = status === 'idle';

    DOM.btnStart.classList.toggle('recording', status === 'recording');
    DOM.btnPause.classList.toggle('active', status === 'paused');
  },

  _updateStatus(status) {
    const statusMap = {
      idle:       { dot: 'dot-idle',   text: 'Ready',      sub: 'Duration' },
      countdown:  { dot: 'dot-amber',  text: 'Starting…',  sub: 'Get ready' },
      recording:  { dot: 'dot-rec',    text: 'Recording',  sub: 'Live' },
      paused:     { dot: 'dot-paused', text: 'Paused',     sub: 'On hold' },
      stopped:    { dot: 'dot-done',   text: 'Saved',      sub: 'Complete' },
    };
    const s = statusMap[status] || statusMap.idle;
    DOM.statusText.textContent = s.text;
    DOM.timerSub.textContent   = s.sub;

    const dot = DOM.statusPill.querySelector('.status-dot');
    dot.className  = `status-dot ${s.dot}`;
  },

  _updateIndicator(status) {
    DOM.recIndicator.classList.toggle('visible', status === 'recording' || status === 'paused');
    DOM.pausedOverlay.style.display = status === 'paused' ? 'flex' : 'none';
  },

  showPreview(stream) {
    DOM.previewVideo.srcObject = stream;
    DOM.previewVideo.classList.add('visible');
    DOM.previewIdle.classList.add('hidden');
  },

  hidePreview() {
    DOM.previewVideo.classList.remove('visible');
    DOM.previewIdle.classList.remove('hidden');
  },

  showWebcam(stream, position, sizePx) {
    DOM.webcamVideo.srcObject = stream;
    DOM.webcamOverlay.style.display = 'block';
    this.setWebcamPosition(position, sizePx);
  },

  setWebcamPosition(pos, sizePx) {
    const ov = DOM.webcamOverlay;
    const w  = sizePx || parseInt(DOM.webcamSize.value);
    const h  = Math.round(w * 0.75);  // 4:3 ratio
    ov.style.width  = w + 'px';
    ov.style.height = h + 'px';

    // Reset position vars
    ov.style.top = ov.style.bottom = ov.style.left = ov.style.right = 'auto';
    const margin = '16px';
    if (pos === 'top-left')     { ov.style.top = margin;    ov.style.left   = margin; }
    if (pos === 'top-right')    { ov.style.top = margin;    ov.style.right  = margin; }
    if (pos === 'bottom-left')  { ov.style.bottom = margin; ov.style.left   = margin; }
    if (pos === 'bottom-right') { ov.style.bottom = margin; ov.style.right  = margin; }
  },

  updateSizeDisplay(bytes) {
    DOM.statusSize.textContent = formatSize(bytes);
  },

  renderRecordingsList() {
    const list = RecordingsList.items;
    DOM.recordingsCount.textContent = list.length;

    if (list.length === 0) {
      DOM.recordingsList.innerHTML = `
        <div class="recordings-empty">
          <span>No recordings yet</span>
          <span class="recordings-empty-sub">Start a session to capture your first video</span>
        </div>`;
      return;
    }

    DOM.recordingsList.innerHTML = list.map(item => `
      <div class="rec-card" data-id="${item.id}">
        <div class="rec-card-thumb">
          <video src="${item.url}" preload="metadata"></video>
        </div>
        <div class="rec-card-name" title="${item.name}">${item.name}</div>
        <div class="rec-card-meta">
          <span>${formatDurationShort(item.duration)}</span>
          <span>${formatSize(item.size)}</span>
        </div>
        <div class="rec-card-actions">
          <button class="rec-action-btn" data-action="edit" data-id="${item.id}">✂ Edit</button>
          <button class="rec-action-btn" data-action="download" data-id="${item.id}">↓ Save</button>
          <button class="rec-action-btn delete" data-action="delete" data-id="${item.id}">✕</button>
        </div>
      </div>
    `).join('');
  },
};

/* ═══════════════════════════════════════════════════════════════
   COUNTDOWN
═══════════════════════════════════════════════════════════════ */
function runCountdown(from = 3) {
  return new Promise(resolve => {
    DOM.countdownOverlay.style.display = 'flex';
    let count = from;
    DOM.countdownNum.textContent = count;

    const interval = setInterval(() => {
      count--;
      if (count <= 0) {
        clearInterval(interval);
        DOM.countdownOverlay.style.display = 'none';
        resolve();
      } else {
        DOM.countdownNum.textContent = count;
        // Re-trigger animation
        DOM.countdownNum.style.animation = 'none';
        void DOM.countdownNum.offsetWidth;
        DOM.countdownNum.style.animation = 'countdown-pop 1s ease-in-out';
      }
    }, 1000);
  });
}

/* ═══════════════════════════════════════════════════════════════
   CORE RECORDING WORKFLOW
═══════════════════════════════════════════════════════════════ */

/* ── START ── */
async function startRecording() {
  if (RecorderState.status !== 'idle') return;
  UIController.setState('countdown');

  try {
    // Acquire all streams before countdown so permissions happen first
    const { screenStream, webcamStream, mixedStream } = await MediaManager.acquireStreams();

    // Show screen preview immediately (before countdown)
    if (screenStream) {
      UIController.showPreview(mixedStream || screenStream);
    }

    // Show webcam overlay if available
    if (webcamStream) {
      const pos = document.querySelector('.pos-btn.active')?.dataset.pos || 'bottom-left';
      UIController.showWebcam(webcamStream, pos);
    }

    RecorderState.mixedStream = mixedStream;

    // 3-second countdown
    await runCountdown(3);

    /* ── PICK MIME TYPE ──
       Prefer a well-supported codec for the selected format.
    */
    const fmt = DOM.outputFormat.value;
    const mimeTypes = fmt === 'mp4'
      ? ['video/mp4;codecs=avc1', 'video/webm;codecs=h264', 'video/webm;codecs=vp9', 'video/webm']
      : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

    const supportedMime = mimeTypes.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';
    console.log('Using MIME type:', supportedMime);

    /* ── CREATE MEDIARECORDER ── */
    const mr = new MediaRecorder(mixedStream, {
      mimeType:            supportedMime,
      videoBitsPerSecond:  5_000_000,  // 5 Mbps — good quality at 1080p
      audioBitsPerSecond:  128_000,    // 128 kbps audio
    });

    RecorderState.mediaRecorder  = mr;
    RecorderState.recordedChunks = [];

    // Collect data chunks
    mr.ondataavailable = e => {
      if (e.data && e.data.size > 0) {
        RecorderState.recordedChunks.push(e.data);
        // Update size display
        const totalBytes = RecorderState.recordedChunks.reduce((a, c) => a + c.size, 0);
        UIController.updateSizeDisplay(totalBytes);
      }
    };

    // Handle natural stream ending (user stopped sharing from browser UI)
    mixedStream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (RecorderState.status === 'recording' || RecorderState.status === 'paused') {
        stopRecording();
      }
    });

    mr.start(1000); // Collect data every 1 second
    TimerManager.start();
    UIController.setState('recording');

    // Start file size ticker
    RecorderState.sizeInterval = setInterval(() => {
      const totalBytes = RecorderState.recordedChunks.reduce((a, c) => a + c.size, 0);
      UIController.updateSizeDisplay(totalBytes);
    }, 2000);

    showToast('Recording started! Press Space to pause.', 'info');

  } catch (err) {
    console.error('Failed to start recording:', err);
    UIController.setState('idle');
    UIController.hidePreview();
    MediaManager.releaseAll();
    showToast(err.message || 'Failed to start recording', 'error');
  }
}

/* ── PAUSE / RESUME ── */
function pauseRecording() {
  if (RecorderState.status !== 'recording') return;

  RecorderState.mediaRecorder.pause();
  TimerManager.pause();
  UIController.setState('paused');
  showToast('Recording paused', 'info');
}

function resumeRecording() {
  if (RecorderState.status !== 'paused') return;

  RecorderState.mediaRecorder.resume();
  TimerManager.resume();
  UIController.setState('recording');
  showToast('Recording resumed', 'info');
}

function togglePause() {
  if      (RecorderState.status === 'recording') pauseRecording();
  else if (RecorderState.status === 'paused')    resumeRecording();
}

/* ── STOP ── */
function stopRecording() {
  if (RecorderState.status !== 'recording' && RecorderState.status !== 'paused') return;

  const duration  = TimerManager.getElapsedMs();
  const mr        = RecorderState.mediaRecorder;
  const format    = DOM.outputFormat.value;

  clearInterval(RecorderState.sizeInterval);

  // Wait for final dataavailable event before processing
  mr.onstop = () => {
    const mimeType = mr.mimeType || 'video/webm';
    const blob     = new Blob(RecorderState.recordedChunks, { type: mimeType });
    RecorderState.currentBlob = blob;

    const recording = RecordingsList.add(blob, duration, format);
    UIController.renderRecordingsList();
    UIController.setState('stopped');
    TimerManager.stop();
    UIController.hidePreview();
    MediaManager.releaseAll();

    showToast(`Saved: ${recording.name}`, 'success');

    // Auto-reset to idle after 1.5s
    setTimeout(() => {
      UIController.setState('idle');
      TimerManager.reset();
      DOM.statusSize.textContent = '0.0 MB';
    }, 1500);
  };

  mr.stop();
}

/* ── CANCEL ── */
function cancelRecording() {
  if (RecorderState.status === 'idle') return;

  if (!confirm('Cancel recording? All unsaved data will be lost.')) return;

  clearInterval(RecorderState.sizeInterval);

  if (RecorderState.mediaRecorder && RecorderState.mediaRecorder.state !== 'inactive') {
    RecorderState.mediaRecorder.stop();
  }
  RecorderState.recordedChunks = [];

  TimerManager.reset();
  UIController.setState('idle');
  UIController.hidePreview();
  MediaManager.releaseAll();
  DOM.statusSize.textContent = '0.0 MB';
  showToast('Recording cancelled', 'error');
}

/* ═══════════════════════════════════════════════════════════════
   EDITOR MODAL
   Provides start/end trim UI and downloads clipped segment.
═══════════════════════════════════════════════════════════════ */
const EditorModal = {
  currentItem: null,
  duration:    0,
  startSec:    0,
  endSec:      0,
  isDraggingStart: false,
  isDraggingEnd:   false,

  open(id) {
    const item = RecordingsList.items.find(i => i.id === id);
    if (!item) return;
    this.currentItem = item;

    DOM.editorFilename.textContent = item.name;
    DOM.editorVideo.src   = item.url;
    DOM.editorBackdrop.style.display = 'flex';

    // Wait for metadata to get duration
    DOM.editorVideo.onloadedmetadata = () => {
      this.duration = DOM.editorVideo.duration;
      this.startSec = 0;
      this.endSec   = this.duration;
      DOM.trimStartInput.value = '0';
      DOM.trimEndInput.value   = this.duration.toFixed(1);
      DOM.trimStartInput.max   = DOM.trimEndInput.max = this.duration;
      DOM.trimStartLabel.textContent = '0:00';
      DOM.trimEndLabel.textContent   = formatDurationShort(this.duration * 1000);
      this._updateTrimVisual();
    };

    // Update playhead as video plays
    DOM.editorVideo.ontimeupdate = () => {
      const pct = (DOM.editorVideo.currentTime / this.duration) * 100;
      DOM.trimPlayhead.style.left = pct + '%';
    };

    this._bindTrimHandles();
  },

  close() {
    DOM.editorBackdrop.style.display = 'none';
    DOM.editorVideo.pause();
    DOM.editorVideo.src = '';
    this.currentItem = null;
    this._unbindTrimHandles();
  },

  _updateTrimVisual() {
    const d = this.duration;
    if (!d) return;
    const startPct = (this.startSec / d) * 100;
    const endPct   = (this.endSec   / d) * 100;
    DOM.trimStart.style.left   = startPct + '%';
    DOM.trimEnd.style.right    = (100 - endPct) + '%';
    DOM.trimSelection.style.left  = startPct + '%';
    DOM.trimSelection.style.right = (100 - endPct) + '%';
    DOM.trimStartLabel.textContent = formatDurationShort(this.startSec * 1000);
    DOM.trimEndLabel.textContent   = formatDurationShort(this.endSec * 1000);
    DOM.trimStartInput.value = this.startSec.toFixed(1);
    DOM.trimEndInput.value   = this.endSec.toFixed(1);
  },

  _bindTrimHandles() {
    const timeline = DOM.trimTimeline.querySelector('.trim-track');

    const getTimeFromX = (clientX) => {
      const rect = timeline.getBoundingClientRect();
      const pct  = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return pct * this.duration;
    };

    // Start handle
    this._onStartMouseDown = (e) => {
      this.isDraggingStart = true;
      e.preventDefault();
    };
    this._onEndMouseDown = (e) => {
      this.isDraggingEnd = true;
      e.preventDefault();
    };
    this._onMouseMove = (e) => {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      if (this.isDraggingStart) {
        this.startSec = Math.min(getTimeFromX(clientX), this.endSec - 0.5);
        this.startSec = Math.max(0, this.startSec);
        this._updateTrimVisual();
      }
      if (this.isDraggingEnd) {
        this.endSec = Math.max(getTimeFromX(clientX), this.startSec + 0.5);
        this.endSec = Math.min(this.duration, this.endSec);
        this._updateTrimVisual();
      }
    };
    this._onMouseUp = () => {
      this.isDraggingStart = false;
      this.isDraggingEnd   = false;
    };

    DOM.trimStart.addEventListener('mousedown',  this._onStartMouseDown);
    DOM.trimEnd.addEventListener('mousedown',    this._onEndMouseDown);
    DOM.trimStart.addEventListener('touchstart', this._onStartMouseDown, { passive: false });
    DOM.trimEnd.addEventListener('touchstart',   this._onEndMouseDown, { passive: false });
    document.addEventListener('mousemove',  this._onMouseMove);
    document.addEventListener('touchmove',  this._onMouseMove, { passive: true });
    document.addEventListener('mouseup',    this._onMouseUp);
    document.addEventListener('touchend',   this._onMouseUp);
  },

  _unbindTrimHandles() {
    DOM.trimStart.removeEventListener('mousedown',  this._onStartMouseDown);
    DOM.trimEnd.removeEventListener('mousedown',    this._onEndMouseDown);
    DOM.trimStart.removeEventListener('touchstart', this._onStartMouseDown);
    DOM.trimEnd.removeEventListener('touchstart',   this._onEndMouseDown);
    document.removeEventListener('mousemove',  this._onMouseMove);
    document.removeEventListener('touchmove',  this._onMouseMove);
    document.removeEventListener('mouseup',    this._onMouseUp);
    document.removeEventListener('touchend',   this._onMouseUp);
  },

  previewTrim() {
    DOM.editorVideo.currentTime = this.startSec;
    DOM.editorVideo.play();
    const stopAt = this.endSec;
    const check = () => {
      if (DOM.editorVideo.currentTime >= stopAt) {
        DOM.editorVideo.pause();
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  },

  /* Export trimmed segment using browser download with metadata markers.
     For true frame-accurate cutting we would need FFmpeg (Electron or WASM).
     Here we offer the original file with a clear note.
  */
  exportTrimmed() {
    if (!this.currentItem) return;
    const { blob, name, format } = this.currentItem;

    /* Simple approach: create a copy with the same blob but with trim metadata
       in the filename so the user knows what to cut in a proper editor.
    */
    const trimName  = name.replace(`.${format}`, `_TRIM_${this.startSec.toFixed(1)}s-${this.endSec.toFixed(1)}s.${format}`);
    const a         = document.createElement('a');
    a.href          = URL.createObjectURL(blob);
    a.download      = trimName;
    a.click();
    URL.revokeObjectURL(a.href);

    showToast(`Exported: ${trimName}`, 'success');
  },

  downloadOriginal() {
    if (!this.currentItem) return;
    const a   = document.createElement('a');
    a.href    = this.currentItem.url;
    a.download = this.currentItem.name;
    a.click();
    showToast(`Downloading: ${this.currentItem.name}`, 'info');
  },
};

/* ═══════════════════════════════════════════════════════════════
   WEBCAM OVERLAY — DRAG + RESIZE
═══════════════════════════════════════════════════════════════ */
(function initWebcamDrag() {
  const ov    = DOM.webcamOverlay;
  let isDragging  = false;
  let isResizing  = false;
  let startX, startY, startW, startH, startLeft, startTop;

  // Dragging
  ov.addEventListener('mousedown', (e) => {
    if (e.target === DOM.webcamResizeHandle) return;
    isDragging = true;
    startX     = e.clientX;
    startY     = e.clientY;
    const rect = ov.getBoundingClientRect();
    startLeft  = rect.left;
    startTop   = rect.top;
    ov.style.transition = 'none';
  });

  // Resizing
  DOM.webcamResizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX     = e.clientX;
    startY     = e.clientY;
    startW     = ov.offsetWidth;
    startH     = ov.offsetHeight;
    e.stopPropagation();
  });

  document.addEventListener('mousemove', (e) => {
    if (isDragging) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      ov.style.left   = (startLeft + dx) + 'px';
      ov.style.top    = (startTop  + dy) + 'px';
      ov.style.right  = 'auto';
      ov.style.bottom = 'auto';
    }
    if (isResizing) {
      const dx  = e.clientX - startX;
      const newW = Math.max(80, startW + dx);
      const newH = Math.round(newW * 0.75);
      ov.style.width  = newW + 'px';
      ov.style.height = newH + 'px';
      DOM.webcamSize.value = newW;
      DOM.webcamSizeVal.textContent = newW + 'px';
    }
  });

  document.addEventListener('mouseup', () => {
    isDragging = isResizing = false;
    ov.style.transition = '';
  });
})();

/* ═══════════════════════════════════════════════════════════════
   EVENT BINDING
═══════════════════════════════════════════════════════════════ */

/* ── Control buttons ── */
DOM.btnStart.addEventListener('click',  startRecording);
DOM.btnPause.addEventListener('click',  togglePause);
DOM.btnStop.addEventListener('click',   stopRecording);
DOM.btnCancel.addEventListener('click', cancelRecording);

/* ── Keyboard shortcuts ── */
document.addEventListener('keydown', (e) => {
  // Don't trigger when typing in input fields
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  switch (e.code) {
    case 'Space':
      e.preventDefault();
      if (RecorderState.status === 'idle')     startRecording();
      else                                     togglePause();
      break;
    case 'KeyS':
      e.preventDefault();
      stopRecording();
      break;
    case 'KeyW':
      DOM.webcamToggle.checked = !DOM.webcamToggle.checked;
      DOM.webcamToggle.dispatchEvent(new Event('change'));
      break;
    case 'KeyM':
      DOM.micToggle.checked = !DOM.micToggle.checked;
      showToast(DOM.micToggle.checked ? 'Mic enabled' : 'Mic muted', 'info');
      break;
    case 'Escape':
      if (DOM.editorBackdrop.style.display !== 'none') {
        EditorModal.close();
      } else {
        cancelRecording();
      }
      break;
  }
});

/* ── Webcam toggle ── */
DOM.webcamToggle.addEventListener('change', async () => {
  const enabled = DOM.webcamToggle.checked;
  DOM.webcamSubOptions.style.display = enabled ? 'flex' : 'none';

  if (enabled) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      RecorderState.webcamStream = stream;
      const pos = document.querySelector('.pos-btn.active')?.dataset.pos || 'bottom-left';
      UIController.showWebcam(stream, pos);
      showToast('Webcam overlay enabled', 'info');
    } catch (err) {
      DOM.webcamToggle.checked = false;
      DOM.webcamSubOptions.style.display = 'none';
      showToast('Webcam not available', 'error');
    }
  } else {
    if (RecorderState.webcamStream) {
      RecorderState.webcamStream.getTracks().forEach(t => t.stop());
      RecorderState.webcamStream = null;
    }
    DOM.webcamOverlay.style.display = 'none';
    DOM.webcamVideo.srcObject = null;
  }
});

/* ── Watermark toggle ── */
DOM.watermarkToggle.addEventListener('change', () => {
  const enabled = DOM.watermarkToggle.checked;
  DOM.watermarkSubOptions.style.display = enabled ? 'flex' : 'none';
  DOM.watermark.classList.toggle('visible', enabled);
});

DOM.watermarkText.addEventListener('input', () => {
  DOM.watermark.querySelector('.wm-text').textContent = DOM.watermarkText.value || 'ANDROMEDA';
});

/* ── Webcam size slider ── */
DOM.webcamSize.addEventListener('input', () => {
  const size = parseInt(DOM.webcamSize.value);
  DOM.webcamSizeVal.textContent = size + 'px';
  const pos = document.querySelector('.pos-btn.active')?.dataset.pos || 'bottom-left';
  UIController.setWebcamPosition(pos, size);
});

/* ── Position buttons ── */
document.querySelectorAll('.pos-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pos-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    UIController.setWebcamPosition(btn.dataset.pos);
  });
});

/* ── Screen toggle show/hide sub-options ── */
DOM.screenToggle.addEventListener('change', () => {
  $('screenSubOptions').style.display = DOM.screenToggle.checked ? 'flex' : 'none';
});

/* ── Recordings list actions ── */
DOM.recordingsList.addEventListener('click', (e) => {
  const btn  = e.target.closest('[data-action]');
  if (!btn) return;
  const id     = parseInt(btn.dataset.id);
  const action = btn.dataset.action;

  if (action === 'edit') {
    EditorModal.open(id);
  }

  if (action === 'download') {
    const item = RecordingsList.items.find(i => i.id === id);
    if (!item) return;
    const a   = document.createElement('a');
    a.href    = item.url;
    a.download = item.name;
    a.click();
    showToast(`Downloading: ${item.name}`, 'info');
  }

  if (action === 'delete') {
    if (!confirm('Delete this recording? This cannot be undone.')) return;
    RecordingsList.remove(id);
    UIController.renderRecordingsList();
    showToast('Recording deleted', 'error');
  }
});

/* ── Editor modal ── */
DOM.editorClose.addEventListener('click', () => EditorModal.close());
DOM.editorBackdrop.addEventListener('click', (e) => {
  if (e.target === DOM.editorBackdrop) EditorModal.close();
});

DOM.btnPreviewTrim.addEventListener('click', () => EditorModal.previewTrim());
DOM.btnApplyTrim.addEventListener('click',   () => EditorModal.exportTrimmed());
DOM.btnDownloadOriginal.addEventListener('click', () => EditorModal.downloadOriginal());

/* Sync inputs with trim handles */
DOM.trimStartInput.addEventListener('input', () => {
  EditorModal.startSec = parseFloat(DOM.trimStartInput.value) || 0;
  EditorModal._updateTrimVisual();
});
DOM.trimEndInput.addEventListener('input', () => {
  EditorModal.endSec = parseFloat(DOM.trimEndInput.value) || EditorModal.duration;
  EditorModal._updateTrimVisual();
});

/* ═══════════════════════════════════════════════════════════════
   BROWSER COMPATIBILITY CHECK
═══════════════════════════════════════════════════════════════ */
(function checkCompatibility() {
  const issues = [];
  if (!navigator.mediaDevices?.getDisplayMedia) issues.push('Screen capture (getDisplayMedia)');
  if (!navigator.mediaDevices?.getUserMedia)   issues.push('Microphone/Webcam (getUserMedia)');
  if (!window.MediaRecorder)                   issues.push('MediaRecorder API');
  if (!window.AudioContext && !window.webkitAudioContext) issues.push('Web Audio API');

  if (issues.length > 0) {
    showToast(`Browser missing: ${issues.join(', ')}. Use Chrome or Edge for full support.`, 'error', 8000);
  }
})();

/* ═══════════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  UIController.setState('idle');
  UIController.renderRecordingsList();
  console.log('%cAndromeda Recorder ready', 'color:#00E6C8; font-size:16px; font-weight:bold;');
  console.log('%cKeyboard shortcuts: Space (start/pause) · S (stop) · W (webcam) · M (mic) · Esc (cancel)', 'color:#888');
});
