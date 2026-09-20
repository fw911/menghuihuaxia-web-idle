# -*- coding: utf-8 -*-
"""一次性补丁：修掉「敏捷 → 物理暴击」被重复计一次的问题。

背景（本次反汇编裁定，见 _dis_battle.txt:47434-47630 起 = character\\stats.py:compute_battle_stats）：
  原版属性→战斗属性**只走一张表** `jobs.json#attribute_effects`（逐职业），
  战士/法师/暗巫/幻师的表里都写着 `agility → phys_crit: 0.142857`。
  原版**没有任何**「再补一次 agility→crit」的代码。

  本 port 的 completeStats：
    998-1002  遍历 job.attribute_effects 累加 ⇒ 已经加了 (attr.agility + bonus.agility) × 0.142857
    1009      combat.phys_crit += attr.agility × 0.142857   ← 重复加第二次
  ⇒ Lv120 战士实测 phys_crit = 239.71，只计一次应为 128.07（_probe_stats_math.js）。
     暴击判定是 `Math.random() < phys_crit/100`，高级角色两边都 >100（恒暴击）影响不显；
     但 Lv30 左右（敏捷 ~50）是 14.3% vs 7.1% —— 早期/中期暴击率被抬了一倍。

  同处第 1010 行 `combat.dodge = combat.dodge||0;` 是**空操作**：闪避从未被推导，
  战斗里也没有闪避判定 —— 原版有 `int(10*agi/(agi+100))`（上限 10）并在伤害路径做「完全闪避」。
  这一条属于「缺机制」，会改变承受伤害 ⇒ 本轮**只记录、不改**，留在待拍板清单。

规则形如 (old, new, expect, tag)；任一规则命中次数 != expect 就 sys.exit(1)，不写回。
"""
import io, os, sys

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'game.js')
s = io.open(SRC, encoding='utf-8', newline='').read()
assert s.count('\r\n') > 0 and (s.count('\n') - s.count('\r\n')) == 0, 'game.js 应为纯 CRLF'


def cr(x):
    assert '\r' not in x
    return x.replace('\n', '\r\n')


R = []

R.append((
    cr("""  // 精炼额外：在 computeStats 之后由 applyRefine 已经并入 stats，这里只补 crit/闪避
  combat.phys_crit = (combat.phys_crit||0) + (attr.agility*0.142857);
  combat.dodge = combat.dodge||0;"""),
    cr("""  // ⚠️ 这里原本还有一行 `combat.phys_crit += attr.agility*0.142857;`，是【重复计算】已删除：
  //    敏捷 → 暴击 已经由上面的 job.attribute_effects 循环统一累加
  //    （战士/法师/暗巫/幻师的表里都有 agility → phys_crit: 0.142857），
  //    再加一次会让敏捷贡献翻倍（Lv120 战士实测 239.71，只计一次应为 128.07）。
  // 闪避：原版由 `int(10*agi/(agi+100))`（上限 10）推导并在伤害路径做「完全闪避」判定，
  //    本 port 的 dodge 恒为 0 且战斗里没有闪避判定 —— 属「缺机制」，待在待拍板清单里，
  //    不要用下面这行空操作假装已实现。量化见 _probe_stats_math.js。
  combat.dodge = combat.dodge||0;"""),
    1, '① 删除重复的 敏捷→物理暴击'))

for old, new, expect, tag in R:
    n = s.count(old)
    if n != expect:
        print('FAIL  %s : 命中 %d 次，期望 %d 次' % (tag, n, expect))
        sys.exit(1)
    s = s.replace(old, new)
    print('OK    %s' % tag)

assert (s.count('\n') - s.count('\r\n')) == 0, '写回后应为纯 CRLF'
io.open(SRC, 'w', encoding='utf-8', newline='').write(s)
print('written %s  %d bytes' % (SRC, len(s.encode('utf-8'))))
