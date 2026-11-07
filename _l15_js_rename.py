#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
L15 改名线（JS / 断言 / 注释 配套）：
  · 0.94 的 xianzhijing 地图真名是「栖霞秘境」（web data 已是），故 web 残留的
    「仙之境」UI 文案（tabs 标签、render 标题/按钮/日志、player eventLog、注释、
    测试断言）统一对齐到「栖霞秘境」。代码标识符（isXianzhiNow / xianzhijing 键 /
    go_xz / xzCapMin）保持不变。
  · 修验系统消费 bailian_shi，0.94 真名「淬锋石」，故 JS 硬编码「百炼石」→「淬锋石」。
  · 测试断言中残留的旧名（百炼丹/北斗石/北斗/百炼装备…）→ 0.94 新名。
  · 宝石系列 元如（含章）注释对齐。

做法：按文件字节定点替换，保留一切排版/行尾。
"""
import os

ROOT = os.path.dirname(os.path.abspath(__file__))

# 各文件独立替换表（固定串替换，替换结果不含源串，安全）
MAP = {
    'js/quest.js':    [('百炼石', '淬锋石')],
    'js/render.js':   [('仙之境', '栖霞秘境'), ('百炼石', '淬锋石')],
    'js/tabs.js':     [('仙之境', '栖霞秘境')],
    'js/player.js':   [('仙之境', '栖霞秘境')],
    'js/idle.js':     [('仙之境', '栖霞秘境')],
    'js/battle.js':   [('仙之境', '栖霞秘境')],
    'js/main.js':     [('仙之境', '栖霞秘境')],
    'js/inlay.js':    [('元如', '含章')],
    '_patch.py':      [('仙之境', '栖霞秘境')],
    'data/shenmo.json': [('仙之境', '栖霞秘境')],
    '_run_test.js':   [
        ('仙之境', '栖霞秘境'),     # 全部 UI/断言/注释一致
        ('北斗石', '玄璧石'),       # 先长后短，避免被 北斗 误切
        ('北斗',   '玄璧'),
        ('百炼丹', '淬锋丹'),
        ('百炼装备', '淬锋装备'),
        ('百炼装', '淬锋装'),
        ('百炼上限', '淬锋上限'),
        ('百炼石', '淬锋石'),
    ],
}

def apply_file(rel, repls):
    p = os.path.join(ROOT, rel)
    raw = open(p, 'rb').read()
    new = raw
    counts = []
    for old, nv in repls:
        b = old.encode('utf-8')
        n = new.count(b)
        if n:
            new = new.replace(b, nv.encode('utf-8'))
            counts.append((old, nv, n))
    if new != raw:
        open(p, 'wb').write(new)
    return counts

if __name__ == '__main__':
    for rel, repls in MAP.items():
        try:
            c = apply_file(rel, repls)
        except FileNotFoundError:
            print('%-22s 缺失，跳过' % rel)
            continue
        if c:
            desc = ', '.join('%s→%s×%d' % (o, n, k) for o, n, k in c)
            print('%-22s %s' % (rel, desc))
        else:
            print('%-22s 无匹配（跳过落盘）' % rel)
