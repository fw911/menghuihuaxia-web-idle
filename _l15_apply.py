#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
L15：按 0.94 对齐 7 份配置文件的展示命名（改名线 · 数据部分）

证据（见 _l15_scan）：
  web 的 items.json/ores.json/gems.json 已是 0.94 新名（淬锋丹 / 玄璧 / 焚髓碧玉 …），
  但 gem_recipes / bailian_recipes / ore_recipes / mining / furnace_recipes /
  potion_recipes / guide 仍用旧名（百炼丹 / 北斗石 / 离火翡翠 / 乌金矿石 / 炼化瓶 /
  一品罗盘 / 定神液 / 仙之境静修）。0.94 的 recipe 文件本身就用新名。

做法：
  对这 7 份，取 web 与 0.94 的「叶级差异」，过滤出文本字段（name/result_name/
  src_name/dst_name/desc/comment 等），排除 icon（0.94 图标资源 web 缺失），
  在原文件字节上做「旧值 -> 0.94 值」子串定点替换，保留一切排版/行尾。
  强校验：替换后与 0.94 的差异恰好只剩 icon 字段。

用法：python _l15_apply.py            # dry-run，只校验不落盘
      python _l15_apply.py --apply    # 落盘
"""
import base64, hashlib, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
ENC  = r'E:/放置归墟：梦回华夏 _v0.94/config_enc'
K = hashlib.pbkdf2_hmac('sha256', base64.b64decode(
        'kUmtE1a7/jQ7LdM04YhJYXKhRvwaQZ6vqY1YRyIbsr8='),
        b'MH_CONFIG_ENC_SALT_v1', 200000, 32)

FILES = ['gem_recipes', 'bailian_recipes', 'ore_recipes', 'mining',
         'furnace_recipes', 'potion_recipes', 'guide']

# 视为「文本展示字段」，可对齐到 0.94；icon 显式排除
TEXT_FIELDS = {'name', 'desc', 'icon', 'flavor', 'result_name', 'src_name',
               'dst_name', 'comment', '_comment', 'title', 'lore', 'time',
               'fmt', 'label', 'text', 'flavor_text', 'result_key', 'src_key',
               'dst_key'}

def dec(fn):
    d = open(os.path.join(ENC, fn + '.json.enc'), 'rb').read()
    assert d[:9] == b'CONFIGENC', fn
    r = subprocess.run(['openssl', 'enc', '-d', '-aes-256-cbc', '-K', K.hex(),
                        '-iv', d[9:25].hex()], input=d[25:], capture_output=True)
    assert r.returncode == 0, (fn, r.stderr[:200])
    return json.loads(r.stdout.decode('utf-8'))

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

def field_of(path):
    return re.sub(r'\[\d+\]$', '', path.rsplit('.', 1)[-1])

def build_map(fn):
    ref = dec(fn)
    raw = open(os.path.join(ROOT, 'data', fn + '.json'), 'rb').read()
    web = json.loads(raw.decode('utf-8'))
    lr, lref = leaves(web), leaves(ref)
    diff = {p for p in (set(lr) | set(lref))
            if lr.get(p, '<NA>') != lref.get(p, '<NA>')}
    repl = {}          # 旧 web 文本 -> 新 0.94 文本
    kept_icon = []
    for p in sorted(diff):
        if field_of(p) == 'icon':
            kept_icon.append(p)
            continue
        if field_of(p) not in TEXT_FIELDS:
            # 非文本字段差异：本批 7 文件不应出现，出现即报错
            raise SystemExit('非文本差异出现在 %s: %s' % (fn, p))
        old, new = lr[p], lref[p]
        assert isinstance(old, str) and isinstance(new, str), (fn, p)
        if old not in repl:
            repl[old] = new
        else:
            assert repl[old] == new, (fn, p, old, new)
    return raw, web, ref, repl, kept_icon, diff

def apply_repl(raw, repl):
    new = raw
    matched = 0
    # 关键：按 old 串长度降序执行，长串/整句先替换，避免短子串提前改写后
    # 导致整句原始串不再命中（如「北斗石」先于「…北斗石。」整句被替换）。
    for old, nv in sorted(repl.items(), key=lambda kv: -len(kv[0])):
        b = old.encode('utf-8')
        if b in new:
            new = new.replace(b, nv.encode('utf-8'))
            matched += 1
        else:
            # 兼容 JSON \u 转义存储（极少数情况下）
            esc = old.encode('utf-8').decode('utf-8').encode('unicode_escape')
            if esc in new:
                new = new.replace(esc, nv.encode('unicode_escape'))
                matched += 1
    return new, matched

def verify(fn, raw_new, ref, kept_icon):
    web2 = json.loads(raw_new.decode('utf-8'))
    l2, lref = leaves(web2), leaves(ref)
    diff2 = {p for p in (set(l2) | set(lref))
             if l2.get(p, '<NA>') != lref.get(p, '<NA>')}
    assert diff2 == set(kept_icon), \
        '%s 替换后差异应为 icon，实际: %s' % (fn, sorted(diff2 ^ set(kept_icon))[:12])
    # icon 字段必须原样保留（即与原始 web 一致）
    raw_old = open(os.path.join(ROOT, 'data', fn + '.json'), 'rb').read()
    web_old = json.loads(raw_old.decode('utf-8'))
    lo = leaves(web_old)
    for p in kept_icon:
        assert l2[p] == lo[p], '%s icon 被改: %s' % (fn, p)

def main():
    apply = '--apply' in sys.argv
    total_repl = 0
    for fn in FILES:
        raw, web, ref, repl, kept_icon, diff = build_map(fn)
        raw_new, matched = apply_repl(raw, repl)
        verify(fn, raw_new, ref, kept_icon)
        print('%-18s 文本替换 %2d 处（命中 %2d），保留 icon %2d 处；'
              '替换后与 0.94 仅剩 icon 差异：OK'
              % (fn, len(repl), matched, len(kept_icon)))
        total_repl += len(repl)
        if apply:
            open(os.path.join(ROOT, 'data', fn + '.json'), 'wb').write(raw_new)
    print('合计文本替换 %d 处' % total_repl)
    if not apply:
        print('[dry-run] 未落盘，加 --apply 执行')
    else:
        print('[applied] 已落盘 7 份 data/*.json')

if __name__ == '__main__':
    main()
