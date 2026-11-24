import { processLandmarks, anglesCSV, landmarksCSV, ANGLE_KEYS, N_LM } from './analysis.js';
import { drawSkeleton } from './draw.js';
import { createCharts } from './charts.js';
import { exportVideo } from './export.js';

const $ = (id) => document.getElementById(id);
const video = $('video'), overlay = $('overlay'), octx = overlay.getContext('2d');
const POSE_DIR = 'vendor/mediapipe-pose/';

const state = {
  name: 'video',     // file name without extension
  url: null,
  raw: null,         // per-frame Float32Array(33*3) or null
  res: null,         // processed result (see analysis.js)
  fps: 30,           // frame rate used for the current results
  charts: null,
  busy: false,
  cancel: false,
};

// ---------- pose model ----------
let pose = null, lastLandmarks = null;
async function getPose(complexity) {
  if (!pose) {
    pose = new window.Pose({ locateFile: (f) => POSE_DIR + f });
    pose.onResults((r) => { lastLandmarks = r.poseLandmarks || null; });
  }
  pose.setOptions({
    modelComplexity: complexity,
    smoothLandmarks: false,      // smoothing is done afterwards with a zero-phase filter
    enableSegmentation: false,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  await pose.initialize();
  pose.reset();
  return pose;
}

// ---------- helpers ----------
function showError(msg) {
  $('error').textContent = msg || '';
  $('error').hidden = !msg;
}
function seek(t) {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - t) < 1e-4 && video.readyState >= 2 && !video.seeking) return resolve();
    video.addEventListener('seeked', () => resolve(), { once: true });
    video.currentTime = t;
  });
}
const frameTime = (i, fps) => (i + 0.5) / fps;
const frameAt = (t, fps, n) => Math.max(0, Math.min(n - 1, Math.floor(t * fps + 1e-6)));

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function fmtDuration(s) {
  if (!Number.isFinite(s)) return '';
  return s < 90 ? `${Math.ceil(s)} s` : `${Math.ceil(s / 60)} min`;
}

/** Estimate the file's frame rate from the presentation times of the first frames. */
async function detectFps() {
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return null;
  const times = [];
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2500);
    const cb = (_now, meta) => {
      times.push(meta.mediaTime);
      if (times.length < 16) video.requestVideoFrameCallback(cb);
      else { clearTimeout(timer); resolve(); }
    };
    video.requestVideoFrameCallback(cb);
    video.play().catch(() => { clearTimeout(timer); resolve(); });
  });
  video.pause();
  let step = Infinity;
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d > 1e-3 && d < step) step = d; // smallest gap ignores dropped frames
  }
  if (!Number.isFinite(step)) return null;
  const fps = 1 / step;
  const common = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 100, 120, 240];
  const near = common.reduce((best, c) => (Math.abs(c - fps) < Math.abs(best - fps) ? c : best));
  return Math.abs(near - fps) / near < 0.004 ? near : Math.round(fps * 100) / 100;
}

// ---------- drawing ----------
function drawOverlay() {
  octx.clearRect(0, 0, overlay.width, overlay.height);
  const res = state.res;
  if (!res || state.busy) return;
  const i = frameAt(video.currentTime, res.fps, res.n);
  $('framepos').textContent = `Frame ${i + 1} / ${res.n} · ${(i / res.fps).toFixed(2)} s`;
  if (!$('showSkel').checked || !res.detected[i]) return;
  drawSkeleton(octx, (k) => [res.xs[k][i], res.ys[k][i], res.vis[k][i]], {
    height: res.height,
    labels: $('showVals').checked ? labelsAt(i) : null,
  });
}
function labelsAt(i) {
  const out = {};
  for (const k of ANGLE_KEYS) out[k] = state.res.angles[k][i];
  return out;
}
let lastDrawn = -1;
function tick() {
  if (state.res && !state.busy && video.currentTime !== lastDrawn) {
    lastDrawn = video.currentTime;
    drawOverlay();
    state.charts?.setCursor(video.currentTime);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
const redraw = () => { lastDrawn = -1; };

// ---------- loading ----------
async function loadFile(file) {
  if (state.busy) return;
  showError('');
  if (state.url) URL.revokeObjectURL(state.url);
  state.charts?.destroy();
  Object.assign(state, { raw: null, res: null, charts: null, url: URL.createObjectURL(file) });
  state.name = file.name.replace(/\.[^.]+$/, '') || 'video';
  $('results').hidden = true;
  try {
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      video.onerror = () => reject(new Error('unsupported'));
      video.src = state.url;
      video.load();
    });
  } catch {
    showError('This browser cannot play that file. If it came from an iPhone, try exporting it as "Most Compatible" (H.264) or open this page in Safari.');
    return;
  }
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
  $('fname').textContent = file.name;
  $('drop').hidden = true;
  $('work').hidden = false;
  const fps = await detectFps();
  if (fps) $('fps').value = fps;
  await seek(0);
  analyze();
}

// ---------- analysis ----------
function setBusy(busy, label) {
  state.busy = busy;
  state.cancel = false;
  $('progress').hidden = !busy;
  video.controls = !busy;
  for (const id of ['reanalyze', 'another', 'model', 'fps', 'csvAngles', 'csvLm', 'exportVideo', 'prev', 'next']) $(id).disabled = busy;
  if (busy) { $('fill').style.width = '0'; $('status').textContent = label; }
}

async function analyze() {
  if (state.busy || !video.src) return;
  const fps = Number($('fps').value);
  if (!(fps > 0)) return showError('Enter a frame rate greater than zero.');
  showError('');
  $('reanalyze').classList.remove('attention');
  video.pause();
  setBusy(true, 'Loading the pose model…');
  const total = Math.max(1, Math.floor(video.duration * fps + 0.01));
  const raw = [];
  try {
    const p = await getPose(Number($('model').value));
    const t0 = performance.now();
    for (let i = 0; i < total && !state.cancel; i++) {
      await seek(frameTime(i, fps));
      lastLandmarks = null;
      await p.send({ image: video });
      let packed = null;
      if (lastLandmarks) {
        packed = new Float32Array(N_LM * 3);
        lastLandmarks.forEach((l, k) => { packed[k * 3] = l.x; packed[k * 3 + 1] = l.y; packed[k * 3 + 2] = l.visibility ?? 0; });
      }
      raw.push(packed);
      // live preview of the raw detection
      octx.clearRect(0, 0, overlay.width, overlay.height);
      if (packed) {
        drawSkeleton(octx, (k) => [packed[k * 3] * overlay.width, packed[k * 3 + 1] * overlay.height, packed[k * 3 + 2]], { height: overlay.height });
      }
      const done = i + 1;
      $('fill').style.width = `${(done / total) * 100}%`;
      const left = ((performance.now() - t0) / done) * (total - done) / 1000;
      $('status').textContent = `Analyzing frame ${done} of ${total}` + (done > 5 ? ` · about ${fmtDuration(left)} left` : '');
    }
  } catch (err) {
    console.error(err);
    setBusy(false);
    showError('The pose model failed to run. Reload the page and try again, or try another browser.');
    return;
  }
  setBusy(false);
  if (!raw.length) return;
  state.raw = raw;
  state.fps = fps;
  reprocess();
  await seek(frameTime(0, fps));
  redraw();
}

function reprocess() {
  if (!state.raw) return;
  const res = processLandmarks(state.raw, {
    width: video.videoWidth, height: video.videoHeight, fps: state.fps, cutoffHz: Number($('cutoff').value),
  });
  state.res = res;
  $('results').hidden = false;
  const found = res.detected.filter(Boolean).length;
  const total = Math.max(1, Math.floor(video.duration * state.fps + 0.01));
  $('summary').textContent =
    `${res.n} frames analyzed at ${state.fps} fps (${(res.n / state.fps).toFixed(1)} s). ` +
    `A person was found in ${found} of them.` +
    (res.n < total ? ' Analysis was stopped early, so the results cover only the first part of the video.' : '') +
    (found === 0 ? ' No skeleton could be detected. Check that the whole body is visible.' : '');
  state.charts?.destroy();
  state.charts = createCharts($('charts'), res, { onSeek: (t) => { video.currentTime = t; } });
  state.charts.setCursor(video.currentTime);
  redraw();
}

// ---------- export ----------
async function doExport() {
  const res = state.res;
  if (!res || state.busy) return;
  showError('');
  video.pause();
  const back = video.currentTime;
  const showVals = $('showVals').checked;
  setBusy(true, 'Preparing the video…');
  octx.clearRect(0, 0, overlay.width, overlay.height);
  try {
    const out = await exportVideo({
      width: res.width, height: res.height, fps: res.fps, frames: res.n,
      isCancelled: () => state.cancel,
      onProgress: (done) => {
        $('fill').style.width = `${(done / res.n) * 100}%`;
        $('status').textContent = `Rendering frame ${done} of ${res.n}`;
      },
      renderFrame: async (i, ctx) => {
        await seek(frameTime(i, res.fps));
        ctx.drawImage(video, 0, 0, ctx.canvas.width, ctx.canvas.height);
        if (res.detected[i]) {
          drawSkeleton(ctx, (k) => [res.xs[k][i], res.ys[k][i], res.vis[k][i]], {
            height: res.height, labels: showVals ? labelsAt(i) : null,
          });
        }
      },
    });
    if (out) download(out.blob, `${state.name}_annotated${out.extension}`);
  } catch (err) {
    console.error(err);
    showError(err.message || 'Video export failed.');
  }
  setBusy(false);
  await seek(back);
  redraw();
}

// ---------- events ----------
const drop = $('drop');
drop.addEventListener('click', () => $('file').click());
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); } });
$('file').addEventListener('change', (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ''; });
// Accept drops anywhere on the page, so a second video can be dropped onto the results.
window.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
window.addEventListener('dragleave', () => drop.classList.remove('over'));
window.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv)$/i.test(f.name));
  if (file) loadFile(file);
  else showError('Drop a video file (MP4, MOV, or WebM).');
});

$('another').addEventListener('click', () => $('file').click());
$('reanalyze').addEventListener('click', analyze);
$('cancel').addEventListener('click', () => { state.cancel = true; });
$('cutoff').addEventListener('change', reprocess);
for (const id of ['model', 'fps']) $(id).addEventListener('change', () => { if (state.raw) $('reanalyze').classList.add('attention'); });
$('showSkel').addEventListener('change', redraw);
$('showVals').addEventListener('change', redraw);

function step(d) {
  if (!state.res || state.busy) return;
  video.pause();
  const i = frameAt(video.currentTime, state.res.fps, state.res.n);
  video.currentTime = frameTime(Math.max(0, Math.min(state.res.n - 1, i + d)), state.res.fps);
}
$('prev').addEventListener('click', () => step(-1));
$('next').addEventListener('click', () => step(1));
window.addEventListener('keydown', (e) => {
  if (/^(INPUT|SELECT|BUTTON|TEXTAREA)$/.test(e.target.tagName) || !state.res || state.busy) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  else if (e.key === ' ') { e.preventDefault(); video.paused ? video.play() : video.pause(); }
});

$('csvAngles').addEventListener('click', () => {
  if (state.res) download(new Blob([anglesCSV(state.res)], { type: 'text/csv' }), `${state.name}_angles.csv`);
});
$('csvLm').addEventListener('click', () => {
  if (state.raw) download(new Blob([landmarksCSV(state.raw, { width: video.videoWidth, height: video.videoHeight, fps: state.fps })], { type: 'text/csv' }), `${state.name}_landmarks.csv`);
});
$('exportVideo').addEventListener('click', doExport);

// Hook for automated tests.
window.__xc = { state, loadFile };
