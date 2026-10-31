// Two things the voice todo does with the microphone at the same time:
// speech-to-text (Web Speech API: Chrome, Edge, Safari — the browser's own
// speech service turns speech into text) and a recording (MediaRecorder,
// every modern browser) that's saved with the todo.
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const voiceSupported = Boolean(Recognition);
export const recordingSupported = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
export const MAX_RECORDING_MS = 5 * 60 * 1000;

const ERRORS = {
  'not-allowed': 'Microphone access is blocked — allow it from the icon in the address bar, then try again',
  'service-not-allowed': 'Microphone access is blocked — allow it from the icon in the address bar, then try again',
  'audio-capture': 'No microphone was found',
  'no-speech': 'Didn\'t hear anything — click the mic and try again',
  network: 'Voice input needs an internet connection',
};

// Starts listening. `base` is text already there; what's spoken is added
// after it. onText(fullText) runs as words arrive, onState(listening) when
// listening starts/stops, onError(message) on failure. Returns
// { stop() — keeps the last words still being recognised, abort() — drops them }.
export function startDictation({ base = '', onText, onState, onError }) {
  const recognition = new Recognition();
  recognition.lang = 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;

  let spoken = '';
  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) spoken += result[0].transcript;
      else interim += result[0].transcript;
    }
    onText([base.trim(), (spoken + interim).trim()].filter(Boolean).join(' '));
  };
  recognition.onstart = () => onState(true);
  recognition.onend = () => onState(false);
  recognition.onerror = (event) => {
    if (event.error === 'aborted') return;
    onError(ERRORS[event.error] || `Voice input stopped (${event.error})`);
  };

  recognition.start();
  return { stop: () => recognition.stop(), abort: () => recognition.abort() };
}

const MIC_ERRORS = {
  NotAllowedError: ERRORS['not-allowed'],
  SecurityError: 'Recording needs a secure page (https or localhost)',
  NotFoundError: ERRORS['audio-capture'],
  NotReadableError: 'The microphone is busy in another app',
};

// Records the microphone into one clip that can be paused and resumed.
// Resolves once recording has started (rejects with a readable message if
// the mic can't be used). onLimit() runs if it reaches MAX_RECORDING_MS.
export async function startRecording({ onLimit } = {}) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    throw new Error(MIC_ERRORS[err.name] || `Couldn't start recording (${err.name})`);
  }
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.addEventListener('dataavailable', (event) => { if (event.data.size) chunks.push(event.data); });

  // Recorded time so far, not counting pauses
  let recordedMs = 0;
  let since = Date.now();
  const elapsed = () => recordedMs + (since ? Date.now() - since : 0);
  const limitTimer = setInterval(() => { if (elapsed() >= MAX_RECORDING_MS) onLimit?.(); }, 250);
  const release = () => { clearInterval(limitTimer); stream.getTracks().forEach((track) => track.stop()); };
  const clip = () => new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || 'audio/webm' });

  recorder.start();
  return {
    elapsed,
    // Pauses, and resolves to the clip so far (for a preview)
    pause() {
      if (recorder.state !== 'recording') return Promise.resolve(clip());
      recordedMs = elapsed();
      since = 0;
      recorder.pause();
      return new Promise((resolve) => {
        recorder.addEventListener('dataavailable', () => resolve(clip()), { once: true });
        recorder.requestData();
      });
    },
    resume() {
      if (recorder.state !== 'paused') return;
      since = Date.now();
      recorder.resume();
    },
    // Ends the recording and frees the mic: resolves to { blob, durationMs }
    finish() {
      const durationMs = Math.round(elapsed());
      if (recorder.state === 'inactive') { release(); return Promise.resolve({ blob: clip(), durationMs }); }
      return new Promise((resolve) => {
        recorder.addEventListener('stop', () => { release(); resolve({ blob: clip(), durationMs }); }, { once: true });
        recorder.stop();
      });
    },
    // Throws the recording away and frees the mic
    cancel() {
      if (recorder.state !== 'inactive') recorder.stop();
      release();
      chunks.length = 0;
    },
  };
}

// 65000 → "1:05"
export function formatClock(ms) {
  const seconds = Math.round((ms || 0) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
