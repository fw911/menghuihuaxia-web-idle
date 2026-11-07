#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""L5 结构回正（以 v0.91 为基准）—— 第一部分。

用户决策：结构补齐 + 5 个高阶副本首领「完全忠实 v0.91」（放弃上一轮
「约 2000 轮可击杀」的校准约束，不再做平衡性下调）。

本脚本做两件事：

A. data/monster_skills.json 结构补齐
   - web-idle 现有 1997 条里含 95 个 key / 190 条**内容完全相同**的重复条目 → 去重
   - v0.91 独有 215 个技能（其中 128 个被 monsters[].skills[] 引用，
     含 5 个高阶副本首领的全部 15 个技能）→ 追加，按 v0.91 顺序
   - 新增条目补 `cd = round(cd_ms/1000)`：引擎 monsterHit() 消费 sk.cd
     （默认 2 回合），v0.91 只给 cd_ms，不补会用错误的冷却
   - 结果：2022 个唯一 key，与 v0.91 完全一致

B. data/monsters.json 5 首领数值回正 v0.91 原版
   - 撤销 L4 的校准值（hp / min_phys_def / max_phys_def / 五曜真君 atk），
     逐字段从 v0.91 读取写入
   - 其它怪物、其它字段不动

格式：bytes 直写；monster_skills 用 indent=1 全量序列化（已验证零差异还原），
      monsters 用定点正则补丁；统一 LF；回读 + 非目标字段零变化强校验。
"""
import io, json, os, re, sys

WI = 'data'
V0 = os.path.join('..', '放置归墟_v0.91_decrypted')

BOSS_KEYS = ['mh_guimu_30020', 'mh_xyt_30212', 'mh_xhz_30807', 'shd_boss115', 'wxz_33164']
BOSS_FIELDS = ['hp', 'min_phys_def', 'max_phys_def', 'min_phys_atk', 'max_phys_atk']


def load(p):
    return json.load(io.open(p, encoding='utf-8'))


def apply_skills():
    path = os.path.join(WI, 'monster_skills.json')
    v0 = load(os.path.join(V0, 'monster_skills.json'))
    src = v0['monster_skills']
    vmap = {e['key']: e for e in src}

    before = load(path)
    arr = before['monster_skills']
    seen = set()
    dedup = []
    for e in arr:
        if e['key'] in seen:
            continue
        seen.add(e['key'])
        dedup.append(e)
    removed = len(arr) - len(dedup)

    added = []
    for e in src:
        if e['key'] in seen:
            continue
        ne = dict(e)
        if 'cd_ms' in ne:
            ne['cd'] = int(round(ne['cd_ms'] / 1000.0))
        added.append(ne)

    before['monster_skills'] = dedup + added
    out = json.dumps(before, indent=1, ensure_ascii=False)
    buf = out.encode('utf-8')
    if b'\r' in buf:
        raise ValueError('monster_skills 输出含 CR')

    # 校验：唯一 key / 与 v0.91 集合一致 / 原有条目内容不变 / 新增条目字段一致
    back = json.loads(buf.decode('utf-8'))
    keys = [e['key'] for e in back['monster_skills']]
    if len(keys) != len(set(keys)):
        raise ValueError('仍有重复 key')
    if set(keys) != set(vmap):
        raise ValueError('key 集合与 v0.91 不一致：缺 %d / 多 %d'
                         % (len(set(vmap) - set(keys)), len(set(keys) - set(vmap))))
    orig_by_key = {}
    for e in arr:
        orig_by_key.setdefault(e['key'], e)
    for e in back['monster_skills']:
        if e['key'] in orig_by_key and e != orig_by_key[e['key']]:
            raise ValueError('原有条目被改动：%s' % e['key'])
    for ne in added:
        cur = next(x for x in back['monster_skills'] if x['key'] == ne['key'])
        base = vmap[ne['key']]
        for f, val in base.items():
            if cur.get(f) != val:
                raise ValueError('新增条目 %s 字段 %s 与 v0.91 不一致' % (ne['key'], f))

    with io.open(path, 'wb') as f:
        f.write(buf)
    print('%-24s 去重 -%d 条 / 追加 +%d 条 / 现 %d 条唯一 key（v0.91=%d）'
          % ('monster_skills.json', removed, len(added), len(keys), len(vmap)))
    return removed + len(added)


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
    raise ValueError('%s unbalanced' % key)


def apply_bosses():
    path = os.path.join(WI, 'monsters.json')
    v0 = load(os.path.join(V0, 'monsters.json'))
    vmap = {e['key']: e for e in v0['monsters']}
    with io.open(path, 'rb') as f:
        buf = f.read()
    if b'\r' in buf:
        raise ValueError('monsters.json 含 CR，需先确认')
    before = json.loads(buf.decode('utf-8'))
    chg = 0
    detail = []
    for key in BOSS_KEYS:
        cur = next(e for e in before['monsters'] if e['key'] == key)
        src = vmap[key]
        fields = {f: src[f] for f in BOSS_FIELDS
                  if f in cur and f in src and cur[f] != src[f]}
        if not fields:
            continue
        ob, oe = find_block(buf, key)
        block = buf[ob:oe]
        for f, val in fields.items():
            pat = rb'("%s"\s*:\s*)-?\d+(?:\.\d+)?' % f.encode('utf-8')
            block, cnt = re.subn(pat, lambda mm: mm.group(1) + str(val).encode('utf-8'), block, count=1)
            if cnt != 1:
                raise ValueError('%s 字段 %s 未命中' % (key, f))
        buf = buf[:ob] + block + buf[oe:]
        chg += len(fields)
        detail.append((key, fields))
    after = json.loads(buf.decode('utf-8'))
    # 强校验：仅 5 首领的目标字段变化，其余内容逐条完全相同
    bmap = {e['key']: e for e in before['monsters']}
    amap = {e['key']: e for e in after['monsters']}
    for key in bmap:
        a, b = bmap[key], amap[key]
        if key in BOSS_KEYS:
            ca = {k: v for k, v in a.items() if k not in BOSS_FIELDS}
            cb = {k: v for k, v in b.items() if k not in BOSS_FIELDS}
            if ca != cb:
                raise ValueError('%s 非目标字段被改动' % key)
        elif a != b:
            raise ValueError('%s 被误改' % key)
    for key in BOSS_KEYS:
        src = vmap[key]
        for f in BOSS_FIELDS:
            if f in amap[key] and f in src and amap[key][f] != src[f]:
                raise ValueError('%s.%s 未回正' % (key, f))
    with io.open(path, 'wb') as f:
        f.write(buf)
    print('%-24s 5 首领回正 v0.91 原版，共 %d 个字段' % ('monsters.json', chg))
    for key, fields in detail:
        print('   %-18s %s' % (key, ' '.join('%s=%s' % (f, v) for f, v in fields.items())))
    return chg


def main():
    n1 = apply_skills()
    n2 = apply_bosses()
    print('OK: L5 第一部分完成（技能结构 %d 处变更 / 首领 %d 字段）' % (n1, n2))


if __name__ == '__main__':
    main()
