/* ===== 模块 inlay.js —— 宝石镶嵌 UI + 生活技能页 renderLife =====
 * 来源：game.js L3208-3471（2026-10-21 模块化切分，内容逐字节保留）
 * 导出 22 个顶层名；import 由 AST 跨模块引用自动计算。
 */
import { state } from './state.js';
import { DATA, GEM_ORDER, LS, MAT_SHOP_LIST, ORE_BY_TIER, ORE_KEYS, ORE_NAME, SLOT_NAME, clamp } from './core.js';
import { QNAME } from './equip.js';
import { equipScore } from './bag.js';
import { doInlay, refineKeys, refineStep } from './refine.js';
import { $, CN_COMBAT, log } from './render.js';
import { equipOpts, refineEquipList, slotOpts, tierOpts } from './tabs.js';
import { itemName } from './shop.js';
import { cn, compassDef, crystalCount, crystalForTier, crystalName, crystalStartRefine, fmtNum, gemCount, gemRecipeFor, instMapName, itemCount, mineConf, mineExpNeed, mineProgress } from './life.js';
import { findItem } from './binds.js';

// ---------- 宝石镶嵌（gems.json）----------
// 系列限定部位必须接通：北斗/天行 → 武器·护手·戒指；望月/无相 → 头盔·护肩·盔甲·项链·护腿·盾牌；
// 元如 → 上面六件 + 鞋子·披风·腰带；修仙石 → 仅武器。不检查会把专用宝石镶到不合适的部位上白费一颗。
export function gemSeriesDef(key){ return ((DATA.gems||{}).gem_series||[]).find(g=>g.key===key)||null; }
export function gemSeriesName(key){ const s=gemSeriesDef(key); return s? s.name : key; }
export function gemSeriesLabel(g){
  const s=gemSeriesDef(g.series);
  return (s? s.name : g.series)+'·'+g.grade+(g.count>1? (' ×'+g.count) : '');
}
export function inlayGemList(){ const p=state.player; return p? p.bag.filter(b=>b.type==='gem') : []; }
// 当前选中的宝石（未选/已失效时回落到第一颗，保证面板始终有内容）
export function selGemForInlay(){ const gs=inlayGemList(); return findItem(LS.inlayGem) || gs[0] || null; }
export function gemCanInlay(gem, it){
  if(!gem || !it || it.type!=='equip') return false;
  if(!(it.sockets>0)) return false;
  if((it.gems||[]).filter(Boolean).length >= it.sockets) return false;
  const s=gemSeriesDef(gem.series);
  return !s || !s.slots || s.slots.indexOf(SLOT_NAME[it.slot])>=0;
}
export function inlayEquipList(){
  const p=state.player; if(!p) return [];
  const gem=selGemForInlay();
  const all=[];
  for(const sl in p.equip) if(p.equip[sl]) all.push(p.equip[sl]);
  for(const b of p.bag) if(b.type==='equip') all.push(b);
  return all.filter(it=> gemCanInlay(gem, it)).sort((a,b)=>equipScore(b)-equipScore(a));
}
export function inlayGemOpts(){
  const gs=inlayGemList();
  if(!gs.length) return '<option value="">（背包里没有宝石）</option>';
  return gs.map(g=> '<option value="'+g.uid+'"'+(LS.inlayGem===g.uid?' selected':'')+'>'+gemSeriesLabel(g)+'</option>').join('');
}
export function inlayEquipOpts(){
  const ts=inlayEquipList();
  if(!ts.length) return '<option value="">（没有可镶嵌的装备）</option>';
  return ts.map(it=> '<option value="'+it.uid+'"'+(LS.inlayEquip===it.uid?' selected':'')+'>'
    +'['+QNAME[it.quality]+'] '+SLOT_NAME[it.slot]+'·'+it.name
    +'（空孔 '+((it.sockets||0)-(it.gems||[]).filter(Boolean).length)+'/'+(it.sockets||0)+'）</option>').join('');
}
export function doInlaySelected(){
  const gs=$('inlay-gem'), es=$('inlay-equip');
  const gem=(gs&&gs.value)? findItem(gs.value) : null;
  const it =(es&&es.value)? findItem(es.value) : null;
  if(!gem){ log('<span class="dmg">请先选择宝石</span>'); return; }
  if(!it){ log('<span class="dmg">没有可镶嵌的装备（需有空闲孔位且部位符合宝石限制）</span>'); return; }
  doInlay(it, gem);
}
// 可精炼装备下拉（只列未满级的，显示「+N [品质] 部位·名称」）
export function refineEquipOpts(){
  const ok2=refineEquipList();
  if(!ok2.length) return '<option value="">（没有可精炼的装备）</option>';
  return ok2.map(it=> '<option value="'+it.uid+'"'+(LS.refineEq===it.uid?' selected':'')+'>'
    +'+'+(it.refine||0)+' ['+QNAME[it.quality]+'] '+SLOT_NAME[it.slot]+'·'+it.name+'</option>').join('');
}
export function oreRecipeOpts(){ let h=''; for(const k in (DATA.ore_recipes||{})){ const r=DATA.ore_recipes[k]; h+='<option value="'+k+'"'+(LS.oreRecipe===k?' selected':'')+'>'+r.name+'</option>'; } return h; }
export function furnaceOpts(){
  const catName={stone:'精炼石',compass:'罗盘',box:'宝匣',lingpai:'令牌',potion_box:'药水盒',ore:'矿石',yuanbao:'元宝'};
  let h=''; for(const k in (DATA.furnace_recipes||{})){ const r=DATA.furnace_recipes[k]; h+='<option value="'+k+'"'+(LS.furnace===k?' selected':'')+'>['+(catName[r.category]||r.category)+'] '+r.name+'</option>'; } return h;
}
export function modeOpts(){
  const gm=(DATA.modes||{}).generate_modes||{}; let h='';
  if(!gm[LS.forgeMode]) LS.forgeMode='random';
  for(const k in gm) h+='<option value="'+k+'"'+(LS.forgeMode===k?' selected':'')+'>'+gm[k]+'</option>';
  return h;
}
export function compassOpts(){
  let h=''; const c=(mineConf().compass||{});
  if(!c[LS.mineGrade]) LS.mineGrade=Object.keys(c)[0];
  for(const g in c) h+='<option value="'+g+'"'+(LS.mineGrade===g?' selected':'')+'>'+c[g].name+'</option>';
  return h;
}
export function mineMapOpts(){
  let h=''; const cd=compassDef(LS.mineGrade); const maps=(cd&&cd.open_maps)||[];
  if(maps.indexOf(LS.mineMap)<0) LS.mineMap=maps[0];
  for(const mk of maps) h+='<option value="'+mk+'"'+(LS.mineMap===mk?' selected':'')+'>'+instMapName(mk)+'</option>';
  return h;
}
export function gemSeriesOpts(){
  let h=''; const arr=(DATA.gems.gem_series||[]);
  if(!LS.gemSeries && arr.length) LS.gemSeries=arr[0].key;
  for(const g of arr) h+='<option value="'+g.key+'"'+(LS.gemSeries===g.key?' selected':'')+'>'+g.name+'</option>';
  return h;
}
export function gemGradeOpts(){
  let h='';
  if(!LS.gemGrade) LS.gemGrade=GEM_ORDER[0];
  for(let i=0;i<GEM_ORDER.length-1;i++){ const g=GEM_ORDER[i]; h+='<option value="'+g+'"'+(LS.gemGrade===g?' selected':'')+'>'+g+' → '+GEM_ORDER[i+1]+'</option>'; }
  return h;
}
export function oreCostPreview(){ const t=LS.forgeTier; const ore=ORE_BY_TIER[t-1]; return ORE_NAME[ore]+' x'+(3+t*2)+' + 金币 '+fmtNum(t*150); }
export function bailianCostStr(r){
  const parts=[];
  for(const m of r.materials){ if(m.key==='bailian_shi') parts.push('百炼石x'+m.count); else if(m.kind==='crystal') parts.push('晶石x'+m.count); else if(m.bottle) parts.push('炼化瓶x1'); }
  const lowL=parseInt(r.key.split('_').pop(),10)-1;
  if(lowL>=1) parts.push('百炼丹·'+cn(lowL)+'x2');
  return parts.join(' ');
}
export function bailianDanSummary(){
  const p=state.player; const s=[];
  for(let L=1;L<=5;L++){ const n=p.bag.filter(b=>b.type==='consumable'&&b.key==='bailian_dan_'+L).reduce((a,b)=>a+b.count,0); if(n>0) s.push('百炼丹·'+cn(L)+'x'+n); }
  return s.length?s.join(' '):'（无）';
}

export function renderLife(sub){
  const p=state.player;
  const any=!sub;                              // sub 为空 = 全量渲染（旧行为，导出/测试依赖）
  const secs=[];
  const push=(k,h)=>{ if(any || sub===k) secs.push(h); };

  // 资源概览（归「探矿」：探矿前先看矿石/材料底数）
  if(any || sub==='mine'){
    const oreParts=(DATA.ores.ore_types||[]).map(o=> o.name+'·'+(p.ores[o.key]||0)).join('  ');
    const matKeys=Object.keys(p.materials).filter(k=>p.materials[k]>0);
    const matStr=matKeys.length? matKeys.map(k=>itemName(k)+'·'+p.materials[k]).join('  ') : '（无）';
    const cryStr=((DATA.crystals||{}).crystal_types||[]).filter(c=>crystalCount(c.key)>0).map(c=>c.name+'·'+crystalCount(c.key)).join('  ')||'（无）';
    push('mine','<h3>资源概览</h3><div class="muted">矿石：'+oreParts+'<br>材料：'+matStr+'<br>晶石：'+cryStr+'<br>神秘结晶：'+fmtNum(p.crystal)+' · 百炼丹：'+bailianDanSummary()+'</div>');
  }

  // ① 打造
  if(any || sub==='craft'){
    let h='<hr><h3>① 打造（装备）</h3><div class="muted">消耗本档矿石+金币，生成最多 '+DATA.craft.craft_max_attr+' 词条、'+DATA.craft.craft_max_slots+' 孔的装备（依据 craft.json 上限）。</div>';
    h+='<div class="muted">部位：<select id="forge-slot">'+slotOpts(LS.forgeSlot)+'</select> 档位：<select id="forge-tier">'+tierOpts(LS.forgeTier)+'</select> 模式：<select id="forge-mode">'+modeOpts()+'</select> <button class="mini" data-act="forge">打造</button></div>';
    h+='<div class="muted">消耗预估：'+oreCostPreview()+'</div>';
    push('craft',h);
  }

  // ② 百炼丹炼制
  if(any || sub==='refine'){
    let h='<hr><h3>② 百炼丹炼制</h3><div class="muted">消耗 百炼石+晶石(神秘结晶)+炼化瓶；高階需上一级百炼丹 x2。配方链：'+DATA.bailian_recipes.level_1.result_name+' → … → '+DATA.bailian_recipes.level_5.result_name+'</div>';
    for(let L=1;L<=5;L++){ const r=DATA.bailian_recipes['level_'+L]; if(!r) continue; h+='<div class="item" data-act="bailian-craft" data-l="'+L+'">炼制 '+r.result_name+' <span class="pill">'+bailianCostStr(r)+'</span></div>'; }
    push('refine',h);
  }

  // ③ 百炼装备升阶
  if(any || sub==='craft'){
    let h='<hr><h3>③ 百炼装备（升阶）</h3><div class="muted">对装备使用 百炼丹·(当前+1)，提升一档并增强属性（上限 +'+DATA.craft.craft_upgrade_max_tier+'）。</div>';
    h+='<div class="craft-row">装备：<select id="bail-equip">'+equipOpts(LS.bailEquip)+'</select> <button class="mini" data-act="bailian-use">百炼升阶</button></div>';
    push('craft',h);
  }

  // ⑩ 装备精炼（refine.json：flat 表按【装备档位】；+5 起每级另耗 1 颗对应档晶石）
  if(any || sub==='craft'){
    const rf=DATA.refine, rmax=rf.refine_max||7;
    const flatStr=[1,2,3,4,5,6,7].map(t=> t+'档 '+(rf.refine_per_level_flat||{})[''+t].join('~')).join(' · ');
    let h='<hr><h3>⑩ 装备精炼</h3><div class="muted">每级加成按【装备档位】取表（'+flatStr+'），与精炼等级无关；'
      +'上限 +'+rmax+'，+5 起每级另耗 1 颗对应档晶石。失败可能下降 / 归零 / 损毁（降级归零会退回已得加成）。'
      +'达到 +'+rmax+' 时按部位解锁隐藏词条（武器/双戒→致命，其余→守御）。</div>';
    h+='<div class="craft-row">装备：<select id="refine-equip">'+refineEquipOpts()+'</select> <button class="mini" data-act="refine-eq">精炼</button></div>';
    // 未选 / 选中项已失效（例如刚被精炼损毁）时回落到排序第一件，保证面板始终有详情
    const selIt=findItem(LS.refineEq) || refineEquipList()[0] || null;
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

  // ⑪ 宝石镶嵌（gems.json：系列限定部位；空孔由打造/兑换产出）
  if(any || sub==='craft'){
    let h='<hr><h3>⑪ 宝石镶嵌</h3><div class="muted">把背包里的宝石镶进有空孔的装备。'
      +'各系列限定部位：北斗/天行→武器·护手·戒指；望月/无相→头盔·护肩·盔甲·项链·护腿·盾牌；'
      +'元如→上面六件 + 鞋子·披风·腰带；修仙石→仅武器。4 颗同级宝石可在「合成」子页炼成更高一级。</div>';
    const gems=inlayGemList();
    if(!gems.length){
      h+='<div class="muted">背包里没有宝石（首领/精英掉落，或在「合成」子页炼制）。</div>';
    }else{
      // 两个下拉 + 按钮塞一行时，1440 下会把「宝石：」「装备：」的文字挤到断行 —— 拆成两行，
      // 与 ③④⑤⑥ 的「一行一个控件」写法保持一致
      h+='<div class="craft-row">宝石：<select id="inlay-gem">'+inlayGemOpts()+'</select></div>';
      h+='<div class="craft-row">装备：<select id="inlay-equip">'+inlayEquipOpts()+'</select> <button class="mini" data-act="inlay">镶嵌</button></div>';
      const gem=selGemForInlay();
      if(gem){
        const sd=gemSeriesDef(gem.series), list=inlayEquipList();
        h+='<div class="muted">'+(sd? sd.name+'·'+gem.grade+'（'+sd.effect+'）' : gem.series)
          +(sd&&sd.slots? ('　限定部位 '+sd.slots.join('/')) : '')
          +'　当前可镶装备 '+list.length+' 件</div>';
      }
    }
    push('craft',h);
  }

  // ④ 提取回收
  if(any || sub==='recycle'){
    let h='<hr><h3>④ 提取（回收）</h3><div class="muted">分解装备，回收 '+DATA.extract.ore_per_equip+' 个本档矿石与已镶嵌宝石，装备销毁。</div>';
    h+='<div class="craft-row">装备：<select id="extract-equip">'+equipOpts(LS.extractEquip)+'</select> <button class="mini" data-act="extract">提取</button></div>';
    push('recycle',h);
  }

  // ⑤ 矿石炼制
  if(any || sub==='combine'){
    let h='<hr><h3>⑤ 矿石炼制</h3><div class="muted">下级矿石+晶石+金币 → 高级矿石（'+DATA.ore_recipes.recipe_ore_4.time+'/次，即时）。</div>';
    h+='<div class="craft-row">配方：<select id="ore-recipe">'+oreRecipeOpts()+'</select> <button class="mini" data-act="ore-refine">炼制</button></div>';
    push('combine',h);
  }

  // ⑥ 乾坤炉合成
  if(any || sub==='combine'){
    let h='<hr><h3>⑥ 乾坤炉合成</h3><div class="muted">南郡·乾坤炉：消耗材料+金币，瞬间合成（详见 data/furnace_recipes.json）。</div>';
    h+='<div class="craft-row">配方：<select id="furnace-recipe">'+furnaceOpts()+'</select> <button class="mini" data-act="furnace">合成</button></div>';
    push('combine',h);
  }

  // ⑦ 探矿
  if(any || sub==='mine'){
    const mc=mineConf();
    const ml=(p.mining&&p.mining.level)||1, mexp=(p.mining&&p.mining.exp)||0, mneed=mineExpNeed(ml);
    let h='<hr><h3>⑦ 探矿（罗盘）</h3><div class="muted">探矿等级 '+ml+'（'+mexp+'/'+mneed+'）· 每轮消耗 1 个罗盘，约 '+((mc.steps||[]).reduce((a,b)=>a+(b.seconds||0),0))+' 秒。</div>';
    h+='<div class="bar exp"><i style="width:'+clamp(mexp/mneed*100,0,100)+'%"></i></div>';
    h+='<div class="muted">罗盘：<select id="mine-compass">'+compassOpts()+'</select> 矿脉：<select id="mine-map">'+mineMapOpts()+'</select> <button class="mini" data-act="mine-start">开始探矿</button></div>';
    for(const g in (mc.compass||{})){ const cd=compassDef(g);
      h+='<div class="muted">'+cd.name+'：持有 '+itemCount(cd.key)+'（需 Lv.'+cd.level_required+' · 可探 '+(cd.open_maps||[]).map(instMapName).join('/')+'）</div>'; }
    if(state.mine){
      const steps=mc.steps||[]; const st=steps[state.mine.step];
      h+='<div class="muted" style="color:var(--gold)">探矿中：'+(st? st.name:'结算中')+' · '+Math.round(mineProgress())+'%</div>';
      h+='<div class="bar exp"><i style="width:'+mineProgress()+'%"></i></div>';
    }
    push('mine',h);
  }

  // ⑧ 宝石炼制
  if(any || sub==='combine'){
    let h='<hr><h3>⑧ 宝石炼制</h3><div class="muted">4 颗同系列同级宝石 + 炼化瓶 x1 → 1 颗高一级宝石（gem_recipes，需 Lv.40）。</div>';
    h+='<div class="muted">系列：<select id="gem-series">'+gemSeriesOpts()+'</select> 品级：<select id="gem-grade">'+gemGradeOpts()+'</select> <button class="mini" data-act="gem-refine">炼制</button></div>';
    if(LS.gemSeries && LS.gemGrade){
      const r=gemRecipeFor(LS.gemSeries, LS.gemGrade);
      if(r) h+='<div class="muted">'+r.src_name+' x4（持有 '+gemCount(LS.gemSeries,LS.gemGrade)+'）+ 炼化瓶（持有 '+(p.materials.lianhua_ping||0)+'）→ '+r.dst_name+' x1</div>';
      else h+='<div class="muted">该品级已是最高或无可升配方</div>';
    }
    push('combine',h);
  }

  // ⑨ 药水炼制
  if(any || sub==='refine'){
    let h='<hr><h3>⑨ 药水炼制</h3><div class="muted">高级丹药/灵浆炼制（potion_recipes）。</div>';
    for(const k in (DATA.potion_recipes||{})){
      const r=DATA.potion_recipes[k], c=r.cost||{};
      const parts=[];
      if(c.hp_potion) parts.push(itemName(c.hp_potion.key)+' x'+c.hp_potion.count+'(有'+itemCount(c.hp_potion.key)+')');
      if(c.mp_potion) parts.push(itemName(c.mp_potion.key)+' x'+c.mp_potion.count+'(有'+itemCount(c.mp_potion.key)+')');
      if(c.crystal) parts.push('神秘结晶 x'+c.crystal.count);
      if(c.bottle) parts.push('炼化瓶 x'+(c.bottle.count||1));
      h+='<div class="item" data-act="potion-refine" data-r="'+k+'">炼制 '+r.result_name+' x'+(r.result_count||1)+' <span class="pill">'+parts.join(' + ')+'</span></div>';
    }
    push('refine',h);
  }

  // 材料商店
  if(any || sub==='recycle'){
    let h='<hr><h3>材料商店</h3><div class="muted">金币购买生活技能材料。晶石(神秘结晶)由精英/首领掉落。</div>';
    for(const m of MAT_SHOP_LIST){ h+='<div class="item shop-item" data-act="buy-mat" data-key="'+m.key+'" data-price="'+m.price+'">'+itemName(m.key)+(ORE_KEYS.has(m.key)?'矿石':'')+' <span class="pill">'+fmtNum(m.price)+'金</span></div>'; }
    for(const c of ((DATA.crystals||{}).crystal_types||[])){ h+='<div class="item shop-item" data-act="buy-crystal" data-key="'+c.key+'" data-price="'+(c.tier*400)+'">'+c.name+' <span class="pill">'+(c.tier*400)+'金</span></div>'; }
    push('recycle',h);
  }

  return secs.join('').replace(/^<hr>/,'');
}
