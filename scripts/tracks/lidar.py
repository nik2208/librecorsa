"""Ground model from an airborne LiDAR survey (public-domain USGS 3DEP and the like) for a scan's road profile.

The DEM is a .npz grid made offline from the survey's ground / road returns (classes 2 and 11): `z` (H, W) mean height
per cell (NaN where no return), `n` returns per cell, `utm0` (E, N) of the grid's south-west corner, `res` cell size (m).
A 2x3 affine maps the scan's model (x, z), at the scale configured in tracks.json, to the grid's (E, N)."""
import numpy as np
from scipy import ndimage


class Dem:
    def __init__(self, path, affine, smooth_m=0.75, min_weight=0.3):
        d = np.load(path)
        z = d['z'].astype(np.float64)
        self.utm0 = np.asarray(d['utm0'], float)
        self.res = float(d['res'])
        self.A = np.asarray(affine, float)
        ok = np.isfinite(z)
        # normalised Gaussian: survey noise averaged over ~smooth_m, holes (no return) bridged only where neighbours are
        s = smooth_m / self.res
        wsum = ndimage.gaussian_filter(ok.astype(np.float64), s)
        zsum = ndimage.gaussian_filter(np.where(ok, z, 0.0), s)
        self.z = np.where(wsum >= min_weight, zsum / np.maximum(wsum, 1e-9), np.nan)

    def sample(self, xz):
        """Heights at model (x, z) points (N, 2); NaN off the survey or in a gap"""
        en = xz @ self.A[:, :2].T + self.A[:, 2]
        c = (en[:, 0] - self.utm0[0]) / self.res - 0.5
        r = (en[:, 1] - self.utm0[1]) / self.res - 0.5
        H, W = self.z.shape
        c0 = np.floor(c).astype(np.int64)
        r0 = np.floor(r).astype(np.int64)
        fc, fr = c - c0, r - r0
        inside = (c0 >= 0) & (r0 >= 0) & (c0 < W - 1) & (r0 < H - 1)
        out = np.full(len(xz), np.nan)
        c0, r0, fc, fr = c0[inside], r0[inside], fc[inside], fr[inside]
        z = self.z
        out[inside] = ((z[r0, c0] * (1 - fc) + z[r0, c0 + 1] * fc) * (1 - fr)
                       + (z[r0 + 1, c0] * (1 - fc) + z[r0 + 1, c0 + 1] * fc) * fr)
        return out
