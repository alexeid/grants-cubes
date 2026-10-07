/*
 * cubes.c - solution finder for "grandad's cubes" puzzles:
 * fill a 3x3x3 cube with polycube pieces (by default 3 tetracubes + 3 pentacubes).
 *
 * Pieces are physical, so they may be rotated but not mirrored: a chiral piece
 * and its mirror image are different pieces. Solutions are counted up to
 * rotation of the whole cube.
 *
 * Build:  cc -O3 -o cubes cubes.c
 * Usage:  ./cubes shapes                       list piece shapes and their names
 *         ./cubes solve 225/245/441 245/641/631 655/661/333
 *                                             solve the puzzle whose pieces are
 *                                             given by a filled cube (layers top
 *                                             to bottom, rows separated by '/')
 *         ./cubes solve 4a 4c 4e 5b 5k 5q      solve a puzzle given by shape names
 *         ./cubes enumerate [out.tsv]          count solutions of every piece set
 *         ./cubes enumerate sets.txt           ... in the compact form the web page reads
 *
 * Layer format: three layers listed top to bottom; within a layer, rows are
 * listed back to front and each row left to right, as seen looking down on the
 * cube. Any non-'/' character can label a piece.
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define FULL ((1u << 27) - 1)
#define MAXSHAPES 64
#define MAXPL 512

typedef struct { int n; int c[5][3]; } Poly;

typedef struct {
    int size;
    char name[4];
    Poly canon;          /* an orientation that fits in the cube */
    int mirror;          /* shape id of the mirror image (self if achiral) */
    int npl;
    uint32_t pl[MAXPL];  /* all placements in the cube */
} Shape;

static int rot[24][3][3];
static int cellperm[24][27];
static uint32_t rottab[24][3][512];
static Shape shapes[MAXSHAPES];
static int nshapes, ntetra;

/* placements of shape s whose lowest cell is c */
static uint32_t *bycell[MAXSHAPES][27];
static int nbycell[MAXSHAPES][27];

/* ---------- geometry ---------- */

static void gen_rotations(void) {
    static const int perms[6][3] = {{0,1,2},{0,2,1},{1,0,2},{1,2,0},{2,0,1},{2,1,0}};
    int n = 0;
    for (int p = 0; p < 6; p++)
        for (int s = 0; s < 8; s++) {
            int m[3][3] = {{0}};
            for (int i = 0; i < 3; i++) m[i][perms[p][i]] = (s >> i & 1) ? -1 : 1;
            int det = m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])
                    - m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])
                    + m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
            if (det != 1) continue;
            memcpy(rot[n++], m, sizeof m);   /* identity is generated first */
        }
    for (int g = 0; g < 24; g++)
        for (int c = 0; c < 27; c++) {
            int p[3] = {c % 3 - 1, c / 3 % 3 - 1, c / 9 - 1}, q[3];
            for (int a = 0; a < 3; a++)
                q[a] = rot[g][a][0]*p[0] + rot[g][a][1]*p[1] + rot[g][a][2]*p[2] + 1;
            cellperm[g][c] = q[0] + 3*q[1] + 9*q[2];
        }
    for (int g = 0; g < 24; g++)
        for (int ch = 0; ch < 3; ch++)
            for (int m = 0; m < 512; m++) {
                uint32_t r = 0;
                for (int b = 0; b < 9; b++)
                    if (m >> b & 1) r |= 1u << cellperm[g][ch*9 + b];
                rottab[g][ch][m] = r;
            }
}

static inline uint32_t rotmask(int g, uint32_t m) {
    return rottab[g][0][m & 511] | rottab[g][1][m >> 9 & 511] | rottab[g][2][m >> 18];
}

static int code(const int *c) { return c[0]*25 + c[1]*5 + c[2]; }

static void normalize(Poly *p) {
    int mn[3] = {99, 99, 99};
    for (int i = 0; i < p->n; i++)
        for (int a = 0; a < 3; a++) if (p->c[i][a] < mn[a]) mn[a] = p->c[i][a];
    for (int i = 0; i < p->n; i++)
        for (int a = 0; a < 3; a++) p->c[i][a] -= mn[a];
    for (int i = 1; i < p->n; i++)          /* insertion sort by code */
        for (int j = i; j > 0 && code(p->c[j]) < code(p->c[j-1]); j--) {
            int t[3]; memcpy(t, p->c[j], sizeof t);
            memcpy(p->c[j], p->c[j-1], sizeof t); memcpy(p->c[j-1], t, sizeof t);
        }
}

static uint64_t key(const Poly *p) {
    uint64_t k = p->n;
    for (int i = 0; i < p->n; i++) k = k << 7 | code(p->c[i]);
    return k;
}

static void rotate(const Poly *in, int g, Poly *out) {
    out->n = in->n;
    for (int i = 0; i < in->n; i++)
        for (int a = 0; a < 3; a++)
            out->c[i][a] = rot[g][a][0]*in->c[i][0] + rot[g][a][1]*in->c[i][1]
                         + rot[g][a][2]*in->c[i][2];
    normalize(out);
}

static uint64_t canon_key(const Poly *p) {
    uint64_t best = UINT64_MAX;
    for (int g = 0; g < 24; g++) {
        Poly q; rotate(p, g, &q);
        uint64_t k = key(&q);
        if (k < best) best = k;
    }
    return best;
}

static int find_shape(const Poly *p) {
    uint64_t k = canon_key(p);
    for (int s = 0; s < nshapes; s++)
        if (canon_key(&shapes[s].canon) == k) return s;
    return -1;
}

/* ---------- shape generation ---------- */

static int cmp_u64(const void *a, const void *b) {
    uint64_t x = *(const uint64_t *)a, y = *(const uint64_t *)b;
    return x < y ? -1 : x > y;
}

/* all one-sided polycubes of size n that fit in the 3x3x3 cube */
static void gen_shapes(int n) {
    static Poly cur[2000], nxt[2000];
    static uint64_t keys[2000];
    int ncur = 1;
    cur[0].n = 1; memset(cur[0].c, 0, sizeof cur[0].c);
    for (int size = 2; size <= n; size++) {
        int nn = 0;
        for (int i = 0; i < ncur; i++)
            for (int j = 0; j < cur[i].n; j++)
                for (int d = 0; d < 6; d++) {
                    int c[3]; memcpy(c, cur[i].c[j], sizeof c);
                    c[d / 2] += d & 1 ? 1 : -1;
                    int dup = 0;
                    for (int k = 0; k < cur[i].n; k++)
                        if (!memcmp(cur[i].c[k], c, sizeof c)) dup = 1;
                    if (dup) continue;
                    Poly q = cur[i];
                    memcpy(q.c[q.n++], c, sizeof c);
                    normalize(&q);
                    uint64_t k = key(&q);
                    int seen = 0;
                    for (int m = 0; m < nn && !seen; m++) seen = keys[m] == k;
                    if (!seen) { keys[nn] = k; nxt[nn++] = q; }
                }
        memcpy(cur, nxt, nn * sizeof(Poly));
        ncur = nn;
    }
    /* reduce fixed polycubes to one-sided (rotation classes) */
    uint64_t ck[2000]; int ncls = 0;
    for (int i = 0; i < ncur; i++) {
        uint64_t k = canon_key(&cur[i]);
        int seen = 0;
        for (int m = 0; m < ncls && !seen; m++) seen = ck[m] == k;
        if (!seen) ck[ncls++] = k;
    }
    qsort(ck, ncls, sizeof *ck, cmp_u64);
    for (int i = 0; i < ncls; i++) {
        Poly p; p.n = n;
        uint64_t k = ck[i];
        for (int j = n - 1; j >= 0; j--, k >>= 7) {
            int cd = k & 127;
            p.c[j][0] = cd / 25; p.c[j][1] = cd / 5 % 5; p.c[j][2] = cd % 5;
        }
        Shape *s = &shapes[nshapes];
        s->size = n; s->npl = 0;
        int have_canon = 0, flat = 0;
        for (int g = 0; g < 24; g++) {
            Poly q; rotate(&p, g, &q);
            int mx[3] = {0, 0, 0};
            for (int j = 0; j < n; j++)
                for (int a = 0; a < 3; a++) if (q.c[j][a] > mx[a]) mx[a] = q.c[j][a];
            if (mx[0] > 2 || mx[1] > 2 || mx[2] > 2) continue;
            /* display orientation: flattest, then shallowest */
            if (!have_canon || mx[2]*3 + mx[1] < flat) { s->canon = q; flat = mx[2]*3 + mx[1]; }
            have_canon = 1;
            for (int tx = 0; tx + mx[0] <= 2; tx++)
                for (int ty = 0; ty + mx[1] <= 2; ty++)
                    for (int tz = 0; tz + mx[2] <= 2; tz++) {
                        uint32_t m = 0;
                        for (int j = 0; j < n; j++)
                            m |= 1u << ((q.c[j][0]+tx) + 3*(q.c[j][1]+ty) + 9*(q.c[j][2]+tz));
                        int dup = 0;
                        for (int t = 0; t < s->npl && !dup; t++) dup = s->pl[t] == m;
                        if (!dup) s->pl[s->npl++] = m;
                    }
        }
        if (!have_canon) continue;   /* too long to fit */
        nshapes++;
    }
}

static void init(void) {
    gen_rotations();
    gen_shapes(4);
    ntetra = nshapes;
    gen_shapes(5);
    for (int s = 0; s < nshapes; s++) {
        int idx = s < ntetra ? s : s - ntetra;
        snprintf(shapes[s].name, sizeof shapes[s].name, "%d%c", shapes[s].size, 'a' + idx);
        Poly m = shapes[s].canon;
        for (int j = 0; j < m.n; j++) m.c[j][0] = -m.c[j][0];
        normalize(&m);
        shapes[s].mirror = find_shape(&m);
        for (int c = 0; c < 27; c++) {
            bycell[s][c] = malloc(MAXPL * sizeof(uint32_t));
            nbycell[s][c] = 0;
        }
        for (int t = 0; t < shapes[s].npl; t++) {
            uint32_t m2 = shapes[s].pl[t];
            int c = __builtin_ctz(m2);
            bycell[s][c][nbycell[s][c]++] = m2;
        }
    }
}

/* ---------- symmetry ---------- */

static void sort_masks(uint32_t *a, int n) {
    for (int i = 1; i < n; i++)
        for (int j = i; j > 0 && a[j] < a[j-1]; j--) { uint32_t t = a[j]; a[j] = a[j-1]; a[j-1] = t; }
}

/* is the tiling (sorted masks) the lexicographically smallest of its rotations? */
static int is_canonical(const uint32_t *sorted, int n) {
    uint32_t r[27];
    for (int g = 1; g < 24; g++) {
        for (int i = 0; i < n; i++) r[i] = rotmask(g, sorted[i]);
        sort_masks(r, n);
        for (int i = 0; i < n; i++) {
            if (r[i] < sorted[i]) return 0;
            if (r[i] > sorted[i]) break;
        }
    }
    return 1;
}

/* ---------- solving one puzzle ---------- */

typedef struct {
    int npieces;
    int shape_count[MAXSHAPES];
    uint32_t masks[27];
    int shape_of[27];
    long raw;
    int nsol, capsol;
    uint32_t (*sols)[27];
    int (*solshape)[27];
} Solver;

static void solve_rec(Solver *S, uint32_t filled, int depth) {
    if (filled == FULL) {
        S->raw++;
        uint32_t m[27]; int sh[27];
        memcpy(m, S->masks, depth * sizeof *m);
        sort_masks(m, depth);
        if (!is_canonical(m, depth)) return;
        for (int i = 0; i < depth; i++)
            for (int j = 0; j < depth; j++) if (S->masks[j] == m[i]) sh[i] = S->shape_of[j];
        if (S->nsol == S->capsol) {
            S->capsol = S->capsol ? 2 * S->capsol : 16;
            S->sols = realloc(S->sols, S->capsol * sizeof *S->sols);
            S->solshape = realloc(S->solshape, S->capsol * sizeof *S->solshape);
        }
        memcpy(S->sols[S->nsol], m, sizeof m);
        memcpy(S->solshape[S->nsol], sh, sizeof sh);
        S->nsol++;
        return;
    }
    int c = __builtin_ctz(~filled);
    for (int s = 0; s < nshapes; s++) {
        if (!S->shape_count[s]) continue;
        S->shape_count[s]--;
        S->shape_of[depth] = s;
        for (int t = 0; t < nbycell[s][c]; t++) {
            uint32_t m = bycell[s][c][t];
            if (m & filled) continue;
            S->masks[depth] = m;
            solve_rec(S, filled | m, depth + 1);
        }
        S->shape_count[s]++;
    }
}

static void print_solution(const uint32_t *m, const int *sh, int n, const int *piece_shape,
                           const char *labels, int npieces) {
    char cell[27], used[27] = {0};
    for (int i = 0; i < n; i++) {
        char lab = '?';
        for (int p = 0; p < npieces; p++)
            if (!used[p] && piece_shape[p] == sh[i]) { used[p] = 1; lab = labels[p]; break; }
        for (int c = 0; c < 27; c++) if (m[i] >> c & 1) cell[c] = lab;
    }
    /* layer L (top first) -> z = 2-L; row r (back first) -> y = 2-r; column -> x */
    for (int L = 0; L < 3; L++) {
        printf("  ");
        for (int r = 0; r < 3; r++) {
            for (int x = 0; x < 3; x++) putchar(cell[x + 3*(2-r) + 9*(2-L)]);
            if (r < 2) putchar('/');
        }
        printf(L < 2 ? "  " : "\n");
    }
}

static int cmd_solve(int argc, char **argv) {
    int piece_shape[27], npieces = 0;
    char labels[27];
    if (argc == 3 && strchr(argv[0], '/')) {
        char grid[27]; int k = 0;
        for (int L = 0; L < 3; L++) {
            const char *s = argv[L]; int r = 0, x = 0;
            for (; *s; s++) {
                if (*s == '/') { r++; x = 0; continue; }
                if (r > 2 || x > 2) { fprintf(stderr, "bad layer '%s'\n", argv[L]); return 1; }
                grid[x + 3*(2-r) + 9*(2-L)] = *s; x++; k++;
            }
        }
        if (k != 27) { fprintf(stderr, "expected 27 cells, got %d\n", k); return 1; }
        for (int c = 0; c < 27; c++) {
            if (memchr(labels, grid[c], npieces)) continue;
            Poly p = {0};
            for (int d = 0; d < 27; d++)
                if (grid[d] == grid[c]) {
                    if (p.n == 5) { fprintf(stderr, "piece '%c' has more than 5 cells\n", grid[c]); return 1; }
                    p.c[p.n][0] = d % 3; p.c[p.n][1] = d / 3 % 3; p.c[p.n][2] = d / 9; p.n++;
                }
            normalize(&p);
            int s = p.n >= 4 ? find_shape(&p) : -1;
            if (s < 0) { fprintf(stderr, "piece '%c' is not a connected tetracube or pentacube\n", grid[c]); return 1; }
            labels[npieces] = grid[c];
            piece_shape[npieces++] = s;
        }
    } else {
        for (int i = 0; i < argc; i++) {
            int s = -1;
            for (int t = 0; t < nshapes; t++) if (!strcmp(shapes[t].name, argv[i])) s = t;
            if (s < 0) { fprintf(stderr, "unknown shape '%s' (see: cubes shapes)\n", argv[i]); return 1; }
            labels[npieces] = npieces < 9 ? '1' + npieces : 'A' + npieces - 9;
            piece_shape[npieces++] = s;
        }
    }
    int cells = 0;
    Solver S; memset(&S, 0, sizeof S);
    printf("Pieces:");
    for (int p = 0; p < npieces; p++) {
        printf(" %c=%s", labels[p], shapes[piece_shape[p]].name);
        cells += shapes[piece_shape[p]].size;
        S.shape_count[piece_shape[p]]++;
    }
    printf("\n");
    if (cells != 27) { fprintf(stderr, "pieces cover %d cells, need 27\n", cells); return 1; }
    solve_rec(&S, 0, 0);
    printf("%d solution%s up to rotation (%ld counting all 24 orientations)\n",
           S.nsol, S.nsol == 1 ? "" : "s", S.raw);
    printf("Layers top -> bottom, rows back -> front:\n");
    for (int i = 0; i < S.nsol; i++) {
        printf("%3d:", i + 1);
        print_solution(S.sols[i], S.solshape[i], npieces, piece_shape, labels, npieces);
    }
    return 0;
}

/* ---------- listing shapes ---------- */

static int cmd_shapes(void) {
    printf("%d tetracubes and %d pentacubes fit in the 3x3x3 cube.\n", ntetra, nshapes - ntetra);
    printf("Pictures: layers top -> bottom (separated by spaces), rows back -> front\n(separated by '/'), '#' = cube.\n\n");
    for (int s = 0; s < nshapes; s++) {
        const Poly *p = &shapes[s].canon;
        char g[27]; memset(g, '.', 27);
        for (int j = 0; j < p->n; j++) g[p->c[j][0] + 3*p->c[j][1] + 9*p->c[j][2]] = '#';
        int mx[3] = {0, 0, 0};
        for (int j = 0; j < p->n; j++)
            for (int a = 0; a < 3; a++) if (p->c[j][a] > mx[a]) mx[a] = p->c[j][a];
        printf("%-3s ", shapes[s].name);
        int width = 0;
        for (int z = mx[2]; z >= 0; z--) {
            for (int y = mx[1]; y >= 0; y--) {
                for (int x = 0; x <= mx[0]; x++) putchar(g[x + 3*y + 9*z]);
                if (y) putchar('/');
            }
            width += (mx[1] + 1) * (mx[0] + 2) + 1;
            if (z) printf("  ");
        }
        printf("%*s", 26 - width, "");
        if (shapes[s].mirror == s) printf("achiral");
        else printf("chiral, mirror of %s", shapes[shapes[s].mirror].name);
        printf("  (%d placements)\n", shapes[s].npl);
    }
    return 0;
}

/* ---------- enumerating all piece sets ---------- */

/* every tiling by 3 tetracubes + 3 pentacubes, tallied by piece multiset */
#define HBITS 20
static uint64_t hkey[1 << HBITS];
static long hraw[1 << HBITS], huniq[1 << HBITS];
static uint32_t emask[6];
static int eshape[6];

static long *slot(uint64_t k) {
    uint64_t h = (k * 0x9E3779B97F4A7C15ull) >> (64 - HBITS);
    while (hkey[h] && hkey[h] != k) h = (h + 1) & ((1 << HBITS) - 1);
    hkey[h] = k;
    return &hraw[h];
}

static void enum_rec(uint32_t filled, int nt, int np, int depth) {
    if (depth == 6) {
        int sh[6]; memcpy(sh, eshape, sizeof sh);
        for (int i = 1; i < 6; i++)
            for (int j = i; j > 0 && sh[j] < sh[j-1]; j--) { int t = sh[j]; sh[j] = sh[j-1]; sh[j-1] = t; }
        uint64_t k = 1;
        for (int i = 0; i < 6; i++) k = k << 6 | sh[i];
        long *r = slot(k);
        (*r)++;
        uint32_t m[6]; memcpy(m, emask, sizeof m);
        sort_masks(m, 6);
        if (is_canonical(m, 6)) huniq[r - hraw]++;
        return;
    }
    int c = __builtin_ctz(~filled);
    int lo = nt < 3 ? 0 : ntetra, hi = np < 3 ? nshapes : ntetra;
    for (int s = lo; s < hi; s++) {
        int t4 = s < ntetra;
        eshape[depth] = s;
        for (int t = 0; t < nbycell[s][c]; t++) {
            uint32_t m = bycell[s][c][t];
            if (m & filled) continue;
            emask[depth] = m;
            enum_rec(filled | m, nt + t4, np + !t4, depth + 1);
        }
    }
}

typedef struct { int sh[6]; long raw, uniq; int distinct; } SetRec;

static int cmp_set(const void *a, const void *b) {
    const SetRec *x = a, *y = b;
    if (x->uniq != y->uniq) return x->uniq < y->uniq ? 1 : -1;
    for (int i = 0; i < 6; i++) if (x->sh[i] != y->sh[i]) return x->sh[i] - y->sh[i];
    return 0;
}

static long choose(long n, long k) {
    long r = 1;
    for (long i = 0; i < k; i++) r = r * (n - i) / (i + 1);
    return r;
}

static void print_hist(const char *title, SetRec *sets, int n, int distinct_only, long total) {
    long maxu = 0, solvable = 0;
    for (int i = 0; i < n; i++)
        if (!distinct_only || sets[i].distinct) { solvable++; if (sets[i].uniq > maxu) maxu = sets[i].uniq; }
    printf("\n%s: %ld possible sets, %ld solvable, %ld unsolvable\n", title, total, solvable, total - solvable);
    printf("  solutions  sets\n");
    long *h = calloc(maxu + 1, sizeof *h);
    for (int i = 0; i < n; i++)
        if (!distinct_only || sets[i].distinct) h[sets[i].uniq]++;
    static const long edges[] = {1, 2, 3, 4, 5, 6, 11, 21, 51, 101, 201, 1L << 40};
    for (int b = 0; b + 1 < (int)(sizeof edges / sizeof *edges) && edges[b] <= maxu; b++) {
        long cnt = 0, hi = edges[b+1] - 1 < maxu ? edges[b+1] - 1 : maxu;
        for (long u = edges[b]; u <= hi; u++) cnt += h[u];
        if (hi == edges[b]) printf("  %9ld  %ld\n", hi, cnt);
        else printf("  %4ld-%-4ld  %ld\n", edges[b], hi, cnt);
    }
    free(h);
}

static int cmd_enumerate(const char *out) {
    enum_rec(0, 0, 0, 0);
    int n = 0;
    SetRec *sets = malloc(sizeof(SetRec) * (1 << HBITS));
    long totraw = 0, totuniq = 0;
    for (int h = 0; h < (1 << HBITS); h++) {
        if (!hkey[h]) continue;
        SetRec *r = &sets[n++];
        uint64_t k = hkey[h];
        for (int i = 5; i >= 0; i--, k >>= 6) r->sh[i] = k & 63;
        r->raw = hraw[h]; r->uniq = huniq[h];
        r->distinct = 1;
        for (int i = 1; i < 6; i++) if (r->sh[i] == r->sh[i-1]) r->distinct = 0;
        totraw += r->raw; totuniq += r->uniq;
    }
    qsort(sets, n, sizeof *sets, cmp_set);
    int npent = nshapes - ntetra;
    printf("%ld tilings of the cube (%ld up to rotation), %d solvable piece sets\n",
           totraw, totuniq, n);
    print_hist("Sets of 6 different pieces", sets, n, 1, choose(ntetra, 3) * choose(npent, 3));
    print_hist("Sets allowing repeated pieces", sets, n, 0,
               choose(ntetra + 2, 3) * choose(npent + 2, 3));
    size_t ol = out ? strlen(out) : 0;
    if (out && ol > 4 && !strcmp(out + ol - 4, ".txt")) {
        /* compact form for the web page: one line per solution count, then each
           set as 6 letters - tetracube 4x as 'x', pentacube 5x as 'X' */
        FILE *f = fopen(out, "w");
        if (!f) { perror(out); return 1; }
        for (int i = 0; i < n; i++) {
            if (i == 0 || sets[i].uniq != sets[i-1].uniq)
                fprintf(f, "%s%ld ", i ? "\n" : "", sets[i].uniq);
            for (int j = 0; j < 6; j++) {
                const char *nm = shapes[sets[i].sh[j]].name;
                fputc(nm[0] == '4' ? nm[1] : nm[1] - 'a' + 'A', f);
            }
        }
        fputc('\n', f);
        fclose(f);
        printf("\nWrote %d sets to %s\n", n, out);
    } else if (out) {
        FILE *f = fopen(out, "w");
        if (!f) { perror(out); return 1; }
        fprintf(f, "solutions\tall_orientations\tdistinct_pieces\tpieces\tmirror_set\n");
        for (int i = 0; i < n; i++) {
            fprintf(f, "%ld\t%ld\t%s\t", sets[i].uniq, sets[i].raw, sets[i].distinct ? "yes" : "no");
            for (int j = 0; j < 6; j++) fprintf(f, "%s%s", j ? " " : "", shapes[sets[i].sh[j]].name);
            int m[6];
            for (int j = 0; j < 6; j++) m[j] = shapes[sets[i].sh[j]].mirror;
            for (int a = 1; a < 6; a++)
                for (int b = a; b > 0 && m[b] < m[b-1]; b--) { int t = m[b]; m[b] = m[b-1]; m[b-1] = t; }
            fputc('\t', f);
            for (int j = 0; j < 6; j++) fprintf(f, "%s%s", j ? " " : "", shapes[m[j]].name);
            fputc('\n', f);
        }
        fclose(f);
        printf("\nWrote %d sets to %s (sorted by number of solutions)\n", n, out);
    }
    return 0;
}

int main(int argc, char **argv) {
    init();
    if (argc >= 2 && !strcmp(argv[1], "shapes")) return cmd_shapes();
    if (argc >= 3 && !strcmp(argv[1], "solve")) return cmd_solve(argc - 2, argv + 2);
    if (argc >= 2 && !strcmp(argv[1], "enumerate")) return cmd_enumerate(argc >= 3 ? argv[2] : NULL);
    fprintf(stderr,
        "usage: cubes shapes\n"
        "       cubes solve <top> <middle> <bottom>   e.g. 225/245/441 245/641/631 655/661/333\n"
        "       cubes solve <shape> ...               e.g. 4a 4c 4e 5b 5k 5q\n"
        "       cubes enumerate [out.tsv | out.txt]\n");
    return 2;
}
