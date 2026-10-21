/* ===== 模块 equip.js —— 装备生成（buildEquip/耐久/双手）+ 掉落 rollLoot =====
 * 来源：game.js L1389-1615（2026-10-21 模块化切分，内容逐字节保留）
 * 导出 16 个顶层名；import 由 AST 跨模块引用自动计算。
 */
import { state } from './state.js';
import { BASE_BY_KEY, CAT_SLOT, DATA, JOB_BASES, LOOT, SLOT_CAT, clamp, pick, ri, uid } from './core.js';
import { weightedPick } from './life.js';

// ---------- 装备生成 ----------
export function tierFromLevel(lv){
  return clamp(1 + Math.floor((lv-5)/15), 1, 7);
}
export function qualityFromPerks(n){
  const t = DATA.quality.quality_thresholds;
  for(const th of t) if(n >= th.min_perks) return th.quality;
  return 'white';
}
export const QNAME = {white:'白板',green:'绿色',blue:'蓝色',purple:'紫色',gold:'橙色',red:'红色'};

// 词条数量上限：放宽到可出紫/橙（原 tier_perk_max 恒为 3，最高仅蓝）。
// 高档装备天花板更高，且分层掷骰保证低品质仍占多数（稀有度高）。
export const PERK_CAP = {1:6, 2:7, 3:8, 4:9, 5:9, 6:9, 7:9};
export function rollPerkCount(tier){
  const cap = PERK_CAP[tier] || 4;
  const r = Math.random();
  let lo=0, hi=3;
  if(r<0.60)      { lo=0; hi=3; }                         // 多数 0~3（白/绿/蓝）
  else if(r<0.85) { lo=4; hi=Math.min(5,cap); }           // 4~5（蓝/紫）
  else if(r<0.97) { lo=6; hi=Math.min(7,cap); }           // 6~7（紫/金）
  else            { lo=Math.min(8,cap); hi=cap; }         // 8~cap（金/红）
  if(lo>hi) hi=lo;
  return ri(lo, hi);
}
export function rollPerks(tier, job, mode){
  const pool = DATA.perk_pool[job+'_general_pool'] || DATA.perk_pool['warrior_general_pool'];
  if(!pool) return [];
  // 生成模式（modes.json）：限定词条类别与数量
  const cats = ((DATA.modes||{}).mode_categories||{})[mode||''] || null;
  let groups = ['stat_fixed','stat_percent','atk_fixed','atk_percent','elemental'];
  if(cats) groups = (cats.length? cats : []);
  if(mode==='whiteboard') return [];
  let all = [];
  for(const g of groups) all = all.concat(pool[g]||[]);
  if(!all.length) all = (pool.stat_fixed||[]).concat(pool.stat_percent||[], pool.atk_fixed||[]);
  if(!all.length) return [];
  let n;
  if(mode==='full_perk') n = PERK_CAP[tier] || 4;             // 满词条
  else n = rollPerkCount(tier);
  const perks = [];
  for(let i=0;i<n;i++){
    const sf = pick(all);
    const vals = sf.values[''+tier] || sf.values['1'] || [1,1];
    perks.push({name:sf.name, suffix:sf.suffix||'', value: ri(vals[0], vals[1])});
  }
  return perks;
}
// 从具体 base 对象构建一件装备（商店/兑换/掉落共用）
export function buildEquip(base, job, tier, slot, mode){
  tier = clamp(tier,1,7);
  const stats = {};
  for(const f in (base.stats||{})){
    const rg = base.stats[f];
    stats[f] = ri(rg[0], rg[1]);
  }
  const perks = rollPerks(tier, job, mode);
  const quality = qualityFromPerks(perks.length);
  return {
    type:'equip', uid: uid(), slot, job, tier, name: base.name, reqLevel: base.req_level||1,
    hand: base.hand || '',   // 单手/双手（战士 7 把双手武器；原版 is_two_hand 判定源）
    durability: baseDurability(base, slot),   // 耐久（null=该部位无耐久；原版打造 roll + 精炼 ×1.04/级；无消耗）
    stats, perks, quality, refine:0, sockets: base.sockets||0, bailian:0,
    gems: new Array(base.sockets||0).fill(null), baseKey: base.key
  };
}
// 耐久（原版 craft.py：打造时 stat_roller.roll_durability(base) 产出标量；
// 解密数据 292 个基底 durability 全部为 [n,n] 等值对 → roll_lo~roll_hi 区间退化为单点，结果恒为 n，
// 直接取 [0] 即零随机零臆造；原版无耐久消耗/修理/损坏机制，精炼按 refine_durability_pct 每级复合提升）
// 部位门控（slots.json#has_durability）：项链/戒指为 false → 无耐久。原版存档序列化对无耐久装备
// 回落 [0,0]（battle.py L2505 it.get('durability',[0,0])），本 port 以「不设字段」等价表达
export function slotHasDurability(slot){
  const raw=(DATA.slots||{}).slots;
  const arr=Array.isArray(raw)? raw : (raw? Object.keys(raw).map(k=>raw[k]) : []);
  const d=arr.find(x=>x && x.key===slot);
  return !!(d && d.has_durability);
}
export function baseDurability(base, slot){
  if(!slotHasDurability(slot)) return null;      // 首饰无耐久（slots.json 门控）
  const du=base&&base.durability;
  if(Array.isArray(du)&&du.length) return du[0]|0;
  if(typeof du==='number') return du|0;
  return 25;   // 原版默认区间 [25,35] 的下限（实际数据无缺失，仅兜底）
}
// 旧存档装备补 durability（2026-10-21 接入）：原版 craft.py roll 产出，本 port 此前未接。
// 已精炼过的旧装备按原版口径补回精炼增益（每级 int(d×(1+pct)) 复合），保证与后续精炼连续
export function backfillDurability(){
  const p=state.player; if(!p) return 0;
  const pct=(DATA.refine&&DATA.refine.refine_durability_pct)||0;
  let n=0;
  const fix=(it)=>{
    if(!it || it.type!=='equip' || it.durability!=null) return;
    if(!slotHasDurability(it.slot)) return;      // 首饰无耐久（slots.json 门控），不补
    const b=it.baseKey&&BASE_BY_KEY[it.baseKey];
    let d=b? baseDurability(b, it.slot) : 25;
    for(let i=0;i<(it.refine||0);i++) d=Math.floor(d*(1+pct));
    it.durability=d; n++;
  };
  for(const sl in p.equip) fix(p.equip[sl]);
  for(const it of (p.bag||[])) fix(it);
  return n;
}
// 按「需求等级最接近参考等级」挑基底；部位无基底时回退到该职业能生成的部位，保证一定出货
export function pickBase(slot, job, refLevel, maxReq){
  refLevel = refLevel||1;
  const src = JOB_BASES[job] || DATA.bases_warrior;
  const tryCat = (cat, limit)=>{
    let list = src[cat];
    if((!list || !list.length) && (cat==='rings'||cat==='necklaces')) list = DATA.bases_accessory[cat];
    if(!list || !list.length) return null;
    let cand = list;
    if(limit!=null){
      cand = list.filter(b=>(b.req_level||0)<=limit);
      if(!cand.length) return null;
    }
    // req_level 最接近参考等级；并列时取需求更低的（保证穿得上）
    return cand.slice().sort((a,b)=>{
      const da=Math.abs((a.req_level||0)-refLevel), db=Math.abs((b.req_level||0)-refLevel);
      return da-db || (a.req_level||0)-(b.req_level||0);
    })[0];
  };
  const cat = SLOT_CAT[slot] || 'armors';
  const order=['armors','weapons','helmets','pants','shoes','gloves','belts','cloaks','shoulders','shields','necklaces','rings'];
  let base = tryCat(cat, maxReq);                 // ①同部位且满足需求上限
  if(base) return {base, slot};
  if(maxReq!=null){                                // ②其他部位找满足上限的（法师无低级护肩→改掉别的能穿的部位）
    const cands=[];
    for(const c of order){ const b=tryCat(c, maxReq); if(b) cands.push({b, c}); }
    if(cands.length){
      cands.sort((x,y)=>Math.abs((x.b.req_level||0)-refLevel)-Math.abs((y.b.req_level||0)-refLevel));
      const win = cands[Math.floor(Math.random()*Math.min(3, cands.length))];
      return {base:win.b, slot: CAT_SLOT[win.c] || 'armor'};
    }
  }
  base = tryCat(cat, null);                        // ③同部位不设限
  if(base) return {base, slot};
  for(const c of order){                           // ④兜底：任意有基底的部位
    const b = tryCat(c, null);
    if(b) return {base:b, slot: CAT_SLOT[c] || 'armor'};
  }
  return null;
}
export function genEquip(slot, job, tier, refLevel, maxReq){
  const r = pickBase(slot, job, refLevel, maxReq);
  if(!r) return null;
  return buildEquip(r.base, job, r.base.tier || tier || 1, r.slot);
}
// 掉落装备：优先按怪物等级取；若需求等级远超玩家（如法师无低级护肩/项链），
// 退而按玩家等级取一件当前穿得上的（必要时回退到有基底的部位），避免掉落一堆废装
export function genEquipWithFallback(slot, job, m, p){
  const refLevel = Math.max(m.level, (p.level||1) - 5);
  let it = genEquip(slot, job, tierFromLevel(m.level), refLevel);
  if(it && it.reqLevel > p.level + 8){
    const it2 = genEquip(slot, job, tierFromLevel(p.level), p.level, p.level + 8);
    if(it2) it = it2;   // 同部位无低级基底时，pickBase 会回退到玩家能穿的其他部位
  }
  return it;
}
// 商店神秘商人：按部位+职业取对应基底
export function genEquipBaseForSlot(slot, job, tier){
  let src = JOB_BASES[job] || DATA.bases_warrior;
  let cat = SLOT_CAT[slot] || 'armors';
  let list = src[cat];
  if((!list || !list.length) && (cat==='rings'||cat==='necklaces')) list = DATA.bases_accessory[cat];
  if(!list || !list.length) return null;
  return list.filter(b=>b.tier===tier).sort((a,b)=>a.req_level-b.req_level)[0]
      || list.slice().sort((a,b)=>Math.abs(a.tier-tier)-Math.abs(b.tier-tier))[0];
}
export function jobFromBaseKey(k){
  if(k.startsWith('base_warrior')) return 'warrior';
  if(k.startsWith('base_mage')) return 'mage';
  if(k.startsWith('base_shaman')) return 'shaman';
  if(k.startsWith('base_darkwitch')) return 'darkwitch';
  if(k.startsWith('base_accessory')) return 'accessory';
  return null;
}

// ---------- 掉落 ----------
export function rollLoot(m, p){
  const drops = [];
  // 金币（怪物固定区间，gold 类型的掉落表项跳过以避免重复）
  const gold = ri(m.gold_min||0, m.gold_max||0);
  if(gold>0) drops.push({type:'gold', value:gold});
  // 装备：按怪物类型多次掷骰（loot_probs）
  const lp = DATA.loot_probs[m.type] || DATA.loot_probs.normal;
  const equipTables = [];
  for(const key of (m.loot_table||[])){
    const t = LOOT[key];
    if(!t) continue;
    for(const d of (t.drops||[])) if(d.item==='equip') equipTables.push(d);
  }
  for(let i=0;i<(lp.rolls||1);i++){
    const prob = (lp.probs&&lp.probs[i]!=null)?lp.probs[i]:0.01;
    if(Math.random()<prob && equipTables.length){
      const e = pick(equipTables);
      const job = e.job && JOB_BASES[e.job] ? e.job : p.job;
      const it = genEquipWithFallback(e.slot, job, m, p);
      if(it) drops.push({type:'equip', item:it});
    }
  }
  // 其余掉落（宝石 / 药水 / 道具 / 武魂 / 宝匣）
  for(const key of (m.loot_table||[])){
    const t = LOOT[key];
    if(!t) continue;
    for(const d of (t.drops||[])){
      if(d.item==='equip'||d.item==='gold') continue;
      if(Math.random()<(d.prob||0)){
        if(d.item==='consumable') drops.push({type:'consumable', key:d.key, count:d.count||1});
        else if(d.item==='gem'){
          const parts=(d.key||'').split('_'); const grade=parts.pop(); const series=parts.join('_');
          drops.push({type:'gem', series, grade, count:d.count||1});
        }
        else if(d.item==='wuhun') drops.push({type:'wuhun', stars: ri(d.star_min||0, d.star_max||0), count:d.count||1});
      }
    }
  }
  // 矿石掉落（生活技能材料来源）：按权重随机一种，数量随怪物等级提升
  const ow = DATA.ores && DATA.ores.ore_gen_weights;
  if(ow && Math.random()<0.6){
    const rk = weightedPick(Object.keys(ow), ow);
    const amt = ri(1, 2+Math.floor(m.level/8));
    p.ores[rk]=(p.ores[rk]||0)+amt;
    drops.push({type:'ore', key:rk, count:amt});
  }
  return drops;
}

