import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { shapes, NTETRA, solve, shapeByLetter, shapeByName, identify, cellXYZ, canonicalForm } from './solver.js';

const COLORS = ['#e8604c', '#f0b23a', '#2fae94', '#4b7fdc', '#9a6bd6', '#7dbb47'];
const ORIGINAL = 'bdgLOT';
const $ = id => document.getElementById(id);

const state = {
  pieces: [],        // shape indices, sorted: four-cube pieces first
  result: null,      // { raw, solutions }
  sol: 0,
  hidden: new Set(), // piece positions hidden in the viewer
  target: null,      // canonical form of an entered cube, to open on its solution
};

/* ---------- colours ---------- */

function mix(hex, other, t) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(other.slice(1), 16);
  const ch = (v, s) => v >> s & 255;
  const c = [16, 8, 0].map(s => Math.round(ch(a, s) * (1 - t) + ch(b, s) * t));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}

/* ---------- isometric pictures of pieces ---------- */

// viewer is front-right-above: +x goes right-down, +y (back) left-up, +z up
const proj = (x, y, z) => [(x - y) * 0.866, (x + y) * 0.5 - z];

function isoSVG(cells, color) {
  const sorted = cells.slice().sort((p, q) => (p[0] - p[1] + p[2]) - (q[0] - q[1] + q[2]));
  const top = mix(color, '#ffffff', 0.25), left = color, right = mix(color, '#000000', 0.25);
  const stroke = mix(color, '#000000', 0.45);
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, polys = '';
  const poly = (pts, fill) => {
    const s = pts.map(([x, y, z]) => {
      const [px, py] = proj(x, y, z);
      minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
      return px.toFixed(3) + ',' + py.toFixed(3);
    }).join(' ');
    polys += `<polygon points="${s}" fill="${fill}" stroke="${stroke}" stroke-width="0.05" stroke-linejoin="round"/>`;
  };
  for (const [x, y, z] of sorted) {
    poly([[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]], top);
    poly([[x, y, z], [x + 1, y, z], [x + 1, y, z + 1], [x, y, z + 1]], left);
    poly([[x + 1, y, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x + 1, y, z + 1]], right);
  }
  const pad = 0.12, w = maxX - minX + 2 * pad, h = maxY - minY + 2 * pad;
  return `<svg viewBox="${(minX - pad).toFixed(3)} ${(minY - pad).toFixed(3)} ${w.toFixed(3)} ${h.toFixed(3)}" aria-hidden="true">${polys}</svg>`;
}

const NEUTRAL = '#9aa3ad';
const describe = s => `${s.name}: ${s.size}-cube piece, ` +
  (s.mirror === s.index ? 'same as its mirror image' : `mirror image of ${shapes[s.mirror].name}`);

/* ---------- pieces: palette and tray ---------- */

const counts = () => ({
  four: state.pieces.filter(i => i < NTETRA).length,
  five: state.pieces.filter(i => i >= NTETRA).length,
});

function buildPalette() {
  for (const s of shapes) {
    const b = document.createElement('button');
    b.className = 'pc';
    b.title = describe(s);
    b.innerHTML = isoSVG(s.cells, NEUTRAL) + `<span>${s.name}</span>`;
    b.onclick = () => addPiece(s.index);
    b.dataset.index = s.index;
    (s.size === 4 ? $('pal4') : $('pal5')).appendChild(b);
  }
}

function addPiece(i) {
  const c = counts();
  if ((i < NTETRA ? c.four : c.five) >= 3) return;
  setPieces([...state.pieces, i]);
}

function removePiece(pos) {
  const p = state.pieces.slice();
  p.splice(pos, 1);
  setPieces(p);
}

function renderTray() {
  const tray = $('tray');
  tray.innerHTML = '';
  const four = state.pieces.map((s, pos) => ({ s, pos })).filter(o => o.s < NTETRA);
  const five = state.pieces.map((s, pos) => ({ s, pos })).filter(o => o.s >= NTETRA);
  const slot = (o, size) => {
    const el = document.createElement('button');
    el.className = 'slot' + (o ? ' filled' : '');
    if (o) {
      const s = shapes[o.s];
      el.title = 'Remove ' + s.name;
      el.innerHTML = isoSVG(s.cells, COLORS[o.pos]) + `<span class="nm">${s.name}</span><span class="x">×</span>`;
      el.onclick = () => removePiece(o.pos);
    } else {
      el.innerHTML = `<span class="size">${size}</span>`;
      el.title = `Empty: add a ${size}-cube piece`;
      el.disabled = true;
    }
    tray.appendChild(el);
  };
  for (let k = 0; k < 3; k++) slot(four[k], 4);
  for (let k = 0; k < 3; k++) slot(five[k], 5);
  const c = counts();
  for (const b of document.querySelectorAll('.pc'))
    b.disabled = (+b.dataset.index < NTETRA ? c.four : c.five) >= 3;
}

const setKey = pieces => pieces.map(i => shapes[i].letter).join('');

function setPieces(pieces, { sol = 0, target = null } = {}) {
  state.pieces = pieces.slice().sort((a, b) => a - b);
  state.hidden.clear();
  state.target = target;
  state.result = null;
  state.sol = 0;
  const c = counts();
  if (c.four === 3 && c.five === 3) {
    state.result = solve(state.pieces);
    state.sol = Math.min(sol, Math.max(0, state.result.solutions.length - 1));
    if (target) {
      const k = state.result.solutions.findIndex(s => canonicalForm(s.map(p => p.mask)) === target);
      if (k >= 0) state.sol = k;
    }
  }
  renderTray();
  renderResult();
  showCurrent(true);
  writeHash();
}

function renderResult() {
  const el = $('result');
  const c = counts();
  if (!state.result) {
    const need = [];
    if (c.four < 3) need.push(`${3 - c.four} more four-cube piece${3 - c.four > 1 ? 's' : ''}`);
    if (c.five < 3) need.push(`${3 - c.five} more five-cube piece${3 - c.five > 1 ? 's' : ''}`);
    el.innerHTML = `<span class="hint" style="margin:0">Add ${need.join(' and ')}.</span>`;
    return;
  }
  const n = state.result.solutions.length;
  if (!n) { el.innerHTML = `<span class="bad">No solutions.</span> These pieces can’t fill the cube.`; return; }
  el.innerHTML = `<strong>${n.toLocaleString()}</strong> solution${n > 1 ? 's' : ''}` +
    ` <span class="hint">(${state.result.raw.toLocaleString()} counting all 24 ways the cube can sit)</span>`;
}

/* ---------- 3D viewer ---------- */

const canvas = $('canvas'), stage = $('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
const HOME_DIR = new THREE.Vector3(5.2, 4.6, 7.4).normalize();
// distance at which a sphere of radius 2.8 (the cube with room to spare) fills the view
function homeDistance() {
  const v = THREE.MathUtils.degToRad(camera.fov) / 2;
  const h = Math.atan(Math.tan(v) * camera.aspect);
  return 2.8 / Math.sin(Math.min(v, h));
}
const resetView = () => { camera.position.copy(HOME_DIR).multiplyScalar(homeDistance()); controls.target.set(0, 0, 0); };
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 4;
controls.maxDistance = 30;

scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(4, 9, 6);
scene.add(sun);
const fill = new THREE.DirectionalLight(0xffffff, 0.6);
fill.position.set(-6, 2, -4);
scene.add(fill);

const box = new THREE.BoxGeometry(0.97, 0.97, 0.97);
const edges = new THREE.EdgesGeometry(box);
const root = new THREE.Group();
scene.add(root);
let groups = [];
let explode = 0, explodeTarget = 0, baseScale = 1;

// cube coords (x right, y back, z up) -> three.js (x right, y up, z toward viewer)
const toWorld = ([x, y, z]) => new THREE.Vector3(x, z, -y);

function clearScene() {
  for (const g of groups) {
    g.traverse(o => { if (o.material) o.material.dispose(); });
    root.remove(g);
  }
  groups = [];
}

function addPieceMesh(cells, color, offset, pos) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.0 });
  const line = new THREE.LineBasicMaterial({ color: mix(color, '#000000', 0.5) });
  const centre = new THREE.Vector3();
  for (const c of cells) {
    const p = toWorld(c).add(offset);
    const m = new THREE.Mesh(box, mat);
    m.position.copy(p);
    const e = new THREE.LineSegments(edges, line);
    e.position.copy(p);
    g.add(m, e);
    centre.add(p);
  }
  centre.divideScalar(cells.length);
  g.userData.dir = centre.clone();
  g.userData.pos = pos;
  g.visible = !state.hidden.has(pos);
  root.add(g);
  groups.push(g);
}

function showCurrent(resetExplode) {
  clearScene();
  const msg = $('msg');
  msg.hidden = true;
  const r = state.result;
  baseScale = r && r.solutions.length ? 1 : 0.5;
  if (r && r.solutions.length) {
    const sol = r.solutions[state.sol];
    sol.forEach((p, pos) => {
      const cells = [];
      for (let c = 0; c < 27; c++) if (p.mask >> c & 1) cells.push(cellXYZ(c));
      addPieceMesh(cells, COLORS[pos], new THREE.Vector3(-1, -1, 1), pos);
    });
    if (resetExplode && explodeTarget === 0) explode = 0;
  } else {
    // lay the chosen pieces out in a row
    const n = state.pieces.length;
    state.pieces.forEach((i, pos) => {
      const s = shapes[i];
      const mx = [0, 1, 2].map(a => Math.max(...s.cells.map(c => c[a])));
      const col = pos % 3, row = Math.floor(pos / 3);
      const off = new THREE.Vector3((col - 1) * 4 - mx[0] / 2, -mx[2] / 2 + (row ? -2.2 : 2.2) * (n > 3 ? 1 : 0), mx[1] / 2);
      addPieceMesh(s.cells, COLORS[pos], off, pos);
      groups[groups.length - 1].userData.dir.set(0, 0, 0);
    });
    if (!n) { msg.hidden = false; msg.firstChild.textContent = 'Pick pieces on the left, or choose a puzzle.'; }
    else if (r) { msg.hidden = false; msg.firstChild.textContent = 'No way to fit these pieces into the cube.'; }
  }
  renderNav();
  renderLegend();
  renderLayers();
}

function renderNav() {
  const n = state.result ? state.result.solutions.length : 0;
  $('solLabel').textContent = n ? `Solution ${state.sol + 1} of ${n.toLocaleString()}` : 'No solutions shown';
  $('prev').disabled = n < 2;
  $('next').disabled = n < 2;
}

function go(d) {
  const n = state.result ? state.result.solutions.length : 0;
  if (n < 2) return;
  state.sol = (state.sol + d + n) % n;
  showCurrent(false);
  writeHash();
}

function renderLegend() {
  const el = $('legend');
  el.innerHTML = '';
  state.pieces.forEach((i, pos) => {
    const b = document.createElement('button');
    b.className = 'chip' + (state.hidden.has(pos) ? ' off' : '');
    b.innerHTML = `<i style="background:${COLORS[pos]}">${pos + 1}</i>${shapes[i].name}`;
    b.title = (state.hidden.has(pos) ? 'Show ' : 'Hide ') + shapes[i].name;
    b.onclick = () => {
      if (state.hidden.has(pos)) state.hidden.delete(pos); else state.hidden.add(pos);
      for (const g of groups) g.visible = !state.hidden.has(g.userData.pos);
      renderLegend();
    };
    el.appendChild(b);
  });
}

function renderLayers() {
  const el = $('layers');
  el.innerHTML = '';
  const r = state.result;
  if (!r || !r.solutions.length) return;
  const owner = new Array(27);
  r.solutions[state.sol].forEach((p, pos) => { for (let c = 0; c < 27; c++) if (p.mask >> c & 1) owner[c] = pos; });
  ['Top', 'Middle', 'Bottom'].forEach((name, L) => {
    let cells = '';
    for (let row = 0; row < 3; row++)
      for (let x = 0; x < 3; x++) {
        const pos = owner[x + 3 * (2 - row) + 9 * (2 - L)];
        cells += `<b style="background:${COLORS[pos]}">${pos + 1}</b>`;
      }
    el.insertAdjacentHTML('beforeend', `<div class="layer">${name}<div class="g">${cells}</div></div>`);
  });
  el.title = 'Layers seen from above, back row first';
}

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (!resized) { resetView(); resized = true; }
}
let resized = false;
new ResizeObserver(resize).observe(stage);

function frame() {
  explode += (explodeTarget - explode) * 0.18;
  for (const g of groups) g.position.copy(g.userData.dir).multiplyScalar(explode * 1.8);
  root.scale.setScalar(baseScale / (1 + explode * 0.7));
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

$('explode').oninput = e => { explodeTarget = e.target.value / 100; };
$('prev').onclick = () => go(-1);
$('next').onclick = () => go(1);
$('resetView').onclick = resetView;
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowLeft') go(-1);
  if (e.key === 'ArrowRight') go(1);
});

/* ---------- browsing puzzles by number of solutions ---------- */

const byCount = new Map(); // solutions -> array of 6-letter set keys
let maxCount = 0, sample = [];

async function loadSets() {
  const text = await (await fetch('sets.txt')).text();
  for (const line of text.trim().split('\n')) {
    const [n, s] = line.split(' ');
    const keys = s.match(/.{6}/g);
    byCount.set(+n, keys);
    maxCount = Math.max(maxCount, +n);
  }
  let all = 0, distinct = 0, unique = 0;
  for (const [n, keys] of byCount) {
    all += keys.length;
    const d = keys.filter(isDistinct).length;
    distinct += d;
    if (n === 1) unique = d;
  }
  $('totals').textContent = `${distinct.toLocaleString()} of the 80,500 sets of six different pieces can be solved, ` +
    `and ${unique.toLocaleString()} of those have exactly one solution. Allowing repeated pieces, ${all.toLocaleString()} sets can be solved.`;
  const quick = $('quick');
  for (const [label, n] of [['1 (hardest)', 1], ['2', 2], ['5', 5], ['10', 10], ['~80', 80], ['Most', -1]]) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = label;
    b.onclick = () => { $('nsol').value = n < 0 ? mostFor() : n; browse(); };
    quick.appendChild(b);
  }
  browse();
}

const isDistinct = k => new Set(k).size === 6;
const matching = n => (byCount.get(n) || []).filter(k => !$('distinct').checked || isDistinct(k));
function mostFor() {
  for (let n = maxCount; n > 0; n--) if (matching(n).length) return n;
  return 1;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function browse() {
  const n = Math.max(1, Math.floor(+$('nsol').value || 1));
  const list = matching(n);
  $('browseInfo').textContent = list.length
    ? `${list.length.toLocaleString()} set${list.length > 1 ? 's' : ''} of pieces ${list.length > 1 ? 'have' : 'has'} exactly ${n} solution${n > 1 ? 's' : ''}.`
    : `No set has exactly ${n} solution${n > 1 ? 's' : ''}.`;
  sample = shuffle(list.slice());
  showMatches();
}

function showMatches() {
  const el = $('matches');
  el.innerHTML = '';
  const n = Math.max(1, Math.floor(+$('nsol').value || 1));
  for (const k of sample.splice(0, 8)) {
    const b = document.createElement('button');
    b.className = 'match';
    b.title = 'Load this puzzle';
    b.innerHTML = [...k].map((ch, pos) => isoSVG(shapeByLetter.get(ch).cells, COLORS[pos])).join('') +
      `<span class="lbl">${[...k].map(ch => shapeByLetter.get(ch).name).join(' ')}</span>`;
    b.onclick = () => setPieces([...k].map(ch => shapeByLetter.get(ch).index));
    el.appendChild(b);
  }
  $('more').disabled = matching(n).length <= 8;
  if (!el.children.length) $('more').disabled = true;
}

$('nsol').oninput = browse;
$('distinct').onchange = browse;
$('more').onclick = () => { if (!sample.length) browse(); else showMatches(); };

function randomPuzzle() {
  const counts = [...byCount.keys()];
  // pick among sets of six different pieces, uniformly
  const all = counts.flatMap(n => byCount.get(n).filter(isDistinct));
  if (!all.length) return;
  const k = all[Math.floor(Math.random() * all.length)];
  setPieces([...k].map(ch => shapeByLetter.get(ch).index));
}

/* ---------- charts: solution histogram and piece effects ---------- */

const tip = $('tip');
function hover(el, html) {
  el.addEventListener('pointermove', e => {
    tip.innerHTML = html;
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(e.clientX + 12, innerWidth - w - 8) + 'px';
    tip.style.top = (e.clientY - h - 12 < 4 ? e.clientY + 16 : e.clientY - h - 12) + 'px';
  });
  el.addEventListener('pointerleave', () => { tip.hidden = true; });
}

function findPuzzles(n) {
  $('distinct').checked = true;
  $('nsol').value = n;
  browse();
  $('nsol').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function drawHistogram() {
  // log2 bins, since counts run from 1 to several hundred; sets of six different pieces only
  const bins = [[0, 0], [1, 1], [2, 2], [3, 4], [5, 8], [9, 16], [17, 32], [33, 64], [65, 128], [129, 256], [257, 1e9]];
  const total = 80500;
  let solvable = 0;
  const vals = bins.map(([lo, hi]) => {
    let k = 0;
    for (const [n, keys] of byCount) if (n >= lo && n <= hi) k += keys.filter(isDistinct).length;
    solvable += k;
    return k;
  });
  vals[0] = total - solvable;
  const max = Math.max(...vals);
  const hist = $('hist'), xs = $('histX');
  bins.forEach(([lo, hi], i) => {
    const label = i === 0 ? '0' : hi >= 1e9 ? `${lo}+` : lo === hi ? `${lo}` : `${lo}–${hi}`;
    const b = document.createElement('button');
    if (i === 0) b.className = 'zero';
    const v = vals[i] >= 1000 ? (vals[i] / 1000).toFixed(1) + 'k' : String(vals[i]);
    b.innerHTML = `<span class="v">${v}</span><span class="bar" style="height:${(vals[i] / max * 88).toFixed(1)}%"></span>`;
    const pct = (vals[i] / total * 100).toFixed(vals[i] / total < 0.01 ? 2 : 1);
    hover(b, `<b>${label} solution${label === '1' ? '' : 's'}</b><br>${vals[i].toLocaleString()} sets (${pct}%)` +
      (i ? '<br>Click to find these puzzles' : '<br>These pieces can’t fill the cube'));
    if (i) b.onclick = () => findPuzzles(lo);
    else b.style.cursor = 'default';
    b.setAttribute('aria-label', `${label} solutions: ${vals[i]} sets`);
    hist.appendChild(b);
    xs.insertAdjacentHTML('beforeend', `<span>${label}</span>`);
  });
  const sorted = [];
  for (const [n, keys] of byCount) { const k = keys.filter(isDistinct).length; for (let j = 0; j < k; j++) sorted.push(n); }
  sorted.sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  $('histSub').textContent = `All 80,500 sets of six different pieces. ${Math.round(vals[0] / total * 100)}% can’t be solved; ` +
    `solvable sets have a median of ${median} solutions. Click a bar to find puzzles with that many.`;
}

async function drawEffects() {
  const text = await (await fetch('outputs/piece_effects.tsv')).text();
  const lines = text.trim().split('\n');
  const r2 = +(lines.find(l => l.startsWith('# r2')) || '').split('\t')[1];
  const rows = lines.filter(l => !l.startsWith('#')).slice(1).map(l => {
    const [name, factor, placements, , , solvable, mean] = l.split('\t');
    return { s: shapeByName.get(name), factor: +factor, placements: +placements, solvable: +solvable, mean: +mean };
  });
  const lo = Math.log2(0.33), hi = Math.log2(3);
  const x = f => ((Math.log2(f) - lo) / (hi - lo) * 100).toFixed(2) + '%';
  const el = $('effects');
  for (const size of [4, 5]) {
    const col = document.createElement('div');
    col.innerHTML = `<h3>${size === 4 ? 'Four' : 'Five'}-cube pieces</h3>`;
    for (const r of rows.filter(r => r.s.size === size)) {
      const up = r.factor >= 1;
      const color = up ? 'var(--series-1)' : 'var(--series-2)';
      const a = Math.min(x(1).slice(0, -1), x(r.factor).slice(0, -1)), b = Math.max(x(1).slice(0, -1), x(r.factor).slice(0, -1));
      const btn = document.createElement('button');
      btn.className = 'eff';
      btn.innerHTML = isoSVG(r.s.cells, NEUTRAL) + `<span class="n">${r.s.name}</span>` +
        `<span class="track"><span class="one" style="left:${x(1)}"></span>` +
        `<span class="stem" style="left:${a}%;width:${b - a}%"></span>` +
        `<span class="dot" style="left:${x(r.factor)};background:${color}"></span></span>` +
        `<span class="f">×${r.factor.toFixed(2)}</span>`;
      hover(btn, `<b>${r.s.name}</b> ×${r.factor.toFixed(2)}<br>${r.placements} ways to sit in the cube<br>` +
        `${Math.round(r.solvable * 100)}% of sets with it can be solved, averaging ${r.mean.toFixed(1)} solutions<br>` +
        (r.s.mirror === r.s.index ? 'Same as its mirror image' : `Mirror image of ${shapes[r.s.mirror].name}`));
      btn.onclick = () => addPiece(r.s.index);
      col.appendChild(btn);
    }
    col.insertAdjacentHTML('beforeend', `<div class="ticks">${[0.5, 1, 2].map(f => `<span style="left:${x(f)}">×${f}</span>`).join('')}</div>`);
    el.appendChild(col);
  }
  $('effNote').textContent = 'Effects come from fitting log(1 + solutions) as a sum of one term per piece over all 80,500 sets. ' +
    `That explains ${Math.round(r2 * 100)}% of the variation; the rest depends on which pieces fit together.`;
}

/* ---------- entering a solved cube ---------- */

function parseCube(text) {
  const layers = text.trim().split(/\s+/);
  if (layers.length !== 3) throw new Error('Give three layers separated by spaces.');
  const grid = new Array(27);
  layers.forEach((layer, L) => {
    const rows = layer.split('/');
    if (rows.length !== 3 || rows.some(r => [...r].length !== 3))
      throw new Error(`Layer ${L + 1} should be three rows of three, like 225/245/441.`);
    rows.forEach((row, r) => [...row].forEach((ch, x) => { grid[x + 3 * (2 - r) + 9 * (2 - L)] = ch; }));
  });
  const labels = [...new Set(grid)];
  const pieces = [], masks = [];
  for (const lab of labels) {
    const cells = [];
    let mask = 0;
    grid.forEach((ch, c) => { if (ch === lab) { cells.push(cellXYZ(c)); mask |= 1 << c; } });
    const s = cells.length >= 4 && cells.length <= 5 ? identify(cells) : -1;
    if (s < 0) throw new Error(`Piece “${lab}” is not a joined-up piece of four or five cubes.`);
    pieces.push(s);
    masks.push(mask);
  }
  const four = pieces.filter(i => i < NTETRA).length;
  if (four !== 3) throw new Error(`Found ${four} four-cube and ${pieces.length - four} five-cube pieces; need three of each.`);
  return { pieces, target: canonicalForm(masks) };
}

$('load').onclick = () => {
  $('cubeErr').textContent = '';
  try {
    const { pieces, target } = parseCube($('cubeText').value || $('cubeText').placeholder);
    setPieces(pieces, { target });
  } catch (e) { $('cubeErr').textContent = e.message; }
};
$('cubeText').onkeydown = e => { if (e.key === 'Enter') $('load').click(); };

/* ---------- page state in the URL: #bdgLOT/2 ---------- */

function writeHash() {
  const k = setKey(state.pieces);
  const h = k ? '#' + k + (state.sol ? '/' + (state.sol + 1) : '') : ' ';
  history.replaceState(null, '', h === ' ' ? location.pathname : h);
}

function readHash() {
  const m = location.hash.match(/^#([a-gA-Y]{0,6})(?:\/(\d+))?$/);
  if (!m) return false;
  const pieces = [...m[1]].map(ch => shapeByLetter.get(ch)).filter(Boolean).map(s => s.index);
  setPieces(pieces, { sol: m[2] ? +m[2] - 1 : 0 });
  return true;
}

$('original').onclick = () => setPieces([...ORIGINAL].map(ch => shapeByLetter.get(ch).index));
$('random').onclick = randomPuzzle;
$('clear').onclick = () => setPieces([]);

buildPalette();
if (!readHash()) $('original').click();
resize();
frame();
loadSets().then(drawHistogram);
drawEffects();
