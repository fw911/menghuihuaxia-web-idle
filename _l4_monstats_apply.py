#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""L4 续：怪物强度表回正 v0.91（hp / 物法攻 / 物法防 / speed）。

范围与例外：
  · 普通怪（1498 只）：10 个强度字段全部对齐 v0.91
  · 非校准首领（33 只）：其 hp/def 本就与 v0.91 一致，仅回正 atk 与 speed
  · 已校准首领（5 只，CALIBRATED）：**hp / def / atk 保持现状**
    —— hp/def 是「高阶副本约 2000 轮可杀」的校准结果（v0.91 原值不可杀），
       atk(五曜真君 ×0.72) 是 entry+5 不暴毙的生存性缩放；仅 speed 随表回正

全流程 bytes 直写，不经 Python 文本模式（避免行尾被 newline 翻译污染）。
"""
import io, json, os, re, sys

SRC = 'data/monsters.json'
V0 = os.path.join('..', '放置归墟_v0.91_decrypted', 'monsters.json')
CALIBRATED = {'mh_guimu_30020', 'mh_xyt_30212', 'mh_xhz_30807', 'shd_boss115', 'wxz_33164'}
ALL_FIELDS = ('hp', 'min_phys_atk', 'max_phys_atk', 'min_magic_atk', 'max_magic_atk',
              'min_phys_def', 'max_phys_def', 'min_magic_def', 'max_magic_def', 'speed')


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
    v0map = {m.get('key'): m for m in (v0['monsters'] if isinstance(v0, dict) else v0)}
    data = json.loads(buf.decode('utf-8'))
    stats = {}
    touched = 0
    for m in data['monsters']:
        key = m.get('key')
        src = v0map.get(key)
        if not src:
            continue
        if key in CALIBRATED:
            fields = ('speed',)                      # 只回正 speed，hp/def/atk 保留校准值
        elif m.get('type') == 'dungeon_boss':
            fields = ('min_phys_atk', 'max_phys_atk', 'min_magic_atk', 'max_magic_atk', 'speed')
        else:
            fields = ALL_FIELDS
        ob, oe = find_block(buf, key)
        block = buf[ob:oe]
        hit = False
        for fld in fields:
            if fld not in src or fld not in m:
                continue
            nb, cnt = set_num(block, fld, src[fld])
            if cnt == 1:
                if nb != block:
                    hit = True
                    stats[fld] = stats.get(fld, 0) + 1
                block = nb
        if hit:
            buf = buf[:ob] + block + buf[oe:]
            touched += 1
    # 校验
    back = json.loads(buf.decode('utf-8'))
    bad = []
    for m in back['monsters']:
        key = m.get('key')
        src = v0map.get(key)
        if not src:
            continue
        if key in CALIBRATED:
            fields = ('speed',)
        elif m.get('type') == 'dungeon_boss':
            fields = ('min_phys_atk', 'max_phys_atk', 'min_magic_atk', 'max_magic_atk', 'speed')
        else:
            fields = ALL_FIELDS
        for fld in fields:
            if fld in src and fld in m and m[fld] != src[fld]:
                bad.append('%s.%s' % (key, fld))
    if b'\r\r\n' in buf:
        raise ValueError('检测到双重回车，终止')
    with io.open(SRC, 'wb') as f:
        f.write(buf)
    print('OK: 怪物强度表已回正 v0.91。改动条目 %d 只' % touched)
    print('    各字段写入次数: %s' % stats)
    print('    回读校验：仍不一致的字段 = %d %s' % (len(bad), bad[:8]))


if __name__ == '__main__':
    main()
