#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""L5 结构回正（以 v0.91 为基准）—— 第二部分：补齐缺失条目。

覆盖（v0.91 有、web-idle 缺，共 94 条）：
  bases_warrior/shaman/mage/darkwitch/accessory.json —— 8 档（tier 8）装备基底 76 条
  achievements.json —— achievements 3 条 + titles 15 条

明确跳过：
  shenmo_skills*.json / shenmo_active_skills*.json（9 条）—— web-idle 自研神魔
    技能树（文件 _comment 标注 MOD 双切改造），属改编线而非数据缺口；
    且其文件为手写压缩排版，插入会破坏格式。
  shops.json 的 3 个 web-idle 自研商店 —— 不删（保留自研内容）。

实现：bytes 定点插入 —— 定位每个顶层 list 字段的数组区间，在最后一个元素
      对象后追加新条目；沿用原文件行尾（这些文件历史带 \\r\\r\\n，不改写
      以免产生整文件 diff）；回读校验 + 原有条目零变化校验。
"""
import io, json, os, re, sys

WI = 'data'
V0 = os.path.join('..', '放置归墟_v0.91_decrypted')

FILES = ['bases_warrior.json', 'bases_shaman.json', 'bases_mage.json',
         'bases_darkwitch.json', 'bases_accessory.json', 'achievements.json']


def load(p):
    return json.load(io.open(p, encoding='utf-8'))


def find_array(buf, field):
    """返回 "field": [...] 的数组区间（含方括号，绝对下标）。"""
    m = re.search(rb'("%s"\s*:\s*)\[' % field.encode('utf-8'), buf)
    if not m:
        return None
    i = m.end() - 1
    depth = 0
    instr = esc = False
    j = i
    while j < len(buf):
        c = buf[j:j + 1]
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
    """数组区间内所有顶层 {...} 对象区间。"""
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


def render_entry(e, indent, eol):
    """按 json.dumps(indent=2) 渲染条目并整体缩进到数组元素层级。"""
    lines = json.dumps(e, indent=2, ensure_ascii=False).split('\n')
    return eol.join((' ' * indent + ln).encode('utf-8') for ln in lines)


def process(fn):
    path = os.path.join(WI, fn)
    v0 = load(os.path.join(V0, fn))
    with io.open(path, 'rb') as f:
        buf = f.read()
    before = json.loads(buf.decode('utf-8'))
    eol = b'\r\r\n' if b'\r\r\n' in buf else (b'\r\n' if b'\r\n' in buf else b'\n')

    # 收集 (字段, 插入位置, 待补条目)，按插入位置倒序处理
    jobs = []
    total = 0
    for field, src_list in v0.items():
        cur_list = before.get(field)
        if not (isinstance(src_list, list) and isinstance(cur_list, list)
                and src_list and isinstance(src_list[0], dict) and 'key' in src_list[0]):
            continue
        have = {e['key'] for e in cur_list if isinstance(e, dict) and 'key' in e}
        adds = [e for e in src_list if isinstance(e, dict) and 'key' in e and e['key'] not in have]
        if not adds:
            continue
        rng = find_array(buf, field)
        if not rng:
            raise ValueError('%s / %s 数组未定位' % (fn, field))
        alo, ahi = rng
        objs = top_objects(buf, alo, ahi)
        if not objs:
            raise ValueError('%s / %s 数组为空，暂不支持' % (fn, field))
        jobs.append((objs[-1][1], field, adds))
        total += len(adds)

    for pos, field, adds in sorted(jobs, key=lambda x: -x[0]):
        # 元素缩进：取数组内第一个对象前的空格数
        rng = find_array(buf, field)
        alo, ahi = rng
        objs = top_objects(buf, alo, ahi)
        first = objs[0][0]
        k = first - 1
        while k >= 0 and buf[k:k + 1] in (b' ', b'\t'):
            k -= 1
        indent = first - 1 - k
        if indent <= 0:
            indent = 4
        chunk = (b',' + eol).join(render_entry(e, indent, eol) for e in adds)
        ins = b',' + eol + chunk
        buf = buf[:pos] + ins + buf[pos:]

    after = json.loads(buf.decode('utf-8'))
    # 校验 1：每个字段的 key 集合与 v0.91 一致（允许 web-idle 自研多余条目）
    for field, src_list in v0.items():
        if not (isinstance(src_list, list) and isinstance(after.get(field), list)
                and src_list and isinstance(src_list[0], dict) and 'key' in src_list[0]):
            continue
        sv = {e['key'] for e in src_list if isinstance(e, dict) and 'key' in e}
        av = {e['key'] for e in after[field] if isinstance(e, dict) and 'key' in e}
        if sv - av:
            raise ValueError('%s / %s 仍缺 %d 条' % (fn, field, len(sv - av)))
    # 校验 2：原有条目内容逐条不变
    for field, cur_list in before.items():
        if not (isinstance(cur_list, list)):
            continue
        amap = {e['key']: e for e in after.get(field, []) if isinstance(e, dict) and 'key' in e}
        for e in cur_list:
            if isinstance(e, dict) and 'key' in e and amap.get(e['key']) != e:
                raise ValueError('%s / %s 原有条目被改动：%s' % (fn, field, e['key']))

    with io.open(path, 'wb') as f:
        f.write(buf)
    print('%-28s 补齐 %3d 条（%s）' % (fn, total, ', '.join('%s:%d' % (f, n) for _, f, n in
                                                          [(0, x[1], len(x[2])) for x in jobs])))
    return total


def main():
    total = sum(process(fn) for fn in FILES)
    print('OK: 缺失条目补齐 %d 条，定点插入 / 原行尾保留 / 回读校验通过' % total)


if __name__ == '__main__':
    main()
