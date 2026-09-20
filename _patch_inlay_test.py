# -*- coding: utf-8 -*-
"""一次性补丁：给 _run_test.js 补上「⑪ 宝石镶嵌 + 系列限定部位」断言。"""
import io, os, sys

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_run_test.js')
s = io.open(SRC, encoding='utf-8', newline='').read()
assert (s.count('\n') - s.count('\r\n')) == 0, '_run_test.js 应为纯 CRLF'


def cr(x):
    assert '\r' not in x
    return x.replace('\n', '\r\n')


R = []

# ---------- ① 行为断言（接在精炼口径块之后） ----------
R.append((
    cr("""    rollOnce(0.015); E.doRefine(rb); Math.random = origRnd;     // → zero
    ok('归零退回全部已得加成（352 → 300）', rb.refine === 0 && rb.stats.phys_atk === 300,
      'refine=' + rb.refine + ' atk=' + rb.stats.phys_atk);
  }"""),
    cr("""    rollOnce(0.015); E.doRefine(rb); Math.random = origRnd;     // → zero
    ok('归零退回全部已得加成（352 → 300）', rb.refine === 0 && rb.stats.phys_atk === 300,
      'refine=' + rb.refine + ' atk=' + rb.stats.phys_atk);
  }

  // ---- 宝石镶嵌（gems.json#gem_series[].slots 是「本系列只能镶哪些部位」的白名单）----
  console.log('-- 宝石镶嵌（系列限定部位）--');
  {
    p.bag.push({ uid: 'gem_p1', type: 'gem', series: 'beidou', grade: '碎石', count: 1 });   // 武器/护手/戒指
    p.bag.push({ uid: 'gem_p2', type: 'gem', series: 'wangyue', grade: '碎石', count: 1 });  // 防具六件
    const gb = p.bag.find(b => b.uid === 'gem_p1'), gw = p.bag.find(b => b.uid === 'gem_p2');
    const iw = E.genEquip('weapon', p.job, 7, 100);
    const ih = E.genEquip('helmet', p.job, 7, 100);
    if (iw && ih) {
      iw.slot = 'weapon'; iw.sockets = 1; iw.gems = [null];
      ih.slot = 'helmet'; ih.sockets = 1; ih.gems = [null];
      ok('北斗可行白名单：可镶武器、不可镶头盔',
        E.gemCanInlay(gb, iw) === true && E.gemCanInlay(gb, ih) === false);
      ok('望月白名单：不可镶武器、可镶头盔',
        E.gemCanInlay(gw, iw) === false && E.gemCanInlay(gw, ih) === true);
      const atkB = iw.stats.phys_atk;
      E.doInlay(iw, gb);
      ok('镶嵌填入孔位（系列/属性正确）',
        (iw.gems || []).filter(Boolean).length === 1 && iw.gems[0].series === 'beidou'
        && iw.gems[0].stat === 'phys_atk', JSON.stringify(iw.gems[0]));
      ok('镶嵌扣掉背包里那颗宝石', (gb.count || 0) === 0 || p.bag.indexOf(gb) < 0, 'count=' + gb.count);
      E.refreshStats();
      ok('镶嵌后角色物理攻击提升', iw.stats.phys_atk > atkB, atkB + ' → ' + iw.stats.phys_atk);
      ih.gems = [{ series: 'wangyue', stat: 'phys_def', value: 1, grade: '碎石' }];   // 满孔
      E.LS.inlayGem = 'gem_p1';
      ok('满孔装备不再出现在镶嵌候选里', !E.inlayEquipList().some(it => it.uid === ih.uid));
    }
  }"""),
    1, '镶嵌行为断言'))

# ---------- ② 面板断言 ----------
R.append((
    cr("""    ok('未选装备时面板也显示「下一级」消耗/成功率详情', craft.indexOf('下一级 +') >= 0);"""),
    cr("""    ok('未选装备时面板也显示「下一级」消耗/成功率详情', craft.indexOf('下一级 +') >= 0);
    ok('打造子页含 ⑪ 宝石镶嵌（此前完全无入口）',
      craft.indexOf('⑪ 宝石镶嵌') >= 0 && craft.indexOf('id="inlay-gem"') >= 0
      && craft.indexOf('id="inlay-equip"') >= 0 && craft.indexOf('data-act="inlay"') >= 0);
    ok('炼丹·药水子页不含 ⑪', E.renderLife('refine').indexOf('⑪ 宝石镶嵌') < 0);
    ok('全量渲染含 ①~⑪', E.renderLife().indexOf('⑪ 宝石镶嵌') >= 0);"""),
    1, '镶嵌面板断言'))

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
