#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
L16：闭合 web loot_tables.json 的宝石命名一致性（改名线收尾）

背景（见 L15 报告 §十八.6 待办 #1）：
  web 的 loot_tables.json 是**高度自研的掉落体系**（与 0.94 叶级差异 4268 处，
  0.94 的掉落描述根本不写「五系」「灵石」这类词，只有 2 处「玄璧宝石」）。
  因此 L16 不是「逐字对齐 0.94」，而是**站内命名一致性闭合**——
  L15 已把全站宝石命名为玄璧（gems.json 系列名、gem_recipes 玄璧灵石、itemName 玄璧石），
  loot_tables 的 desc 仍残留旧品牌「北斗」，需统一为「玄璧」以免玩家在掉落日志看到不一致。

范围（仅 desc 字段的旧品牌前缀，保留 web 自研术语「五系」「灵石」结构）：
  北斗宝石 -> 玄璧宝石   （15 处；0.94 与全站一致）
  北斗五系 -> 玄璧五系   （16 处；web 自研「五系宝石统称」术语，品牌前缀统一）
  北斗灵石 -> 玄璧灵石   （ 4 处；gem_recipes 已是玄璧灵石，该系标准名）

做法：字节级子串替换（保留一切排版/行尾），强校验：替换后全文「北斗」计数为 0，
      且重新解析 JSON 后所有字段（含非 desc）均不含「北斗」、desc 旧词清零。

用法：python _l16_apply.py          # dry-run
      python _l16_apply.py --apply   # 落盘
"""
import json, os, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
FN = 'loot_tables'
PATH = os.path.join(ROOT, 'data', FN + '.json')

# 旧品牌 -> 新品牌（仅前缀替换，保留 web 自研「五系」「灵石」「宝石」「石」后缀）
# 覆盖全文 36 处「北斗」的 4 种前缀：北斗宝石(15)/北斗五系(16)/北斗灵石(4)/北斗石(1)
REPL = {
    '北斗宝石': '玄璧宝石',
    '北斗五系': '玄璧五系',
    '北斗灵石': '玄璧灵石',
    '北斗石':   '玄璧石',
}

def main():
    apply = '--apply' in sys.argv
    raw = open(PATH, 'rb').read()

    # 替换前统计
    before = {old: raw.count(old.encode('utf-8')) for old in REPL}
    total_before = sum(before.values())

    # 字节级子串替换（三词互不重叠，长度降序仅作惯例）
    new = raw
    matched = 0
    for old, nv in sorted(REPL.items(), key=lambda kv: -len(kv[0])):
        b = old.encode('utf-8')
        c = new.count(b)
        if c:
            new = new.replace(b, nv.encode('utf-8'))
            matched += c

    # 强校验 1：全文「北斗」清零
    bei_left = new.count('北斗'.encode('utf-8'))
    # 强校验 2：重新解析，确认所有字段（含非 desc）均不含「北斗」
    web = json.loads(new.decode('utf-8'))
    def scan(o, path='', hits=None):
        if hits is None:
            hits = []
        if isinstance(o, dict):
            for k, v in o.items():
                scan(v, path + '.' + str(k), hits)
        elif isinstance(o, list):
            for i, v in enumerate(o):
                scan(v, path + '[%d]' % i, hits)
        elif isinstance(o, str) and '北斗' in o:
            hits.append(path)
        return hits
    bad = scan(web)
    new_counts = {nv: new.count(nv.encode('utf-8')) for nv in REPL.values()}

    print('%-10s 替换前: %s' % ('loot_tables', before))
    print('%-10s 替换后新词出现: %s' % ('', new_counts))
    print('%-10s 全文「北斗」残留: %d' % ('', bei_left))
    print('%-10s 非 desc 中含北斗的路径: %s' % ('', bad if bad else '无'))
    print('%-10s 实际命中替换: %d（理论 %d）' % ('', matched, total_before))

    assert bei_left == 0, '替换后仍有北斗残留！'
    assert not bad, '非 desc 字段出现北斗：%s' % bad
    assert matched == total_before, '替换命中数与预期不符'
    print('[校验] 北斗已完全清零且未误伤非 desc 字段：OK')

    if apply:
        open(PATH, 'wb').write(new)
        print('[applied] 已落盘 data/loot_tables.json')
    else:
        print('[dry-run] 未落盘，加 --apply 执行')

if __name__ == '__main__':
    main()
