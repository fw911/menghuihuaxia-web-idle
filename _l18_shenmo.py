#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
L18 收尾：同步暗巫师神魔技能文案中的召唤兽名
证据：0.94 shenmo_skills_darkwitch 用 焰鬃兽/幽蝶（含技能 name 字段），web 魔改成 炎灵兽/魅影。
      summons 已回正为 0.94 真名（焰鬃兽/幽蝶），shenmo 文案须同步以免玩家可见不一致。
      0.94 对应字段：幽蝶 出现在 name/desc/fmt，焰鬃兽 出现在 desc；web 炎灵兽/魅影 同语境。
用法：
  python3 _l18_shenmo.py          # dry-run
  python3 _l18_shenmo.py --apply  # 落盘
"""
import json, sys, os

FILES = ['data/shenmo_skills_darkwitch.json', 'data/shenmo_active_skills_darkwitch.json']
REPL = [('炎灵兽', '焰鬃兽'), ('魅影', '幽蝶')]

def main():
    apply = '--apply' in sys.argv
    for f in FILES:
        raw = open(f, 'rb').read()
        new = raw
        total = 0
        for old, nv in REPL:
            n = new.count(old.encode('utf-8'))
            new = new.replace(old.encode('utf-8'), nv.encode('utf-8'))
            total += n
        # 强校验
        left = new.count('炎灵兽'.encode('utf-8')) + new.count('魅影'.encode('utf-8'))
        json.loads(new.decode('utf-8'))  # 合法性
        print('=== %s ===' % f)
        print('  替换处数: %d | 残留 炎灵兽/魅影: %d | JSON 合法: True' % (total, left))
        if left != 0:
            print('  !! 残留非0，跳过')
            continue
        if apply:
            open(f, 'wb').write(new)
            print('  已落盘')
        else:
            print('  [dry-run] 未落盘')

if __name__ == '__main__':
    main()
