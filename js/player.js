/* ===== 模块 player.js —— 经验/属性/技能学习/武魂系统/神魔修验基础/仙之境 =====
 * 来源：game.js L430-927（2026-10-21 模块化切分，内容逐字节保留）
 * 导出 59 个顶层名；import 由 AST 跨模块引用自动计算。
 */
import { state } from './state.js';
import { DATA, PASSIVES, SKILLS, WUHUN_ATTR_CAT, WUHUN_EXP_MULT, WUHUN_TYPE_KEYS, clamp, pick, ri, rnd, uid } from './core.js';
import { refreshStats, smAggCached } from './smtree.js';
import { todayKey } from './world.js';
import { eventLog, log } from './render.js';
import { fmtNum, titleDmgMult } from './life.js';

// ---------- 经验/属性 ----------
export function expToNext(level){
  const ef = DATA.character.exp_formula;
  // exp_formula(15*L^3) 是「升到该等级的累计经验」曲线，单级需求取差分。
  // 若直接把 15*L^3 当作单级需求，会因怪物经验仅线性增长（Lv120 怪仅 734 经验）
  // 导致 Lv30 起需击杀 2700+ 只怪才能升 1 级，中期彻底卡死。
  return Math.round(ef.coefficient * (Math.pow(level+1, ef.power) - Math.pow(level, ef.power)));
}
// 等级差经验缩放（口径对齐原版 battle/encounter.py:scale_monster_exp，本次由 exe 反汇编裁定）：
//   diff = 怪物等级 − 角色等级
//     diff > 0 → min(over_high_factor^diff, max_cap)      跨级打怪收益指数放大，封顶 max_cap
//     diff = 0 → 1.0
//     diff < 0 → max(0, 1 − (−diff) × over_low_factor)     刷低级怪线性衰减，低 5 级即 0 经验
// 旧实现用 ratio = 角色等级/怪物等级 做阶梯（>=1.5 → 0.2；<=0.7 → 1.2）：
// 既丢了指数放大、又丢了线性衰减，且 max_cap 被 min() 吃掉变成死配置。
export function expScale(diff){
  const ms = (DATA.character || {}).monster_exp_scale || {};
  if(diff > 0) return Math.min(Math.pow(ms.over_high_factor || 1, diff), ms.max_cap || 1);
  if(diff < 0) return Math.max(0, 1 - (-diff) * (ms.over_low_factor || 0));
  return 1.0;
}
// 类型经验倍率：type_exp_tiers 按【怪物等级】每 10 级一档（原版 tier_idx=(mon_level-1)//10，越界取末档），
// 缺表/缺档时回落到 type_exp_multiplier 的基础值（= tiers 第 1 段）。
// 旧实现误用【角色等级】按 ceil(level/20) 取档：高级角色刷低级精英会白拿 1.83~4.17 倍。
export function typeExpMul(type, monLevel){
  const ch = DATA.character || {};
  const tiers = ch.type_exp_tiers && ch.type_exp_tiers[type];
  if(tiers && tiers.length){
    const t = clamp(Math.floor(((monLevel || 1) - 1) / 10) + 1, 1, tiers.length);
    const v = tiers[t - 1];
    if(typeof v === 'number' && v > 0) return v;
  }
  return (ch.type_exp_multiplier || {})[type] || 1;
}
export function monsterExp(m, playerLevel){
  const base = m.exp || 0;
  if(base <= 0) return 0;                                  // 原版：mon_exp <= 0 直接返回 0
  const scale = expScale((m.level || 1) - playerLevel);
  if(scale <= 0) return 0;                                 // 怪低 5 级以上 → 0 经验
  return Math.max(0, Math.trunc(base * scale * typeExpMul(m.type, m.level || 1)));
}

// 计算角色派生属性
// ================= 技能系统（skills_active_* / skills_passive） =================

export function jobSkills(job){ return SKILLS[job] || []; }
export function skillLvData(s, lv){          // 取技能第 lv 级数据（levels 为 0 基数组）
  const arr = s.levels || [];
  if(!arr.length) return {};
  return arr[Math.max(0, Math.min(lv-1, arr.length-1))];
}
export function skillUpgradeReq(s, curLv){   // 升到 curLv+1 的条件（requirements 索引对齐等级）
  return (s.requirements||[])[curLv] || null;
}
// 被动等级：数据未提供升级消耗，改为随角色等级自动成长（learn_level 起每 5 级 +1）
export function passiveLevel(p, ps){
  if(!(p.passives||{})[ps.key]) return 0;
  const auto = 1 + Math.floor(Math.max(0,(p.level||1)-(ps.learn_level||1))/5);
  return Math.max(1, Math.min(auto, ps.max_level||1));
}
// 达到 learn_level 自动学会技能/领悟被动
export function syncSkills(){
  const p=state.player; if(!p) return;
  if(!p.skills) p.skills={};
  if(!p.passives) p.passives={};
  if(!p.skillCd) p.skillCd={};
  for(const s of jobSkills(p.job)){
    if(p.level >= (s.learn_level||1) && !p.skills[s.key]){
      p.skills[s.key]=1;
      eventLog('学会技能 <span class="loot">'+s.name+'</span>');
    }
  }
  for(const ps of PASSIVES){
    if((ps.jobs||[]).indexOf(p.job)<0) continue;
    if(p.level >= (ps.learn_level||1) && !p.passives[ps.key]){
      p.passives[ps.key]=1;
      eventLog('领悟被动 <span class="loot">'+ps.name+'</span>');
    }
  }
}
export function upgradeSkill(key){
  const p=state.player;
  const s=jobSkills(p.job).find(x=>x.key===key);
  if(!s) return {ok:false,msg:'技能不存在'};
  const lv=p.skills[key]||0;
  if(lv<=0) return {ok:false,msg:'尚未学会该技能'};
  if(lv>=(s.max_level||1)) return {ok:false,msg:'已达最高等级'};
  const req=skillUpgradeReq(s, lv);
  if(req){
    if(p.level<(req.level||0)) return {ok:false,msg:'角色等级不足（需 Lv.'+req.level+'）'};
    if(p.gold<(req.money||0)) return {ok:false,msg:'金币不足（需 '+fmtNum(req.money||0)+'）'};
    if(p.exp<(req.exp||0)) return {ok:false,msg:'经验不足（需 '+fmtNum(req.exp||0)+'）'};
    p.gold-=req.money||0; p.exp-=req.exp||0;
  }
  p.skills[key]=lv+1;
  refreshStats();
  return {ok:true,msg:s.name+' 提升至 '+p.skills[key]+' 级'};
}
// 被动技能提供的属性加成
export function passiveBonus(p){
  const out={};
  for(const ps of PASSIVES){
    const lv=passiveLevel(p, ps);
    if(lv<=0) continue;
    const arr=ps.levels||[];
    const e = arr.length ? arr[Math.max(0,Math.min(lv-1,arr.length-1))] : (ps.effect||{});
    for(const k in e) out[k]=(out[k]||0)+e[k];
  }
  return out;
}
// 技能释放条件：不在冷却 且 MP 足够
export function canCast(s){
  const p=state.player;
  const lv=p.skills[s.key]||0; if(lv<=0) return false;
  if((p.skillCd||{})[s.key]>0) return false;
  const L=skillLvData(s, lv);
  return (p.mp||0) >= (L.mp||0);
}
// 技能冷却每回合递减
export function tickSkillCd(){
  const p=state.player; if(!p||!p.skillCd) return;
  for(const k in p.skillCd) if(p.skillCd[k]>0) p.skillCd[k]--;
  // 神魔主动技能冷却
  if(p.shenmo && p.shenmo.cd) for(const k in p.shenmo.cd) if(p.shenmo.cd[k]>0) p.shenmo.cd[k]--;
}
export function paySkill(s){
  const p=state.player;
  const lv=p.skills[s.key]||1;
  const L=skillLvData(s, lv);
  p.mp=Math.max(0,(p.mp||0)-(L.mp||0));
  p.skillCd[s.key]=L.cd!=null? L.cd : (s.cd||1);
  return L;
}
// 选一个可用的攻击类技能（伤害最高优先）
export function pickAttackSkill(){
  const p=state.player; let best=null, bestDmg=-1;
  for(const s of jobSkills(p.job)){
    const st=s.skill_type;
    if(st!=='attack'&&st!=='control') continue;
    if(!canCast(s)) continue;
    const lv=p.skills[s.key]||1;
    const d=skillLvData(s,lv).damage||0;
    if(d>bestDmg){ bestDmg=d; best=s; }
  }
  return best;
}
// 选一个可用的治疗技能
export function pickHealSkill(){
  const p=state.player; let best=null, bestV=-1;
  for(const s of jobSkills(p.job)){
    if(s.skill_type!=='heal') continue;
    if(!canCast(s)) continue;
    const lv=p.skills[s.key]||1;
    const L=skillLvData(s,lv);
    let v=0;
    for(const e of (L.effects||[])){
      if(e.type==='heal') v+=e.value||0;
      else if(e.type==='hot') v+=(e.value||0)*Math.max(1,Math.round((e.duration||1)/2));
    }
    if(v>bestV){ bestV=v; best=s; }
  }
  return best;
}
// 战斗开始时释放增益/防御类技能，加成本场战斗
export function castBattleStartBuffs(){
  const p=state.player;
  state.buff={atk:0, phys_def:0, magic_def:0};
  for(const s of jobSkills(p.job)){
    const st=s.skill_type;
    if(st!=='buff'&&st!=='defense') continue;
    if(!canCast(s)) continue;
    const L=paySkill(s);
    for(const e of (L.effects||[])){
      if(e.type==='phys_def_flat') state.buff.phys_def+=e.value||0;
      else if(e.type==='magic_def_flat') state.buff.magic_def+=e.value||0;
      else if(e.type==='phys_atk_flat'||e.type==='magic_atk_flat'||e.type==='atk_flat') state.buff.atk+=e.value||0;
    }
    log('施放 <span class="skill">'+s.name+'</span>');
  }
}
// 技能伤害（基础伤害 + 主属性 30% 加成，保证技能始终强于普攻且随成长）
export function skillDamage(s, lv){
  const p=state.player, s0=p._s;
  const L=skillLvData(s, lv);
  const main=s0.main||0;
  // 基础伤害 + 主属性 30% 加成；但至少为普攻的 1.1 倍（技能有 MP/CD 成本，应强于普攻）
  let dmg = Math.max((L.damage||0) + Math.round(main*0.3), Math.round(main*1.1));
  const ag = smAggCached();
  if(ag.dmgBonus) dmg = Math.round(dmg*(1+ag.dmgBonus/100));
  if(ag.skillDmg[s.name]!=null) dmg = Math.round(dmg*(1+ag.skillDmg[s.name]/100));
  return dmg;
}
// 对怪物应用一次伤害（含防御减伤与暴击）
// 神魔：命中追加攻击（on_hit_append），普攻与技能命中均触发
export function smAppendHit(m, def){
  const ag=smAggCached(); const s=state.player._s; let sum=0;
  for(const ap of (ag.append||[])){
    if(Math.random()*100 < (ap.prob||0)){
      const extra=Math.max(1, Math.round((s.main*(ap.pct||0)/100)*(s.main*(ap.pct||0)/100)/def));
      m.curHp-=extra; sum+=extra;
    }
  }
  if(ag.silence && Math.random()*100 < ag.silence.prob) m.silence=Math.max(m.silence||0, ag.silence.dur);
  if(ag.healReduce && Math.random()*100 < ag.healReduce.prob) m.healReduce=Math.max(m.healReduce||0, ag.healReduce.pct);
  return sum;
}
// 怪物真实防御：数据里 phys_def / magic_def 字段恒为 0（解密残留），
// 真实防御在 min/max 区间，取中值（与攻击 (min+max)/2 一致）。
export function monsterDef(m, type){
  const isMagic = type==='magic_def' || type==='magic';
  const lo = isMagic ? (m.min_magic_def||0) : (m.min_phys_def||0);
  const hi = isMagic ? (m.max_magic_def||0) : (m.max_phys_def||0);
  return lo + (hi-lo)/2;
}
export function damageMonster(m, raw){
  const p=state.player, s0=p._s;
  const v=raw*rnd(0.85,1.15);
  const def=monsterDef(m, s0.defType);
  // 原版伤害公式：max(1, round(atk²/def))；怪物完全闪避则 0 伤害
  const dodged = Math.random()*100 < (m.dodge||0);
  let dmg = dodged ? 0 : Math.max(1, Math.round((v*v/def)*titleDmgMult(m)));
  const crit = !dodged && Math.random() < (s0.combat.phys_crit||0)/100;
  const critMult=1.8 + (smAggCached().critDmg||0)/100;
  if(crit) dmg=Math.round(dmg*critMult);
  if(!dodged) m.curHp-=dmg;
  state.pendingAppend = (state.pendingAppend||0) + (dodged?0:smAppendHit(m, def));
  return {dmg, crit, dodged};
}
export function castHeal(s){
  const L=paySkill(s);
  const p=state.player;
  let heal=0;
  for(const e of (L.effects||[])){
    if(e.type==='heal') heal+=e.value||0;
    else if(e.type==='hot') heal+=(e.value||0)*Math.max(1,Math.round((e.duration||1)/2));
  }
  if(heal<=0) heal=Math.round((p._s.max_hp||100)*0.2);
  p.hp=Math.min(p._s.max_hp, p.hp+heal);
  return {heal:Math.round(heal)};
}

// ================= 武魂系统（wuhun.json） =================
export function wh(){ return DATA.wuhun || {}; }
export function whStarDef(t, star){
  const arr = (wh().stars||{})[t] || [];
  return arr[star!=null?star:0] || arr[0] || null;
}
export function whMaxLevel(t, star){ const d=whStarDef(t,star); return d? (d.max_level||10) : 10; }
export function whReqLevel(star){                       // 星级对应的角色等级要求 [60,60,70,80,90,100]
  const r=(wh().star_rules||{}).level_required||[];
  return r[star]!=null ? r[star] : 60;
}
export function whTypeName(t){ const w=(wh().wuhun_types||{})[t]; return w? w.name : t; }
export function whStarName(star){ const n=(wh().star_rules||{}).star_names||[]; return n[star]||('★'.repeat(star||0)); }
export function whName(o){ return whTypeName(o.whType)+whStarName(o.star); }
export function whItemName(key){ const it=(wh().items||{})[key]; return it? it.name : key; }

// 生成一个武魂（背包物品：type='wuhun'，不叠加）
export function genWuhun(star, type){
  star = clamp(star||0, 0, 5);
  const t = type || pick(WUHUN_TYPE_KEYS);
  return { uid:uid(), type:'wuhun', whType:t, star, level:1, exp:0,
           activated:false, actAttr:null, count:1 };
}
// 武魂当前属性：按 base→max 在 max_level 内线性插值
export function wuhunStats(o){
  const W=wh();
  const td=(W.wuhun_types||{})[o.whType]; if(!td) return {};
  const sd=whStarDef(o.whType,o.star);     if(!sd) return {};
  const stats=td.stats||[], base=sd.base||[], mx=sd.max||[];
  const maxLv=sd.max_level||10;
  const k = maxLv>1 ? clamp((o.level-1)/(maxLv-1),0,1) : 0;
  const out={};
  for(let i=0;i<stats.length;i++) out[stats[i]] = Math.round((base[i]||0) + ((mx[i]||0)-(base[i]||0))*k);
  return out;
}
// 升到下一级所需经验：ceil(coef_by_star[star] * level^power)
export function wuhunExpNeed(o){
  const f=wh().exp_formula||{power:2.4,coef_by_star:[64701]};
  const c=(f.coef_by_star||[])[o.star]||f.coef_by_star[0]||64701;
  return Math.ceil(c * Math.pow(o.level, f.power||2.4));
}
// 佩戴后杀怪吸经验：双槽各 50% 角色经验，满级停吸
export function wuhunAbsorb(charExp){
  const p=state.player; if(!p||!p.wuhunSlots) return;
  for(const o of p.wuhunSlots){
    if(!o) continue;
    const maxLv=whMaxLevel(o.whType,o.star);
    if(o.level>=maxLv){ o.exp=0; continue; }
    o.exp += charExp*0.5*WUHUN_EXP_MULT;
    let up=false;
    while(o.level<maxLv && o.exp>=wuhunExpNeed(o)){ o.exp-=wuhunExpNeed(o); o.level++; up=true; }
    if(o.level>=maxLv){
      o.exp=0;
      if(up) eventLog('<span class="lv">武魂 '+whName(o)+' 修炼圆满（'+maxLv+' 级），可进化升星</span>');
    }else if(up) eventLog('武魂 <span class="loot">'+whName(o)+'</span> 升至 '+o.level+' 级');
  }
}
// 潜能激活：消耗对应星级启魂符，附加一条随机激活属性
export function wuhunActivate(o){
  const W=wh();
  if(!o) return {ok:false,msg:'武魂不存在'};
  if(o.activated) return {ok:false,msg:'该武魂已激活'};
  const p=state.player;
  const item='lingyin_'+o.star;
  if((p.materials[item]||0)<1) return {ok:false,msg:'缺少材料：'+whItemName(item)+' x1'};
  const sd=whStarDef(o.whType,o.star);
  const pool=(sd&&sd.attr_pool)||[];
  const name = pool.length? pick(pool) : 'phys_atk';
  const cat = WUHUN_ATTR_CAT[name]||'atk_flat';
  const rg = ((W.star_rules||{}).attr_value_ranges||{})[cat];
  const r = rg ? (rg[''+o.star]||rg['0']) : [1,1];
  p.materials[item] = (p.materials[item]||0)-1;
  o.activated=true; o.actAttr={ name, value: ri(r[0],r[1]) };
  return {ok:true,msg:'激活成功，附加 '+(W.attr_labels[name]||name)+' +'+o.actAttr.value};
}
// 武魂进化：两个满级同类型同星级 + 目标星级化星诀 → 高一级 0 级未激活武魂
export function wuhunEvolve(uidA, uidB){
  const p=state.player;
  const a=p.bag.find(b=>b.uid===uidA), b2=p.bag.find(b=>b.uid===uidB);
  if(!a||!b2||a===b2) return {ok:false,msg:'需要两个不同的武魂'};
  if(a.type!=='wuhun'||b2.type!=='wuhun') return {ok:false,msg:'只能选择武魂'};
  if(a.whType!==b2.whType||a.star!==b2.star) return {ok:false,msg:'需两个同类型、同星级武魂'};
  const maxLv=whMaxLevel(a.whType,a.star);
  if(a.level<maxLv||b2.level<maxLv) return {ok:false,msg:'需两个均修炼圆满（'+maxLv+' 级）'};
  if(a.star>=5) return {ok:false,msg:'已达最高星级'};
  const item='niepan_'+(a.star+1);
  if((p.materials[item]||0)<1) return {ok:false,msg:'缺少材料：'+whItemName(item)+' x1'};
  const newStar=a.star+1;
  if(p.level < whReqLevel(newStar)) return {ok:false,msg:'角色等级不足，佩戴 '+newStar+'★ 需 Lv.'+whReqLevel(newStar)};
  p.materials[item]=(p.materials[item]||0)-1;
  const nw=genWuhun(newStar, a.whType);
  p.bag = p.bag.filter(b=>b.uid!==uidA && b.uid!==uidB);
  p.bag.push(nw);
  return {ok:true,msg:'进化成功，获得 '+whName(nw)+'（0 级未激活）', item:nw};
}
// 武魂融合：两个已激活武魂 + 融魂令 → 激活属性重组
export function wuhunFuse(uidA, uidB){
  const p=state.player;
  const a=p.bag.find(b=>b.uid===uidA), b2=p.bag.find(b=>b.uid===uidB);
  if(!a||!b2||a===b2) return {ok:false,msg:'需要两个不同的武魂'};
  if(a.type!=='wuhun'||b2.type!=='wuhun') return {ok:false,msg:'只能选择武魂'};
  if(!a.activated||!b2.activated) return {ok:false,msg:'需两个均已激活的武魂'};
  const item='mingqi_'+Math.max(a.star,b2.star);
  if((p.materials[item]||0)<1) return {ok:false,msg:'缺少材料：'+whItemName(item)+' x1'};
  p.materials[item]=(p.materials[item]||0)-1;
  for(const o of [a,b2]){
    const sd=whStarDef(o.whType,o.star), pool=(sd&&sd.attr_pool)||[];
    const name=pool.length?pick(pool):'phys_atk';
    const cat=WUHUN_ATTR_CAT[name]||'atk_flat';
    const rg=((wh().star_rules||{}).attr_value_ranges||{})[cat];
    const r=rg?(rg[''+o.star]||rg['0']):[1,1];
    o.actAttr={name, value: ri(r[0],r[1])};
  }
  return {ok:true,msg:'融合完成，两个武魂的激活属性已重组'};
}
// 武魂湮灭：解除激活状态
export function wuhunAnnihilate(o){
  if(!o||o.type!=='wuhun') return {ok:false,msg:'武魂不存在'};
  if(!o.activated) return {ok:false,msg:'该武魂未激活'};
  o.activated=false; o.actAttr=null;
  return {ok:true,msg:'已解除激活状态'};
}
// 武魂回收：按 recycle_price 折算为神秘结晶
export function wuhunRecycleValue(o){
  const rp=wh().recycle_price||{base:[5,15,40,100,250,600],activated_bonus:1.5,level_bonus_per:0.1};
  const base=(rp.base||[])[o.star]||5;
  return Math.round(base*(o.activated?(rp.activated_bonus||1.5):1)*(1+o.level*(rp.level_bonus_per||0.1)));
}
export function wuhunRecycle(o){
  if(!o||o.type!=='wuhun') return {ok:false,msg:'武魂不存在'};
  const v=wuhunRecycleValue(o);
  state.player.crystal=(state.player.crystal||0)+v;
  state.player.bag=state.player.bag.filter(b=>b.uid!==o.uid);
  return {ok:true,msg:'已回收，获得神秘结晶 +'+v};
}
// 佩戴 / 卸下（双槽）
export function equipWuhun(o, slot){
  const p=state.player;
  if(!p.wuhunSlots) p.wuhunSlots=[null,null];
  if(slot==null) slot = p.wuhunSlots[0]? (p.wuhunSlots[1]?0:1) : 0;
  const req=whReqLevel(o.star);
  if(p.level<req) return {ok:false,msg:'佩戴 '+o.star+'★ 武魂需角色 Lv.'+req};
  const old=p.wuhunSlots[slot];
  p.wuhunSlots[slot]=o;
  p.bag=p.bag.filter(b=>b.uid!==o.uid);
  if(old) p.bag.push(old);
  return {ok:true,msg:'已佩戴 '+whName(o)+' 于槽位'+(slot+1)};
}
export function unequipWuhun(slot){
  const p=state.player; if(!p.wuhunSlots) return {ok:false,msg:'未佩戴'};
  const o=p.wuhunSlots[slot]; if(!o) return {ok:false,msg:'槽位为空'};
  p.wuhunSlots[slot]=null; p.bag.push(o);
  return {ok:true,msg:'已卸下 '+whName(o)};
}

// ================= 神魔修验（shenmo.json） =================
export function sm(){ return DATA.shenmo || {}; }
export function smTransform(lv){                       // 按修验等级取当前变身阶位
  const arr=sm().transform_levels||[]; let cur=null;
  for(const t of arr) if(lv>=(t.min_level||1)) cur=t;
  return cur;
}
export function smExpNeed(lv){
  const c=(sm().level||{}).exp_curve||[];
  return c[lv]!=null ? c[lv] : Math.ceil(1200*Math.pow(lv,2));
}
export function smMaxLevel(){ return (sm().level||{}).max || 100; }
export function smTitle(faction, lv){
  const t=smTransform(lv); if(!t) return '';
  const job=(state.player&&state.player.job)||'';
  if(faction==='mo'){
    if(job==='shaman'&&t.title_mo_shaman) return t.title_mo_shaman;
    if(job==='darkwitch'&&t.title_mo_darkwitch) return t.title_mo_darkwitch;
    return t.title_mo||'';
  }
  if(job==='shaman'&&t.title_shen_shaman) return t.title_shen_shaman;
  if(job==='darkwitch'&&t.title_shen_darkwitch) return t.title_shen_darkwitch;
  return t.title_shen||'';
}
export function smTier(spent){
  const arr=sm().tiers||[]; let cur=arr[0]||{tier:1,name:'一档',points_per_level:1};
  for(const t of arr) if(spent>=(t.spent_required||0)) cur=t;
  return cur;
}
// 入道（选阵营）
export function smJoin(faction){
  const p=state.player;
  const need=(sm().entry||{}).min_char_level||101;
  if(p.level<need) return {ok:false,msg:'入道需角色 Lv.'+need+'（当前 Lv.'+p.level+'）'};
  if(p.shenmo&&p.shenmo.faction) return {ok:false,msg:'已入'+(p.shenmo.faction==='shen'?'神':'魔')+'道'};
  p.shenmo={ faction, level:1, exp:0, spent:0, points:1, nodes:{}, cd:{} };
  return {ok:true,msg:'入道成功：'+((sm().factions||{})[faction]||{}).name};
}
// 修验值增长（挂机获得，按角色经验比例）
export function smGain(charExp){
  const s=state.player.shenmo; if(!s||!s.faction) return;
  const maxLv=smMaxLevel();
  if(s.level>=maxLv) return;
  s.exp += charExp*0.25;
  let up=false;
  while(s.level<maxLv && s.exp>=smExpNeed(s.level)){ s.exp-=smExpNeed(s.level); s.level++; up=true; }
  if(up){
    s.points=(s.points||0)+ (smTier(s.spent||0).points_per_level||1);
    eventLog('修验等级提升至 <span class="lv">'+s.level+'</span>，称号：'+smTitle(s.faction,s.level));
  }
}

// 仙之境（shenmo.json#xianzhijing）：安全区被动修验，按滞留 tick 结算，每日上限 60 分钟，24:00 重置
export const XIANZHI_TICKS_PER_MIN = 86;   // loop 700ms → 60000/700≈85.7，取整
export function curMapKey(){ return (state.zone && state.zone.mapKey) || (state.player && state.player.map) || null; }
export function xzCfg(){ return sm().xianzhijing || {}; }
export function xzRatePerMin(level){
  const arr=(xzCfg().per_min_exp||[]); let r=0;
  for(const t of arr) if(level>=(t.min_level||1)) r=t.per_min;
  return r||0;
}
export function xzCapMin(){ return xzCfg().daily_minutes || 60; }
export function xzDailyReset(s){
  const d=todayKey();
  if(s.xz_date!==d){ s.xz_date=d; s.xz_min=0; s.xz_frac=0; }
}
export function isXianzhiNow(){ return curMapKey()==='xianzhijing'; }
// 每 tick 结算（loop 700ms）：把「每分钟」修验值摊到每 tick
export function smXianzhiTick(){
  const p=state.player, s=p.shenmo; if(!s||!s.faction) return;
  if(s.level>=smMaxLevel()) return;
  xzDailyReset(s);
  if((s.xz_min||0) >= xzCapMin()) return;
  const rate=xzRatePerMin(s.level); if(rate<=0) return;
  const perTick=rate/XIANZHI_TICKS_PER_MIN;
  s.xz_min=Math.min(xzCapMin(), (s.xz_min||0)+(1/XIANZHI_TICKS_PER_MIN));
  s.xz_exp_total=(s.xz_exp_total||0)+perTick;
  s.exp+=perTick;
  let up=false;
  while(s.level<smMaxLevel() && s.exp>=smExpNeed(s.level)){ s.exp-=smExpNeed(s.level); s.level++; up=true; }
  if(up){
    s.points=(s.points||0)+(smTier(s.spent||0).points_per_level||1);
    eventLog('【仙之境】修验等级提升至 <span class="lv">'+s.level+'</span>，称号：'+smTitle(s.faction,s.level));
  }
}
// 直接结算 minutes 分钟（测试/补领用，最多到当日上限）
export function smXianzhiAddMinutes(mins){
  const p=state.player, s=p.shenmo; if(!s||!s.faction) return 0;
  xzDailyReset(s);
  const left=xzCapMin()-(s.xz_min||0); if(left<=0) return 0;
  const use=Math.min(mins,left), rate=xzRatePerMin(s.level), gained=rate*use;
  s.xz_min=(s.xz_min||0)+use;
  s.xz_exp_total=(s.xz_exp_total||0)+gained;
  s.exp+=gained;
  let up=false;
  while(s.level<smMaxLevel() && s.exp>=smExpNeed(s.level)){ s.exp-=smExpNeed(s.level); s.level++; up=true; }
  if(up) s.points=(s.points||0)+(smTier(s.spent||0).points_per_level||1);
  return gained;
}

