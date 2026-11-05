#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""L4 续三：把 data/maps.json 的 `zones[].explore_target` 回正 v0.91。

背景：区域探索进度按「击杀数达 explore_target」计（js/world.js / js/idle.js 消费）。
  web-idle 用整齐的 100 / 50；v0.91 用 35（264 处）、10、15 —— 探索门槛被作者抬高 2~3 倍。
  该字段单位一致（击杀数）、引擎直接消费，属可安全回正项。

`minion_target`（首领区清剿门槛）两侧本就 0 差异，无需处理。
全流程 bytes 直写；回读校验。
"""
import io, json, os, re, sys

SRC = 'data/maps.json'
V0 = os.path.join('..', '放置归墟_v0.91_decrypted', 'maps.json')


def find_obj(buf, marker, lo=0, hi=None):
    """在 buf[lo:hi] 内定位 marker（如 '"key": "xx"'）所属对象的 {..} 区间（绝对下标）。

    必须限定区间：多个地图可能存在同名 zone key（如 farm/central），
    全文件搜索会把 A 图的 zone 改到 B 图上。"""
    if hi is None:
        hi = len(buf)
    idx = buf.find(marker, lo, hi)
    if idx < 0:
        return None
    i = idx - 1
    instr = esc = False
    ob = None
    while i >= lo:
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
        return None
    depth = 0
    i = ob
    instr = esc = False
    n = hi
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
    return None


def main():
    with io.open(SRC, 'rb') as f:
        buf = f.read()
    with io.open(V0, 'r', encoding='utf-8') as f:
        v0 = json.load(f)
    v0map = {m.get('key'): m for m in (v0['maps'] if isinstance(v0, dict) else v0)}
    data = json.loads(buf.decode('utf-8'))
    changed = 0
    total = 0
    for m in data['maps']:
        src = v0map.get(m.get('key'))
        if not src:
            continue
        szones = {z.get('key'): z for z in (src.get('zones') or [])}
        mrng = find_obj(buf, b'"key": "%s"' % m['key'].encode('utf-8'))
        if not mrng:
            print('  WARN 地图 %s 未定位' % m['key'])
            continue
        for z in (m.get('zones') or []):
            t = szones.get(z.get('key'))
            if not t or 'explore_target' not in t or 'explore_target' not in z:
                continue
            if z['explore_target'] == t['explore_target']:
                continue
            total += 1
            rng = find_obj(buf, b'"key": "%s"' % z['key'].encode('utf-8'), mrng[0], mrng[1])
            if not rng:
                continue
            ob, oe = rng
            block = buf[ob:oe]
            pat = rb'("explore_target"\s*:\s*)-?\d+(?:\.\d+)?'
            nb, cnt = re.subn(pat, lambda mm: mm.group(1) + str(t['explore_target']).encode('utf-8'), block, count=1)
            if cnt != 1:
                print('  WARN 区域 %s/%s 未命中 explore_target' % (m['key'], z['key']))
                continue
            buf = buf[:ob] + nb + buf[oe:]
            changed += 1
    back = json.loads(buf.decode('utf-8'))
    bad = 0
    for m in back['maps']:
        src = v0map.get(m.get('key'))
        if not src:
            continue
        szones = {z.get('key'): z for z in (src.get('zones') or [])}
        for z in (m.get('zones') or []):
            t = szones.get(z.get('key'))
            if t and 'explore_target' in t and 'explore_target' in z and z['explore_target'] != t['explore_target']:
                bad += 1
    if b'\r\r\n' in buf:
        raise ValueError('检测到双重回车，终止')
    with io.open(SRC, 'wb') as f:
        f.write(buf)
    print('OK: explore_target 已回正 v0.91。改动 %d / %d 处，回读不一致 = %d' % (changed, total, bad))


if __name__ == '__main__':
    main()
