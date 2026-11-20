"""Minimal GLB reader: world-space primitives with UVs and decoded base-colour textures (data only)."""
import json, struct, io
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
CT={5120:np.int8,5121:np.uint8,5122:np.int16,5123:np.uint16,5125:np.uint32,5126:np.float32}
NC={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}

def load(p):
    with open(p,'rb') as f: data=f.read()
    off=12; j=None; b=None
    while off < len(data):
        ln, typ = struct.unpack_from('<II', data, off); off+=8
        chunk=data[off:off+ln]; off+=ln
        if typ==0x4E4F534A: j=json.loads(chunk)
        elif typ==0x004E4942: b=chunk
    return j,b

def acc(j,b,i):
    a=j['accessors'][i]; bv=j['bufferViews'][a['bufferView']]
    dt=np.dtype(CT[a['componentType']]); n=NC[a['type']]
    o=bv.get('byteOffset',0)+a.get('byteOffset',0); st=bv.get('byteStride',0)
    cnt=a['count']
    if st and st!=dt.itemsize*n:
        buf=np.frombuffer(b,dtype=np.uint8,count=st*(cnt-1)+dt.itemsize*n,offset=o)
        out=np.empty((cnt,n),dt)
        for k in range(n):
            out[:,k]=np.ndarray((cnt,),dt,buf,k*dt.itemsize,(st,))
        res=out
    else:
        res=np.frombuffer(b,dtype=dt,count=cnt*n,offset=o).reshape(cnt,n)
    if a.get('normalized'):
        if dt==np.uint8: res=res/255.0
        elif dt==np.uint16: res=res/65535.0
    return res

def lm(n):
    if 'matrix' in n: return np.array(n['matrix'],float).reshape(4,4).T
    T=np.eye(4)
    if 'translation' in n: T[:3,3]=n['translation']
    R=np.eye(4)
    if 'rotation' in n:
        x,y,z,w=n['rotation']
        R[:3,:3]=[[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]]
    S=np.eye(4)
    if 'scale' in n: S[0,0],S[1,1],S[2,2]=n['scale']
    return T@R@S

def world_mats(j):
    W={}
    def rec(i,P):
        W[i]=P@lm(j['nodes'][i])
        for c in j['nodes'][i].get('children',[]): rec(c,W[i])
    for r in j['scenes'][j.get('scene',0)]['nodes']: rec(r,np.eye(4))
    return W

class Prim:
    pass

def prims(j,b):
    W=world_mats(j); out=[]
    for ni,n in enumerate(j['nodes']):
        if 'mesh' not in n or ni not in W: continue
        M=W[ni]
        for pi,pr in enumerate(j['meshes'][n['mesh']]['primitives']):
            if pr.get('mode',4)!=4: continue
            p=Prim(); p.node=ni; p.name=n.get('name',''); p.mesh=n['mesh']; p.pi=pi
            pos=acc(j,b,pr['attributes']['POSITION']).astype(np.float64)
            p.v=pos@M[:3,:3].T+M[:3,3]
            p.uv=acc(j,b,pr['attributes']['TEXCOORD_0']).astype(np.float64) if 'TEXCOORD_0' in pr['attributes'] else None
            p.f=acc(j,b,pr['indices']).reshape(-1,3).astype(np.int64) if 'indices' in pr else np.arange(len(pos)).reshape(-1,3)
            p.mat=pr.get('material',-1)
            out.append(p)
    return out

_imgcache={}
def mat_info(j,b,mi):
    """(name, baseColorFactor, texture image ndarray RGBA or None, texTransform)"""
    if mi<0: return ('',[1,1,1,1],None,None)
    m=j['materials'][mi]; pbr=m.get('pbrMetallicRoughness',{})
    fac=pbr.get('baseColorFactor',[1,1,1,1]); img=None; tt=None
    t=pbr.get('baseColorTexture')
    if t is not None:
        tt=t.get('extensions',{}).get('KHR_texture_transform')
        src=j['textures'][t['index']].get('source')
        if src is not None:
            if src not in _imgcache:
                im=j['images'][src]; bv=j['bufferViews'][im['bufferView']]
                o=bv.get('byteOffset',0)
                try:
                    pil=Image.open(io.BytesIO(b[o:o+bv['byteLength']])).convert('RGBA')
                    _imgcache[src]=np.asarray(pil)
                except Exception:
                    _imgcache[src]=None
            img=_imgcache[src]
    return (m.get('name',''),fac,img,tt)

def apply_tt(uv,tt):
    if not tt: return uv
    off=np.array(tt.get('offset',[0,0])); sc=np.array(tt.get('scale',[1,1])); rot=tt.get('rotation',0.0)
    u=uv*sc
    if rot:
        c,s=np.cos(rot),np.sin(rot); u=np.stack([c*u[:,0]+s*u[:,1], -s*u[:,0]+c*u[:,1]],1)
    return u+off

def sample_tex(img,uv):
    h,w=img.shape[:2]
    x=np.mod(uv[:,0],1.0)*(w-1); y=np.mod(uv[:,1],1.0)*(h-1)
    return img[y.astype(int),x.astype(int)]
