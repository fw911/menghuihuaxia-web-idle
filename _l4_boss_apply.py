#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""L4：把 5 张高阶副本首领的 HP / 物理防御 /（五曜真君）攻击 下调到约 2000 轮可击杀。

数值来自 _l4_calib.js 校准（entry+5 级有效 DPS 反推 + 目标 1950 轮）。

实现要点：**全流程按 bytes 处理**，不经过 Python 文本模式，避免行尾被
newline 翻译污染（text 模式读会把 CRLF→LF、写会把 LF→CRLF，
再叠加 '.replace('\n','\r\n')' 会产出 '\r\r\n' 双重回车并撑出空行）。
定位方式：按 "key": "<monster key>" 向左回溯找所属对象的 '{'，
再向右做括号配对（跳过字符串字面量），最后逐字段做单次数字替换。
"""
import json, re, sys

SRC = 'data/monsters.json'

PATCH = {
    'mh_guimu_30020': {'hp': 510638, 'min_phys_def': 4780, 'max_phys_def': 5844},
    'mh_xyt_30212':   {'hp': 510638, 'min_phys_def': 5498, 'max_phys_def': 6720},
    'mh_xhz_30807':   {'hp': 538117, 'min_phys_def': 6619, 'max_phys_def': 8091},
    'shd_boss115':    {'hp': 555555, 'min_phys_def': 6354, 'max_phys_def': 7767},
    'wxz_33164':      {'hp': 474308, 'min_phys_def': 5009, 'max_phys_def': 6121,
                       'max_phys_atk': 2754, 'min_phys_atk': 2035},
}


def find_block(buf, key):
    """返回 (起始, 结束) —— 该 monster 对象 {...} 在 bytes 中的区间。"""
    k = b'"key": "%s"' % key.encode('utf-8')
    idx = buf.find(k)
    if idx < 0:
        raise ValueError('%s not found' % key)
    # 向左回溯：找该对象开头的 '{'（key 之前只有标量字段）
    i = idx - 1
    instr = False
    esc = False
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
    # 向右括号配对
    depth = 0
    i = ob
    instr = False
    esc = False
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


def patch_block(block, fields):
    for f, newv in fields.items():
        pat = rb'("%s"\s*:\s*)-?\d+(?:\.\d+)?' % f.encode('utf-8')
        block, cnt = re.subn(pat, lambda m: m.group(1) + str(newv).encode('utf-8'), block, count=1)
        if cnt != 1:
            raise ValueError('field %s count=%d in block' % (f, cnt))
    return block


def main():
    with open(SRC, 'rb') as f:
        buf = f.read()
    orig_len = len(buf)
    for key, fields in PATCH.items():
        ob, oe = find_block(buf, key)
        newblock = patch_block(buf[ob:oe], fields)
        buf = buf[:ob] + newblock + buf[oe:]
    # 校验 JSON 合法 + 行尾未被污染
    d = json.loads(buf.decode('utf-8'))
    if b'\r\r\n' in buf:
        raise ValueError('检测到双重回车，终止')
    with open(SRC, 'wb') as f:
        f.write(buf)
    print('OK: 已写入（bytes 直写，行尾原样保留）。落地值：')
    for key in PATCH:
        m = [x for x in d['monsters'] if x.get('key') == key][0]
        print('  %-16s hp=%-8s def=%s~%s atk=%s~%s' % (
            key, m.get('hp'), m.get('min_phys_def'), m.get('max_phys_def'),
            m.get('min_phys_atk'), m.get('max_phys_atk')))
    print('字节数 %d -> %d' % (orig_len, len(buf)))


if __name__ == '__main__':
    main()
