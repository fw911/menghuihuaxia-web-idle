#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""L5 结构回正（以 v0.91 为基准）—— 第三部分：补齐缺失字段。

仅补「v0.91 有、web-idle 缺」且引擎不消费 / 纯展示的字段：
  jobs.json / jobs / hp_per_level, mp_per_level, form_five, form_desc, form_buffs  —— 4 职业 × 5 = 20 处
  achievements.json / achievements / kill_keyword_official                        —— 2 处

明确跳过：
  shenmo_skills*.json / shenmo_active_skills*.json 的 effect_type / mode / jobs /
    summon_duration_ms 等 —— 自研神魔技能树（改编线），其中 ps.jobs 会被引擎
    消费并限制技能职业，补齐会改变战斗行为。
  jobs.shenmo（自研大对象）、crystals.desc（展示元数据，价值低）。

实现：bytes 定点插入 —— 按 key 定位条目对象，在末尾 '}' 前追加字段；
      沿用原文件行尾；回读校验 + 原有字段零变化校验。
"""
import io, json, os, re, sys

WI = 'data'
V0 = os.path.join('..', '放置归墟_v0.91_decrypted')

SPEC = [
    ('jobs.json', 'jobs', ['hp_per_level', 'mp_per_level', 'form_five', 'form_desc', 'form_buffs']),
    ('achievements.json', 'achievements', ['kill_keyword_official']),
]


def load(p):
    return json.load(io.open(p, encoding='utf-8'))


def find_block(buf, key, lo=0):
    marker = b'"key": "%s"' % key.encode('utf-8')
    idx = buf.find(marker, lo)
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
    while i < len(buf):
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


def field_indent(buf, ob, oe):
    """探测对象内字段行的缩进空格数。"""
    block = buf[ob:oe]
    m = re.search(rb'\n[ \t]*"', block)
    if not m:
        return 2
    s = m.start() + 1
    e = m.end() - 1
    return max(2, e - s)


def process(fn, topkey, fields):
    path = os.path.join(WI, fn)
    v0 = load(os.path.join(V0, fn))
    with io.open(path, 'rb') as f:
        buf = f.read()
    before = json.loads(buf.decode('utf-8'))
    eol = b'\r\r\n' if b'\r\r\n' in buf else (b'\r\n' if b'\r\n' in buf else b'\n')
    vmap = {e['key']: e for e in v0[topkey] if isinstance(e, dict) and 'key' in e}

    jobs = []   # (对象结束位置, key, [(字段, 值)])
    total = 0
    for e in before[topkey]:
        src = vmap.get(e.get('key'))
        if not src:
            continue
        add = [(f, src[f]) for f in fields if f in src and f not in e]
        if not add:
            continue
        rng = find_block(buf, e['key'])
        if not rng:
            raise ValueError('%s / %s 对象未定位' % (fn, e['key']))
        jobs.append((rng, e['key'], add))
        total += len(add)

    for (ob, oe), key, add in sorted(jobs, key=lambda x: -x[0][0]):
        ind = field_indent(buf, ob, oe)
        parts = []
        for f, val in add:
            parts.append((' ' * ind + '"%s": ' % f).encode('utf-8')
                         + json.dumps(val, ensure_ascii=False).encode('utf-8'))
        ins = b',' + eol + (b',' + eol).join(parts)
        # 插到对象末尾 '}' 之前
        pos = oe - 1
        buf = buf[:pos] + ins + buf[pos:]

    after = json.loads(buf.decode('utf-8'))
    amap = {e['key']: e for e in after[topkey]}
    for e in before[topkey]:
        cur = amap[e['key']]
        for f, val in e.items():
            if cur.get(f) != val:
                raise ValueError('%s / %s 原有字段被改动：%s' % (fn, e['key'], f))
        src = vmap.get(e['key'])
        if src:
            for f in fields:
                if f in src and cur.get(f) != src[f]:
                    raise ValueError('%s / %s 字段 %s 未补齐' % (fn, e['key'], f))
    with io.open(path, 'wb') as f:
        f.write(buf)
    print('%-24s %-14s 补齐 %2d 个字段' % (fn, topkey, total))
    return total


def main():
    total = sum(process(*s) for s in SPEC)
    print('OK: 缺失字段补齐 %d 处，定点插入 / 原行尾保留 / 回读校验通过' % total)


if __name__ == '__main__':
    main()
