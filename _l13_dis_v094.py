# -*- coding: utf-8 -*-
"""L13 取证：v0.94 官方 perk_pool / instance_exchange 与 web-idle 的逐键差异。

证据源优先级：0.94 config_enc/*.enc 直解密（配置真值）> 归档标准反汇编
`_dis_quality.txt`（引擎消费口径）> web-idle 当前数据。

用法： python _l13_dis_v094.py
输出： _dis_v094_l13.txt（.gitignore 的 _dis_*.txt 已覆盖）
只读，不修改任何 data/ 或 exe。
"""
import base64
import hashlib
import io
import json
import os
import subprocess
import zipfile

ENC = r'E:/放置归墟：梦回华夏 _v0.94/config_enc'
OLD_DIS = r'F:/梦回华夏/_archive/web_idle_disassembly_20261020.zip'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '_dis_v094_l13.txt')
DATA = os.path.join(HERE, 'data')

SALT = b'MH_CONFIG_ENC_SALT_v1'
K94_B64 = 'kUmtE1a7/jQ7LdM04YhJYXKhRvwaQZ6vqY1YRyIbsr8='


def dec94(fn):
    key = hashlib.pbkdf2_hmac('sha256', base64.b64decode(K94_B64), SALT, 200000, 32)
    d = open(os.path.join(ENC, fn + '.json.enc'), 'rb').read()
    assert d[:9] == b'CONFIGENC'
    r = subprocess.run(['openssl', 'enc', '-d', '-aes-256-cbc',
                        '-K', key.hex(), '-iv', d[9:25].hex()],
                       input=d[25:], capture_output=True)
    assert r.returncode == 0, (fn, r.stderr[:200])
    return json.loads(r.stdout.decode('utf-8'))


def web(fn):
    return json.load(open(os.path.join(DATA, fn + '.json'), 'r', encoding='utf-8'))


def j(x):
    return json.dumps(x, ensure_ascii=False, sort_keys=True)


def walk_diff(a, b, path, out, limit=4000):
    """按 dict key 对齐的递归差异；数组按下标对齐并校验长度。"""
    if type(a) is not type(b):
        out.append('%s  TYPE  %s -> %s' % (path, type(a).__name__, type(b).__name__))
        return
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a:
                out.append('%s.%s  WEB_ONLY  %s' % (path, k, j(b[k])[:180]))
            elif k not in b:
                out.append('%s.%s  V094_ONLY  %s' % (path, k, j(a[k])[:180]))
            else:
                walk_diff(a[k], b[k], path + '.' + k, out)
    elif isinstance(a, list):
        if len(a) != len(b):
            out.append('%s  LEN  %d -> %d' % (path, len(a), len(b)))
        for i in range(min(len(a), len(b))):
            walk_diff(a[i], b[i], '%s[%d]' % (path, i), out)
    elif a != b:
        out.append('%s  %s -> %s' % (path, j(a)[:180], j(b)[:180]))
        if len(out) > limit:
            out.append('... 差异过多，截断')


def perk_report(a, b, out):
    out.append('')
    out.append('=' * 78)
    out.append('A. perk_pool.json')
    out.append('=' * 78)
    tiers94, tiersweb = set(), set()
    stat94 = statweb = 0
    tmpl94 = tmplweb = 0
    for pool in a:
        for cat in a[pool]:
            for t in a[pool][cat]:
                tmpl94 += 1
                tiers94 |= set(t.get('values', {}).keys())
                stat94 += 1 if 'stat_key' in t else 0
    for pool in b:
        for cat in b[pool]:
            for t in b[pool][cat]:
                tmplweb += 1
                tiersweb |= set(t.get('values', {}).keys())
                statweb += 1 if 'stat_key' in t else 0
    out.append('词条模板数 0.94=%d web=%d' % (tmpl94, tmplweb))
    out.append('values 档位 0.94=%s web=%s' % (sorted(tiers94, key=int), sorted(tiersweb, key=int)))
    out.append('带 stat_key 的模板 0.94=%d web=%d' % (stat94, statweb))

    # 按 (pool, cat, name+suffix) 对齐
    def index(d):
        r = {}
        for pool in d:
            for cat in d[pool]:
                for t in d[pool][cat]:
                    r[(pool, cat, t.get('name', '') + t.get('suffix', ''))] = t
        return r
    ia, ib = index(a), index(b)
    only94 = sorted(set(ia) - set(ib))
    onlyweb = sorted(set(ib) - set(ia))
    out.append('仅 0.94 有的模板 %d 个：%s' % (len(only94), [x[2] + '@' + x[0] + '/' + x[1] for x in only94][:60]))
    out.append('仅 web 有的模板 %d 个：%s' % (len(onlyweb), [x[2] + '@' + x[0] + '/' + x[1] for x in onlyweb][:60]))

    vdiff, sdiff, keydiff = [], [], []
    for k in sorted(set(ia) & set(ib)):
        ta, tb = ia[k], ib[k]
        if ta.get('values') != tb.get('values'):
            diff = {t: (ta.get('values', {}).get(t), tb.get('values', {}).get(t))
                    for t in sorted(set(ta.get('values', {})) | set(tb.get('values', {})), key=int)
                    if ta.get('values', {}).get(t) != tb.get('values', {}).get(t)}
            vdiff.append((k, diff))
        if ta.get('stat_key') != tb.get('stat_key'):
            sdiff.append((k, ta.get('stat_key'), tb.get('stat_key')))
        seta, setb = set(ta), set(tb)
        if seta != setb:
            keydiff.append((k, sorted(seta - setb), sorted(setb - seta)))
    out.append('values 内容不同的模板 %d 个' % len(vdiff))
    for k, d in vdiff[:80]:
        out.append('  %s@%s/%s  %s' % (k[2], k[0], k[1], j(d)))
    out.append('stat_key 不同的模板 %d 个' % len(sdiff))
    for k, x, y in sdiff[:80]:
        out.append('  %s@%s/%s  0.94=%s web=%s' % (k[2], k[0], k[1], x, y))
    out.append('字段集合不同的模板 %d 个：%s' % (len(keydiff), [(k[2], x, y) for k, x, y in keydiff[:40]]))
    out.append('')
    out.append('-- 完整递归差异 --')
    d = []
    walk_diff(a, b, 'perk_pool', d)
    out.extend(d[:1200])
    out.append('递归差异行数 %d' % len(d))


def exchange_report(a, b, out):
    out.append('')
    out.append('=' * 78)
    out.append('B. instance_exchange.json')
    out.append('=' * 78)
    out.append('顶层键 0.94=%d web=%d；键集合相同=%s' %
               (len(a), len(b), set(a) == set(b)))
    out.append('_exchange_spec 相同=%s' % (a['_exchange_spec'] == b['_exchange_spec']))
    out.append('_instance_exchange_meta 相同=%s' % (a['_instance_exchange_meta'] == b['_instance_exchange_meta']))
    out.append('')
    out.append('样例 0.94 xhz_weapon = ' + j(a['xhz_weapon']))
    out.append('样例 web  xhz_weapon = ' + j(b['xhz_weapon']))
    out.append('样例 0.94 gm_weapon  = ' + j(a['gm_weapon']))
    out.append('样例 web  gm_weapon  = ' + j(b['gm_weapon']))
    out.append('样例 0.94 wxz_weapon = ' + j(a['wxz_weapon']))
    out.append('样例 web  wxz_weapon = ' + j(b['wxz_weapon']))
    out.append('')
    # 字段级差异按 (字段名, 0.94值, web值) 聚类
    groups = {}
    for k in a:
        if k.startswith('_') or not isinstance(a[k], dict):
            continue
        for f in sorted(set(a[k]) | set(b.get(k, {}))):
            va, vb = a[k].get(f, '<MISSING>'), b.get(k, {}).get(f, '<MISSING>')
            if va != vb:
                groups.setdefault((f, j(va), j(vb)), []).append(k)
    out.append('差异组 %d 类：' % len(groups))
    for (f, va, vb), keys in sorted(groups.items(), key=lambda x: (-len(x[1]), x[0])):
        out.append('  [%s] 0.94=%s web=%s  ×%d  %s' %
                   (f, va[:120], vb[:120], len(keys), ','.join(keys[:8]) + ('...' if len(keys) > 8 else '')))
    out.append('')
    out.append('-- 完整递归差异 --')
    d = []
    walk_diff(a, b, 'instance_exchange', d)
    out.extend(d[:1200])
    out.append('递归差异行数 %d' % len(d))


def dis_report(out):
    out.append('')
    out.append('=' * 78)
    out.append('C. 归档标准反汇编中的档位消费口径')
    out.append('=' * 78)
    z = zipfile.ZipFile(OLD_DIS)
    for name in ['_dis_quality.txt', '_dis_all.txt']:
        txt = z.read(name).decode('utf-8', 'replace')
        lines = txt.split('\n')
        out.append('%s 共 %d 行' % (name, len(lines)))
        needles = ['values.get', 'str(tier)', 'REFINE_MAX', 'tier', 'perk_pool', 'stat_key',
                   'apply_refine_levels', 'generate_instance_equip', '_find_perk_template']
        for nd in needles:
            hits = [l.strip() for l in lines if nd in l]
            out.append('  %-28s 命中 %d 行' % (nd, len(hits)))
            for h in hits[:12]:
                out.append('      ' + h[:160])


def main():
    buf = io.StringIO()
    out = []
    a, b = dec94('perk_pool'), web('perk_pool')
    perk_report(a, b, out)
    a2, b2 = dec94('instance_exchange'), web('instance_exchange')
    exchange_report(a2, b2, out)
    dis_report(out)
    txt = '\n'.join(out) + '\n'
    buf.write(txt)
    open(OUT, 'w', encoding='utf-8').write(txt)
    print('写入', OUT, len(out), '行')
    # 控制台摘要
    for l in out:
        if l.startswith(('词条模板数', 'values 档位', '带 stat_key', '仅 0.94', '仅 web',
                         'values 内容不同', 'stat_key 不同', '字段集合不同',
                         '顶层键', '_exchange_spec', '_instance_exchange_meta',
                         '差异组', '  [', '递归差异行数')):
            print(l[:400])


if __name__ == '__main__':
    main()
