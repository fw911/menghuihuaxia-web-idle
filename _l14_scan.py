# -*- coding: utf-8 -*-
"""L14 全库差异盘点：0.94 config_enc/*.enc  vs  web-idle data/*.json
只读取证，不写任何文件。输出 _dis_v094_l14.txt
"""
import base64, hashlib, json, os, subprocess, collections

ENC = r'E:/放置归墟：梦回华夏 _v0.94/config_enc'
WEB = 'data'
K = hashlib.pbkdf2_hmac(
    'sha256',
    base64.b64decode('kUmtE1a7/jQ7LdM04YhJYXKhRvwaQZ6vqY1YRyIbsr8='),
    b'MH_CONFIG_ENC_SALT_v1', 200000, 32)


def dec(fn):
    p = os.path.join(ENC, fn + '.json.enc')
    d = open(p, 'rb').read()
    assert d[:9] == b'CONFIGENC', fn
    r = subprocess.run(['openssl', 'enc', '-d', '-aes-256-cbc',
                        '-K', K.hex(), '-iv', d[9:25].hex()],
                       input=d[25:], capture_output=True)
    assert r.returncode == 0, (fn, r.stderr[:200])
    return json.loads(r.stdout.decode('utf-8'))


def leaf_paths(x, path=''):
    """递归产出所有叶子路径 -> 值（dict 按 key，list 按下标）。"""
    out = {}
    if isinstance(x, dict):
        for k, v in x.items():
            out.update(leaf_paths(v, path + '/' + str(k)))
    elif isinstance(x, list):
        for i, v in enumerate(x):
            out.update(leaf_paths(v, path + '[%d]' % i))
    else:
        out[path or '/'] = x
    return out


def top_of(path):
    """取一级/二级字段，用于按模块聚合。"""
    parts = path.lstrip('/').replace('[', '/').replace(']', '').split('/')
    return '/'.join(parts[:2]) if len(parts) > 1 else parts[0]


enc = sorted(f[:-9] for f in os.listdir(ENC) if f.endswith('.json.enc'))
web = sorted(f[:-5] for f in os.listdir(WEB) if f.endswith('.json'))
both = [f for f in enc if f in web]
only94 = [f for f in enc if f not in web]
onlyweb = [f for f in web if f not in enc]

lines = []
def P(s=''):
    lines.append(str(s))

P('=== L14 全库差异盘点（0.94 config_enc vs web-idle data）===')
P('0.94 enc 文件 %d，web data 文件 %d，同名 %d' % (len(enc), len(web), len(both)))
P('0.94 独有: ' + ', '.join(only94))
P('web 独有: ' + ', '.join(onlyweb))
P()

summary = []
equal = []
detail = {}
for fn in both:
    try:
        a = dec(fn)
    except Exception as e:
        P('%s 解密失败: %s' % (fn, e))
        continue
    try:
        b = json.load(open(os.path.join(WEB, fn + '.json'), 'r', encoding='utf-8'))
    except Exception as e:
        P('%s web 读取失败: %s' % (fn, e))
        continue
    if a == b:
        equal.append(fn)
        continue
    la, lb = leaf_paths(a), leaf_paths(b)
    ka, kb = set(la), set(lb)
    added = ka - kb      # 0.94 有 web 无
    removed = kb - ka    # web 有 0.94 无
    changed = [k for k in (ka & kb) if la[k] != lb[k]]
    summary.append((fn, len(added), len(removed), len(changed)))
    detail[fn] = (added, removed, changed, la, lb)

P('=== 汇总：非全等文件（按差异叶子数降序）===')
P('%-28s %8s %8s %8s' % ('file', '+0.94缺', 'web多', '值不同'))
for fn, na, nr, nc in sorted(summary, key=lambda x: -(x[1] + x[2] + x[3])):
    P('%-28s %8s %8s %8s' % (fn, na, nr, nc))
P()
P('全等文件 %d / %d: %s' % (len(equal), len(both), ', '.join(equal)))
P()

P('=== 各文件差异的顶层字段聚合（只看前 3 层）===')
for fn in sorted(detail):
    added, removed, changed, la, lb = detail[fn]
    cnt = collections.Counter()
    for k in list(added) + list(removed) + list(changed):
        cnt[top_of(k)] += 1
    P('--- %s (%d 处)' % (fn, len(added) + len(removed) + len(changed)))
    for k, n in cnt.most_common(18):
        P('    %-46s %d' % (k, n))
    if len(cnt) > 18:
        P('    ... 共 %d 个分组' % len(cnt))

P()
P('=== 样本：每个文件前 4 条具体差异 ===')
for fn in sorted(detail):
    added, removed, changed, la, lb = detail[fn]
    P('--- ' + fn)
    for tag, keys in [('0.94-only', sorted(added)), ('web-only', sorted(removed)), ('DIFF', sorted(changed))]:
        for k in keys[:4]:
            va = la.get(k, '<无>')
            vb = lb.get(k, '<无>')
            P('  %-9s %-58s 0.94=%s | web=%s' % (
                tag, k[:58], json.dumps(va, ensure_ascii=False)[:70],
                json.dumps(vb, ensure_ascii=False)[:70]))

out = '\n'.join(lines) + '\n'
open('_dis_v094_l14.txt', 'w', encoding='utf-8', newline='\n').write(out)
print(out[:12000])
print('... 完整清单已写入 _dis_v094_l14.txt，共 %d 行' % len(lines))
