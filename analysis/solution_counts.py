"""How many solutions do piece sets have, and which pieces drive the count?

Reads sets.txt (from `./cubes enumerate sets.txt`) and the shape list from
`./cubes shapes`. Only sets of six different pieces are analysed: 80,500 sets,
of which those absent from sets.txt have no solution and count as 0.

Writes outputs/solution_histogram.png, outputs/piece_effects.png and
outputs/piece_effects.tsv, and prints the tables behind them.

A piece's effect is its coefficient in a least-squares fit of
log2(1 + solutions) on indicators for the six pieces in the set. It is an
average over the sets the piece appears in, holding the other pieces' average
effects fixed; it does not say the piece helps in every set, and an additive
model on the log scale ignores which pairs of pieces fit well together.

Usage: python3 analysis/solution_counts.py   (from the repo root)
"""
import itertools
import os
import re
import subprocess
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "outputs")

SURFACE, INK, INK2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e2dc"
BLUE, ORANGE = "#2a78d6", "#eb6834"


def load_shapes():
    exe = os.path.join(ROOT, "cubes")
    if not os.path.exists(exe):
        subprocess.run(["cc", "-O3", "-o", exe, os.path.join(ROOT, "cubes.c")], check=True)
    shapes = {}
    for line in subprocess.run([exe, "shapes"], capture_output=True, text=True, check=True).stdout.splitlines():
        m = re.match(r"^(\d[a-z])\s+(.*?)\s{2,}(achiral|chiral, mirror of (\w+))\s+\((\d+) placements\)", line)
        if not m:
            continue
        name, pic, _, mirror, placements = m.groups()
        layers = pic.split()
        flat = len(layers) == 1
        shapes[name] = dict(name=name, size=int(name[0]), mirror=mirror or name,
                            placements=int(placements), flat=flat)
    return shapes


def load_counts(shapes):
    letter = {(n[1] if n[0] == "4" else n[1].upper()): n for n in shapes}
    counts = {}
    with open(os.path.join(ROOT, "sets.txt")) as f:
        for line in f:
            n, keys = line.split()
            for i in range(0, len(keys), 6):
                counts[tuple(sorted(letter[c] for c in keys[i:i + 6]))] = int(n)
    return counts


def main():
    shapes = load_shapes()
    counts = load_counts(shapes)
    four = sorted(n for n in shapes if n[0] == "4")
    five = sorted(n for n in shapes if n[0] == "5")
    sets = [tuple(sorted(a + b)) for a in itertools.combinations(four, 3) for b in itertools.combinations(five, 3)]
    y = np.array([counts.get(s, 0) for s in sets])
    os.makedirs(OUT, exist_ok=True)

    # ---- distribution ----
    print(f"{len(sets)} sets of six different pieces")
    print(f"  no solution   {np.sum(y == 0):6d}  ({np.mean(y == 0):.0%})")
    solv = y[y > 0]
    print(f"  solvable      {len(solv):6d}; median {int(np.median(solv))}, mean {solv.mean():.1f}, "
          f"90th percentile {int(np.percentile(solv, 90))}, max {solv.max()}")
    for lo, hi in [(1, 1), (2, 2), (3, 5), (6, 10), (11, 20), (21, 50), (51, 100), (101, 200), (201, 400)]:
        k = np.sum((y >= lo) & (y <= hi))
        print(f"  {lo:>3}-{hi:<3}       {k:6d}  ({k / len(sets):.1%})")

    # Even counts outnumber odd ones. A set equal to its own mirror set has its
    # solutions paired with their mirror images, so its count is odd only when
    # some solution is its own mirror image.
    selfmirror = np.array([tuple(sorted(shapes[p]["mirror"] for p in s)) == s for s in sets])
    for label, mask in [("own mirror set", selfmirror), ("other sets", ~selfmirror)]:
        v = y[mask & (y > 0)]
        print(f"  {label:15s} {mask.sum():6d} sets, {len(v)} solvable, {np.mean(v % 2 == 0):.0%} of those even")

    # histogram: log2 bins, since the counts span 1..395
    edges = [0, 1, 2, 3, 5, 9, 17, 33, 65, 129, 257, 513]
    labels = ["0", "1", "2", "3–4", "5–8", "9–16", "17–32", "33–64", "65–128", "129–256", "257+"]
    hist = [np.sum((y >= edges[i]) & (y < edges[i + 1])) for i in range(len(labels))]
    fig, ax = plt.subplots(figsize=(8, 4.2), dpi=150, facecolor=SURFACE)
    ax.set_facecolor(SURFACE)
    colors = [INK2 if i == 0 else BLUE for i in range(len(hist))]
    bars = ax.bar(range(len(hist)), hist, width=0.78, color=colors)
    for b, h in zip(bars, hist):
        ax.text(b.get_x() + b.get_width() / 2, h + 300, f"{h:,}", ha="center", va="bottom", fontsize=8, color=INK2)
    ax.set_xticks(range(len(labels)), labels, fontsize=9, color=INK2)
    ax.set_xlabel("Number of solutions (up to rotation)", color=INK2, fontsize=10)
    ax.set_ylabel("Piece sets", color=INK2, fontsize=10)
    ax.set_title("Solutions per set of six different pieces (80,500 sets)", loc="left", color=INK, fontsize=12)
    ax.yaxis.grid(True, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    ax.tick_params(axis="y", colors=INK2, labelsize=9)
    ax.tick_params(axis="x", length=0)
    ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"{int(v):,}"))
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color(GRID)
    ax.set_ylim(0, max(hist) * 1.1)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "solution_histogram.png"), facecolor=SURFACE)

    # ---- piece effects ----
    names = four + five
    X = np.zeros((len(sets), len(names)))
    for i, s in enumerate(sets):
        for p in s:
            X[i, names.index(p)] = 1
    ly = np.log2(1 + y)
    # within each size group the indicators sum to 3, so fit effects relative to
    # each group's mean: intercept + centred indicators (minimum-norm solution)
    A = np.hstack([np.ones((len(sets), 1)), X])
    coef = np.linalg.lstsq(A, ly, rcond=None)[0][1:]
    for grp in (four, five):
        idx = [names.index(p) for p in grp]
        coef[idx] -= coef[idx].mean()
    pred = A @ np.linalg.lstsq(A, ly, rcond=None)[0]
    r2 = 1 - np.sum((ly - pred) ** 2) / np.sum((ly - ly.mean()) ** 2)

    rows = []
    for j, p in enumerate(names):
        has = X[:, j] == 1
        rows.append(dict(name=p, effect=coef[j], factor=2 ** coef[j], placements=shapes[p]["placements"],
                         flat=shapes[p]["flat"], chiral=shapes[p]["mirror"] != p,
                         solvable=np.mean(y[has] > 0), median=np.median(y[has]), mean=y[has].mean()))
    rows.sort(key=lambda r: -r["effect"])
    print(f"\nPiece effects: additive model on log2(1 + solutions), R² = {r2:.2f}")
    print("piece  factor  placements  flat  chiral  solvable  mean solutions")
    with open(os.path.join(OUT, "piece_effects.tsv"), "w") as f:
        f.write(f"# r2\t{r2:.3f}\n")
        f.write("piece\tfactor\tplacements\tflat\tchiral\tsolvable\tmean_solutions\n")
        for r in rows:
            print(f"  {r['name']}   ×{r['factor']:.2f}   {r['placements']:5d}      {'yes' if r['flat'] else '  -'}"
                  f"    {'yes' if r['chiral'] else '  -'}    {r['solvable']:5.0%}    {r['mean']:6.1f}")
            f.write(f"{r['name']}\t{r['factor']:.3f}\t{r['placements']}\t{r['flat']}\t{r['chiral']}"
                    f"\t{r['solvable']:.3f}\t{r['mean']:.2f}\n")
    pl = np.array([r["placements"] for r in rows])
    ef = np.array([r["effect"] for r in rows])
    for size in (4, 5):
        m = np.array([r["name"][0] == str(size) for r in rows])
        print(f"  correlation of effect with log placements, {size}-cube pieces: "
              f"{np.corrcoef(np.log(pl[m]), ef[m])[0, 1]:.2f}")

    # dot chart: multiplicative effect per piece, sorted, split by size
    fig, axes = plt.subplots(1, 2, figsize=(9, 6.2), dpi=150, facecolor=SURFACE,
                             sharex=True, gridspec_kw=dict(width_ratios=[1, 1], wspace=0.35))
    nrows = len(five)
    for ax, size in zip(axes, (4, 5)):
        rs = [r for r in rows if r["name"][0] == str(size)][::-1]
        ax.set_facecolor(SURFACE)
        ypos = np.arange(len(rs)) + nrows - len(rs)   # same row spacing, top-aligned
        fac = [r["factor"] for r in rs]
        ax.hlines(ypos, 1, fac, color=GRID, linewidth=2)
        ax.scatter(fac, ypos, s=42, color=[BLUE if f >= 1 else ORANGE for f in fac], zorder=3,
                   edgecolor=SURFACE, linewidth=1.5)
        ax.axvline(1, color=INK2, linewidth=0.8)
        ax.set_yticks(ypos, [f"{r['name']}  ({r['placements']})" for r in rs], fontsize=8.5, color=INK2)
        ax.set_xscale("log", base=2)
        ax.xaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"×{v:g}"))
        ax.xaxis.grid(True, color=GRID, linewidth=0.8)
        ax.set_axisbelow(True)
        ax.tick_params(colors=INK2, labelsize=8.5, length=0)
        for s in ("top", "right", "left", "bottom"):
            ax.spines[s].set_visible(False)
        ax.set_title(f"{size}-cube pieces", loc="left", color=INK, fontsize=10.5)
        ax.set_ylim(-0.7, nrows - 0.3)
    fig.suptitle("Effect of each piece on (1 + solutions), relative to an average piece of its size",
                 x=0.02, ha="left", color=INK, fontsize=11.5)
    fig.text(0.02, 0.01, "Placements in the cube in brackets. Additive model on log scale over all 80,500 sets "
             f"of six different pieces; R² = {r2:.2f}.", color=INK2, fontsize=8)
    fig.subplots_adjust(left=0.1, right=0.98, top=0.9, bottom=0.08)
    fig.savefig(os.path.join(OUT, "piece_effects.png"), facecolor=SURFACE)


if __name__ == "__main__":
    sys.exit(main())
