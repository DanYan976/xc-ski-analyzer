// Pure analysis functions: no DOM access, so they can be reused and tested anywhere.

export const LANDMARK_NAMES = [
  'nose', 'left_eye_inner', 'left_eye', 'left_eye_outer', 'right_eye_inner', 'right_eye', 'right_eye_outer',
  'left_ear', 'right_ear', 'mouth_left', 'mouth_right',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist',
  'left_pinky', 'right_pinky', 'left_index', 'right_index', 'left_thumb', 'right_thumb',
  'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
  'left_heel', 'right_heel', 'left_foot_index', 'right_foot_index',
];
export const N_LM = 33;

// Each joint angle is the included angle at the middle landmark (180 deg = fully extended),
// measured in the image plane.
export const JOINTS = [
  { key: 'knee', label: 'Knee', left: [23, 25, 27], right: [24, 26, 28] },
  { key: 'hip', label: 'Hip', left: [11, 23, 25], right: [12, 24, 26] },
  { key: 'ankle', label: 'Ankle', left: [25, 27, 31], right: [26, 28, 32] },
  { key: 'elbow', label: 'Elbow', left: [11, 13, 15], right: [12, 14, 16] },
  { key: 'shoulder', label: 'Shoulder', left: [13, 11, 23], right: [14, 12, 24] },
];
export const TRUNK = { key: 'trunk', label: 'Trunk lean', points: [11, 12, 23, 24] };

// Column keys in output order.
export const ANGLE_KEYS = [...JOINTS.flatMap((j) => [`${j.key}_L`, `${j.key}_R`]), 'trunk'];

/** Zero-phase 2nd-order Butterworth low-pass (forward + backward pass, cutoff corrected for two passes). */
export function lowpass(x, fs, fc) {
  const n = x.length;
  if (!(fc > 0) || n < 6) return Float64Array.from(x);
  const fcAdj = fc / 0.802; // dual-pass correction (Winter, 2009)
  if (fcAdj >= 0.45 * fs) return Float64Array.from(x);
  const w = Math.tan((Math.PI * fcAdj) / fs);
  const k1 = Math.SQRT2 * w;
  const k2 = w * w;
  const a0 = k2 / (1 + k1 + k2);
  const a1 = 2 * a0;
  const k3 = a1 / k2;
  const b1 = -2 * a0 + k3;
  const b2 = 1 - 2 * a0 - k3;
  // Odd-reflection padding reduces edge transients.
  const pad = Math.min(n - 1, Math.ceil((3 * fs) / fc));
  const m = n + 2 * pad;
  const p = new Float64Array(m);
  for (let i = 0; i < pad; i++) {
    p[i] = 2 * x[0] - x[pad - i];
    p[m - 1 - i] = 2 * x[n - 1] - x[n - 1 - (pad - i)];
  }
  for (let i = 0; i < n; i++) p[pad + i] = x[i];
  const pass = (src) => {
    const y = new Float64Array(m);
    y[0] = src[0];
    y[1] = src[1];
    for (let i = 2; i < m; i++) {
      y[i] = a0 * src[i] + a1 * src[i - 1] + a0 * src[i - 2] + b1 * y[i - 1] + b2 * y[i - 2];
    }
    return y;
  };
  const fwd = pass(p);
  fwd.reverse();
  const bwd = pass(fwd);
  bwd.reverse();
  return bwd.slice(pad, pad + n);
}

/** Linearly fill NaN gaps in place; edges are held at the nearest valid value. */
export function fillGaps(x) {
  const n = x.length;
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(x[i])) continue;
    if (last < 0) for (let j = 0; j < i; j++) x[j] = x[i];
    else if (i - last > 1) {
      for (let j = last + 1; j < i; j++) x[j] = x[last] + ((x[i] - x[last]) * (j - last)) / (i - last);
    }
    last = i;
  }
  if (last >= 0) for (let j = last + 1; j < n; j++) x[j] = x[last];
  return x;
}

function includedAngle(ax, ay, bx, by, cx, cy) {
  const v1x = ax - bx, v1y = ay - by, v2x = cx - bx, v2y = cy - by;
  const d = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (d === 0) return NaN;
  return (Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / d))) * 180) / Math.PI;
}

/**
 * Turn per-frame raw landmarks into filtered pixel trajectories, joint angles, and confidences.
 * @param raw   Array (one per frame) of Float32Array(33*3) [x_norm, y_norm, visibility] or null if no person found.
 * @param opts  { width, height, fps, cutoffHz }  cutoffHz = 0 disables filtering.
 */
export function processLandmarks(raw, { width, height, fps, cutoffHz }) {
  const n = raw.length;
  const detected = raw.map((r) => !!r);
  const xs = [], ys = [], vis = [];
  for (let k = 0; k < N_LM; k++) {
    const x = new Float64Array(n), y = new Float64Array(n), v = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = raw[i];
      x[i] = r ? r[k * 3] * width : NaN;
      y[i] = r ? r[k * 3 + 1] * height : NaN;
      v[i] = r ? r[k * 3 + 2] : 0;
    }
    fillGaps(x);
    fillGaps(y);
    xs.push(cutoffHz > 0 ? lowpass(x, fps, cutoffHz) : x);
    ys.push(cutoffHz > 0 ? lowpass(y, fps, cutoffHz) : y);
    vis.push(v);
  }
  const angles = {}, conf = {};
  const any = detected.some(Boolean);
  const mk = (key) => {
    angles[key] = new Float32Array(n).fill(NaN);
    conf[key] = new Float32Array(n);
  };
  for (const j of JOINTS) {
    for (const [side, idx] of [['L', j.left], ['R', j.right]]) {
      const key = `${j.key}_${side}`;
      mk(key);
      if (!any) continue;
      const [a, b, c] = idx;
      for (let i = 0; i < n; i++) {
        angles[key][i] = includedAngle(xs[a][i], ys[a][i], xs[b][i], ys[b][i], xs[c][i], ys[c][i]);
        conf[key][i] = Math.min(vis[a][i], vis[b][i], vis[c][i]);
      }
    }
  }
  mk('trunk');
  if (any) {
    const [ls, rs, lh, rh] = TRUNK.points;
    for (let i = 0; i < n; i++) {
      const dx = (xs[ls][i] + xs[rs][i]) / 2 - (xs[lh][i] + xs[rh][i]) / 2;
      const dy = (ys[ls][i] + ys[rs][i]) / 2 - (ys[lh][i] + ys[rh][i]) / 2;
      // 0 deg = trunk vertical; image y points down.
      angles.trunk[i] = (Math.atan2(Math.abs(dx), -dy) * 180) / Math.PI;
      conf.trunk[i] = Math.min(vis[ls][i], vis[rs][i], vis[lh][i], vis[rh][i]);
    }
  }
  return { n, fps, width, height, detected, xs, ys, vis, angles, conf };
}

const f = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : '');

export function anglesCSV(res) {
  const head = ['frame', 'time_s', 'person_detected',
    ...ANGLE_KEYS.map((k) => `${k}_deg`), ...ANGLE_KEYS.map((k) => `${k}_conf`)];
  const rows = [head.join(',')];
  for (let i = 0; i < res.n; i++) {
    rows.push([i, (i / res.fps).toFixed(4), res.detected[i] ? 1 : 0,
      ...ANGLE_KEYS.map((k) => f(res.angles[k][i], 2)),
      ...ANGLE_KEYS.map((k) => f(res.conf[k][i], 3))].join(','));
  }
  return rows.join('\n') + '\n';
}

export function landmarksCSV(raw, { width, height, fps }) {
  const head = ['frame', 'time_s',
    ...LANDMARK_NAMES.flatMap((nm) => [`${nm}_x_px`, `${nm}_y_px`, `${nm}_visibility`])];
  const rows = [head.join(',')];
  raw.forEach((r, i) => {
    const cells = [i, (i / fps).toFixed(4)];
    for (let k = 0; k < N_LM; k++) {
      if (r) cells.push((r[k * 3] * width).toFixed(2), (r[k * 3 + 1] * height).toFixed(2), r[k * 3 + 2].toFixed(3));
      else cells.push('', '', '');
    }
    rows.push(cells.join(','));
  });
  return rows.join('\n') + '\n';
}
