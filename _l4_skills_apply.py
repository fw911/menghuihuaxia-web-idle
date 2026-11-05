#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""L4：把 web-idle 的技能等级伤害数值回正到 v0.91（放置归墟_v0.91_decrypted）。

对齐规则（严格）：
  1. 按技能 key 匹配（key 为原始中文名拼音，v0.91 虽改名但 key 不变，是稳定标识）
  2. 要求 web-idle 与 v0.91 的 skill_type 相同——v0.91 把部分技能改造过
     （如 招魂引 heal→连锁闪电 attack、凛冬寒流 control→attack），
     类型不同则不搬伤害，避免把攻击型伤害写进治疗/控制技
  3. 仅当两侧该等级都有 damage 字段时才对齐
  4. web-idle 侧 max_level 更小的技能，只对齐其实际存在的等级区间，
     不补入 v0.91 多出的更高等级（保留 max_level / levels 长度 / mp / cd / 结构）
  5. 同步更新该等级 desc 内嵌的伤害数字（保持 web-idle 文案风格与空格）

格式：技能文件为 CRLF + indent=1 + 无结尾换行，json.dumps(indent=1) 可零差异还原。
"""
import io, json, os, re, sys

WI_DIR = 'data'
V0_DIR = os.path.join('..', '放置归墟_v0.91_decrypted')
PROFS = ['warrior', 'mage', 'darkwitch', 'shaman']   # summon 的 damage 与 v0.91 已完全一致，跳过


def load(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return json.load(f)


def fix_desc(desc, old, new):
    """把 desc 中「约 N 点」的 N 换成 new（仅当 N==old 时），保持原排版空格。"""
    if not isinstance(desc, str):
        return desc, False
    m = re.search(r'约\s*(\d+)\s*点', desc)
    if not m or int(m.group(1)) != old:
        return desc, False
    return desc[:m.start(1)] + str(new) + desc[m.end(1):], True


def process(prof):
    wf = os.path.join(WI_DIR, 'skills_active_%s.json' % prof)
    vf = os.path.join(V0_DIR, 'skills_active_%s.json' % prof)
    wi = load(wf)
    v0 = load(vf)
    v0map = {s['key']: s for s in v0['active_skills']}
    st = {'dmg': 0, 'desc': 0, 'skills': [], 'skip_type': [], 'no_dmg_field': 0}
    for s in wi['active_skills']:
        v = v0map.get(s['key'])
        if not v:
            continue
        if s.get('skill_type') != v.get('skill_type'):
            st['skip_type'].append('%s(%s↔%s)' % (s['key'], s.get('name'), v.get('name')))
            continue
        wl = s.get('levels', [])
        vl = v.get('levels', [])
        sk = 0
        for i in range(min(len(wl), len(vl))):
            if 'damage' not in wl[i] or 'damage' not in vl[i]:
                st['no_dmg_field'] += 1
                continue
            old = wl[i]['damage']
            new = vl[i]['damage']
            if old == new:
                continue
            wl[i]['damage'] = new
            st['dmg'] += 1
            sk += 1
            nd, dch = fix_desc(wl[i].get('desc'), old, new)
            if dch:
                wl[i]['desc'] = nd
                st['desc'] += 1
        if sk:
            st['skills'].append('%s(%d级)' % (s.get('name'), sk))
    out = json.dumps(wi, indent=1, ensure_ascii=False)
    with io.open(wf, 'w', encoding='utf-8', newline='') as f:
        f.write(out.replace('\n', '\r\n'))

    # 回读校验：同 key + 同 type + 两侧都有 damage 的等级必须完全一致
    back = load(wf)
    v0map2 = {s['key']: s for s in load(vf)['active_skills']}
    bad = []
    for s in back['active_skills']:
        v = v0map2.get(s['key'])
        if not v or s.get('skill_type') != v.get('skill_type'):
            continue
        wl = s.get('levels', [])
        vl = v.get('levels', [])
        for i in range(min(len(wl), len(vl))):
            if 'damage' in wl[i] and 'damage' in vl[i] and wl[i]['damage'] != vl[i]['damage']:
                bad.append('%s L%d' % (s['key'], i + 1))
    print('%-9s 改动技能=%d 伤害点=%d desc同步=%d | 类型不同跳过=%d %s'
          % (prof, len(st['skills']), st['dmg'], st['desc'], len(st['skip_type']), st['skip_type'] or ''))
    print('          改动技能明细: %s' % (', '.join(st['skills']) or '无'))
    return bad


def main():
    allbad = []
    for p in PROFS:
        allbad += [(p, b) for b in process(p)]
    if allbad:
        print('ERROR: 仍有未对齐伤害点:', allbad[:10], '共', len(allbad))
        sys.exit(1)
    print('OK: 全部技能伤害已回正至 v0.91（保留 max_level/levels 长度/mp/cd/结构）')


if __name__ == '__main__':
    main()
