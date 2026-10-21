/* ===== 模块 refine.js —— 精炼 + 宝石镶嵌逻辑 =====
 * 来源：game.js L2162-2270（2026-10-21 模块化切分，内容逐字节保留）
 * 导出 9 个顶层名；import 由 AST 跨模块引用自动计算。
 */
import { state } from './state.js';
import { DATA, SLOT_NAME, pick, ri } from './core.js';
import { refreshStats } from './smtree.js';
import { decStack } from './bag.js';
import { log, renderHeader } from './render.js';
import { renderTab } from './tabs.js';
import { checkAchievements, crystalCount, crystalForTier, crystalName, crystalStartRefine, fmtNum, useCrystalStone } from './life.js';

// ---------- 生活技能：精炼 / 镶嵌 ----------
// 精炼加成口径（按原版 refine.py 反汇编还原，勿改回「按精炼等级取表 × 百分比」）：
//   · flat 表按【装备档位】索引（原版 refine_flat_per_level(equip.tier)），每级增量恒定
//   · 原版无任何百分比缩放：refine_per_level_pct / refine_per_level_pct_list 在原版是死代码
//     （config.py 里定义 + refine.py import 进命名空间，全 exe 零次使用；配套的
//      apply_range_bonus / apply_stat_range_bonus 也从未被调用）
//   · 只作用于四个白板攻防键，且【跳过 (0,0) 的键】（原版 `if int(v[0])==0 and int(v[1])==0: continue`）
//   · 失败降级/归零必须回退已得加成（原版 _revert_refine_stats），否则会白送属性
//   · 隐藏词条仅在达到精炼上限时解锁，按部位分 attack/defense，文案取自 refine_hidden_perks
export function refineFlatOf(it){
  const m=(DATA.refine&&DATA.refine.refine_per_level_flat)||{};
  return m[''+((it&&it.tier)||1)] || m['1'] || [3,3];
}
// 本 port 装备属性是标量（原版是 [lo,hi] 区间）：原版给区间两端分别加 flat_lo / flat_hi，
// 标量下的等价期望增量就是中值，且【逐级恒定】—— 这样回退能精确还原，不必额外存字段
export function refineStep(it){ const f=refineFlatOf(it); return Math.round((f[0]+f[1])/2); }
export function refineKeys(it){
  return ['phys_atk','magic_atk','phys_def','magic_def'].filter(k=> it.stats && (it.stats[k]||0)!==0);
}
export function refineApplyOne(it){
  const d=refineStep(it);
  for(const k of refineKeys(it)) it.stats[k]+= d;
  // 耐久每级 ×(1+refine_durability_pct)（原版 _apply_refine_one_level L115：
  //   equip.durability = int(equip.durability*(1+REFINE_DURABILITY_PCT))，逐级复合、int 截断）
  // 门控：slots.json#has_durability 为假的部位（项链/戒指）无耐久，不提升。
  // 注意：_revert_refine_stats 只回退四维攻防【不回退耐久】—— 精炼失败降级/归零时耐久增益保留（原版口径）
  const pct=(DATA.refine&&DATA.refine.refine_durability_pct)||0;
  if(pct>0 && it.durability!=null) it.durability=Math.floor(it.durability*(1+pct));
  return d;
}
export function refineRevert(it, levels){
  if(!(levels>0)) return;
  const d=refineStep(it)*levels;
  for(const k of refineKeys(it)) it.stats[k]=Math.max(0, it.stats[k]-d);
}
// 隐藏词条：攻击部位（武器/双戒）→ 致命；其余部位 → 守御。返回展示文案，未解锁返回 null
export function refineAddHidden(it){
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
export function doRefine(item){
  const p = state.player;
  const rf = DATA.refine;
  if(item.refine>=rf.refine_max){ log('<span class="sys">'+item.name+' 已是最高精炼 +'+rf.refine_max+'</span>'); return; }
  const next = item.refine+1;
  const cost = next*120;
  if(p.gold < cost){ log('<span class="dmg">金币不足，精炼需要 '+fmtNum(cost)+'</span>'); return; }
  // 晶石：+5 起每级消耗 1 颗对应档位晶石
  let needC=null;
  if(next >= crystalStartRefine()){
    needC = crystalForTier(item.tier||1);
    if(crystalCount(needC) < 1){ log('<span class="dmg">精炼 +'+next+' 需要 '+crystalName(needC)+' x1（材料商店/首领掉落）</span>'); return; }
  }
  // success table
  const oc = rf.refine_outcomes[''+next];
  const r = Math.random();
  let acc=0, outcome='keep';
  for(const k of ['destroy','zero','drop','keep','up']){ acc+=oc[k]||0; if(r<acc){outcome=k;break;} }
  p.gold -= cost;
  if(needC) useCrystalStone(needC, 1);
  if(outcome==='destroy'){ log('<span class="dmg">精炼失败，'+item.name+' 损毁！</span>'); removeItem(item); }
  else if(outcome==='zero'){ refineRevert(item, item.refine); item.refine=0; log('<span class="dmg">精炼失败，'+item.name+' 精炼归零</span>'); }
  else if(outcome==='drop'){ refineRevert(item, 1); item.refine=Math.max(0,item.refine-1); log('<span class="sys">精炼失败，'+item.name+' 下降一级</span>'); }
  else if(outcome==='keep'){ log('<span class="sys">精炼未提升，'+item.name+' 维持 +'+item.refine+'</span>'); }
  else { // up
    item.refine = next;
    refineApplyOne(item);
    // 隐藏词条：原版仅在达到精炼上限时解锁（按部位分 attack/defense）
    const hid = next>=rf.refine_max ? refineAddHidden(item) : null;
    log('<span class="loot">精炼成功！'+item.name+' 提升至 +'+next+(hid?' · 解锁隐藏词条 '+hid:'')+'</span>');
    if(next>=7) state.player.stats.refine7=(state.player.stats.refine7||0)+1;
    checkAchievements();
  }
  refreshStats(); renderHeader(); renderTab();
}
export function doInlay(item, gem){
  if(!item.sockets || item.gems.filter(Boolean).length>=item.sockets){ log('<span class="dmg">'+item.name+' 没有空闲孔位</span>'); return; }
  // 系列对应属性
  const series = DATA.gems.gem_series.find(g=>g.key===gem.series);
  if(!series){ log('<span class="dmg">未知宝石</span>'); return; }
  // gems.json#gem_series[].slots 是「本系列只能镶哪些部位」的中文白名单（如北斗→武器/护手/戒指）
  if(series.slots && series.slots.indexOf(SLOT_NAME[item.slot]) < 0){
    log('<span class="dmg">'+series.name+' 只能镶进 '+series.slots.join('/')+'，不能镶到'+SLOT_NAME[item.slot]+'</span>'); return;
  }
  const gv = DATA.gems.gem_grade_values[series.type];
  const val = gv ? ri(gv[gem.grade][0], gv[gem.grade][1]) : 5;
  const slot = item.gems.indexOf(null);
  item.gems[slot] = {series:gem.series, stat:series.type, value:val, grade:gem.grade};
  // 按堆叠数量扣减背包宝石（叠加后不能整条删除，否则会误删整堆）
  decStack(gem, 1);
  refreshStats();
  log('<span class="loot">镶嵌 '+series.name+'·'+gem.grade+' 于 '+item.name+'（'+series.effect+'+'+val+'）</span>');
  renderHeader(); renderTab();
}
export function removeItem(item){
  const p=state.player;
  p.bag = p.bag.filter(b=>b.uid!==item.uid);
  for(const s in p.equip) if(p.equip[s] && p.equip[s].uid===item.uid) p.equip[s]=null;
  refreshStats(); renderHeader(); renderTab();
}

