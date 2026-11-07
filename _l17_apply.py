#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
L17: 把 web 全站「战魂」(companion 体系的 web 重命名) 对齐回 0.94 的「灵兽」。

取证依据:
  - 0.94 companion.json 用「灵兽」(171 处)、quests.json 用「灵兽」(8 处)；
    web 把这套体系重命名为「战魂」。
  - 全仓库「战魂」均位于 JSON value 文本(name/desc/数组字符串)，无 key 含战魂
    (标识符稳定，纯文本改名不破坏代码引用)；js/ 代码层无战魂标识符。
  - 0.94 items 用「灵兽」(519)，web items 用「战魂」(476)，key 均不含战魂/灵兽。

范围:
  - data/ 下 10 个含战魂的 json 文件全量替换 value 文本 (排除仓库根的 _data_backup_before_upgrade)。
  - 不动 _run_test.js 的 1 处历史考证注释("v0.91 战魂系在该店回退")，它是事实记录不改失真。
  - 不动 _l*_apply.py 等历史取证脚本注释。

强校验:
  - 替换后各文件无「战魂」且 json.load 合法。
"""
import json, os, sys

DATA = 'data'
OLD = '战魂'.encode('utf-8')
NEW = '灵兽'.encode('utf-8')

FILES = [
    'achievements.json', 'bases_warrior.json', 'companion.json', 'items.json',
    'loot_pools.json', 'maps.json', 'monster_loot_built.json', 'quests.json',
    'shops.json', 'taptap_achievements.json',
]

def apply_file(fn, do_write):
    p = os.path.join(DATA, fn)
    raw = open(p, 'rb').read()
    n = raw.count(OLD)
    new = raw.replace(OLD, NEW)
    if do_write:
        open(p, 'wb').write(new)
        # 合法性校验
        json.loads(new.decode('utf-8'))
    return n, new.count(OLD)

def main():
    do_write = '--apply' in sys.argv
    total = 0
    print(('[DRY-RUN] ' if not do_write else '[APPLY] ') + 'L17 战魂->灵兽')
    for fn in FILES:
        n, leftover = apply_file(fn, do_write)
        total += n
        flag = 'OK' if leftover == 0 else '!!残留%d' % leftover
        print('  %-26s 替换 %4d 处  残留战魂 %d  %s' % (fn, n, leftover, flag))
    print('合计替换 %d 处' % total)
    if do_write:
        # 全仓库(除备份)战魂清零复核
        left = 0
        for root, _, files in os.walk('.'):
            if 'node_modules' in root or '.git' in root or '_data_backup_before_upgrade' in root:
                continue
            for f in files:
                if f.endswith('.json'):
                    if open(os.path.join(root, f), 'rb').read().count(OLD):
                        left += 1
                        print('  残留文件:', os.path.join(root, f))
        print('全仓库 data 战魂残留文件数:', left)

if __name__ == '__main__':
    main()
