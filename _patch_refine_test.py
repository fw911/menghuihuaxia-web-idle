# -*- coding: utf-8 -*-
"""一次性补丁：给 _run_test.js 补上「精炼口径」与「⑩ 装备精炼面板」断言。

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

# ---------- ① 精炼数值口径断言（紧跟晶石精炼那段之后） ----------
R.append((
    cr("""  ok('精炼 +5 消耗晶石', E.crystalCount(ck) < beforeC + 20, 'ck=' + E.crystalCount(ck));"""),
    cr("""  ok('精炼 +5 消耗晶石', E.crystalCount(ck) < beforeC + 20, 'ck=' + E.crystalCount(ck));

  // ---- 精炼数值口径（按原版 refine.py 反汇编还原：档位取表 / 无百分比 / 跳过 0/0 / 失败回退）----
  console.log('-- 精炼口径（档位取表 / 无百分比 / 回退）--');
  {
    const tw = E.genEquip('weapon', p.job, 7, 100);
    tw.tier = 7; tw.stats = { phys_atk: 300, magic_atk: 0 }; tw.refine = 0; tw.perks = [];
    E.applyRefineLevels(tw, 7);
    ok('tier7 每级 +13 ⇒ +7 恰好 +91（无百分比缩放）', tw.stats.phys_atk === 391,
      'phys_atk=' + tw.stats.phys_atk + '（应 300+7*13=391）');
    ok('tier7 flat 与精炼等级无关（不是取 flat 表第 1..7 行再乘系数）', tw.stats.phys_atk !== 305);
    ok('0/0 白板键被跳过（magic_atk 保持 0）', tw.stats.magic_atk === 0, 'magic_atk=' + tw.stats.magic_atk);
    ok('+7 解锁隐藏词条（武器 → 致命）',
      tw.refine === 7 && (tw.perks || []).some(k => k.hidden && k.name === '致命'),
      'refine=' + tw.refine + ' perks=' + JSON.stringify(tw.perks));
    const tw2 = E.genEquip('weapon', p.job, 1, 1);
    tw2.tier = 1; tw2.stats = { phys_atk: 20, magic_atk: 0 }; tw2.refine = 0; tw2.perks = [];
    E.applyRefineLevels(tw2, 7);
    ok('tier1 每级 +3 ⇒ +7 恰好 +21（另一条档位行）', tw2.stats.phys_atk === 41,
      'phys_atk=' + tw2.stats.phys_atk);
    const hd = E.genEquip('helmet', p.job, 7, 100);
    if (hd) {
      hd.perks = []; E.applyRefineLevels(hd, 7);
      ok('非攻击部位隐藏词条 → 守御', (hd.perks || []).some(k => k.hidden && k.name === '守御'),
        JSON.stringify(hd.perks));
    }
    // 失败回退：造一件 +5，强制 drop / zero（outcomes['6']: destroy .01 / zero .01 / drop .16）
    const rb = E.genEquip('weapon', p.job, 7, 100);
    rb.tier = 7; rb.stats = { phys_atk: 300, magic_atk: 0 }; rb.refine = 0; rb.perks = [];
    E.applyRefineLevels(rb, 5);
    E.addToBag(rb); E.addCrystalStone(E.crystalForTier(7), 5); p.gold = 9999999;
    const origRnd = Math.random;
    const rollOnce = (v) => { let once = true; Math.random = () => { if (once) { once = false; return v; } return origRnd(); }; };
    rollOnce(0.10); E.doRefine(rb); Math.random = origRnd;      // → drop
    ok('降级回退一级加成（300+5*13=365 → 352）', rb.refine === 4 && rb.stats.phys_atk === 352,
      'refine=' + rb.refine + ' atk=' + rb.stats.phys_atk);
    rollOnce(0.015); E.doRefine(rb); Math.random = origRnd;     // → zero
    ok('归零退回全部已得加成（352 → 300）', rb.refine === 0 && rb.stats.phys_atk === 300,
      'refine=' + rb.refine + ' atk=' + rb.stats.phys_atk);
  }"""),
    1, '精炼口径断言'))

# ---------- ② 面板 ⑩ 断言 ----------
R.append((
    cr("""    ok('打造子页不含 ② 与 ④', craft.indexOf('② 百炼丹') < 0 && craft.indexOf('④ 提取') < 0);"""),
    cr("""    ok('打造子页不含 ② 与 ④', craft.indexOf('② 百炼丹') < 0 && craft.indexOf('④ 提取') < 0);
    ok('打造子页含 ⑩ 装备精炼（此前完全无入口）',
      craft.indexOf('⑩ 装备精炼') >= 0 && craft.indexOf('id="refine-equip"') >= 0
      && craft.indexOf('data-act="refine-eq"') >= 0);
    ok('炼丹·药水子页不含 ⑩', E.renderLife('refine').indexOf('⑩ 装备精炼') < 0);
    ok('精炼面板写明「按装备档位取表」', craft.indexOf('按【装备档位】取表') >= 0);"""),
    1, '面板 ⑩ 断言'))

# ---------- 执行 ----------
for i, (old, new, expect, tag) in enumerate(R, 1):
    n = s.count(old)
    if n != expect:
        print('FAIL 规则 %d [%s]：命中 %d 次，期望 %d' % (i, tag, n, expect))
        sys.exit(1)
    s = s.replace(old, new)
    print('ok   规则 %d [%s]：命中 %d 次' % (i, tag, n))

assert (s.count('\n') - s.count('\r\n')) == 0, '结果出现裸 LF'
b = s.encode('utf-8')
io.open(SRC, 'wb').write(b)
print('written %s  %d bytes  CRLF %d' % (SRC, len(b), s.count('\r\n')))
