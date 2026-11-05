#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""L4: 将 data/jobs.json 的属性成长字段忠实回正到 v0.91（game_server/config/jobs.json）。

仅改动战斗相关数值字段：base_stats / growth / attribute_effects / per_level_points
以及顶层 attribute_effects。保留 name/desc/forms/shenmo/available_slots/skill_pool 等
web-idle 专有字段，不引入 hp_per_level / form_five / form_buffs / form_desc 等引擎
（computeStats）未读取的死字段。

采用精确文本替换以保留原文件 2 空格缩进与换行风格。
"""
import io, sys

SRC = 'data/jobs.json'

# (old, new, expected_old_count)
REPL = [
    # ---- warrior ----
    ('      "base_stats": {"strength": 12, "agility": 8, "constitution": 10, "intelligence": 2, "spirit": 4},',
     '      "base_stats": {"strength": 20, "agility": 7, "constitution": 7, "intelligence": 0, "spirit": 6},', 1),
    ('      "growth": {"strength": 2.0, "agility": 1.5, "constitution": 2.0, "intelligence": 0.0, "spirit": 1.0},',
     '      "growth": {"strength": 2.5, "agility": 1.5, "constitution": 1.0, "intelligence": 0.0, "spirit": 1.0},', 1),
    ('''      "attribute_effects": {
        "strength": {"phys_atk": 2, "max_hp": 5},
        "constitution": {"max_hp": 15, "phys_def": 2},
        "agility": {"phys_crit": 0.142857},
        "intelligence": {},
        "spirit": {"max_mp": 15, "magic_def": 2}
      },''',
     '''      "attribute_effects": {
        "strength": {"phys_atk": 2, "max_hp": 5},
        "constitution": {"max_hp": 15, "phys_def": 3},
        "agility": {"phys_crit": 0.0857142},
        "intelligence": {},
        "spirit": {"max_mp": 15, "magic_def": 3}
      },''', 1),

    # ---- mage ----
    ('      "base_stats": {"strength": 4, "agility": 6, "constitution": 5, "intelligence": 14, "spirit": 10},',
     '      "base_stats": {"strength": 0, "agility": 7, "constitution": 7, "intelligence": 20, "spirit": 6},', 1),
    ('      "growth": {"strength": 0.5, "agility": 1.0, "constitution": 1.0, "intelligence": 2.5, "spirit": 2.0},',
     '      "growth": {"strength": 0.0, "agility": 1.0, "constitution": 1.5, "intelligence": 2.5, "spirit": 1.0},', 1),

    # ---- darkwitch ----
    ('      "base_stats": {"strength": 4, "agility": 6, "constitution": 6, "intelligence": 12, "spirit": 12},',
     '      "base_stats": {"strength": 0, "agility": 7, "constitution": 7, "intelligence": 13, "spirit": 13},', 1),
    ('      "growth": {"strength": 0.5, "agility": 1.0, "constitution": 1.2, "intelligence": 2.2, "spirit": 2.4},',
     '      "growth": {"strength": 0.0, "agility": 1.0, "constitution": 1.0, "intelligence": 2.0, "spirit": 2.0},', 1),

    # ---- shaman ----
    ('      "base_stats": {"strength": 6, "agility": 10, "constitution": 8, "intelligence": 10, "spirit": 10},',
     '      "base_stats": {"strength": 0, "agility": 20, "constitution": 7, "intelligence": 6, "spirit": 7},', 1),
    ('      "growth": {"strength": 0.8, "agility": 1.8, "constitution": 1.4, "intelligence": 1.8, "spirit": 1.8},',
     '      "growth": {"strength": 0.0, "agility": 2.0, "constitution": 1.0, "intelligence": 2.0, "spirit": 1.0},', 1),
    ('''      "attribute_effects": {
        "strength": {"max_hp": 5},
        "constitution": {"max_hp": 15, "phys_def": 2},
        "agility": {"phys_crit": 0.142857, "phys_atk": 1.5},
        "intelligence": {"magic_atk": 2, "magic_crit": 0.142857},
        "spirit": {"max_mp": 15, "magic_def": 2}
      },''',
     '''      "attribute_effects": {
        "strength": {"max_hp": 2},
        "constitution": {"max_hp": 15, "phys_def": 3},
        "agility": {"phys_crit": 0.0857142, "phys_atk": 2},
        "intelligence": {"magic_atk": 2, "max_mp": 2, "magic_crit": 0.0857142},
        "spirit": {"max_mp": 15, "magic_def": 3}
      },''', 1),

    # ---- mage & darkwitch attribute_effects（两职业原文本完全一致）----
    ('''      "attribute_effects": {
        "strength": {},
        "constitution": {"max_hp": 15, "phys_def": 2},
        "agility": {"phys_crit": 0.142857},
        "intelligence": {"magic_atk": 2, "magic_crit": 0.142857},
        "spirit": {"max_mp": 15, "magic_def": 2}
      },''',
     '''      "attribute_effects": {
        "strength": {},
        "constitution": {"max_hp": 15, "phys_def": 3},
        "agility": {"phys_crit": 0.0857142},
        "intelligence": {"magic_atk": 2, "max_mp": 2, "magic_crit": 0.0857142},
        "spirit": {"max_mp": 15, "magic_def": 3}
      },''', 2),

    # ---- 顶层 attribute_effects ----
    ('''  "attribute_effects": {
    "strength": {"phys_atk": 2, "max_hp": 5},
    "constitution": {"max_hp": 15, "phys_def": 2},
    "agility": {"phys_crit": 0.142857, "phys_atk": 1.5},
    "intelligence": {"magic_atk": 2, "magic_crit": 0.142857},
    "spirit": {"max_mp": 15, "magic_def": 2}
  }''',
     '''  "attribute_effects": {
    "strength": {"phys_atk": 2, "max_hp": 5},
    "constitution": {"max_hp": 15, "phys_def": 3},
    "agility": {"phys_crit": 0.0857142, "phys_atk": 2},
    "intelligence": {"magic_atk": 2, "max_mp": 2, "magic_crit": 0.0857142},
    "spirit": {"max_mp": 15, "magic_def": 3}
  }''', 1),

    # ---- per_level_points: 4 职业均为 5 -> 6 ----
    ('"per_level_points": 5,', '"per_level_points": 6,', 4),
]

import re

def main():
    # bytes 直写：文本模式读会把 CRLF→LF、写会把 LF→CRLF，
    # 再叠加 replace('\n','\r\n') 会产出 '\r\r\n' 双重回车并撑出空行
    with open(SRC, 'rb') as f:
        raw = f.read().decode('utf-8')
    # 归一化行尾便于精确匹配（写回时恢复 CRLF）；
    # 折叠 attribute_effects 块内的空行，使干净的单换行串能对齐
    text = raw.replace('\r\n', '\n')
    text = re.sub(r'\n[ \t]*\n', '\n', text)
    for i, (old, new, cnt) in enumerate(REPL):
        have = text.count(old)
        if have != cnt:
            sys.stderr.write(f'[FAIL] repl#{i} expected {cnt} occurrences but found {have}\n')
            sys.stderr.write(f'  OLD={old!r}\n')
            sys.exit(1)
        text = text.replace(old, new)
    # 合法性校验
    import json
    json.loads(text)
    with open(SRC, 'wb') as f:
        f.write(text.encode('utf-8'))   # 原样保留原有行尾，不做翻译
    print('OK: jobs.json 数值字段已回正，全部 %d 处替换完成且 JSON 合法。' % len(REPL))

if __name__ == '__main__':
    main()
