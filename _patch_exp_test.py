# -*- coding: utf-8 -*-
"""一次性补丁：把 _run_test.js 里「经验口径」相关断言改写成原版口径，并补行为回归。

背景：原 typeExpMul 断言按【角色等级】每 20 级取档（ceil(level/20)），
      那是实现里的错误口径；原版是按【怪物等级】每 10 级取档（tier_idx=(mon_level-1)//10）。
      详见 _dis_exp.txt:1191-1311 battle/encounter.py:scale_monster_exp。

新增断言：
  - type_exp_tiers 边界（怪 Lv10/11、Lv51、越界 1200）
  - expScale 全形态：指数放大 / max_cap 封顶 / 线性衰减 / 低 5 级归零 / 不为负
  - monsterExp 端到端（合成怪，逐条手算期望值）
  - bestZone 行为回归：Lv120 必须选「等级匹配」区域，低级怪区经验为 0；
    角色等级超出怪物上限（Lv140）时仍有保底区域可继续刷金币。

规则形如 (old, new, expect, tag)；任一规则命中次数 != expect 就 sys.exit(1)，不写回。
"""
import io, os, sys

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_run_test.js')
s = io.open(SRC, encoding='utf-8', newline='').read()
assert s.count('\r\n') > 0 and (s.count('\n') - s.count('\r\n')) == 0, '_run_test.js 应为纯 CRLF'


def cr(x):
    assert '\r' not in x
    return x.replace('\n', '\r\n')


R = []

# ---------- ① 档位注释 + 取档依据断言 ----------
R.append((
    cr("""    ok('每套 6 段（== ceil(120/20) 档位）', KINDS.every(k => T[k].length === 6), KINDS.map(k => T[k].length).join(','));"""),
    cr("""    ok('每套 6 段（覆盖怪物 Lv1~50，末档兜底 Lv51+）', KINDS.every(k => T[k].length === 6), KINDS.map(k => T[k].length).join(','));"""),
    1, '① 档位数注释改为怪物等级口径'))

R.append((
    cr("""    ok('Lv1  → tier1', E.typeExpMul('elite', 1) === T.elite[0], E.typeExpMul('elite', 1) + '');
    ok('Lv20 → tier1（边界）', E.typeExpMul('elite', 20) === T.elite[0], E.typeExpMul('elite', 20) + '');
    ok('Lv21 → tier2（边界）', E.typeExpMul('elite', 21) === T.elite[1], E.typeExpMul('elite', 21) + '');
    ok('Lv41 → tier3', E.typeExpMul('elite', 41) === T.elite[2], E.typeExpMul('elite', 41) + '');
    ok('Lv100 → tier5', E.typeExpMul('elite', 100) === T.elite[4], E.typeExpMul('elite', 100) + '');
    ok('Lv101 → tier6', E.typeExpMul('elite', 101) === T.elite[5], E.typeExpMul('elite', 101) + '');
    ok('Lv120 封顶 tier6（不越界）', E.typeExpMul('elite', 120) === T.elite[5], E.typeExpMul('elite', 120) + '');
    ok('boss Lv120 == 11.0', E.typeExpMul('boss', 120) === 11.0, E.typeExpMul('boss', 120) + '');
    ok('jubao Lv120 == 25.0', E.typeExpMul('jubao', 120) === 25.0, E.typeExpMul('jubao', 120) + '');
    ok('dungeon_boss Lv120 == 25.0', E.typeExpMul('dungeon_boss', 120) === 25.0, E.typeExpMul('dungeon_boss', 120) + '');
    ok('normal 无 tiers → 回落 1.0', E.typeExpMul('normal', 120) === 1.0, E.typeExpMul('normal', 120) + '');
    ok('未知类型 → 回落 1', E.typeExpMul('__no_such_type__', 50) === 1);"""),
    cr("""    // 取档依据是【怪物等级】每 10 级一档（原版 tier_idx = (mon_level-1)//10，越界取末档）
    ok('怪Lv1   → tier1', E.typeExpMul('elite', 1) === T.elite[0], E.typeExpMul('elite', 1) + '');
    ok('怪Lv10  → tier1（边界）', E.typeExpMul('elite', 10) === T.elite[0], E.typeExpMul('elite', 10) + '');
    ok('怪Lv11  → tier2（边界）', E.typeExpMul('elite', 11) === T.elite[1], E.typeExpMul('elite', 11) + '');
    ok('怪Lv21  → tier3', E.typeExpMul('elite', 21) === T.elite[2], E.typeExpMul('elite', 21) + '');
    ok('怪Lv41  → tier5', E.typeExpMul('elite', 41) === T.elite[4], E.typeExpMul('elite', 41) + '');
    ok('怪Lv51  → tier6', E.typeExpMul('elite', 51) === T.elite[5], E.typeExpMul('elite', 51) + '');
    ok('怪Lv120 取末档（不越界）', E.typeExpMul('elite', 120) === T.elite[5], E.typeExpMul('elite', 120) + '');
    ok('怪Lv1200 仍取末档', E.typeExpMul('elite', 1200) === T.elite[5], E.typeExpMul('elite', 1200) + '');
    ok('怪Lv0 取首档（不为负索引）', E.typeExpMul('elite', 0) === T.elite[0], E.typeExpMul('elite', 0) + '');
    ok('boss 怪Lv120 == 11.0', E.typeExpMul('boss', 120) === 11.0, E.typeExpMul('boss', 120) + '');
    ok('jubao 怪Lv120 == 25.0', E.typeExpMul('jubao', 120) === 25.0, E.typeExpMul('jubao', 120) + '');
    ok('dungeon_boss 怪Lv120 == 25.0', E.typeExpMul('dungeon_boss', 120) === 25.0, E.typeExpMul('dungeon_boss', 120) + '');
    ok('normal 无 tiers → 回落 1.0', E.typeExpMul('normal', 120) === 1.0, E.typeExpMul('normal', 120) + '');
    ok('未知类型 → 回落 1', E.typeExpMul('__no_such_type__', 50) === 1);
    // 取档依据必须是【怪物等级】：同一怪物类型下，不同怪物等级给出不同倍率
    ok('同类型不同怪等级 → 倍率不同（证明按怪等级取档）',
      E.typeExpMul('elite', 5) !== E.typeExpMul('elite', 105),
      E.typeExpMul('elite', 5) + ' vs ' + E.typeExpMul('elite', 105));"""),
    1, '② typeExpMul 断言改为怪物等级口径'))

# ---------- ② 端到端块 → 缩放律 + monsterExp 手算对拍 + bestZone 行为 ----------
R.append((
    cr("""    // 端到端：monsterExp 确实吃到了档位（把怪 level 设很大，让 lf 在 Lv20/21 都恒定，隔离档位影响）
    const base = Object.keys(E.MONSTERS).map(k => E.MONSTERS[k]).find(m => m.type === 'elite');
    ok('找到精英怪用于端到端校验', !!base, base ? base.key : '无');
    if (base) {
      const fake = Object.assign({}, base, { level: 100000, exp: 1000 });
      const a = E.monsterExp(fake, 20), b = E.monsterExp(fake, 21);
      ok('monsterExp 随档位提升（Lv21 > Lv20）', b > a, a + ' → ' + b);
      const want = T.elite[1] / T.elite[0];
      ok('提升比例 == tiers[1]/tiers[0]', Math.abs((b / a) - want) < 0.02,
        (b / a).toFixed(3) + ' vs ' + want.toFixed(3));
    }
  }"""),
    cr("""  }

  // ---- 等级差经验缩放（原版 battle/encounter.py:scale_monster_exp 口径）----
  console.log('-- 等级差经验缩放（expScale）--');
  {
    const MS = E.DATA.character.monster_exp_scale;
    ok('diff=0   → 1.0', E.expScale(0) === 1.0, E.expScale(0) + '');
    ok('diff=+1  → 1.2', Math.abs(E.expScale(1) - 1.2) < 1e-9, E.expScale(1) + '');
    ok('diff=+2  → 1.44（指数而非线性）', Math.abs(E.expScale(2) - 1.44) < 1e-9, E.expScale(2) + '');
    ok('diff=+4  → 1.2^4', Math.abs(E.expScale(4) - Math.pow(1.2, 4)) < 1e-9, E.expScale(4) + '');
    ok('diff=+5  → 1.2^5（尚未触顶）', Math.abs(E.expScale(5) - Math.pow(1.2, 5)) < 1e-9, E.expScale(5) + '');
    ok('diff=+6  → 封顶 max_cap', E.expScale(6) === MS.max_cap, E.expScale(6) + ' vs ' + MS.max_cap);
    ok('diff=+40 → 仍封顶（不溢出）', E.expScale(40) === MS.max_cap, E.expScale(40) + '');
    ok('diff=−1  → 0.8（线性衰减）', Math.abs(E.expScale(-1) - 0.8) < 1e-9, E.expScale(-1) + '');
    ok('diff=−2  → 0.6', Math.abs(E.expScale(-2) - 0.6) < 1e-9, E.expScale(-2) + '');
    ok('diff=−3  → 0.4', Math.abs(E.expScale(-3) - 0.4) < 1e-9, E.expScale(-3) + '');
    ok('diff=−4  → 0.2', Math.abs(E.expScale(-4) - 0.2) < 1e-9, E.expScale(-4) + '');
    ok('diff=−5  → 0（怪低 5 级零经验）', E.expScale(-5) === 0, E.expScale(-5) + '');
    ok('diff=−40 → 0（不为负）', E.expScale(-40) === 0, E.expScale(-40) + '');
  }

  // ---- monsterExp 端到端：逐条手算期望值（合成怪，隔离怪物数据变动）----
  console.log('-- monsterExp 端到端（合成怪手算对拍）--');
  {
    const fake = (lv, type, exp) => ({ key: '_t', name: '对拍怪', type, level: lv, exp });
    const CASES = [
      ['同级 normal', fake(120, 'normal', 100), 120, 100],
      ['高 4 级 normal', fake(124, 'normal', 100), 120, 207],
      ['高 5 级 normal（1.2^5 未触顶）', fake(125, 'normal', 100), 120, 248],
      ['高 6 级封顶', fake(126, 'normal', 100), 120, 250],
      ['高 40 级仍封顶', fake(160, 'normal', 100), 120, 250],
      ['低 1 级 normal', fake(119, 'normal', 100), 120, 80],
      // 注意：1 − 4×0.2 在 IEEE754 下是 0.19999999999999996，原版 int() 截断后得 19 —— 这里保持同口径
      ['低 4 级 normal（浮点同原版）', fake(116, 'normal', 100), 120, 19],
      ['低 5 级 → 0', fake(115, 'normal', 100), 120, 0],
      ['低 40 级 → 0', fake(80, 'normal', 10000), 120, 0],
      ['同级 boss（怪Lv120 档 11.0）', fake(120, 'boss', 100), 120, 1100],
      ['同级 elite（怪Lv120 档 5.4）', fake(120, 'elite', 100), 120, 540],
      ['低级 elite 不再白拿高档', fake(5, 'elite', 100), 5, 290],
      ['基础经验为 0 → 0', fake(120, 'normal', 0), 120, 0],
      ['基础经验为负 → 0', fake(120, 'normal', -5), 120, 0],
    ];
    for (const [name, m, cl, want] of CASES) {
      const got = E.monsterExp(m, cl);
      ok('monsterExp ' + name + ' = ' + want, got === want, got + '');
    }
  }

  // ---- 自动择区：必须选「等级匹配」而非「低级怪」----
  console.log('-- 自动择区行为（低级怪零经验）--');
  {
    // 注意：不能用外层 let p —— 前面的导入/云存档测试会经 applySavePayload 重建 player，
    // 此处必须重新取引用，否则改的是一个孤儿对象。
    const pl = E.state.player;
    const saveLv = pl.level, saveUnlocked = JSON.stringify(pl.unlocked);
    // 前面的测试把 unlocked 重置过；幻月海等高层区域在 unlock_map 链上，
    // 这里模拟「已走遍全图」的玩家，否则测出来的是「可达区域里最优」而非「全图最优」。
    pl.unlocked = {};
    for (const m of E.DATA.maps.maps) pl.unlocked[m.key] = true;
    const zoneInfo = b => {
      const map = E.DATA.maps.maps.find(m => m.key === b.mapKey);
      const keys = E.zoneKeys(map, b.zoneKey, b.isBoss) || [];
      const ms = keys.map(k => E.getMonster(k)).filter(Boolean);
      return { avg: E.zoneMonsterAvg(keys), maxLv: Math.max.apply(null, ms.map(m => m.level || 0)),
               y: E.zoneYield(keys, pl.level) };
    };
    for (const L of [40, 80, 120]) {
      pl.level = L; E.refreshStats(); pl.hp = pl._s.max_hp;
      const b = E.bestZone();
      ok('Lv' + L + ' 能选出区域', !!b && b.score > 0, b ? b.name + ' ' + b.score.toFixed(2) : 'null');
      if (b) {
        const zi = zoneInfo(b);
        ok('Lv' + L + ' 最优区经验 > 0（不是纯低级怪区）', zi.y.exp > 0, '区经验 ' + zi.y.exp);
        ok('Lv' + L + ' 最优区均怪等级在可打窗口 [L−8, L+8] 内',
          zi.avg.level >= L - 8 && zi.avg.level <= L + 8,
          '均怪lv ' + zi.avg.level.toFixed(0) + ' / 最高怪lv ' + zi.maxLv + ' @ ' + b.name);
      }
    }
    // 低级怪区在高级角色下必须是 0 经验
    pl.level = 120; E.refreshStats(); pl.hp = pl._s.max_hp;
    const lowMap = E.DATA.maps.maps.find(m => m.key === 'beijun');
    const lowZ = (lowMap.zones || [])[0];
    const lowKeys = E.zoneKeys(lowMap, lowZ.key, false);
    const lowAvg = E.zoneMonsterAvg(lowKeys).level;
    ok('北原郡是低级怪区（均怪lv ' + lowAvg.toFixed(0) + '）', lowAvg < 115, lowAvg + '');
    ok('Lv120 时北原郡每只经验为 0',
      lowKeys.every(k => E.monsterExp(E.getMonster(k), 120) === 0), '仍有非零');
    ok('Lv120 时北原郡 zoneEval 为 0（不再被选为挂机点）',
      E.zoneEval('beijun', lowZ.key, false) === 0, E.zoneEval('beijun', lowZ.key, false) + '');
    // 直接锁住本次修复的动机：修复前 bestZone() 在 Lv120 恰好挑中这个均怪 Lv84 的区域
    ok('Lv120 时旧的「最优区」七曲洞二层·左翼通道已是 0 经验',
      E.zoneEval('qimidong_l2', 'zuo_yi_tong_dao', false) === 0,
      E.zoneEval('qimidong_l2', 'zuo_yi_tong_dao', false) + '');
    const bz120 = E.bestZone();
    ok('Lv120 最优区不再是低级怪区（七曲洞二层·左翼通道）',
      !!bz120 && !(bz120.mapKey === 'qimidong_l2' && bz120.zoneKey === 'zuo_yi_tong_dao'),
      bz120 ? bz120.name : 'null');
    ok('Lv120 最优区均怪等级 ≥ 115（等级匹配）',
      !!bz120 && zoneInfo(bz120).avg.level >= 115,
      bz120 ? bz120.name + ' 均怪lv ' + zoneInfo(bz120).avg.level.toFixed(0) : 'null');

    // 超出怪物上限（最高怪 Lv120 → Lv126+ 全部零经验）时要有保底，否则金币也断供
    pl.level = 140; E.refreshStats(); pl.hp = pl._s.max_hp;
    const b140 = E.bestZone();
    ok('Lv140 全零经验时仍有保底区域（可继续刷金币）', !!b140, b140 ? b140.name + ' score=' + b140.score : 'null');
    if (b140) {
      ok('Lv140 保底区 score == 0（经验为 0，不该伪报收益）', b140.score === 0, b140.score + '');
      ok('Lv140 保底区挑的是最高级可打区域', zoneInfo(b140).avg.level >= 110, '均怪lv ' + zoneInfo(b140).avg.level.toFixed(0));
    }
    pl.level = saveLv; pl.unlocked = JSON.parse(saveUnlocked); E.refreshStats(); pl.hp = pl._s.max_hp;
  }"""),
    1, '③ 端到端块 → 缩放律 + 手算对拍 + 择区行为'))

# ---------- 应用 ----------
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
