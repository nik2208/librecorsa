"""World-space triangle soup with fast vertical-ray and colour queries, plus 2D raster helpers."""
import numpy as np
import cv2

import glbio


class TriSoup:
    """Near-horizontal triangles (|ny| > min_ny) indexed on a uniform XZ grid."""

    def __init__(self, tris, mats, cols, cell=4.0, min_ny=0.35):
        n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
        ln = np.linalg.norm(n, axis=1)
        ok = ln > 1e-9
        ny = np.zeros(len(tris))
        ny[ok] = np.abs(n[ok, 1]) / ln[ok]
        keep = ok & (ny > min_ny)
        self.t = tris[keep]
        self.mat = mats[keep]
        self.col = cols[keep]
        self.cell = cell
        xz = self.t[:, :, [0, 2]]
        mn = xz.min(1)
        mx = xz.max(1)
        self.lo = mn.min(0) - cell
        hi = mx.max(0) + cell
        self.nx = int((hi[0] - self.lo[0]) / cell) + 1
        self.nz = int((hi[1] - self.lo[1]) / cell) + 1
        c0 = ((mn - self.lo) / cell).astype(np.int64)
        c1 = ((mx - self.lo) / cell).astype(np.int64)
        span = (c1 - c0 + 1)
        cnt = span[:, 0] * span[:, 1]
        cnt[cnt > 2500] = 0  # giant ground planes: skipped (use a coarser fallback if ever needed)
        ids = np.repeat(np.arange(len(self.t)), cnt)
        start = np.repeat(np.cumsum(cnt) - cnt, cnt)
        k = np.arange(len(ids)) - start
        sx = span[ids, 0]
        dz = k // sx
        dx = k % sx
        cells = (c0[ids, 1] + dz) * self.nx + (c0[ids, 0] + dx)
        order = np.argsort(cells, kind='stable')
        self.cells_sorted = cells[order]
        self.ids_sorted = ids[order]

    def candidates(self, x, z):
        cx = int((x - self.lo[0]) / self.cell)
        cz = int((z - self.lo[1]) / self.cell)
        if cx < 0 or cz < 0 or cx >= self.nx or cz >= self.nz:
            return np.empty(0, np.int64)
        key = cz * self.nx + cx
        a = np.searchsorted(self.cells_sorted, key, 'left')
        b = np.searchsorted(self.cells_sorted, key, 'right')
        return self.ids_sorted[a:b]

    def hits(self, x, z):
        """All (height, mat, colour) of triangles under (x, z)."""
        ids = self.candidates(x, z)
        if len(ids) == 0:
            return []
        t = self.t[ids]
        a, b, c = t[:, 0], t[:, 1], t[:, 2]
        v0x, v0z = c[:, 0] - a[:, 0], c[:, 2] - a[:, 2]
        v1x, v1z = b[:, 0] - a[:, 0], b[:, 2] - a[:, 2]
        v2x, v2z = x - a[:, 0], z - a[:, 2]
        d00 = v0x * v0x + v0z * v0z
        d01 = v0x * v1x + v0z * v1z
        d11 = v1x * v1x + v1z * v1z
        d20 = v2x * v0x + v2z * v0z
        d21 = v2x * v1x + v2z * v1z
        den = d00 * d11 - d01 * d01
        good = np.abs(den) > 1e-12
        den = np.where(good, den, 1)
        u = (d11 * d20 - d01 * d21) / den
        v = (d00 * d21 - d01 * d20) / den
        inside = good & (u >= -1e-6) & (v >= -1e-6) & (u + v <= 1 + 1e-6)
        if not inside.any():
            return []
        y = a[:, 1] + u * (c[:, 1] - a[:, 1]) + v * (b[:, 1] - a[:, 1])
        return [(float(y[k]), int(self.mat[ids[k]]), self.col[ids[k]]) for k in np.nonzero(inside)[0]]

    def height_near(self, x, z, y_pred, window=2.5, prefer=None):
        """Surface height closest to y_pred (within window); `prefer` mats win when within 0.6 m of the best."""
        hs = self.hits(x, z)
        if not hs:
            return None
        best = None
        for y, m, col in hs:
            d = abs(y - y_pred)
            if d > window:
                continue
            score = d - (0.6 if prefer is not None and m in prefer else 0.0)
            if best is None or score < best[0] or (abs(score - best[0]) < 0.02 and y > best[1]):
                best = (score, y, m, col)
        if best is None:
            return None
        return best[1], best[2], best[3]


def load_world(path, scale=1.0, clip=None):
    """All triangles of the GLB in world space, with material index and centroid texture colour."""
    j, b = glbio.load(path)
    prims = glbio.prims(j, b)
    tris, mats, cols = [], [], []
    for p in prims:
        p.v = p.v * scale
        t = p.v[p.f]
        if clip is not None:
            c = t.mean(1)
            k = (np.abs(c[:, 0]) < clip) & (np.abs(c[:, 2]) < clip)
            t = t[k]
            f = p.f[k]
        else:
            f = p.f
        if len(t) == 0:
            continue
        name, fac, img, tt = glbio.mat_info(j, b, p.mat)
        if img is not None and p.uv is not None:
            uvc = glbio.apply_tt(p.uv[f].mean(1), tt)
            col = glbio.sample_tex(img, uvc)[:, :3].astype(np.float32) * np.array(fac[:3], np.float32)
        else:
            col = np.tile(np.array(fac[:3], np.float32) * 255, (len(t), 1))
        tris.append(t)
        mats.append(np.full(len(t), p.mat, np.int32))
        cols.append(col)
    return j, b, np.concatenate(tris), np.concatenate(mats), np.concatenate(cols)


class Raster:
    def __init__(self, lo, hi, res):
        self.lo = np.asarray(lo, float)
        self.res = res
        self.W = int((hi[0] - lo[0]) / res) + 1
        self.H = int((hi[1] - lo[1]) / res) + 1

    def zeros(self, dtype=np.uint8):
        return np.zeros((self.H, self.W), dtype)

    def fill(self, mask, tris_xz, val=1):
        px = np.round((tris_xz - self.lo) / self.res).astype(np.int32)
        for q in px:
            cv2.fillConvexPoly(mask, q, val)
        return mask

    def to_px(self, xz):
        p = (np.asarray(xz, float) - self.lo) / self.res
        return p

    def to_world(self, rc):
        # rc = (row, col)
        rc = np.asarray(rc, float)
        return np.stack([rc[..., 1] * self.res + self.lo[0], rc[..., 0] * self.res + self.lo[1]], -1)

    def sample(self, mask, xz):
        p = np.round(self.to_px(xz)).astype(np.int64)
        x, z = p[..., 0], p[..., 1]
        ok = (x >= 0) & (z >= 0) & (x < self.W) & (z < self.H)
        out = np.zeros(x.shape, mask.dtype)
        out[ok] = mask[z[ok], x[ok]]
        return out


def classify_colour(col):
    """Rough surface class of a texture colour: 'kerb' | 'gravel' | 'grass' | 'paved' | 'other'."""
    r, g, b = float(col[0]), float(col[1]), float(col[2])
    mx, mn = max(r, g, b), min(r, g, b)
    if r > 120 and r > 1.55 * g and r > 1.55 * b:
        return 'kerb'
    if g > r + 4 and g > b + 8:
        return 'grass'
    if r >= g >= b - 4 and r - b > 22 and 95 < mx < 235:
        return 'gravel'
    if mx - mn < 26:
        return 'paved'
    return 'other'
