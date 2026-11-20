"""
Write the simulator copy of a circuit GLB:
  * the source scene wrapped in `Track_Model` (uniform scale + recentring offset),
  * far-away geometry dropped (nodes whose world bounds lie entirely outside the clip square),
  * textures re-encoded to WebP (EXT_texture_webp) and capped at 2048 px,
  * generated, hidden collider / surface meshes appended as scene roots in final world space:
    `Track_Collider_Road`, `Track_Collider_Wall_Left/Right` and `Track_Surface_*` (see TrackColliderQuery.ts).
"""
import io
import json
import struct

import numpy as np
from PIL import Image

import glbio

Image.MAX_IMAGE_PIXELS = None
MAX_TEX = 2048


def _pad(b, ch=b'\0'):
    return b + ch * ((4 - len(b) % 4) % 4)


def _node_bounds(j, W, ni):
    n = j['nodes'][ni]
    lo = np.full(3, np.inf)
    hi = np.full(3, -np.inf)
    for pr in j['meshes'][n['mesh']]['primitives']:
        a = j['accessors'][pr['attributes']['POSITION']]
        if 'min' not in a:
            return None
        mn, mx = np.array(a['min'], float), np.array(a['max'], float)
        corners = np.array([[x, y, z, 1.0] for x in (mn[0], mx[0]) for y in (mn[1], mx[1]) for z in (mn[2], mx[2])])
        w = corners @ W[ni].T
        lo = np.minimum(lo, w[:, :3].min(0))
        hi = np.maximum(hi, w[:, :3].max(0))
    return lo, hi


def _encode_webp(raw, mime):
    im = Image.open(io.BytesIO(raw))
    im.load()
    has_alpha = im.mode in ('RGBA', 'LA', 'P') and np.asarray(im.convert('RGBA'))[..., 3].min() < 250
    im = im.convert('RGBA' if has_alpha else 'RGB')
    w, h = im.size
    k = max(w, h) / MAX_TEX
    if k > 1:
        im = im.resize((max(1, round(w / k)), max(1, round(h / k))), Image.LANCZOS)
    out = io.BytesIO()
    im.save(out, 'WEBP', quality=86, method=4, alpha_quality=90)
    return out.getvalue()


def _normals(pos, idx):
    f = idx.reshape(-1, 3)
    fn = np.cross(pos[f[:, 1]] - pos[f[:, 0]], pos[f[:, 2]] - pos[f[:, 0]])
    vn = np.zeros_like(pos)
    for k in range(3):
        np.add.at(vn, f[:, k], fn)
    ln = np.linalg.norm(vn, axis=1, keepdims=True)
    vn = np.where(ln > 1e-12, vn / np.maximum(ln, 1e-12), np.array([0.0, 1.0, 0.0]))
    return vn


def write_track_glb(j, b, scale, off, extra_meshes, out_path, clip=4000.0, log=print):
    """extra_meshes: [(name, positions (N,3) world, indices (M,), extras dict)]"""
    j = json.loads(json.dumps(j))
    W = glbio.world_mats(j)

    # ---- drop far geometry (world = scale * source - off) ----
    dropped = 0
    for ni, n in enumerate(j['nodes']):
        if 'mesh' not in n or ni not in W:
            continue
        bb = _node_bounds(j, W, ni)
        if bb is None:
            continue
        lo, hi = bb[0] * scale - off, bb[1] * scale - off
        if lo[0] > clip or hi[0] < -clip or lo[2] > clip or hi[2] < -clip:
            del n['mesh']
            dropped += 1
    if dropped:
        log(f'glb: dropped {dropped} far-away mesh nodes')

    # ---- geometry: kept primitives re-encoded (int8 normals, 16-bit indices, unused UV sets dropped) ----
    used_mesh = sorted({n['mesh'] for n in j['nodes'] if 'mesh' in n})
    mesh_map = {old: new for new, old in enumerate(used_mesh)}
    chunks = []  # (bytes, target or None, stride or None)
    new_acc = []
    bv_map = {}
    raw_cache = {}
    enc_cache = {}

    def add_view(data, target=None, stride=None):
        chunks.append((data, target, stride))
        return len(chunks) - 1

    def src_view(bvi):
        """The new view holding the source's view `bvi`, copied the first time it is asked for"""
        if bvi not in bv_map:
            bv = j['bufferViews'][bvi]
            o = bv.get('byteOffset', 0)
            bv_map[bvi] = add_view(b[o:o + bv['byteLength']], bv.get('target'), bv.get('byteStride'))
        return bv_map[bvi]

    def raw_acc(ai):
        if ai in raw_cache:
            return raw_cache[ai]
        a = dict(j['accessors'][ai])
        if 'bufferView' in a:
            a['bufferView'] = src_view(a['bufferView'])
        if 'sparse' in a:
            # a sparse accessor's indices and values sit in views of their own (and it may have no base view at all)
            sp = dict(a['sparse'])
            sp['indices'] = {**sp['indices'], 'bufferView': src_view(sp['indices']['bufferView'])}
            sp['values'] = {**sp['values'], 'bufferView': src_view(sp['values']['bufferView'])}
            a['sparse'] = sp
        new_acc.append(a)
        raw_cache[ai] = len(new_acc) - 1
        return raw_cache[ai]

    def put(arr, comp, typ, target, normalized=False, minmax=False, stride=None):
        a = {'bufferView': add_view(arr.tobytes(), target, stride), 'componentType': comp,
             'count': int(arr.shape[0]), 'type': typ}
        if normalized:
            a['normalized'] = True
        if minmax:
            a['min'] = arr.min(0).astype(float).tolist()
            a['max'] = arr.max(0).astype(float).tolist()
        new_acc.append(a)
        return len(new_acc) - 1

    def enc(ai, kind):
        key = (ai, kind)
        if key in enc_cache:
            return enc_cache[key]
        A = j['accessors'][ai]
        if A.get('sparse') or 'bufferView' not in A:
            r = raw_acc(ai)
        elif kind == 'POSITION':
            r = put(glbio.acc(j, b, ai).astype(np.float32), 5126, 'VEC3', 34962, minmax=True)
        elif kind == 'NORMAL':
            v = glbio.acc(j, b, ai).astype(np.float32)
            q = np.zeros((len(v), 4), np.int8)
            q[:, :3] = np.clip(np.round(v * 127.0), -127, 127)
            k = put(q, 5120, 'VEC3', 34962, normalized=True, stride=4)
            new_acc[k]['count'] = len(v)
            r = k
        elif kind.startswith('TEXCOORD'):
            r = put(glbio.acc(j, b, ai).astype(np.float32), 5126, 'VEC2', 34962)
        elif kind == 'INDICES':
            v = glbio.acc(j, b, ai).reshape(-1).astype(np.int64)
            r = put(v.astype(np.uint16 if v.max(initial=0) < 65535 else np.uint32),
                    5123 if v.max(initial=0) < 65535 else 5125, 'SCALAR', 34963)
        else:
            r = raw_acc(ai)
        enc_cache[key] = r
        return r

    uv_sets = set()

    def find_uv(o):
        if isinstance(o, dict):
            if 'index' in o and isinstance(o.get('index'), int) and ('texCoord' in o or 'scale' in o or 'strength' in o or len(o) <= 4):
                uv_sets.add(int(o.get('texCoord', 0)))
            for v in o.values():
                find_uv(v)
        elif isinstance(o, list):
            for v in o:
                find_uv(v)

    find_uv(j.get('materials', []))
    uv_sets.add(0)
    meshes = []
    for mi in used_mesh:
        m = j['meshes'][mi]
        for pr in m['primitives']:
            at = {}
            for k, v in pr['attributes'].items():
                if k.startswith('TEXCOORD_') and int(k[9:]) not in uv_sets:
                    continue
                at[k] = enc(v, k)
            pr['attributes'] = at
            if 'indices' in pr:
                pr['indices'] = enc(pr['indices'], 'INDICES')
            if 'targets' in pr:
                pr['targets'] = [{k: raw_acc(v) for k, v in tg.items()} for tg in pr['targets']]
        meshes.append(m)
    j['meshes'] = meshes
    for n in j['nodes']:
        if 'mesh' in n:
            n['mesh'] = mesh_map[n['mesh']]
    for sk in j.get('skins', []):
        if 'inverseBindMatrices' in sk:
            sk['inverseBindMatrices'] = raw_acc(sk['inverseBindMatrices'])
    for an in j.get('animations', []):
        for sm in an['samplers']:
            sm['input'] = raw_acc(sm['input'])
            sm['output'] = raw_acc(sm['output'])
    geo = sum(len(c[0]) for c in chunks)
    log(f'glb: geometry {geo / 1e6:.1f} MB')

    # ---- images → WebP ----
    raw_before = raw_after = 0
    new_images = []
    for ii, im in enumerate(j.get('images', [])):
        if 'bufferView' not in im:
            new_images.append(im)
            continue
        bv = j['bufferViews'][im['bufferView']]
        o = bv.get('byteOffset', 0)
        raw = b[o:o + bv['byteLength']]
        raw_before += len(raw)
        try:
            data = _encode_webp(raw, im.get('mimeType'))
            mime = 'image/webp'
        except Exception as e:  # keep undecodable images as they are
            log(f'glb: image {ii} kept as is ({e})')
            data, mime = raw, im.get('mimeType', 'image/png')
        raw_after += len(data)
        ni = {k: v for k, v in im.items() if k not in ('bufferView', 'mimeType', 'uri')}
        ni['bufferView'] = add_view(data)
        ni['mimeType'] = mime
        new_images.append(ni)
    if new_images:
        j['images'] = new_images
    webp_images = {ii for ii, im in enumerate(new_images) if im.get('mimeType') == 'image/webp'}
    for t in j.get('textures', []):
        src = t.get('source')
        if src in webp_images:
            del t['source']
            t.setdefault('extensions', {})['EXT_texture_webp'] = {'source': src}
    log(f'glb: textures {raw_before / 1e6:.1f} MB -> {raw_after / 1e6:.1f} MB')

    # ---- wrap the source scene ----
    sc = j['scenes'][j.get('scene', 0)]
    root = {'name': 'Track_Model', 'children': list(sc['nodes']),
            'translation': [float(-v) for v in off], 'scale': [float(scale)] * 3}
    j['nodes'].append(root)
    roots = [len(j['nodes']) - 1]

    # ---- generated collider / surface meshes ----
    # Private keys in a mesh's extras: `_uv` (N, 2) texture coordinates, `_material` a dict (name, png bytes,
    # roughness) for a textured material, `_visible` to render it (generated meshes are hidden physics otherwise)
    j['accessors'] = new_acc
    gen_materials = {}
    for name, pos, idx, extras in extra_meshes:
        if len(idx) == 0:
            continue
        pos = np.asarray(pos, np.float32)
        idx = np.asarray(idx, np.uint32)
        nrm = _normals(pos.astype(np.float64), idx).astype(np.float32)
        pa = len(j['accessors'])
        j['accessors'].append({'bufferView': add_view(pos.tobytes(), 34962), 'componentType': 5126, 'count': len(pos),
                               'type': 'VEC3', 'min': pos.min(0).tolist(), 'max': pos.max(0).tolist()})
        j['accessors'].append({'bufferView': add_view(nrm.tobytes(), 34962), 'componentType': 5126, 'count': len(nrm),
                               'type': 'VEC3'})
        j['accessors'].append({'bufferView': add_view(idx.tobytes(), 34963), 'componentType': 5125, 'count': len(idx),
                               'type': 'SCALAR'})
        attrs = {'POSITION': pa, 'NORMAL': pa + 1}
        if extras.get('_uv') is not None:
            uv = np.asarray(extras['_uv'], np.float32)
            attrs['TEXCOORD_0'] = len(j['accessors'])
            j['accessors'].append({'bufferView': add_view(uv.tobytes(), 34962), 'componentType': 5126, 'count': len(uv),
                                   'type': 'VEC2'})
        prim = {'attributes': attrs, 'indices': pa + 2}
        mat = extras.get('_material')
        if mat is not None:
            if mat['name'] not in gen_materials:
                j.setdefault('images', []).append({'bufferView': add_view(_encode_webp(mat['png'], 'image/png')),
                                                   'mimeType': 'image/webp', 'name': mat['name']})
                j.setdefault('samplers', []).append({'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 33071})
                j.setdefault('textures', []).append({'sampler': len(j['samplers']) - 1,
                                                     'extensions': {'EXT_texture_webp': {'source': len(j['images']) - 1}}})
                webp_images.add(len(j['images']) - 1)
                j.setdefault('materials', []).append({
                    'name': mat['name'],
                    'pbrMetallicRoughness': {'baseColorTexture': {'index': len(j['textures']) - 1}, 'metallicFactor': 0.0,
                                             'roughnessFactor': mat.get('roughness', 0.7)}})
                gen_materials[mat['name']] = len(j['materials']) - 1
            prim['material'] = gen_materials[mat['name']]
        j['meshes'].append({'name': name, 'primitives': [prim]})
        node_extras = {k: v for k, v in extras.items() if not k.startswith('_')}
        if not extras.get('_visible'):
            node_extras['hidden'] = True
        j['nodes'].append({'name': name, 'mesh': len(j['meshes']) - 1, 'extras': node_extras})
        roots.append(len(j['nodes']) - 1)
    sc['nodes'] = roots
    j['scenes'] = [sc]
    j['scene'] = 0

    # ---- buffer ----
    out = bytearray()
    views = []
    for data, target, stride in chunks:
        while len(out) % 4:
            out += b'\0'
        v = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(data)}
        if target:
            v['target'] = target
        if stride:
            v['byteStride'] = stride
        views.append(v)
        out += data
    j['bufferViews'] = views
    j['buffers'] = [{'byteLength': len(out)}]
    for ext in (['EXT_texture_webp'] if webp_images else []) + ['KHR_mesh_quantization']:
        for key in ('extensionsUsed', 'extensionsRequired'):
            lst = j.setdefault(key, [])
            if ext not in lst:
                lst.append(ext)
    j.setdefault('asset', {})['generator'] = 'scripts/tracks/glbwrite.py'

    js = _pad(json.dumps(j, separators=(',', ':')).encode('utf-8'), b' ')
    bn = _pad(bytes(out))
    total = 12 + 8 + len(js) + 8 + len(bn)
    with open(out_path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack('<II', len(bn), 0x004E4942))
        f.write(bn)
    log(f'glb: wrote {out_path} ({total / 1e6:.1f} MB)')
