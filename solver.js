// solver.js - the cubes.c solver in JavaScript, for the web page.
//
// Cells of the 3x3x3 cube are bits 0..26 of a mask, cell = x + 3y + 9z with
// x left->right, y front->back, z bottom->top. Shapes are generated and named
// exactly as cubes.c names them (4a-4g, 5a-5y), so names agree between the two.
// Pieces may be rotated but not mirrored; solutions are counted up to rotation
// of the whole cube.

export const FULL = (1 << 27) - 1;

const ROT = [];
{
  const perms = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
  for (const p of perms)
    for (let s = 0; s < 8; s++) {
      const m = [[0,0,0],[0,0,0],[0,0,0]];
      for (let i = 0; i < 3; i++) m[i][p[i]] = (s >> i & 1) ? -1 : 1;
      const det = m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])
                - m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])
                + m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
      if (det === 1) ROT.push(m);
    }
}

const apply = (m, c) => [0,1,2].map(a => m[a][0]*c[0] + m[a][1]*c[1] + m[a][2]*c[2]);
const code = c => c[0]*25 + c[1]*5 + c[2];

function normalize(cells) {
  const mn = [0,1,2].map(a => Math.min(...cells.map(c => c[a])));
  return cells.map(c => c.map((v, a) => v - mn[a])).sort((p, q) => code(p) - code(q));
}
// same order as cubes.c's packed key for equal-size pieces
const key = cells => cells.map(c => String(code(c)).padStart(3, '0')).join('');
const rotate = (cells, g) => normalize(cells.map(c => apply(ROT[g], c)));
function canonKey(cells) {
  let best = null;
  for (let g = 0; g < 24; g++) { const k = key(rotate(cells, g)); if (best === null || k < best) best = k; }
  return best;
}

// cube rotations as cell permutations and 9-bit lookup tables
const CELLPERM = ROT.map(m => {
  const perm = [];
  for (let c = 0; c < 27; c++) {
    const q = apply(m, [c % 3 - 1, Math.floor(c / 3) % 3 - 1, Math.floor(c / 9) - 1]).map(v => v + 1);
    perm.push(q[0] + 3*q[1] + 9*q[2]);
  }
  return perm;
});
const ROTTAB = CELLPERM.map(perm => [0,1,2].map(ch => {
  const t = new Int32Array(512);
  for (let m = 0; m < 512; m++) {
    let r = 0;
    for (let b = 0; b < 9; b++) if (m >> b & 1) r |= 1 << perm[ch*9 + b];
    t[m] = r;
  }
  return t;
}));
const rotmask = (g, m) => ROTTAB[g][0][m & 511] | ROTTAB[g][1][m >> 9 & 511] | ROTTAB[g][2][m >> 18];
export const ctz = x => 31 - Math.clz32(x & -x);

export const shapes = [];

function genShapes(n) {
  let cur = [[[0,0,0]]];
  for (let size = 2; size <= n; size++) {
    const seen = new Map();
    for (const p of cur)
      for (const c of p)
        for (let d = 0; d < 6; d++) {
          const nc = c.slice(); nc[d >> 1] += d & 1 ? 1 : -1;
          if (p.some(q => q[0] === nc[0] && q[1] === nc[1] && q[2] === nc[2])) continue;
          const q = normalize([...p, nc]);
          seen.set(key(q), q);
        }
    cur = [...seen.values()];
  }
  const classes = new Map();
  for (const p of cur) { const k = canonKey(p); if (!classes.has(k)) classes.set(k, p); }
  const ks = [...classes.keys()].sort();
  const out = [];
  for (const k of ks) {
    const p = classes.get(k);
    let display = null, flat = 0;
    const pl = new Set();
    for (let g = 0; g < 24; g++) {
      const q = rotate(p, g);
      const mx = [0,1,2].map(a => Math.max(...q.map(c => c[a])));
      if (mx.some(v => v > 2)) continue;
      if (display === null || mx[2]*3 + mx[1] < flat) { display = q; flat = mx[2]*3 + mx[1]; }
      for (let tx = 0; tx + mx[0] <= 2; tx++)
        for (let ty = 0; ty + mx[1] <= 2; ty++)
          for (let tz = 0; tz + mx[2] <= 2; tz++) {
            let m = 0;
            for (const c of q) m |= 1 << ((c[0]+tx) + 3*(c[1]+ty) + 9*(c[2]+tz));
            pl.add(m);
          }
    }
    if (display) out.push({ size: n, cells: display, key: k, placements: [...pl] });
  }
  return out;
}

shapes.push(...genShapes(4));
export const NTETRA = shapes.length;
shapes.push(...genShapes(5));
shapes.forEach((s, i) => {
  s.index = i;
  s.name = s.size + String.fromCharCode(97 + (i < NTETRA ? i : i - NTETRA));
  // one-letter code used in sets.txt: 4x -> 'x', 5x -> 'X'
  s.letter = s.size === 4 ? s.name[1] : s.name[1].toUpperCase();
  s.byCell = Array.from({ length: 27 }, () => []);
  for (const m of s.placements) s.byCell[ctz(m)].push(m);
});
const byKey = new Map(shapes.map(s => [s.key, s]));
shapes.forEach(s => {
  s.mirror = byKey.get(canonKey(s.cells.map(c => [-c[0], c[1], c[2]]))).index;
});
export const shapeByLetter = new Map(shapes.map(s => [s.letter, s]));
export const shapeByName = new Map(shapes.map(s => [s.name, s]));

/** shape index of a set of cells, or -1 if it is not one of the shapes */
export function identify(cells) {
  const s = byKey.get(canonKey(normalize(cells)));
  return s ? s.index : -1;
}

function isCanonical(sorted) {
  const n = sorted.length, r = new Array(n);
  for (let g = 1; g < 24; g++) {
    for (let i = 0; i < n; i++) r[i] = rotmask(g, sorted[i]);
    r.sort((a, b) => a - b);
    for (let i = 0; i < n; i++) {
      if (r[i] < sorted[i]) return false;
      if (r[i] > sorted[i]) break;
    }
  }
  return true;
}

/**
 * All solutions for a list of shape indices (repeats allowed).
 * Returns { raw, solutions } where raw counts every orientation and each
 * solution is one representative per rotation class: an array of
 * { shape, mask } in the order of the input pieces.
 */
export function solve(pieceShapes) {
  const count = new Map();
  for (const s of pieceShapes) count.set(s, (count.get(s) || 0) + 1);
  const kinds = [...count.keys()].sort((a, b) => a - b);
  const masks = [], shapeOf = [], found = [];
  let raw = 0;
  (function rec(filled, depth) {
    if (filled === FULL) {
      raw++;
      const sorted = masks.slice(0, depth).sort((a, b) => a - b);
      if (isCanonical(sorted))
        found.push(masks.slice(0, depth).map((m, i) => ({ shape: shapeOf[i], mask: m })));
      return;
    }
    const c = ctz(~filled & FULL);
    for (const s of kinds) {
      const k = count.get(s);
      if (!k) continue;
      count.set(s, k - 1);
      shapeOf[depth] = s;
      for (const m of shapes[s].byCell[c]) {
        if (m & filled) continue;
        masks[depth] = m;
        rec(filled | m, depth + 1);
      }
      count.set(s, k);
    }
  })(0, 0);
  // match placed pieces back to input order
  const solutions = found.map(sol => {
    const left = sol.slice();
    return pieceShapes.map(s => left.splice(left.findIndex(p => p.shape === s), 1)[0]);
  });
  return { raw, solutions };
}

export const cellXYZ = c => [c % 3, Math.floor(c / 3) % 3, Math.floor(c / 9)];

/** the rotation-independent form of a filled cube (masks of its pieces), as a string */
export function canonicalForm(masks) {
  let best = null;
  for (let g = 0; g < 24; g++) {
    const k = masks.map(m => rotmask(g, m)).sort((a, b) => a - b).join(',');
    if (best === null || k < best) best = k;
  }
  return best;
}
