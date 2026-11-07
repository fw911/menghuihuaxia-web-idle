#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""L4 续六（收尾）：剩余「可安全回正」的同量纲字段 → v0.91。

经逐项判定，本轮只回正真实数值漂移：

  skills_passive.json / passive_skills / requirements[].level|money|exp   270 处
  monster_skills.json / monster_skills / weight                            26 处
  monsters.json       / monsters       / level（天尊系列 95 -> 109）        6 处

明确排除（写入会破坏游戏，或属刻意设计；详见 UPGRADE_REPORT.md）：
  shops.json  items[].price                  v0.91 全部 = 1，43 处
  maps.json   jubao_spots[].refresh_minutes v0.91 全部 = 0，45 处
  ⚠ 上面两项当时被误记为「占位/脱敏」：L7 从原版 .enc 直解证实是 v0.91 魔改版的
    刻意压平设定；L8 又证实 v0.94 官方发行版已恢复真值，并已按 v0.94 回填
    （见 UPGRADE_REPORT.md §十 / §十一、_l7_forensic.py、_l8_v094_apply.py）。
  shenmo_skills*.json levels[].scale_pct 等 自研神魔技能树（多数为刻意 2x 设计）
  monster_skills effects[].value / mp      效果体系、蓝耗量纲不同
  monsters.json 5 首领 hp/phys_def/atk     L4 刻意校准值，保证三档可杀
  skills_active_mage/shaman requirements   3 个 skill_type 被改造技能（既定跳过）

实现：bytes 定点补丁（按 key 定位对象 + 括号配对 + 逐字段单次替换），
      统一 LF 行尾，禁止双重回车；回读校验 + 「非目标字段零变化」强校验。
"""
import io, json, os, re, sys

WI_DIR = 'data'
V0_DIR = os.path.join('..', '放置归墟_v0.91_decrypted')

# (文件, 顶层键, 容器字段, 目标字段列表, 附加过滤)
# 容器字段为 None 表示条目自身的标量字段
SPEC = [
    ('skills_passive.json', 'passive_skills', 'requirements', ['level', 'money', 'exp'], None),
    ('monster_skills.json', 'monster_skills', None, ['weight'], None),
    ('monsters.json', 'monsters', None, ['level'], None),
]


def find_block(buf, marker, lo=0, hi=None):
    """在 buf[lo:hi] 内定位 marker（b'"key": "xx"'）所属对象的 {..} 区间。"""
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
    while i < hi:
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


def find_array(block, field):
    """返回 block 内 "field": [...] 数组区间（含方括号）。"""
    m = re.search(rb'("%s"\s*:\s*)\[' % field.encode('utf-8'), block)
    if not m:
        return None
    i = m.end() - 1
    depth = 0
    instr = esc = False
    j = i
    while j < len(block):
        c = block[j:j + 1]
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
            elif c == b'[':
                depth += 1
            elif c == b']':
                depth -= 1
                if depth == 0:
                    return i, j + 1
        j += 1
    return None


def top_objects(buf, lo, hi):
    """数组区间内所有顶层 {...} 对象的区间列表。"""
    out = []
    depth = 0
    instr = esc = False
    start = None
    i = lo
    while i < hi:
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
                if depth == 0:
                    start = i
                depth += 1
            elif c == b'}':
                depth -= 1
                if depth == 0 and start is not None:
                    out.append((start, i + 1))
                    start = None
        i += 1
    return out


def set_num(block, field, newv):
    """单次替换 "field": 数字；返回 (新块, 命中次数)。0 次表示字段不存在。"""
    pat = rb'("%s"\s*:\s*)-?\d+(?:\.\d+)?' % field.encode('utf-8')
    return re.subn(pat, lambda mm: mm.group(1) + str(newv).encode('utf-8'), block, count=1)


def patch_entry(block, entry, src, container, fields):
    """生成补丁后的条目块，返回 (新块, 改动字段数)。"""
    chg = 0
    if container is None:
        for f in fields:
            if f in entry and f in src and entry[f] != src[f]:
                nb, cnt = set_num(block, f, src[f])
                if cnt != 1:
                    raise ValueError('字段 %s 未命中（key=%s）' % (f, entry.get('key')))
                block = nb
                chg += 1
        return block, chg

    arr = find_array(block, container)
    if not arr:
        raise ValueError('容器 %s 未找到（key=%s）' % (container, entry.get('key')))
    alo, ahi = arr
    objs = top_objects(block, alo, ahi)
    src_items = src.get(container) or []
    newarr = block[alo:ahi]
    # 倒序替换，避免前面元素的下标被后面的长度变化影响
    for i in reversed(range(min(len(objs), len(src_items)))):
        a = src_items[i]
        if not isinstance(a, dict):
            continue
        s, e = objs[i]
        rel_s, rel_e = s - alo, e - alo
        elem = newarr[rel_s:rel_e]
        for f in fields:
            if f not in a:
                continue
            nb, cnt = set_num(elem, f, a[f])
            if cnt == 1:
                elem = nb
                chg += 1
        newarr = newarr[:rel_s] + elem + newarr[rel_e:]
    return block[:alo] + newarr + block[ahi:], chg


def strip_targets(entries, container, fields):
    """返回去掉目标字段后的条目深拷贝，用于「非目标字段零变化」校验。"""
    out = []
    for e in entries:
        c = json.loads(json.dumps(e, ensure_ascii=False))
        if container is None:
            for f in fields:
                c.pop(f, None)
        else:
            for it in (c.get(container) or []):
                if isinstance(it, dict):
                    for f in fields:
                        it.pop(f, None)
        out.append(c)
    return out


def main():
    total = 0
    for fn, topkey, container, fields, filt in SPEC:
        path = os.path.join(WI_DIR, fn)
        vpath = os.path.join(V0_DIR, fn)
        with io.open(path, 'rb') as f:
            buf = f.read()
        # 统一 LF（.gitattributes: * text=auto eol=lf）
        if b'\r\n' in buf:
            buf = buf.replace(b'\r\n', b'\n')
        before = json.loads(buf.decode('utf-8'))
        v0 = json.load(io.open(vpath, encoding='utf-8'))
        vmap = {e.get('key'): e for e in (v0.get(topkey) or [])}

        cursor = 0
        chg = 0
        skipped = 0
        for entry in (before.get(topkey) or []):
            src = vmap.get(entry.get('key'))
            if not src or (filt and not filt(entry, src)):
                skipped += 1
                continue
            marker = b'"key": "%s"' % entry['key'].encode('utf-8')
            rng = find_block(buf, marker, cursor)
            if not rng:
                raise ValueError('未定位条目 %s / %s' % (fn, entry['key']))
            ob, oe = rng
            nb, n = patch_entry(buf[ob:oe], entry, src, container, fields)
            buf = buf[:ob] + nb + buf[oe:]
            cursor = ob + len(nb)
            chg += n

        if b'\r\r\n' in buf or b'\r' in buf:
            raise ValueError('行尾污染（检测到 CR）：%s' % fn)
        after = json.loads(buf.decode('utf-8'))

        # 强校验 1：除目标字段外，条目内容必须逐条完全一致
        sb = strip_targets(before.get(topkey) or [], container, fields)
        sa = strip_targets(after.get(topkey) or [], container, fields)
        if sb != sa:
            raise ValueError('非目标字段发生变化：%s' % fn)
        # 强校验 2：目标字段与 v0.91 逐条一致
        bad = 0
        for e in (after.get(topkey) or []):
            src = vmap.get(e.get('key'))
            if not src or (filt and not filt(e, src)):
                continue
            if container is None:
                for f in fields:
                    if f in e and f in src and e[f] != src[f]:
                        bad += 1
            else:
                for a, b in zip(e.get(container) or [], src.get(container) or []):
                    for f in fields:
                        if f in a and f in b and a[f] != b[f]:
                            bad += 1
        with io.open(path, 'wb') as f:
            f.write(buf)
        print('%-26s %-18s %-26s 改动=%-4d 跳过=%-4d 回读不一致=%d'
              % (fn, topkey, container or '(条目本身)', chg, skipped, bad))
        if bad:
            raise ValueError('%s 仍有 %d 处未对齐' % (fn, bad))
        total += chg
    print('OK: 合计回正 %d 处（bytes 定点补丁 / LF / 回读校验全部通过）' % total)


if __name__ == '__main__':
    main()
