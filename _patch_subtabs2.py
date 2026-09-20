# -*- coding: utf-8 -*-
"""子菜单第二轮细化：把第一轮量出来仍然 >1.8 屏的子页再拆一层。

第一轮量化（_subtabs_report.txt，1440x900）后仍要下滑的子页：
    神魔·技能树 x2.26  ← 33 个修验节点
    技能·主动   x1.95  ← 18 个主动技能
    背包·装备   x1.95  ← 22 件装备
    成就·等级   x1.91  ← 24 条等级成就
第二轮全部用**配置自带的维度**拆，不引入我编的分类：
    装备 → slots.json 的 slot_type（weapon/offhand → 武器·副手；armor → 防具；jewelry → 首饰）
    主动技能 → skills_active_*.json 的 learn_level（≤30 / ≤60 / >60 三段）
    修验技能树 → shenmo_skills*.json 的 tier，标签取 shenmo.json#tiers 的 name（一档/二档/一档进阶/二档进阶）
    等级成就 → target 分三段（≤40 / ≤80 / >80）
"""
import io, os, re, sys

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, 'game.js')
s = io.open(SRC, encoding='utf-8', newline='').read().replace('\r\n', '\n')
n0 = len(s)
if '\r' in s:
    sys.exit('发现裸 CR')
hits = []


def rep(old, new, expect=1, tag=''):
    global s
    got = s.count(old)
    if got != expect:
        sys.exit('[%s] 期望 %d 处，实际 %d 处\n---- 片段 ----\n%s' % (tag, expect, got, old[:400]))
    hits.append((tag, got))
    s = s.replace(old, new)


# ============================================================
# 1) 背包：装备按 slot_type 拆成 武器·副手 / 防具 / 首饰
# ============================================================
rep("""// 背包子菜单：按「物品用途」分（分组规则集中在 bagSubOf()，调分组只动那一处）
const BAG_SUBS=[
  {key:'equip', label:'装备'},
  {key:'potion',label:'药品'},""",
    """// 背包子菜单：按「物品用途」分（分组规则集中在 bagSubOf()，调分组只动那一处）。
// 装备单独按部位大类再拆 —— 长局背包里未装备的装备最多（逐件显示、每件两行），
// 不拆的话「装备」一页会是全背包最长的一页。
const BAG_SUBS=[
  {key:'eq_weapon', label:'装备·武器'},
  {key:'eq_armor',  label:'装备·防具'},
  {key:'eq_jewelry',label:'装备·首饰'},
  {key:'potion',label:'药品'},""", 1, 'bag-subs')

rep("""// 背包物品 → 子菜单 key（依据 items.json 的 effect_type，即配置里的分类语义）
function bagSubOf(it){
  if(!it) return 'other';
  if(it.type==='equip') return 'equip';""",
    """// 装备部位 → slots.json 的 slot_type（weapon/offhand/armor/jewelry）。
// 用配置而不是自己维护一张部位表：slots.json 里每个部位都带 slot_type。
function bagSlotType(slot){
  const raw=(DATA.slots||{}).slots;
  const arr=Array.isArray(raw)? raw : (raw? Object.keys(raw).map(k=>raw[k]) : []);
  const d=arr.find(x=>x && x.key===slot);
  return (d && d.slot_type) || 'armor';
}
function equipSubOf(it){
  const t=bagSlotType(it && it.slot);
  if(t==='weapon'||t==='offhand') return 'eq_weapon';
  if(t==='jewelry') return 'eq_jewelry';
  return 'eq_armor';                  // armor 与任何未知部位：宁可落到「防具」也不要产生孤儿
}
// 背包物品 → 子菜单 key（依据 items.json 的 effect_type，即配置里的分类语义）
function bagSubOf(it){
  if(!it) return 'other';
  if(it.type==='equip') return equipSubOf(it);""", 1, 'bag-subof')

rep("""  // ② 装备：每件词条/属性独立，逐件显示（不合并），按战力评分从高到低。
  //    只属于「装备」子页；sub 为空时也渲染（保持旧行为）。
  const eqs = (!sub || sub==='equip')
    ? p.bag.filter(b=>b.type==='equip').sort((a,b)=>equipScore(b)-equipScore(a))
    : [];
  if(eqs.length){
    html+='<h3 class="sec">装备（'+eqs.length+' 件 · 词条各不相同，逐件显示）</h3>';""",
    """  // ② 装备：每件词条/属性独立，逐件显示（不合并），按战力评分从高到低。
  //    按子菜单过滤（武器·副手 / 防具 / 首饰）；sub 为空时全部渲染（保持旧行为）。
  const allEq = p.bag.filter(b=>b.type==='equip');
  const eqs = (sub ? allEq.filter(b=>equipSubOf(b)===sub) : allEq)
    .sort((a,b)=>equipScore(b)-equipScore(a));
  if(eqs.length){
    html+='<h3 class="sec">装备（'+eqs.length+' 件 · 词条各不相同，逐件显示）</h3>';""", 1, 'bag-eqs')


# ============================================================
# 2) 技能：主动按 learn_level 分 3 段
# ============================================================
rep("""// 其余页签的固定子菜单（需要按数据动态生成的页签走 subTabs() 的分支）""",
    """// 主动技能子菜单：按「可学等级」分 3 段（战士 18 个主动技能一屏放不下；每个技能卡 3 行）。
const SKILL_BANDS=[{key:'lv1',label:'初阶'},{key:'lv2',label:'中阶'},{key:'lv3',label:'高阶'}];
function skillBand(lv){ lv=lv||1; return lv<=30? 'lv1' : (lv<=60? 'lv2' : 'lv3'); }

// 其余页签的固定子菜单（需要按数据动态生成的页签走 subTabs() 的分支）""", 1, 'skill-bands')

rep("""  skill:  [{key:'active',label:'主动'},{key:'passive',label:'被动'},{key:'summon',label:'召唤兽'}],""",
    """  skill:  [{key:'passive',label:'被动'},{key:'summon',label:'召唤兽'}],   // 主动部分由 SKILL_BANDS 拼在前""", 1, 'tab-subs-skill')

rep("""function subTabs(tab){
  if(tab==='bag') return BAG_SUBS;""",
    """function subTabs(tab){
  if(tab==='bag') return BAG_SUBS;
  if(tab==='skill') return SKILL_BANDS.concat(TAB_SUBS.skill);""", 1, 'subTabs-skill')

rep("""  if(tab==='ach'){
    const cats=achCats(), ks=[];
    for(const a of achList()) if(ks.indexOf(a.category)<0) ks.push(a.category);
    return ks.map(k=>({key:k,label:cats[k]||k}));
  }
  // 未入道时神魔页很短（只有一段说明 + 两个按钮），不拆
  if(tab==='shenmo'){
    const joined=!!(state.player&&state.player.shenmo&&state.player.shenmo.faction);
    return joined? TAB_SUBS.shenmo : [{key:'level',label:'修验·变身'}];
  }""",
    """  if(tab==='ach') return achSubs();
  // 未入道时神魔页很短（只有一段说明 + 两个按钮），不拆；
  // 入道后技能树本身还有 30+ 个节点 → 再按 tier 拆（标签用 shenmo.json#tiers 的 name）
  if(tab==='shenmo'){
    const joined=!!(state.player&&state.player.shenmo&&state.player.shenmo.faction);
    if(!joined) return [{key:'level',label:'修验·变身'}];
    const out=TAB_SUBS.shenmo.slice(0,1);          // 「修验·变身」
    for(const t of smNodeTiers()) out.push({key:'tree_'+t, label:(smTierDef(t)||{}).name || ('第'+t+'档')});
    return out;
  }""", 1, 'subTabs-dyn')

# 成就子菜单：等级按 target 分 3 段
rep("""function subKey(tab){""",
    """// 成就子菜单：普通分类一项一个；「等级」24 条按 target 再拆 3 段
function achSubs(){
  const cats=achCats(), ks=[];
  for(const a of achList()) if(ks.indexOf(a.category)<0) ks.push(a.category);
  const out=[];
  for(const k of ks){
    if(k==='level')
      out.push({key:'level_1',label:'等级·初'},{key:'level_2',label:'等级·中'},{key:'level_3',label:'等级·高'});
    else out.push({key:k,label:cats[k]||k});
  }
  return out;
}
function achSubOf(a){
  if(!a || a.category!=='level') return a? a.category : 'level_1';
  const t=a.target||0;
  return t<=40? 'level_1' : (t<=80? 'level_2' : 'level_3');
}
function subKey(tab){""", 1, 'ach-subs')

# smNodeTiers 辅助
rep("""function smNodeDef(key){ const n=smNodes().list.find(x=>x.key===key); return n||null; }""",
    """function smNodeDef(key){ const n=smNodes().list.find(x=>x.key===key); return n||null; }
// 当前职业的修验节点实际用到了哪些档位（升序）—— 子菜单按它动态生成
function smNodeTiers(){
  const s=state.player&&state.player.shenmo;
  const seen=[];
  for(const d of smNodes().list) if(d.faction===(s&&s.faction) && seen.indexOf(d.tier)<0) seen.push(d.tier);
  return seen.sort((a,b)=>a-b);
}""", 1, 'smNodeTiers')


# ============================================================
# 3) renderSkill：支持 lv1/lv2/lv3 子页（'active' 仍表示全部主动，兼容旧调用）
# ============================================================
rep("""  if(on('active')){
    const list=jobSkills(p.job);
    const learned=Object.keys(p.skills||{}).length;
    html+='<h3 class="sec">主动技能（已学 '+learned+'/'+list.length+'）</h3>';""",
    """  if(any || sub==='active' || SKILL_BANDS.some(b=>b.key===sub)){
    const allSkill=jobSkills(p.job);
    const learned=Object.keys(p.skills||{}).length;
    const list = (any || sub==='active') ? allSkill : allSkill.filter(x=>skillBand(x.learn_level||1)===sub);
    html+='<h3 class="sec">主动技能（已学 '+learned+'/'+allSkill.length+'）</h3>';""", 1, 'renderSkill-band')


# ============================================================
# 4) renderShenmo：技能树按 tier 过滤
# ============================================================
rep("""  for(const tk of Object.keys(byTier).sort()){
    const td2=smTierDef(Number(tk));
    tree+='<div class="muted" style="margin-top:6px">'""",
    """  for(const tk of Object.keys(byTier).sort()){
    // sub='tree_<档位>' 时只渲染该档（sub='tree' / 空 表示全部档位）
    if(sub && sub.indexOf('tree_')===0 && Number(sub.slice(5))!==Number(tk)) continue;
    const td2=smTierDef(Number(tk));
    tree+='<div class="muted" style="margin-top:6px">'""", 1, 'renderShenmo-tier')

rep("""  if(!sub) return info+tree+lvls;             // 旧行为：全量、原顺序
  return sub==='tree'? tree : (info+lvls);""",
    """  if(!sub) return info+tree+lvls;             // 旧行为：全量、原顺序
  return (sub==='tree' || sub.indexOf('tree_')===0) ? tree : (info+lvls);""", 1, 'renderShenmo-ret')


# ============================================================
# 5) renderAch：按 achSubOf() 分组（等级拆 3 段）
# ============================================================
rep("""  const groups={};
  list.forEach(a=>{ (groups[a.category]=groups[a.category]||[]).push(a); });
  // 按子菜单只显示该分类（sub 为空 = 全部分类，与旧行为一致）
  const cur = (sub && groups[sub]) ? sub : '';
  const use = cur ? [cur] : Object.keys(groups);
  let html='<h3>成就'+(cur? '（'+(cats[cur]||cur)+'）':'')+'</h3><div class="muted">共 '+list.length+' 项，已达成 '+done+' 项；达成后自动发放奖励（金币/道具/神秘结晶）。</div>';
  for(const c of use){
    html+='<div class="shop"><div class="shop-name">'+(cats[c]||c)+'</div>';""",
    """  const groups={}, subLabels={};
  list.forEach(a=>{ const k=achSubOf(a); (groups[k]=groups[k]||[]).push(a); });
  for(const x of achSubs()) subLabels[x.key]=x.label;
  // 按子菜单只显示该子页（sub 为空 = 全部，与旧行为一致）
  const cur = (sub && groups[sub]) ? sub : '';
  const use = cur ? [cur] : Object.keys(groups);
  let html='<h3>成就'+(cur? '（'+(subLabels[cur]||cats[cur]||cur)+'）':'')+'</h3><div class="muted">共 '+list.length+' 项，已达成 '+done+' 项；达成后自动发放奖励（金币/道具/神秘结晶）。</div>';
  for(const c of use){
    html+='<div class="shop"><div class="shop-name">'+(subLabels[c]||cats[c]||c)+'</div>';""", 1, 'renderAch-groups')

out = s.replace('\r\n', '\n').replace('\n', '\r\n')
io.open(SRC, 'w', encoding='utf-8', newline='').write(out)
print('written %s : %d -> %d bytes' % (SRC, n0, len(out.encode('utf-8'))))
for tag, n in hits:
    print('   ok  %-22s %s' % (tag, n))
