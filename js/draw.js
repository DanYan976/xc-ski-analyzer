// Skeleton overlay drawing, shared by the on-screen preview and the video export.
import { JOINTS } from './analysis.js';

export const COLORS = { left: '#2a78d6', right: '#eb6834', center: '#f4f4f2', casing: 'rgba(255,255,255,0.92)' };
export const MIN_VIS = 0.5; // below this a landmark is treated as low confidence

const SEGMENTS = [
  // [from, to, side]
  [12, 14, 'right'], [14, 16, 'right'], [12, 24, 'right'], [24, 26, 'right'], [26, 28, 'right'],
  [28, 30, 'right'], [30, 32, 'right'], [28, 32, 'right'],
  [11, 12, 'center'], [23, 24, 'center'],
  [11, 13, 'left'], [13, 15, 'left'], [11, 23, 'left'], [23, 25, 'left'], [25, 27, 'left'],
  [27, 29, 'left'], [29, 31, 'left'], [27, 31, 'left'],
];
const JOINT_DOTS = [[12, 'right'], [14, 'right'], [16, 'right'], [24, 'right'], [26, 'right'], [28, 'right'],
  [11, 'left'], [13, 'left'], [15, 'left'], [23, 'left'], [25, 'left'], [27, 'left']];

/**
 * @param ctx   2D context whose coordinate system is video pixels
 * @param pt    (k) => [x, y, visibility] for landmark k
 * @param opts  { height, labels?: {key: value} }  labels draws angle values beside the joints
 */
export function drawSkeleton(ctx, pt, opts) {
  const s = Math.max(1, opts.height / 360); // scale stroke widths with resolution
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const stroke = (a, b, color, width, alpha) => {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  };
  for (const [i, j, side] of SEGMENTS) {
    const a = pt(i), b = pt(j);
    const ok = Math.min(a[2], b[2]) >= MIN_VIS;
    stroke(a, b, COLORS.casing, 3.5 * s, ok ? 1 : 0.35);
    stroke(a, b, side === 'center' ? '#6b6a66' : COLORS[side], 2 * s, ok ? 1 : 0.45);
  }
  // Head: neck line to the ear midpoint, plus a marker at the nose.
  const ls = pt(11), rs = pt(12), le = pt(7), re = pt(8), nose = pt(0);
  const neck = [(ls[0] + rs[0]) / 2, (ls[1] + rs[1]) / 2], head = [(le[0] + re[0]) / 2, (le[1] + re[1]) / 2];
  stroke(neck, head, COLORS.casing, 3.5 * s, 1);
  stroke(neck, head, '#6b6a66', 2 * s, 1);
  ctx.globalAlpha = 1;
  const dot = (p, color, r) => {
    ctx.beginPath();
    ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.25 * s;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  };
  dot(nose, "#6b6a66", 2.5 * s);
  for (const [k, side] of JOINT_DOTS) {
    const p = pt(k);
    ctx.globalAlpha = p[2] >= MIN_VIS ? 1 : 0.45;
    dot(p, COLORS[side], 3 * s);
  }
  ctx.globalAlpha = 1;
  if (opts.labels) {
    ctx.font = `600 ${Math.round(11 * s)}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    for (const j of JOINTS) {
      for (const [side, idx, dx] of [['R', j.right, -1], ['L', j.left, 1]]) {
        const v = opts.labels[`${j.key}_${side}`];
        const p = pt(idx[1]);
        if (!Number.isFinite(v) || p[2] < MIN_VIS) continue;
        const text = `${Math.round(v)}°`;
        const w = ctx.measureText(text).width;
        const x = dx > 0 ? p[0] + 7 * s : p[0] - 7 * s - w;
        ctx.fillStyle = 'rgba(11,11,11,0.72)';
        ctx.fillRect(x - 2 * s, p[1] - 7 * s, w + 4 * s, 14 * s);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, x, p[1] + 0.5 * s);
      }
    }
  }
  ctx.restore();
}
