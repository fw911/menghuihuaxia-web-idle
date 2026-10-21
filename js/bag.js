/* ===== 模块 bag.js —— 背包/装备操作（叠加/整理/自动换装/双手互斥） =====
 * 来源：game.js L1999-2161（2026-10-21 模块化切分，内容逐字节保留）
 * 导出 14 个顶层名；import 由 AST 跨模块引用自动计算。
 */
import { state } from './state.js';
import { DATA, ORE_BY_TIER, ORE_NAME, SLOT_NAME, uid } from './core.js';
import { refreshStats } from './smtree.js';
import { eventLog, log, renderHeader } from './render.js';
import { renderTab } from './tabs.js';
import { addOre } from './life.js';

// ---------- 背包 / 装备 ----------
export function addToBag(item){
  const p = state.player;
  // 装备每件属性独立，不叠加
  if(item.type==='equip'){
    if(item.uid==null) item.uid = uid();
    p.bag.push(item);
    trimBag();
    return;
  }
  // 武魂每件独立（类型/星级/等级/激活状态各异），不叠加
  if(item.type==='wuhun'){
    if(item.uid==null) item.uid = uid();
    p.bag.push(item);
    trimBag();
    return;
  }
  // 可叠加物品：消耗品 / 宝石 / 矿石 按标识合并，避免背包被同类刷屏
  if(item.count==null) item.count = 1;
  if(item.uid==null) item.uid = uid();
  const sig = stackSig(item);
  const ex = p.bag.find(b=> b.type!=='equip' && stackSig(b)===sig);
  if(ex){ ex.count = (ex.count||1) + item.count; return; }
  p.bag.push(item);
  trimBag();
}
// 相同物品判定（用于背包叠加；装备不叠加）
export function stackSig(it){
  if(it.type==='consumable') return 'c|'+it.key;
  if(it.type==='gem')       return 'g|'+it.series+'|'+it.grade;
  if(it.type==='wuhun')     return 'x|'+it.uid;   // 武魂不叠加
  if(it.type==='ore')       return 'o|'+it.key;
  return 'x|'+it.uid;
}
// 堆叠物品扣减数量（扣到 0 自动移除），供镶嵌/使用调用
export function decStack(it, n){
  const p=state.player;
  it.count = (it.count||1) - n;
  if(it.count<=0) p.bag = p.bag.filter(b=>b.uid!==it.uid);
}
// 装备战力评分：用于背包排序与超限淘汰（装备词条各不相同，不做叠加）
export function equipScore(it){
  let s=0;
  for(const k in (it.stats||{})) s += it.stats[k]||0;
  for(const pk of (it.perks||[])) s += (pk.value||0)*1.5;
  for(const g of (it.gems||[])) if(g) s += (g.value||0);
  s += (it.refine||0)*20 + (it.bailian||0)*60;
  return Math.round(s);
}
// 整理背包：合并同类可叠加物（兼容旧存档），并排序
export function consolidateBag(){
  const p=state.player; if(!p||!p.bag) return 0;
  const map=new Map(); const equips=[]; let merged=0;
  for(const it of p.bag){
    if(it.type==='equip'){ equips.push(it); continue; }
    if(it.count==null) it.count=1;
    const sig=stackSig(it);
    if(map.has(sig)){ map.get(sig).count += it.count; merged++; }
    else map.set(sig, it);
  }
  const order={consumable:0,gem:1,ore:2,wuhun:3,material:4};
  p.bag = Array.from(map.values()).concat(equips);
  p.bag.sort((a,b)=>{
    const oa=order[a.type]!=null?order[a.type]:9, ob=order[b.type]!=null?order[b.type]:9;
    if(oa!==ob) return oa-ob;
    if(a.type==='equip'&&b.type==='equip') return equipScore(b)-equipScore(a);
    return String(stackSig(a)).localeCompare(String(stackSig(b)));
  });
  return merged;
}
// 背包超限：优先丢弃评分最低的白/绿装，避免误删高价值物品
export const BAG_CAP = 300;
export function trimBag(){
  const p=state.player; if(!p||!p.bag) return;
  if(p.bag.length<=BAG_CAP) return;
  const equipped=new Set();
  for(const s in p.equip) if(p.equip[s]) equipped.add(p.equip[s].uid);
  const victims=p.bag
    .filter(b=> b.type==='equip' && !equipped.has(b.uid) && (b.quality==='white'||b.quality==='green') && !(b.refine>0) && !(b.bailian>0))
    .sort((a,b)=>equipScore(a)-equipScore(b));
  let i=0;
  while(p.bag.length>BAG_CAP && i<victims.length){ p.bag=p.bag.filter(b=>b.uid!==victims[i].uid); i++; }
  if(p.bag.length>BAG_CAP) p.bag.splice(0, p.bag.length-BAG_CAP);
}
// 一键分解白/绿装（未装备、未强化），回收矿石与宝石
// quiet=true 供挂机循环自动调用：只记一行日志，不重渲染右侧面板，返回分解件数
export function autoExtractJunk(quiet){
  const p=state.player;
  const equipped=new Set(); for(const s in p.equip) if(p.equip[s]) equipped.add(p.equip[s].uid);
  const junk=p.bag.filter(b=> b.type==='equip' && (b.quality==='white'||b.quality==='green')
    && !equipped.has(b.uid) && !(b.refine>0) && !(b.bailian>0));
  if(!junk.length){ if(!quiet) log('<span class="sys">背包中没有可分解的白/绿装备。</span>'); return 0; }
  const gain={};
  for(const it of junk){
    for(const g of (it.gems||[])) if(g) addToBag({type:'gem', series:g.series, grade:g.grade, count:1});
    const ok=ORE_BY_TIER[(it.tier||1)-1]; const amt=DATA.extract.ore_per_equip||1;
    addOre(ok, amt); gain[ok]=(gain[ok]||0)+amt;
  }
  const ids=new Set(junk.map(j=>j.uid));
  p.bag=p.bag.filter(b=>!ids.has(b.uid));
  const gs=Object.keys(gain).map(k=>ORE_NAME[k]+'x'+gain[k]).join('、');
  log('<span class="loot">'+(quiet?'自动':'')+'分解 '+junk.length+' 件白/绿装备，回收 '+gs+'</span>');
  if(!quiet){ renderHeader(); renderTab(); }
  return junk.length;
}
// 挂机自动分解：包裹达到阈值即回收白/绿装，避免超过 BAG_CAP(300) 后被 trimBag 静默丢弃
export const AUTO_SALVAGE_AT = 200;
export function maybeAutoSalvage(){
  if(!state.auto.junk) return 0;
  const p=state.player; if(!p||!p.bag) return 0;
  if(p.bag.length < AUTO_SALVAGE_AT) return 0;
  return autoExtractJunk(true);
}
export function tryAutoEquip(item){
  const p = state.player;
  if(item.reqLevel > p.level) return; // 等级不足不自动穿
  const cur = p.equip[item.slot];
  if(!cur){ equipItem(item); return; }
  // 比较主属性总和
  const sum = it=> Object.values(it.stats||{}).reduce((a,b)=>a+b,0) + (it.perks||[]).reduce((a,b)=>a+b.value,0);
  if(sum(item) > sum(cur)){
    equipItem(item);
    eventLog('自动换装 <span class="q-'+item.quality+'">'+item.name+'</span>（'+SLOT_NAME[item.slot]+'）');
  }
}
// 是否双手武器（原版 character/equipment.py is_two_hand 反汇编：
//   getattr(equip,'hand','') in ('double','双手') —— 双手武器占用武器+盾牌两个槽位）
export function isTwoHand(it){ return !!it && (it.hand === 'double' || it.hand === '双手'); }
// 当前武器是否双手（原版 char.js weaponIsTwoHand）
export function weaponIsTwoHand(){
  const p = state.player;
  return !!p && isTwoHand(p.equip && p.equip.weapon);
}
export function equipItem(item){
  const p = state.player;
  // 等级门控（原版 character/equipment.py equip_item L195-196 反汇编：
  //   character.level < getattr(equip,'level_required',0)
  //     → {'success':False,'msg':f'等级不足，需要 {equip.level_required} 级才能穿戴'}
  //   原版前端 char.js wearSlot 亦按 (!it.level_required || charData.level>=it.level_required) 过滤候选；
  //   自动换装 tryAutoEquip 早有同口径判断，此处补上手动装备路径）
  if((item.reqLevel||0) > p.level){
    log('<span class="dmg">等级不足，需要 '+(item.reqLevel||0)+' 级才能穿戴</span>');
    return false;
  }
  // 职业门控（原版 L200-202：job_key 不符且非首饰 → '职业不符，该装备需要 X'；
  //   _JEWELRY_SLOT_NAMES={'戒指','项链'} 豁免；job_key 缺失默认 'warrior'）
  const ejob = item.job || 'warrior';
  // 首饰（项链 / 戒指任意槽）豁免职业门控：原版 _JEWELRY_SLOT_NAMES={'戒指','项链'}，
  // 背包内戒指 slot 为 'ring'，装备后才落到 ring1/ring2，故两种 key 都豁免
  const isJewelry = item.slot==='necklace' || item.slot==='ring' || item.slot==='ring1' || item.slot==='ring2';
  if(ejob && ejob!==p.job && !isJewelry){
    const jn=(DATA.jobs.jobs.find(j=>j.key===ejob)||{}).name||ejob;
    log('<span class="dmg">职业不符，该装备需要 '+jn+'</span>');
    return false;
  }
  // 找空位（戒指有两个）
  let slot = item.slot;
  if(slot==='ring'){ slot = p.equip.ring1? (p.equip.ring2?'ring1':(p.equip.ring1?'ring2':'ring1')) : 'ring1'; }
  if(item.slot!==slot) item.slot = slot;
  // 双手武器互斥规则（原版 equip_item 反汇编，自动卸下放回背包而非硬拦截）：
  //   装备盾牌时若已持双手武器 → 自动卸下武器（已自动卸下双手武器 [name] 放回背包）
  //   装备双手武器时若已持盾牌 → 自动卸下盾牌（已自动卸下盾牌 [name] 放回背包）
  if(slot==='shield' && weaponIsTwoHand()){
    const w = p.equip.weapon;
    delete p.equip.weapon;
    if(w) p.bag.push(w);
    log('已自动卸下双手武器 ['+(w&&w.name)+'] 放回背包');
  }else if(slot==='weapon' && isTwoHand(item)){
    const sh = p.equip.shield;
    if(sh){
      delete p.equip.shield;
      p.bag.push(sh);
      log('已自动卸下盾牌 ['+sh.name+'] 放回背包');
    }
  }
  const old = p.equip[slot];
  p.equip[slot] = item;
  p.bag = p.bag.filter(b=>b.uid!==item.uid);
  if(old) p.bag.push(old);
  refreshStats();
  renderHeader(); renderTab();
}

