// Small-multiple angle charts: one panel per joint, left and right sides as two lines.
import { JOINTS, TRUNK } from './analysis.js';
import { MIN_VIS } from './draw.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};
const M = { l: 36, r: 10, t: 8, b: 20 };
const H = 132;

function niceStep(span, target, steps) {
  for (const s of steps) if (span / s <= target) return s;
  return steps[steps.length - 1];
}

export function createCharts(root, res, { onSeek }) {
  root.innerHTML = '';
  const duration = res.n / res.fps;
  const panels = [
    ...JOINTS.map((j) => ({ title: j.label, series: [['left', `${j.key}_L`, 'L'], ['right', `${j.key}_R`, 'R']] })),
    { title: TRUNK.label, series: [['single', 'trunk', '']] },
  ];
  let cursorT = 0, hoverT = null;

  for (const p of panels) {
    const box = document.createElement('figure');
    box.className = 'chart';
    const head = document.createElement('figcaption');
    const title = document.createElement('span');
    title.className = 'chart-title';
    title.textContent = p.title;
    head.appendChild(title);
    p.readouts = p.series.map(([cls, , tag]) => {
      const s = document.createElement('span');
      s.className = 'readout';
      s.innerHTML = `<i class="swatch ${cls}"></i>${tag ? `<span class="tag">${tag}</span>` : ''}<b></b>`;
      head.appendChild(s);
      return s.querySelector('b');
    });
    box.appendChild(head);
    p.svg = el('svg', { class: 'chart-svg', height: H, role: 'img', 'aria-label': `${p.title} angle over time, in degrees` });
    box.appendChild(p.svg);
    root.appendChild(box);
    const toTime = (ev) => {
      const r = p.svg.getBoundingClientRect();
      const frac = (ev.clientX - r.left - M.l) / (r.width - M.l - M.r);
      return Math.max(0, Math.min(1, frac)) * duration;
    };
    p.svg.addEventListener('pointermove', (ev) => { hoverT = toTime(ev); update(); });
    p.svg.addEventListener('pointerleave', () => { hoverT = null; update(); });
    p.svg.addEventListener('click', (ev) => onSeek(toTime(ev)));
  }

  function render() {
    for (const p of panels) {
      const W = Math.max(220, Math.floor(p.svg.parentNode.clientWidth));
      p.W = W;
      p.svg.setAttribute('width', W);
      p.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      p.svg.innerHTML = '';
      const iw = W - M.l - M.r, ih = H - M.t - M.b;
      let lo = Infinity, hi = -Infinity;
      for (const [, key] of p.series) {
        for (const v of res.angles[key]) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
      }
      if (!Number.isFinite(lo)) { lo = 0; hi = 180; }
      if (hi - lo < 10) { lo -= 5; hi += 5; }
      const ys = niceStep(hi - lo, 4, [5, 10, 15, 20, 30, 45, 60, 90]);
      lo = Math.floor(lo / ys) * ys;
      hi = Math.ceil(hi / ys) * ys;
      const X = (t) => M.l + (t / duration) * iw;
      const Y = (v) => M.t + (1 - (v - lo) / (hi - lo)) * ih;
      p.X = X;
      for (let v = lo; v <= hi + 1e-6; v += ys) {
        el('line', { class: 'grid', x1: M.l, x2: W - M.r, y1: Y(v), y2: Y(v) }, p.svg);
        el('text', { class: 'tick', x: M.l - 6, y: Y(v) + 3.5, 'text-anchor': 'end' }, p.svg).textContent = `${v}°`;
      }
      const xs = niceStep(duration, 6, [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]);
      for (let t = 0; t <= duration + 1e-6; t += xs) {
        el('text', { class: 'tick', x: X(t), y: H - 5, 'text-anchor': 'middle' }, p.svg).textContent = `${+t.toFixed(2)}s`;
      }
      for (const [cls, key] of p.series) {
        const a = res.angles[key], c = res.conf[key];
        let all = '', sure = '', penAll = false, penSure = false;
        for (let i = 0; i < res.n; i++) {
          if (!Number.isFinite(a[i])) { penAll = penSure = false; continue; }
          const pt = `${X(i / res.fps).toFixed(1)},${Y(a[i]).toFixed(1)}`;
          all += (penAll ? 'L' : 'M') + pt;
          penAll = true;
          if (c[i] >= MIN_VIS) { sure += (penSure ? 'L' : 'M') + pt; penSure = true; } else penSure = false;
        }
        // Whole trace drawn faint; confident stretches drawn again at full strength on top.
        el('path', { class: `line faint ${cls}`, d: all }, p.svg);
        el('path', { class: `line ${cls}`, d: sure }, p.svg);
      }
      p.hover = el('line', { class: 'hoverline', y1: M.t, y2: H - M.b, visibility: 'hidden' }, p.svg);
      p.cursor = el('line', { class: 'cursor', y1: M.t, y2: H - M.b }, p.svg);
    }
    update();
  }

  function update() {
    const t = hoverT ?? cursorT;
    const i = Math.max(0, Math.min(res.n - 1, Math.floor(t * res.fps + 1e-6)));
    for (const p of panels) {
      if (!p.X) continue;
      const cx = p.X(cursorT);
      p.cursor.setAttribute('x1', cx);
      p.cursor.setAttribute('x2', cx);
      if (hoverT == null) p.hover.setAttribute('visibility', 'hidden');
      else {
        const hx = p.X(hoverT);
        p.hover.setAttribute('visibility', 'visible');
        p.hover.setAttribute('x1', hx);
        p.hover.setAttribute('x2', hx);
      }
      p.series.forEach(([, key], k) => {
        const v = res.angles[key][i];
        const low = res.conf[key][i] < MIN_VIS;
        p.readouts[k].textContent = Number.isFinite(v) ? `${v.toFixed(0)}°` : 'n/a';
        p.readouts[k].classList.toggle('low', low);
        p.readouts[k].title = low ? 'Low confidence: a landmark is hidden or uncertain in this frame' : '';
      });
    }
  }

  const ro = new ResizeObserver(() => render());
  ro.observe(root);
  render();
  return {
    setCursor(t) { cursorT = t; update(); },
    destroy() { ro.disconnect(); root.innerHTML = ''; },
  };
}
