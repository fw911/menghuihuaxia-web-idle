"""L19 取证：全库 web↔0.94 漂移盘点（key 感知版）

教训来源（L14 / 本轮 bases_*）：
  按数组下标比对会把「同一批 key、顺序不同」判成成百上千处假差异。
  本脚本对含 'key' 字段的数组条目改按 key 对齐，再比对叶级值。
用法：python3 _l19_inventory.py
"""
import base64, hashlib, json, subprocess, os, re
from collections import Counter

ENC = r'E:/放置归墟：梦回华夏 _v0.94/config_enc'
KEY_B64 = 'kUmtE1a7/jQ7LdM04YhJYXKhRvwaQZ6vqY1YRyIbsr8='
K = hashlib.pbkdf2_hmac('sha256', base64.b64decode(KEY_B64), b'MH_CONFIG_ENC_SALT_v1', 200000, 32)
DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')


def dec(fn):
    p = os.path.join(ENC, fn + '.json.enc')
    if not os.path.exists(p):
        return None
    d = open(p, 'rb').read()
    r = subprocess.run(['openssl', 'enc', '-d', '-aes-256-cbc', '-K', K.hex(), '-iv', d[9:25].hex()],
                       input=d[25:], capture_output=True)
    if r.returncode != 0:
        return None
    try:
        return json.loads(r.stdout.decode('utf-8'))
    except Exception:
        return None


def leaves(x, p=''):
    o = {}
    if isinstance(x, dict):
        for k, v in x.items():
            o.update(leaves(v, (p + '.' + str(k)) if p else str(k)))
    elif isinstance(x, list):
        for i, v in enumerate(x):
            o.update(leaves(v, p + '[%d]' % i))
    else:
        o[p or '/'] = x
    return o


def canon(obj):
    """把含 'key' 字段的数组条目转成 按 key 排序的稳定列表，消除顺序假差异。"""
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if isinstance(v, list) and v and all(isinstance(e, dict) and isinstance(e.get('key'), str) for e in v):
                out[k] = sorted((canon(e) for e in v), key=lambda e: e.get('key', ''))
            else:
                out[k] = canon(v)
        return out
    if isinstance(obj, list):
        return [canon(v) for v in obj]
    return obj


def diff_paths(a, b, path='', out=None, skip_suffix=('icon',)):
    """返回 (a值, b值) 差异列表；a=web, b=ref"""
    if out is None:
        out = []
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k in a and k in b:
                diff_paths(a[k], b[k], (path + '.' + str(k)) if path else str(k), out, skip_suffix)
            else:
                out.append(((path + '.' + str(k)) if path else str(k),
                            a.get(k, '<缺>'), b.get(k, '<缺>')))
        return out
    if isinstance(a, list) and isinstance(b, list):
        for i in range(max(len(a), len(b))):
            if i < len(a) and i < len(b):
                diff_paths(a[i], b[i], path + '[%d]' % i, out, skip_suffix)
            else:
                out.append((path + '[%d]' % i, a[i] if i < len(a) else '<缺>', b[i] if i < len(b) else '<缺>'))
        return out
    if a != b:
        out.append((path, a, b))
    return out


def main():
    encs = sorted(os.path.basename(x)[:-len('.json.enc')] for x in os.listdir(ENC) if x.endswith('.json.enc'))
    webfiles = set(os.path.splitext(x)[0] for x in os.listdir(DATA) if x.endswith('.json'))
    rows = []
    for fn in encs:
        ref = dec(fn)
        if ref is None:
            continue
        if fn not in webfiles:
            rows.append((fn, None, None, None, None))
            continue
        web = json.load(open(os.path.join(DATA, fn + '.json'), encoding='utf-8'))
        d_raw = diff_paths(canon(web), canon(ref))
        real = [x for x in d_raw if not x[0].split('.')[-1].split('[')[0] == 'icon']
        rows.append((fn, len(d_raw), len(real), 0, None))
    print('%-32s %10s %10s' % ('config', '含icon差异', '非icon真实'))
    print('-' * 56)
    tot = 0
    for fn, raw, real, _, _ in sorted(rows, key=lambda x: -(x[2] if x[2] is not None else -1)):
        if raw is None:
            print('%-32s %10s   [WEB 无此文件]' % (fn, '—'))
            continue
        tot += real
        flag = '' if real else '   ✓零漂移'
        print('%-32s %10d %10d%s' % (fn, raw, real, flag))
    print('-' * 56)
    print('非 icon 真实漂移合计: %d' % tot)


if __name__ == '__main__':
    main()
