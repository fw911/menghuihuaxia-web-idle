/* ===== 模块 quest.js —— 修验任务（炼丹产线：接取/材料/炼丹/提交/强化/导师考验） =====
 * 来源：game.js L928-1109（2026-10-21 模块化切分，内容逐字节保留）
 * 导出 30 个顶层名；import 由 AST 跨模块引用自动计算。
 */
import { state } from './state.js';
import { sm } from './player.js';
import { addToBag } from './bag.js';
import { todayKey } from './world.js';
import { itemName } from './shop.js';
import { itemConsume, itemCount } from './life.js';

// ============ 修验任务（炼丹产线，shenmo.json#quest，设计文档 §7.1） ============
// 原版是「神魔修验」的委托/炼丹产线，配置完整但此前零引用（刻意留白的功能缺口）。本实现按配置还原：
//   · 修验任务：接取随机品阶（按 grades.weight 加权，4A/5A 受 refresh.boost 影响）→ 扣修验经验 + 银子（yinzi.pool 道具池）
//     → 提交配方材料（recipe_types 的 exact/any_of）→ 用炼丹神炉(liandan_shenlu)炼丹（grades.dan_pct 概率出修验丹，修验符 +dan_bonus_pct）
//     → 提交领金币（grades.submit_gold × (1+submit_bonus_pct) × (1+10%×强化等级)）。
//   · 强化修验任务：按当前强化等级消耗 百炼石/紫菱花/风铃珠，提升丹率(+5%/级)与提交金币(+10%/级)。
//   · 修验导师的考验：消耗百炼石，限时击杀 N 怪，按品阶 per_kill_exp 给修验经验。
// 每日次数受 daily 限制（基础 + 符令加成 + 80 级无限）；刷新/洗练含免费次数与金币/洗练道具消耗。
export function xyCfg(){ return (sm() && sm().quest) || {}; }
export function xyGrades(){ return xyCfg().grade_order || []; }
export function xyGradeDef(g){ return ((xyCfg().grades) || {})[g] || null; }
export function xyRecipeTypes(){ return (xyCfg().recipe_types) || {}; }
export function xyRecipeName(t){ return ((xyRecipeTypes()[t]) || {}).name || t; }

export function xyDailyReset(q){
  const d = todayKey();
  if(q.date !== d){ q.date = d; q.tasks_done = 0; q.refresh_free_used = 0; q.wash_used = 0; }
  if(q.str && q.str.date !== d){ q.str.date = d; q.str.times = 0; q.str.refresh_free_used = 0; q.str.wash_used = 0; }
  if(q.trial && q.trial.date !== d){ q.trial.date = d; q.trial.times = 0; q.trial.refresh_free_used = 0; q.trial.wash_used = 0; }
}
export function xyQuestState(){
  const s = state.player.shenmo; if(!s) return null;
  s.quest = s.quest || {}; xyDailyReset(s.quest); return s.quest;
}

// 银子（yinzi）：用 yinzi.pool 道具池（紫菱花/风铃珠/百炼石）抵扣 qty
export function xyYinziPool(){ return ((xyCfg().yinzi) || {}).pool || []; }
export function xyHasYinzi(qty){ let h = 0; for(const k of xyYinziPool()) h += itemCount(k); return h >= qty; }
export function xyConsumeYinzi(qty){
  let left = qty;
  for(const k of xyYinziPool()){ const h = itemCount(k); if(h > 0){ const u = Math.min(h, left); itemConsume(k, u); left -= u; } if(left <= 0) break; }
  return left === 0;
}

// 配方材料需求（按 recipe_types[].mode 与 grade 解释）
export function xyMatRequirement(type, grade){
  const g = xyGradeDef(grade), rt = xyRecipeTypes()[type]; if(!g || !rt) return null;
  const mq = g.mat_qty || 0;
  if(rt.mode === 'exact'){ const k = (rt.by_grade || [])[xyGrades().indexOf(grade)]; return k ? { mode:'exact', mq, items:[k] } : null; }
  if(rt.mode === 'any_of'){ const opts = (rt.by_grade || [])[xyGrades().indexOf(grade)] || []; return { mode:'any_of', mq, items:opts }; }
  return null; // exp 等无材料类型
}
export function xyStoreOf(type){ return ((xyRecipeTypes()[type]) || {}).store; }
export function xyGemCount(key){ const i=key.lastIndexOf('_'); const s=key.slice(0,i), g=key.slice(i+1); const p=state.player; let n=0; for(const b of p.bag) if(b.type==='gem' && b.series===s && b.grade===g) n+=(b.count||1); return n; }
export function xyGemConsume(key, qty){ const i=key.lastIndexOf('_'); const s=key.slice(0,i), g=key.slice(i+1); const p=state.player; let left=qty; for(const b of p.bag){ if(left<=0) break; if(b.type==='gem' && b.series===s && b.grade===g){ const c=b.count||1; if(c>left){ b.count=c-left; left=0; } else { left-=c; b.count=0; } } } p.bag=p.bag.filter(b=> !(b.type==='gem' && (b.count||0)<=0)); return left===0; }
export function xyCountMat(type, key){
  const store = xyStoreOf(type);
  if(store === 'ore') return (state.player.ores && state.player.ores[key]) || 0;     // 矿石存于 p.ores
  if(store === 'crystal') return state.player.crystal || 0;                          // 晶石为统一池
  if(store === 'gem') return xyGemCount(key);                                        // 宝石存于 p.bag(type=gem)
  return itemCount(key);                                                            // 其余走 p.bag(consumable)
}
export function xyConsumeMat(type, key, qty){
  const store = xyStoreOf(type);
  if(store === 'ore'){ const o=state.player.ores||{}; if((o[key]||0)<qty) return false; o[key]-=qty; if(o[key]<=0) delete o[key]; return true; }
  if(store === 'crystal'){ if((state.player.crystal||0)<qty) return false; state.player.crystal-=qty; return true; }
  if(store === 'gem') return xyGemConsume(key, qty);
  return itemConsume(key, qty);
}
export function xyHasMaterials(type, grade){
  const r = xyMatRequirement(type, grade); if(!r) return true;
  if(r.mode === 'exact') return xyCountMat(type, r.items[0]) >= r.mq;
  let h = 0; for(const k of r.items) h += xyCountMat(type, k); return h >= r.mq;
}
export function xyConsumeMaterials(type, grade){
  const r = xyMatRequirement(type, grade); if(!r) return;
  if(r.mode === 'exact'){ xyConsumeMat(type, r.items[0], r.mq); return; }
  let left = r.mq; for(const k of r.items){ const h = xyCountMat(type, k); if(h > 0){ const u = Math.min(h, left); xyConsumeMat(type, k, u); left -= u; } if(left <= 0) break; }
}

// 修验任务每日上限（基础 + 符令加成 + 80 级无限）
export function xyDailyCap(){
  const d = xyCfg().daily || {}; const lv = (state.player.shenmo && state.player.shenmo.level) || 1;
  let cap = d.base_times || 0;
  if(lv >= (d.talisman_extra_min_level || 40)) cap += (d.talisman_extra || 0);
  if(lv >= (d.talisman_unlimited_min_level || 80)) cap = Infinity;
  return cap;
}

// 随机品阶（按 weight 加权；4A/5A 受 refresh.boost 影响）
export function xyRollGrade(){
  const order = xyGrades(), cfg = xyCfg(), lv = (state.player.shenmo && state.player.shenmo.level) || 1;
  const boost = (cfg.refresh && cfg.refresh.boost) || [];
  const weights = order.map(g => { let m = 1; for(const b of boost){ if(lv < b.below && b.mult && b.mult[g]){ m = b.mult[g]; break; } } return ((xyGradeDef(g).weight) || 0) * m; });
  const total = weights.reduce((a, b) => a + b, 0) || 1; let r = Math.random() * total;
  for(let i = 0; i < order.length; i++){ r -= weights[i]; if(r <= 0) return order[i]; }
  return order[order.length - 1];
}

// 接取修验任务（type 由玩家选择；grade 随机）
export function xyAccept(type){
  const q = xyQuestState(), s = state.player.shenmo; if(!q) return { ok:false, msg:'未入神魔道' };
  if(!xyRecipeTypes()[type]) return { ok:false, msg:'未知配方类型' };
  const cap = xyDailyCap(); if(cap !== Infinity && (q.tasks_done || 0) >= cap) return { ok:false, msg:'今日修验任务次数已用完' };
  const g = xyRollGrade(), gd = xyGradeDef(g);
  if((s.exp || 0) < (gd.exp_cost || 0)) return { ok:false, msg:'修验经验不足（需 ' + gd.exp_cost + '）' };
  if(!xyHasYinzi(gd.yinzi_qty || 0)) return { ok:false, msg:'银子不足（需 ' + gd.yinzi_qty + '）' };
  s.exp -= gd.exp_cost; xyConsumeYinzi(gd.yinzi_qty || 0);
  q.tasks_done = (q.tasks_done || 0) + 1;
  q.current = { grade:g, type, status:'accepted' };
  return { ok:true, msg:'接取 ' + g + ' 修验任务（' + xyRecipeName(type) + '）' };
}
// 提交材料
export function xySubmitMaterials(){
  const q = xyQuestState(), c = q && q.current; if(!c || c.status !== 'accepted') return { ok:false, msg:'当前没有进行中的任务' };
  if(!xyHasMaterials(c.type, c.grade)) return { ok:false, msg:'材料不足' };
  xyConsumeMaterials(c.type, c.grade); c.status = 'ready';
  return { ok:true, msg:'材料已提交，可炼丹' };
}
// 炼丹（需炼丹神炉在背包；修验符 +dan_bonus_pct；强化等级 +5%/级 丹率）
export function xyRefine(){
  const q = xyQuestState(), c = q && q.current; if(!c || c.status !== 'ready') return { ok:false, msg:'需先提交材料' };
  const cfg = xyCfg(), furnace = cfg.furnace_item;
  if(furnace && itemCount(furnace) <= 0) return { ok:false, msg:'需要炼丹神炉（' + itemName(furnace) + '）' };
  const gd = xyGradeDef(c.grade); let p = gd.dan_pct || 0;
  const tal = cfg.talisman; if(tal && itemCount(tal.item) > 0) p *= (1 + (tal.dan_bonus_pct || 0));
  const enh = (q.str && q.str.enhanced) || 0; p *= (1 + 0.05 * enh);
  const got = Math.random() < p; if(got) addToBag({ type:'consumable', key:gd.pill, count:1 });
  c.status = 'refined'; c.gotPill = got;
  return { ok:true, msg: got ? ('炼出 ' + itemName(gd.pill) + '！') : ('未炼出修验丹（丹率 ' + (p * 100).toFixed(1) + '%）') };
}
// 提交领金币（submit_gold × (1+submit_bonus_pct) × (1+10%×强化等级)）
export function xyHandIn(){
  const q = xyQuestState(), c = q && q.current; if(!c || c.status !== 'refined') return { ok:false, msg:'需先炼丹' };
  const cfg = xyCfg(), gd = xyGradeDef(c.grade);
  const enh = (q.str && q.str.enhanced) || 0;
  const gold = Math.floor((gd.submit_gold || 0) * (1 + (cfg.submit_bonus_pct || 0)) * (1 + 0.10 * enh));
  state.player.gold += gold; q.current = null;
  return { ok:true, msg:'提交成功，获得 ' + gold + ' 金币' };
}
// 刷新当前任务（换随机品阶；免费次数用完后扣金币）
export function xyRefresh(){
  const q = xyQuestState(); if(!q || !q.current) return { ok:false, msg:'没有可刷新的任务' };
  const cfg = xyCfg().refresh || {}; const lv = (state.player.shenmo && state.player.shenmo.level) || 1;
  if(lv < (cfg.min_level || 40)) return { ok:false, msg:'Lv.' + (cfg.min_level || 40) + ' 解锁刷新' };
  const free = cfg.gold_free_times || 0;
  if((q.refresh_free_used || 0) < free){ q.refresh_free_used++; }
  else { const cost = (cfg.gold_per_level || 0) * lv; if(state.player.gold < cost) return { ok:false, msg:'刷新金币不足（需 ' + cost + '）' }; state.player.gold -= cost; }
  q.current.grade = xyRollGrade();
  return { ok:true, msg:'已刷新为 ' + q.current.grade + ' 任务' };
}

// ---- 强化修验任务 ----
export function xyStrCap(){
  const d = (xyCfg().strengthen && xyCfg().strengthen.daily) || {};
  let cap = d.base_times || 0;
  const lv = (state.player.shenmo && state.player.shenmo.level) || 1;
  if(lv >= (d.talisman_min_level || 0)) cap += (d.talisman_extra || 0);
  return cap;
}
export function xyStrengthen(){
  const q = xyQuestState(); if(!q) return { ok:false, msg:'未入神魔道' };
  const st = q.str = q.str || {}; const cfg = xyCfg().strengthen; if(!cfg) return { ok:false, msg:'无强化配置' };
  if((st.times || 0) >= xyStrCap()) return { ok:false, msg:'今日强化次数已用完' };
  const lvl = st.enhanced || 0, mats = cfg.mats, need = [];
  for(const key in mats){ const arr = mats[key]; need.push({ key, qty:arr[Math.min(lvl, arr.length - 1)] }); }
  for(const n of need){ if(itemCount(n.key) < n.qty) return { ok:false, msg:'材料不足：' + itemName(n.key) + '×' + n.qty }; }
  for(const n of need){ itemConsume(n.key, n.qty); }
  st.times = (st.times || 0) + 1; st.enhanced = (st.enhanced || 0) + 1;
  return { ok:true, msg:'强化成功（Lv.' + st.enhanced + '，丹率/提交金币提升）' };
}

// ---- 修验导师的考验 ----
export function xyTrialCap(){ const d = (xyCfg().trial && xyCfg().trial.daily) || {}; return d.base_times || 0; }
export function xyTrialStart(){
  const q = xyQuestState(); if(!q) return { ok:false, msg:'未入神魔道' };
  const tr = q.trial = q.trial || {}; const cfg = xyCfg().trial; if(!cfg) return { ok:false, msg:'无考验配置' };
  if((tr.times || 0) >= xyTrialCap()) return { ok:false, msg:'今日考验次数已用完' };
  const g = xyRollGrade(), gi = xyGrades().indexOf(g);
  const bq = cfg.bailian_qty[gi], mk = cfg.min_kills[gi];
  if(itemCount('bailian_shi') < bq) return { ok:false, msg:'需要百炼石×' + bq };
  itemConsume('bailian_shi', bq); tr.times = (tr.times || 0) + 1;
  tr.active = { grade:g, kills:0, target:mk, exp:(cfg.per_kill_exp[g] || 0), deadline:Date.now() + (cfg.kill_seconds || 900) * 1000 };
  return { ok:true, msg:'考验开始：' + mk + ' 杀 / ' + (cfg.kill_seconds || 900) + ' 秒内' };
}
export function xyTrialOnKill(){
  const q = xyQuestState(); if(!q) return; const tr = q.trial; if(!tr || !tr.active) return;
  if(Date.now() > tr.active.deadline){ tr.active = null; return; }   // 超时失败
  tr.active.kills++;
  if(tr.active.kills >= tr.active.target){ state.player.shenmo.exp += (tr.active.exp || 0) * tr.active.target; tr.active = null; }
}

