# -*- coding: utf-8 -*-
"""一次性补丁：把「装备精炼」按原版口径还原 + 补上缺失的 UI 入口。

背景（本次反汇编原版 exe 裁定，详见 _dis_all.txt 第 67960 行 _apply_refine_one_level）：
  原版：flat 表按【装备档位】索引、每级增量恒定、**无任何百分比缩放**
        （refine_per_level_pct / _list 在原版是死代码）、只作用于四个白板攻防键且跳过 (0,0)、
        降级/归零要用 _revert_refine_stats 回退已得加成、隐藏词条仅在达到上限时按部位解锁。
  本 port 现状：flat 表按【精炼等级】取行 × 自创 0.10、作用于全键、失败不回退、
        隐藏词条每级 15% 随机；并且 doRefine 在 UI 上【根本没有入口】（data-refine 只绑不渲染）。

规则形如 (old, new, expect, tag)；任一规则命中次数 != expect 就 sys.exit(1)，不写回。
"""
import io, os, sys

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'game.js')
s = io.open(SRC, encoding='utf-8', newline='').read()
assert s.count('\r\n') > 0 and (s.count('\n') - s.count('\r\n')) == 0, 'game.js 应为纯 CRLF'


def cr(x):
    """把 LF 片段转成 CRLF 片段，方便书写。"""
    assert '\r' not in x
    return x.replace('\n', '\r\n')


R = []

# ---------- ① LS 里加精炼目标 ----------
R.append((
    cr("""const LS = { forgeSlot:'weapon', forgeTier:1, bailEquip:null, extractEquip:null, oreRecipe:'recipe_ore_4', furnace:null,
  mineGrade:'yipin', mineMap:'tianshengyuan', gemSeries:null, gemGrade:null, forgeMode:'random' };"""),
    cr("""const LS = { forgeSlot:'weapon', forgeTier:1, bailEquip:null, extractEquip:null, oreRecipe:'recipe_ore_4', furnace:null,
  mineGrade:'yipin', mineMap:'tianshengyuan', gemSeries:null, gemGrade:null, forgeMode:'random', refineEq:null };"""),
    1, 'LS 加 refineEq'))

# ---------- ② 词条映射：让精炼隐藏词条真正生效 ----------
R.append((
    cr("""const PERK_STAT_MAP = {
  '物理防御':'phys_def', '法术防御':'magic_def', '生命值':'max_hp',"""),
    cr("""const PERK_STAT_MAP = {
  // 精炼隐藏词条（refine_hidden_perks）：攻击部位 → 致命(物爆+1%)，其余 → 守御(减伤+1%)
  '致命':'phys_crit', '守御':'dmg_reduce_pct',
  '物理防御':'phys_def', '法术防御':'magic_def', '生命值':'max_hp',"""),
    1, 'PERK_STAT_MAP 注册隐藏词条'))

# ---------- ③ 精炼核心：按原版口径重写 ----------
R.append((
    cr("""// ---------- 生活技能：精炼 / 镶嵌 ----------
function doRefine(item){"""),
    cr("""// ---------- 生活技能：精炼 / 镶嵌 ----------
// 精炼加成口径（按原版 refine.py 反汇编还原，勿改回「按精炼等级取表 × 百分比」）：
//   · flat 表按【装备档位】索引（原版 refine_flat_per_level(equip.tier)），每级增量恒定
//   · 原版无任何百分比缩放：refine_per_level_pct / refine_per_level_pct_list 在原版是死代码
//     （config.py 里定义 + refine.py import 进命名空间，全 exe 零次使用；配套的
//      apply_range_bonus / apply_stat_range_bonus 也从未被调用）
//   · 只作用于四个白板攻防键，且【跳过 (0,0) 的键】（原版 `if int(v[0])==0 and int(v[1])==0: continue`）
//   · 失败降级/归零必须回退已得加成（原版 _revert_refine_stats），否则会白送属性
//   · 隐藏词条仅在达到精炼上限时解锁，按部位分 attack/defense，文案取自 refine_hidden_perks
function refineFlatOf(it){
  const m=(DATA.refine&&DATA.refine.refine_per_level_flat)||{};
  return m[''+((it&&it.tier)||1)] || m['1'] || [3,3];
}
// 本 port 装备属性是标量（原版是 [lo,hi] 区间）：原版给区间两端分别加 flat_lo / flat_hi，
// 标量下的等价期望增量就是中值，且【逐级恒定】—— 这样回退能精确还原，不必额外存字段
function refineStep(it){ const f=refineFlatOf(it); return Math.round((f[0]+f[1])/2); }
function refineKeys(it){
  return ['phys_atk','magic_atk','phys_def','magic_def'].filter(k=> it.stats && (it.stats[k]||0)!==0);
}
function refineApplyOne(it){
  const d=refineStep(it);
  for(const k of refineKeys(it)) it.stats[k]+= d;
  return d;
}
function refineRevert(it, levels){
  if(!(levels>0)) return;
  const d=refineStep(it)*levels;
  for(const k of refineKeys(it)) it.stats[k]=Math.max(0, it.stats[k]-d);
}
// 隐藏词条：攻击部位（武器/双戒）→ 致命；其余部位 → 守御。返回展示文案，未解锁返回 null
function refineAddHidden(it){
  const hp=(DATA.refine&&DATA.refine.refine_hidden_perks)||{};
  const atk=['weapon','ring1','ring2'].indexOf(it.slot)>=0;
  const pool=hp[atk?'attack':'defense'];
  if(!pool || !pool.length) return null;
  it.perks=it.perks||[];
  if(it.perks.some(pk=>pk.hidden)) return null;      // 已经有隐藏词条就不再叠加
  const txt=pick(pool);
  const name=txt.indexOf('致命')>=0 ? '致命' : '守御';
  it.perks.push({name, value:1, hidden:true});
  return name+'（'+txt+'）';
}
function doRefine(item){"""),
    1, '精炼核心helper'))

# ---------- ④ 归零：回退已得加成 ----------
R.append((
    cr("""  else if(outcome==='zero'){ item.refine=0; log('<span class="dmg">精炼失败，'+item.name+' 精炼归零</span>'); }"""),
    cr("""  else if(outcome==='zero'){ refineRevert(item, item.refine); item.refine=0; log('<span class="dmg">精炼失败，'+item.name+' 精炼归零</span>'); }"""),
    1, '归零回退'))

# ---------- ⑤ 降级：回退一级 ----------
R.append((
    cr("""  else if(outcome==='drop'){ item.refine=Math.max(0,item.refine-1); log('<span class="sys">精炼失败，'+item.name+' 下降一级</span>'); }"""),
    cr("""  else if(outcome==='drop'){ refineRevert(item, 1); item.refine=Math.max(0,item.refine-1); log('<span class="sys">精炼失败，'+item.name+' 下降一级</span>'); }"""),
    1, '降级回退'))

# ---------- ⑥ 成功：按档位加 flat、消除百分比、隐藏词条只在满级 ----------
R.append((
    cr("""    item.refine = next;
    const flat = rf.refine_per_level_flat[''+next] || [3,3];
    const add = ri(flat[0],flat[1]);
    for(const s in item.stats){ item.stats[s]+= Math.round(add*(rf.refine_per_level_pct+0.05)); }
    // 隐藏词条
    if(Math.random()<0.15){ item.perks.push({name:'致命', value:1}); }
    log('<span class="loot">精炼成功！'+item.name+' 提升至 +'+next+'</span>');"""),
    cr("""    item.refine = next;
    refineApplyOne(item);
    // 隐藏词条：原版仅在达到精炼上限时解锁（按部位分 attack/defense）
    const hid = next>=rf.refine_max ? refineAddHidden(item) : null;
    log('<span class="loot">精炼成功！'+item.name+' 提升至 +'+next+(hid?' · 解锁隐藏词条 '+hid:'')+'</span>');"""),
    1, '成功分支'))

# ---------- ⑦ 逐级套用（兑换装备用）：与手动精炼同级结果一致 ----------
R.append((
    cr("""function applyRefineLevels(it, lv){
  const rf=DATA.refine; if(!rf) return;
  for(let n=1;n<=lv;n++){
    const flat=rf.refine_per_level_flat[''+n]||[3,3];
    const add=(flat[0]+flat[1])/2;
    for(const st in it.stats) it.stats[st]+=Math.round(add*(rf.refine_per_level_pct+0.05));
  }
  it.refine=lv;
}"""),
    cr("""function applyRefineLevels(it, lv){
  const rf=DATA.refine; if(!rf) return;
  const max=rf.refine_max||7;
  for(let n=0;n<Math.max(0,Math.floor(lv||0));n++){
    if((it.refine||0)>=max) break;
    it.refine=(it.refine||0)+1;
    refineApplyOne(it);
  }
  if((it.refine||0)>=max && !(it.perks||[]).some(pk=>pk.hidden)) refineAddHidden(it);
}"""),
    1, 'applyRefineLevels'))

# ---------- ⑧ 精炼目标下拉（只列可精炼的，带当前等级） ----------
R.append((
    cr("""function oreRecipeOpts(){"""),
    cr("""// 可精炼装备下拉（只列未满级的，显示「+N [品质] 部位·名称」）
function refineEquipOpts(){
  const p=state.player; if(!p) return '<option value="">（无装备）</option>';
  const max=(DATA.refine||{}).refine_max||7;
  const list=[];
  for(const s in p.equip) if(p.equip[s]) list.push(p.equip[s]);
  for(const b of p.bag) if(b.type==='equip') list.push(b);
  const ok2=list.filter(it=> (it.refine||0)<max).sort((a,b)=>equipScore(b)-equipScore(a));
  if(!ok2.length) return '<option value="">（没有可精炼的装备）</option>';
  return ok2.map(it=> '<option value="'+it.uid+'"'+(LS.refineEq===it.uid?' selected':'')+'>'
    +'+'+(it.refine||0)+' ['+QNAME[it.quality]+'] '+SLOT_NAME[it.slot]+'·'+it.name+'</option>').join('');
}
function oreRecipeOpts(){"""),
    1, 'refineEquipOpts'))

# ---------- ⑨ 面板：⑩ 装备精炼（补上缺失的 UI 入口） ----------
R.append((
    cr("""  // ④ 提取回收
  if(any || sub==='recycle'){"""),
    cr("""  // ⑩ 装备精炼（refine.json：flat 表按【装备档位】；+5 起每级另耗 1 颗对应档晶石）
  if(any || sub==='craft'){
    const rf=DATA.refine, rmax=rf.refine_max||7;
    const flatStr=[1,2,3,4,5,6,7].map(t=> t+'档 '+(rf.refine_per_level_flat||{})[''+t].join('~')).join(' · ');
    let h='<hr><h3>⑩ 装备精炼</h3><div class="muted">每级加成按【装备档位】取表（'+flatStr+'），与精炼等级无关；'
      +'上限 +'+rmax+'，+5 起每级另耗 1 颗对应档晶石。失败可能下降 / 归零 / 损毁（降级归零会退回已得加成）。'
      +'达到 +'+rmax+' 时按部位解锁隐藏词条（武器/双戒→致命，其余→守御）。</div>';
    h+='<div class="craft-row">装备：<select id="refine-equip">'+refineEquipOpts()+'</select> <button class="mini" data-act="refine-eq">精炼</button></div>';
    const selIt=LS.refineEq? findItem(LS.refineEq) : null;
    if(selIt){
      const next=(selIt.refine||0)+1, cost=next*120;
      const ck=crystalForTier(selIt.tier||1);
      const oc=(rf.refine_outcomes||{})[''+next]||{};
      h+='<div class="muted">下一级 +'+next+'：消耗 '+fmtNum(cost)+' 金币'
        +(next>=crystalStartRefine()? (' + '+crystalName(ck)+' x1（持有 '+crystalCount(ck)+'）') : '')
        +'；每级 +'+refineStep(selIt)+' 到 '+refineKeys(selIt).map(k=>CN_COMBAT[k]||k).join('/')
        +'<br>成功率 '+Math.round((oc.up||0)*100)+'% · 保持 '+Math.round((oc.keep||0)*100)+'%'
        +((oc.drop||0)?' · 降级 '+Math.round((oc.drop||0)*100)+'%':'')
        +((oc.zero||0)?' · 归零 '+Math.round((oc.zero||0)*100)+'%':'')
        +((oc.destroy||0)?' · 损毁 '+Math.round((oc.destroy||0)*100)+'%':'')+'</div>';
    }
    push('craft',h);
  }

  // ④ 提取回收
  if(any || sub==='recycle'){"""),
    1, '⑩ 精炼面板'))

# ---------- ⑩ 下拉 onchange 记忆 ----------
R.append((
    cr("""  const ee=$('extract-equip'); if(ee) ee.onchange=()=>{ LS.extractEquip=ee.value; };"""),
    cr("""  const ee=$('extract-equip'); if(ee) ee.onchange=()=>{ LS.extractEquip=ee.value; };
  const re=$('refine-equip'); if(re) re.onchange=()=>{ LS.refineEq=re.value; renderTab(); };"""),
    1, '精炼下拉 onchange'))

# ---------- ⑪ 按钮 handler ----------
R.append((
    cr("""    else if(a==='extract') doExtract();"""),
    cr("""    else if(a==='extract') doExtract();
    else if(a==='refine-eq'){ const rq=$('refine-equip'); if(rq && rq.value) doRefine(findItem(rq.value)); }"""),
    1, '精炼按钮 handler'))

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
