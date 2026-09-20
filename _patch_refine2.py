# -*- coding: utf-8 -*-
"""一次性补丁 2：精炼面板「未选装备时也显示详情」。

问题：LS.refineEq 初始为 null，未操作下拉时面板只有一行下拉，看不到「下一级消耗/成功率」。
改法：抽出 refineEquipList()，下拉与详情共用；详情在 LS.refineEq 未选/已失效时回落到首选装备。
"""
import io, os, sys

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'game.js')
s = io.open(SRC, encoding='utf-8', newline='').read()
assert s.count('\r\n') > 0 and (s.count('\n') - s.count('\r\n')) == 0, 'game.js 应为纯 CRLF'


def cr(x):
    assert '\r' not in x
    return x.replace('\n', '\r\n')


R = []

# ---------- ① 抽出 refineEquipList，下拉复用它 ----------
R.append((
    cr("""// 可精炼装备下拉（只列未满级的，显示「+N [品质] 部位·名称」）
function refineEquipOpts(){
  const p=state.player; if(!p) return '<option value="">（无装备）</option>';
  const max=(DATA.refine||{}).refine_max||7;
  const list=[];
  for(const s in p.equip) if(p.equip[s]) list.push(p.equip[s]);
  for(const b of p.bag) if(b.type==='equip') list.push(b);
  const ok2=list.filter(it=> (it.refine||0)<max).sort((a,b)=>equipScore(b)-equipScore(a));
  if(!ok2.length) return '<option value="">（没有可精炼的装备）</option>';
  return ok2.map(it=>"""),
    cr("""// 可精炼装备（未满级的，按战力评分从高到低）—— 下拉与面板详情共用同一份口径
function refineEquipList(){
  const p=state.player; if(!p) return [];
  const max=(DATA.refine||{}).refine_max||7;
  const list=[];
  for(const s in p.equip) if(p.equip[s]) list.push(p.equip[s]);
  for(const b of p.bag) if(b.type==='equip') list.push(b);
  return list.filter(it=> (it.refine||0)<max).sort((a,b)=>equipScore(b)-equipScore(a));
}
// 可精炼装备下拉（只列未满级的，显示「+N [品质] 部位·名称」）
function refineEquipOpts(){
  const ok2=refineEquipList();
  if(!ok2.length) return '<option value="">（没有可精炼的装备）</option>';
  return ok2.map(it=>"""),
    1, '抽出 refineEquipList'))

# ---------- ② 面板详情回落到首选装备 ----------
R.append((
    cr("""    const selIt=LS.refineEq? findItem(LS.refineEq) : null;"""),
    cr("""    // 未选 / 选中项已失效（例如刚被精炼损毁）时回落到排序第一件，保证面板始终有详情
    const selIt=findItem(LS.refineEq) || refineEquipList()[0] || null;"""),
    1, '详情回落首选'))

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
