#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""L4 续四：通用「条目级标量字段」对齐器。

按 (文件, 顶层键, 字段名) 规格，把 web-idle 的条目字段对齐到 v0.91 同 key 条目的值。
仅处理**同量纲标量字段**（倍率/等级/价格等），不做结构变更。

技能类文件额外要求 `skill_type` 相同（v0.91 改造过部分技能，同 key 不同技能不能搬数值）。

SPEC 列表：
  monster_skills.json / monster_skills / mult          —— 怪物技能倍率（原版 sd = round(max_phys_atk×(mult-1))）
  skills_active_*.json / active_skills / learn_level   —— 主动技能学习等级
  skills_passive.json  / passive_skills / learn_level  —— 被动技能学习等级
  items.json / items / coupon_price                    —— 神秘结晶价格

全流程 bytes 直写 + 回读校验。
"""
import io, json, os, re, sys

V0_DIR = os.path.join('..', '放置归墟_v0.91_decrypted')

SPEC = [
    ('data/monster_skills.json', 'monster_skills', 'mult', False),
    ('data/skills_active_warrior.json', 'active_skills', 'learn_level', True),
    ('data/skills_active_mage.json', 'active_skills', 'learn_level', True),
    ('data/skills_active_darkwitch.json', 'active_skills', 'learn_level', True),
    ('data/skills_active_shaman.json', 'active_skills', 'learn_level', True),
    ('data/skills_passive.json', 'passive_skills', 'learn_level', True),
    ('data/items.json', 'items', 'coupon_price', False),
]


def find_block(buf, key):
    k = b'"key": "%s"' % key.encode('utf-8')
    idx = buf.find(k)
    if idx < 0:
        return None
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
        return None
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
    return None


def set_num(block, field, newv):
    pat = rb'("%s"\s*:\s*)-?\d+(?:\.\d+)?' % field.encode('utf-8')
    return re.subn(pat, lambda mm: mm.group(1) + str(newv).encode('utf-8'), block, count=1)


def main():
    total_chg = 0
    for path, topkey, field, need_type in SPEC:
        vpath = os.path.join(V0_DIR, os.path.basename(path))
        with io.open(path, 'rb') as f:
            buf = f.read()
        with io.open(vpath, 'r', encoding='utf-8') as f:
            v0 = json.load(f)
        vmap = {e.get('key'): e for e in (v0.get(topkey) or [])}
        data = json.loads(buf.decode('utf-8'))
        chg = 0
        skip_type = 0
        for e in data.get(topkey) or []:
            src = vmap.get(e.get('key'))
            if not src:
                continue
            if need_type and e.get('skill_type') != src.get('skill_type'):
                skip_type += 1
                continue
            if field not in e or field not in src or e[field] == src[field]:
                continue
            rng = find_block(buf, e['key'])
            if not rng:
                continue
            ob, oe = rng
            nb, cnt = set_num(buf[ob:oe], field, src[field])
            if cnt != 1:
                print('  WARN %s %s 未命中字段 %s' % (path, e['key'], field))
                continue
            buf = buf[:ob] + nb + buf[oe:]
            chg += 1
        if b'\r\r\n' in buf:
            raise ValueError('检测到双重回车，终止：%s' % path)
        with io.open(path, 'wb') as f:
            f.write(buf)
        # 回读校验
        back = json.loads(buf.decode('utf-8'))
        vmap2 = {e.get('key'): e for e in (json.load(io.open(vpath, encoding='utf-8')).get(topkey) or [])}
        bad = 0
        for e in back.get(topkey) or []:
            src = vmap2.get(e.get('key'))
            if not src:
                continue
            if need_type and e.get('skill_type') != src.get('skill_type'):
                continue
            if field in e and field in src and e[field] != src[field]:
                bad += 1
        print('%-34s %-14s %-12s 改动=%-5d 跳过(类型不同)=%-3d 回读不一致=%d'
              % (os.path.basename(path), topkey, field, chg, skip_type, bad))
        total_chg += chg
    print('合计改动 %d 处' % total_chg)


if __name__ == '__main__':
    main()
