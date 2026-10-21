/* ===== 模块 smtree.js —— 神魔技能树（加点/聚合/主动技）+ 角色属性计算 =====
 * 来源：game.js L1110-1388（2026-10-21 模块化切分，内容逐字节保留）
 * 导出 19 个顶层名；import 由 AST 跨模块引用自动计算。
 */
import { state } from './state.js';
import { ATTR_EFFECT_KEY, DATA, PERK_STAT_MAP, SM_ACTIVE } from './core.js';
import { monsterDef, passiveBonus, sm, smTransform, wuhunStats } from './player.js';
import { itemName } from './shop.js';
import { fmtNum, itemConsume, itemCount } from './life.js';

// ---------- 神魔修验技能树（shenmo_skills.json） ----------
export function smNodes(){
  // 各职业技能树分散在 shenmo_skills(_darkwitch|_shaman).json
  const job=(state.player&&state.player.job)||'warrior';
  let file = job==='darkwitch'? DATA.shenmo_skills_darkwitch
           : job==='shaman'?  DATA.shenmo_skills_shaman
           : job==='warrior'? DATA.shenmo_skills : null;
  let fallback=false;
  if(!file || !(file.skills||[]).length){ file=DATA.shenmo_skills; fallback=true; }  // 法师无专属树，沿用战士
  return {list:(file&&file.skills)||[], fallback};
}
export function smNodeDef(key){ const n=smNodes().list.find(x=>x.key===key); return n||null; }
// 当前职业的修验节点实际用到了哪些档位（升序）—— 子菜单按它动态生成
export function smNodeTiers(){
  const s=state.player&&state.player.shenmo;
  const seen=[];
  for(const d of smNodes().list) if(d.faction===(s&&s.faction) && seen.indexOf(d.tier)<0) seen.push(d.tier);
  return seen.sort((a,b)=>a-b);
}
export function smNodeLv(key){ const s=state.player.shenmo; return (s&&s.nodes&&s.nodes[key])||0; }
export function smTierDef(tier){ const arr=sm().tiers||[]; return arr.find(t=>t.tier===tier)||{tier:1,name:'一档',spent_required:0,points_per_level:1}; }
export function smSpent(){
  const s=state.player.shenmo; if(!s||!s.nodes) return 0;
  let n=0;
  for(const k in s.nodes){ const d=smNodeDef(k); if(!d) continue; n += (s.nodes[k]||0)*(smTierDef(d.tier).points_per_level||1); }
  return n;
}
export function smNodeLevelData(d, lv){ const arr=d.levels||[]; if(!arr.length) return {}; return arr[Math.max(0,Math.min((lv||1)-1,arr.length-1))]; }
export function smFmt(d, lv){
  let f=d.fmt||d.desc||'';
  const v=smNodeLevelData(d, Math.max(1, lv||1));
  f=f.replace(/\{(\w+)\}/g, (m,k)=> (v[k]!=null? v[k] : (v[k]==null&&d.levels&&d.levels[0]&&d.levels[0][k]!=null? d.levels[0][k] : m)));
  return f;
}
export function smEquipOk(d){
  const p=state.player, r=d.require||{};
  if(r.equip_weapon_kind){
    const map={dao:'刀', fu:'斧', qiang:'枪', jian:'剑', gun:'棍', blade:'刀'};
    const kw=map[r.equip_weapon_kind]||r.equip_weapon_kind;
    const w=p.equip.weapon;
    if(!w || (w.name||'').indexOf(kw)<0) return false;
  }
  if(r.equip_shield && !p.equip.shield) return false;
  return true;
}
export function smPrereqOk(d){
  for(const pr of ((d.require||{}).prereq||[])) if(smNodeLv(pr.key) < (pr.level||1)) return false;
  return true;
}
export function smAddPoint(key){
  const s=state.player.shenmo, d=smNodeDef(key);
  if(!s||!s.faction||!d) return {ok:false, msg:'尚未入道'};
  const lv=smNodeLv(key);
  if(lv>=(d.max_level||1)) return {ok:false, msg:d.name+' 已满级'};
  const td=smTierDef(d.tier);
  if(smSpent() < (td.spent_required||0)) return {ok:false, msg:'需累计投入 '+(td.spent_required||0)+' 点解锁'+(td.name||'')};
  if(!smPrereqOk(d)){
    const pr=((d.require||{}).prereq||[]).find(x=> smNodeLv(x.key)<(x.level||1));
    const pd=smNodeDef(pr.key);
    return {ok:false, msg:'需前置 '+(pd? pd.name : pr.key)+' Lv.'+pr.level};
  }
  const cost=td.points_per_level||1;
  if((s.points||0) < cost) return {ok:false, msg:'修验点不足（需 '+cost+' 点）'};
  s.points-=cost;
  s.nodes[key]=lv+1; s.spent=smSpent();
  refreshStats();
  return {ok:true, msg:d.name+' → Lv.'+(lv+1)+(smEquipOk(d)?'':'（当前装备不满足，暂不生效）')};
}
export function smResetPoints(){
  const p=state.player, s=p.shenmo;
  if(!s||!s.faction) return {ok:false, msg:'尚未入道'};
  const R=(sm().reset||{}), lv=s.level||1;
  if(lv<50){
    // 成本按配置公式（"level * 100"）计算，避免硬编码漂移；公式来自受信本地配置，白名单校验后求值
    const b=R.below_level_50||{};
    let cost=lv*100; // 兜底，与配置 "level * 100" 一致
    if(typeof b.formula==='string' && /^[\dlevel+\-*/().\s]+$/.test(b.formula)){
      try{ const v=Function('"use strict";return ('+b.formula.replace(/level/g,'('+lv+')')+');')(); if(Number.isFinite(v)&&v>=0) cost=Math.round(v); }catch(e){}
    }
    if(p.gold<cost) return {ok:false, msg:'重置需金币 '+fmtNum(cost)};
    p.gold-=cost;
  }else{
    const a=(R.above_level_50||{}), itemKey=a.item||'shoushan_shi';
    const starBy=a.star_by_level||{};
    let star=1; for(const k of Object.keys(starBy).map(Number).sort((a,b)=>a-b)) if(lv>=k) star=starBy[''+k];
    if(itemCount(itemKey)<star) return {ok:false, msg:'重置需'+itemName(itemKey)+' x'+star};
    itemConsume(itemKey, star);
  }
  const back=smSpent();
  s.nodes={}; s.spent=0; s.points=(s.points||0)+back;
  refreshStats();
  return {ok:true, msg:'已重置修验加点，返还 '+back+' 点'};
}
// 汇总已加点节点的效果（战斗与属性共用）
export function smAgg(){
  const out={ atk:0, crit:0, critDmg:0, constitutionPct:0, defPct:0, dmgBonus:0, ignoreDef:0,
    append:[], reflect:0, block:0, critGuard:0, silence:null, healReduce:null, cdReduce:{}, skillDmg:{}, actives:[] };
  const s=state.player.shenmo;
  if(!s||!s.faction||!s.nodes) return out;
  for(const key in s.nodes){
    const lv=s.nodes[key]||0; if(lv<=0) continue;
    const d=smNodeDef(key); if(!d) continue;
    if(d.faction!==s.faction) continue;
    if(!smEquipOk(d)) continue;          // 装备要求不满足则不生效
    const v=smNodeLevelData(d, lv);
    const mode=d.mode||'';
    const name=(function(){ const m=/【(.+?)】/.exec(d.fmt||d.desc||''); return m? m[1] : null; })();
    if(d.type==='active'){ out.actives.push({key:d.active_key, node:d, lv}); continue; }
    switch(d.hook){
      case 'stat_buff':
        if(mode==='atk_flat') out.atk += (v.atk||0);
        else if(mode==='constitution_pct') out.constitutionPct += (v.constitution_pct||0);
        else if(mode==='crit_flat') out.crit += (v.crit_pct||0);
        else if(mode==='crit_dmg_pct') out.critDmg += (v.crit_dmg_pct||0);
        break;
      case 'on_hit_append':
        out.append.push({prob: v.prob||0, pct: mode==='append_attack_full'? 100 : (v.bonus_pct||0)});
        break;
      case 'on_damage_taken':
        if(mode==='reflect_pct') out.reflect += (v.reflect_pct||0);
        else if(mode==='block_pct') out.block += (v.block_pct||0);
        else if(mode==='crit_guard_pct') out.critGuard += (v.crit_guard_pct||0);
        break;
      case 'on_hit':
        if(mode==='silence_chance') out.silence={prob:v.prob||0, dur:v.duration||0};
        else if(mode==='apply_debuff') out.healReduce={prob:v.prob||0, pct:v.heal_reduce_pct||0, dur:v.duration||0};
        break;
      case 'reduce_cd':
        if(name) out.cdReduce[name]=Math.max(out.cdReduce[name]||0, v.cd_reduce||0);
        break;
      case 'enhance_skill':
        if(mode==='dmg_bonus'){ if(name) out.skillDmg[name]=(out.skillDmg[name]||0)+(v.dmg_bonus_pct||0); else out.dmgBonus += (v.dmg_bonus_pct||0); }
        else if(mode==='set_field') out.ignoreDef = Math.max(out.ignoreDef, v.ignore_def_pct||0);
        else out.dmgBonus += (v.dmg_bonus_pct||v.scale_pct||v.value_add||v.ignore_def_pct||v.def_down_pct||v.duration_add||v.prob||0)*0.5;
        break;
      case 'unlock_skill':
        if(d.active_key) out.actives.push({key:d.active_key, node:d, lv});
        break;
      default: break;
    }
  }
  return out;
}
export function smAggCached(){
  const p=state.player;
  if(!p) return smAggEmpty();
  if(!p._smAgg) p._smAgg = smAgg();
  return p._smAgg;
}
export function smAggEmpty(){ return {atk:0,crit:0,critDmg:0,constitutionPct:0,defPct:0,dmgBonus:0,ignoreDef:0,append:[],reflect:0,block:0,critGuard:0,silence:null,healReduce:null,cdReduce:{},skillDmg:{},actives:[]}; }
// 神魔主动技能：取已解锁且冷却就绪的一个
export function smActivePick(){
  const s=state.player.shenmo; const ag=smAggCached();
  if(!s||!s.faction||!ag.actives.length) return null;
  s.cd=s.cd||{};
  const ready=ag.actives.filter(a=>{
    const d=SM_ACTIVE[a.key]; if(!d) return false;
    return !(s.cd[a.key]>0);
  });
  if(!ready.length) return null;
  const pickOne=ready[Math.floor(Math.random()*ready.length)];
  const d=SM_ACTIVE[pickOne.key];
  const L=(d.levels||[])[Math.max(0,Math.min(pickOne.lv-1,(d.levels||[]).length-1))]||{};
  return {def:d, lvdata:L, node:pickOne};
}
export function smActiveCast(m){
  const s=state.player.shenmo; const a=smActivePick(); if(!a) return null;
  const p=state.player;
  const cd=(a.lvdata.cd||a.def.cd||4);
  s.cd[a.def.key]=cd;
  const mp=a.lvdata.mp||0;
  if(mp>0){ if((p.mp||0)<mp) return null; p.mp-=mp; }
  const dmg=a.lvdata.damage||0;
  if(dmg>0 && m){
    const atk=p._s.main;
    const base=atk*(dmg/100) + dmg*0.5;
    const def=monsterDef(m, p._s.defType);
    const val=Math.max(1, Math.round(base*base/def));
    m.curHp-=val;
    return {name:a.def.name, dmg:val, kind:'attack'};
  }
  if((a.def.skill_type==='defense'||a.def.skill_type==='buff') && state.buff){
    state.buff.phys_def=(state.buff.phys_def||0)+Math.round((a.lvdata.damage||10)*2);
    return {name:a.def.name, dmg:0, kind:'defense'};
  }
  return {name:a.def.name, dmg:0, kind:'other'};
}

export function computeStats(p){
  const job = DATA.jobs.jobs.find(j=>j.key===p.job);
  // 基础属性
  const attr = {};
  for(const k in job.base_stats) attr[k]=0;
  for(const k in job.base_stats){
    attr[k] = job.base_stats[k] + job.growth[k]*(p.level-1) + job.per_level_points*(p.level-1);
  }
  // 神魔技能树：体质百分比（需在属性→战斗属性转换前生效）
  const _smAg = (p.shenmo && p.shenmo.faction) ? smAggCached() : null;
  if(_smAg && _smAg.constitutionPct) attr.constitution = Math.round(attr.constitution*(1+_smAg.constitutionPct/100));
  // 装备 + 词条 + 宝石 + 精炼 加成
  const bonus = {}; // stat -> val
  const addStat = (s,v)=> bonus[s]=(bonus[s]||0)+v;
  for(const slot in p.equip){
    const it = p.equip[slot];
    if(!it) continue;
    for(const s in (it.stats||{})) addStat(s, it.stats[s]);
    for(const pk of (it.perks||[])){
      if(ATTR_EFFECT_KEY[pk.name]) addStat(ATTR_EFFECT_KEY[pk.name], pk.value);
      else if(PERK_STAT_MAP[pk.name]) addStat(PERK_STAT_MAP[pk.name], pk.value);
    }
    for(const g of (it.gems||[])) if(g) addStat(g.stat, g.value);
  }
  // 被动技能加成
  const pb = passiveBonus(p);
  for(const k in pb) addStat(k, pb[k]);
  // 武魂（双槽）：基础属性 + 激活属性
  for(const o of (p.wuhunSlots||[])){
    if(!o) continue;
    const ws = wuhunStats(o);
    for(const s in ws) addStat(s, ws[s]);
    if(o.activated && o.actAttr) addStat(o.actAttr.name, o.actAttr.value);
  }
  // 神魔变身：按修验等级给攻/防/血/减伤
  if(p.shenmo && p.shenmo.faction){
    const tl = smTransform(p.shenmo.level||1);
    if(tl){
      addStat('phys_atk', tl.atk||0); addStat('magic_atk', tl.atk||0);
      addStat('phys_def', tl.def||0); addStat('magic_def', tl.def||0);
      addStat('max_hp', tl.hp||0);
      if(tl.dmg_reduce) addStat('dmg_reduce_pct', tl.dmg_reduce);
    }
    // 修验技能树被动
    const ag = smAggCached();
    if(ag.atk){ addStat('phys_atk', ag.atk); addStat('magic_atk', ag.atk); }
    if(ag.crit){ addStat('phys_crit', ag.crit); addStat('magic_crit', ag.crit); }
    if(ag.critDmg) addStat('crit_dmg_pct', ag.critDmg);
    if(ag.block) addStat('dmg_reduce_pct', ag.block);
  }
  // 属性 → 战斗属性
  const combat = {};
  const eff = job.attribute_effects;
  for(const a in attr){
    const amt = attr[a] + (bonus[a]||0);
    const map = eff[a] || {};
    for(const s in map) combat[s] = (combat[s]||0) + amt*map[s];
  }
  for(const s in bonus){
    if(['strength','agility','constitution','intelligence','spirit'].includes(s)) continue;
    combat[s] = (combat[s]||0) + bonus[s];
  }
  // ⚠️ 这里原本还有一行 `combat.phys_crit += attr.agility*0.142857;`，是【重复计算】已删除：
  //    敏捷 → 暴击 已经由上面的 job.attribute_effects 循环统一累加
  //    （战士/法师/暗巫/幻师的表里都有 agility → phys_crit: 0.142857），
  //    再加一次会让敏捷贡献翻倍（Lv120 战士实测 239.71，只计一次应为 128.07）。
  // 闪避 / 速度（原版战斗模型，按 agility 派生）
  //  dodge = min(10, trunc(10*agi/(agi+100)))：命中则完全闪避（0 伤害）
  //  speed = 4 + min(12, trunc(12*agi/(agi+60)))：速度条每 tick 累加，跑满 100 出手（上限 16）
  const _agi = (attr.agility||0) + (bonus.agility||0);
  combat.agility = _agi;
  combat.dodge = Math.min(10, Math.trunc(10*_agi/(_agi+100)));
  combat.speed = 4 + Math.min(12, Math.trunc(12*_agi/(_agi+60)));
  // 主攻击
  const main = job.main_damage==='magic' ? (combat.magic_atk||0) : (combat.phys_atk||0);
  const defType = job.main_damage==='magic' ? 'magic_def' : 'phys_def';
  return {
    attr, combat, main, defType,
    max_hp: Math.round((combat.max_hp||100) + 100),
    max_mp: Math.round((combat.max_mp||50) + 50),
  };
}
export function refreshStats(){
  const p = state.player;
  p._smAgg = null;                 // 神魔技能树加成缓存失效
  const s = computeStats(p);
  p._s = s;
  if(p.hp > s.max_hp) p.hp = s.max_hp;
  if(p.mp > s.max_mp) p.mp = s.max_mp;
}

