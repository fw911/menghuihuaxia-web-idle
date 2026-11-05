#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""L4 续：把 data/monsters.json 的产出端（exp / gold_min / gold_max）回正到 v0.91。

背景（三层核对结论）：
  · 需求端：玩家升级需求 = exp_formula(15L³ 差分)，与 v0.91 **完全相同** → 已忠实
  · 价格端：items.price 354/354 与 v0.91 **完全相同** → 已忠实
  · 产出端：怪物 exp/gold 被作者整表砍到 1/10（恒定比值 10）→ **唯一偏离点**
    因此回正产出端即可让整个经济回到 v0.91（收入与价格同源于原版，自洽）

取 v0.91 的原值直接写入（而非乘 10），避免任何舍入漂移；
全流程 bytes 直写，不经过 Python 文本模式（防止行尾被 newline 翻译污染）。
"""
import io, json, os, re, sys

SRC = 'data/monsters.json'
V0 = os.path.join('..', '放置归墟_v0.91_decrypted', 'monsters.json')
FIELDS = ('exp', 'gold_min', 'gold_max')


def find_block(buf, key):
    k = b'"key": "%s"' % key.encode('utf-8')
    idx = buf.find(k)
    if idx < 0:
        raise ValueError('%s not found' % key)
    i = idx - 1
    instr = esc = False
    ob = None
    while i >= 0:
        c = buf[i:i + 1]
        if instr:
            if esc:
                esc = False
            elif c == b'\\':
                esc = True
            elif c == b'"':
                instr = False
        else:
            if c == b'"':
                instr = True
            elif c == b'{':
                ob = i
                break
        i -= 1
    if ob is None:
        raise ValueError('%s open brace not found' % key)
    depth = 0
    i = ob
    instr = esc = False
    n = len(buf)
    while i < n:
        c = buf[i:i + 1]
        if instr:
            if esc:
                esc = False
            elif c == b'\\':
                esc = True
            elif c == b'"':
                instr = False
        else:
            if c == b'"':
                instr = True
            elif c == b'{':
                depth += 1
            elif c == b'}':
                depth -= 1
                if depth == 0:
                    return ob, i + 1
        i += 1
    raise ValueError('%s unbalanced' % key)


def set_num(block, field, newv):
    pat = rb'("%s"\s*:\s*)-?\d+(?:\.\d+)?' % field.encode('utf-8')
    block, cnt = re.subn(pat, lambda m: m.group(1) + str(newv).encode('utf-8'), block, count=1)
    return block, cnt


def main():
    with io.open(SRC, 'rb') as f:
        buf = f.read()
    with io.open(V0, 'r', encoding='utf-8') as f:
        v0 = json.load(f)
    v0map = {}
    for m in (v0['monsters'] if isinstance(v0, dict) else v0):
        v0map[m.get('key')] = m

    stats = {f: 0 for f in FIELDS}
    changed = 0
    unmatched = 0
    keys = sorted({m.get('key') for m in json.loads(buf.decode('utf-8'))['monsters']})
    for key in keys:
        if key not in v0map:
            unmatched += 1
            continue
        ob, oe = find_block(buf, key)
        block = buf[ob:oe]
        src = v0map[key]
        hit = False
        for fld in FIELDS:
            if fld not in src:
                continue
            try:
                nb, cnt = set_num(block, fld, src[fld])
            except Exception:
                continue
            if cnt == 1:
                if nb != block:
                    hit = True
                block = nb
        if hit:
            buf = buf[:ob] + block + buf[oe:]
            changed += 1
            for fld in FIELDS:
                if fld in src:
                    stats[fld] += 1
    data = json.loads(buf.decode('utf-8'))
    if b'\r\r\n' in buf:
        raise ValueError('检测到双重回车，终止')
    with io.open(SRC, 'wb') as f:
        f.write(buf)
    print('OK: 产出端已回正 v0.91。改动怪物条目 %d 只（v0.91 无对应条目的 %d 只跳过）' % (changed, unmatched))
    print('    字段写入次数: %s' % stats)
    # 复核：与 v0.91 逐字段一致
    bad = 0
    for m in data['monsters']:
        s = v0map.get(m.get('key'))
        if not s:
            continue
        for fld in FIELDS:
            if fld in s and fld in m and m[fld] != s[fld]:
                bad += 1
    print('    回读校验：与 v0.91 不一致的字段数 = %d' % bad)


if __name__ == '__main__':
    main()
