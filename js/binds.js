/* ===== 模块 binds.js —— 页签点击委托 bindTabClicks + findItem =====
 * 来源：game.js L4459-4660（2026-10-21 模块化切分，内容逐字节保留）
 * 导出 2 个顶层名；import 由 AST 跨模块引用自动计算。
 */
import { saveAuto, state } from './state.js';
import { cloudDelete, cloudLoad, cloudLogin, cloudLogout, cloudRank, cloudRegister, cloudSave, persistCloud } from './api.js';
import { LS, uid } from './core.js';
import { equipWuhun, smJoin, unequipWuhun, upgradeSkill, whName, wuhunActivate, wuhunAnnihilate, wuhunEvolve, wuhunFuse, wuhunRecycle } from './player.js';
import { xyAccept, xyHandIn, xyRefine, xyRefresh, xyStrengthen, xySubmitMaterials, xyTrialStart } from './quest.js';
import { refreshStats, smAddPoint, smResetPoints } from './smtree.js';
import { summonDef } from './battle.js';
import { autoExtractJunk, consolidateBag, equipItem } from './bag.js';
import { doInlay, doRefine } from './refine.js';
import { travelTo } from './world.js';
import { $, eventLog, log, renderHeader, renderHero, renderMap, whCraft } from './render.js';
import { renderTab } from './tabs.js';
import { doInlaySelected } from './inlay.js';
import { loadCloudUI } from './panels.js';
import { acceptQuest, buyShopItem, useConsumable } from './shop.js';
import { addCrystalStone, buyMaterial, courierTravel, crystalName, doBailianCraft, doBailianUse, doExtract, doForge, doFurnace, doGemRefine, doInstanceExchange, doOreRefine, doPotionRefine, equipTitle, mineStart, titleByKey } from './life.js';
import { copySaveText, exportSaveFile, importSaveFile, importSaveText, save } from './loop.js';
import { autoZone } from './idle.js';
import { renderAll } from './boot.js';

export function bindTabClicks(){
  const el=$('tab-pane');
  el.querySelectorAll('[data-item]').forEach(d=> d.onclick=()=>{
    const it=findItem(d.getAttribute('data-item')); if(!it) return;
    if(it.type==='consumable'){ useConsumable(it); return; }
    if(it.type==='equip'){
      if(window._pendingGem){ doInlay(it, window._pendingGem); window._pendingGem=null; const t=$('inlay-target'); if(t) t.textContent='已镶嵌'; return; }
      if(equipItem(it)) log('装备了 '+it.name);   // 等级/职业不符时 equipItem 已log原因并返回 false
    }
  });
  // 注：原先这里绑过 [data-refine] / [data-gem]，但这两个属性【从未被渲染】，
  // 而 #inlay-target 元素在 index.html 里也不存在 ⇒ 全是死入口。
  // 现已分别用「⑩ 装备精炼」的 data-act="refine-eq" 和「⑪ 宝石镶嵌」的 data-act="inlay" 替代。
  // 商店购买
  el.querySelectorAll('[data-buy]').forEach(d=> d.onclick=()=>{
    const [sk,idx]=d.getAttribute('data-buy').split('|'); buyShopItem(sk, parseInt(idx,10));
  });
  // 任务接受
  el.querySelectorAll('[data-accept]').forEach(d=> d.onclick=()=> acceptQuest(d.getAttribute('data-accept')));
  // 技能升级
  el.querySelectorAll('[data-skill]').forEach(d=> d.onclick=()=>{
    const r=upgradeSkill(d.getAttribute('data-skill'));
    log(r.ok? ('<span class="loot">'+r.msg+'</span>') : ('<span class="dmg">'+r.msg+'</span>'));
    renderTab(); renderHero();
  });
  // 武魂：选中
  el.querySelectorAll('[data-wh-item]').forEach(d=> d.onclick=()=>{
    const id=d.getAttribute('data-wh-item');
    const i=state.whSel.indexOf(id);
    if(i>=0) state.whSel.splice(i,1); else state.whSel.push(id);
    renderTab();
  });
  // 武魂：操作
  el.querySelectorAll('[data-wh]').forEach(d=> d.onclick=()=>{
    const a=d.getAttribute('data-wh'); const p=state.player;
    const found=uid0=> p.bag.find(b=>b.uid===uid0) || (p.wuhunSlots||[]).find(x=>x&&x.uid===uid0);
    let r={ok:false,msg:''};
    if(a==='unequip') r=unequipWuhun(parseInt(d.getAttribute('data-slot'),10));
    else if(a==='act'){ const o=found(d.getAttribute('data-uid')); r=wuhunActivate(o);
      if(r.ok){ refreshStats(); eventLog('武魂 <span class="loot">'+whName(o)+'</span> 潜能激活'); } }
    else if(a==='anni'){ const o=found(d.getAttribute('data-uid')); r=wuhunAnnihilate(o); if(r.ok) refreshStats(); }
    else if(a==='equip'){
      if(state.whSel.length!==1) r={ok:false,msg:'请先选择 1 个武魂'};
      else { r=equipWuhun(found(state.whSel[0]), null); if(r.ok){ state.whSel=[]; refreshStats(); } }
    }
    else if(a==='evolve'){
      if(state.whSel.length!==2) r={ok:false,msg:'进化需选择 2 个同类型、同星级且圆满的武魂'};
      else { r=wuhunEvolve(state.whSel[0], state.whSel[1]); if(r.ok) state.whSel=[]; }
    }
    else if(a==='fuse'){
      if(state.whSel.length!==2) r={ok:false,msg:'融合需选择 2 个已激活的武魂'};
      else { r=wuhunFuse(state.whSel[0], state.whSel[1]); if(r.ok){ state.whSel=[]; refreshStats(); } }
    }
    else if(a==='recycle'){
      if(!state.whSel.length) r={ok:false,msg:'请先选择要回收的武魂'};
      else { const o=found(state.whSel[0]); r=wuhunRecycle(o); if(r.ok) state.whSel=state.whSel.filter(x=>x!==o.uid); }
    }
    else if(a==='clear'){ state.whSel=[]; r={ok:true,msg:''}; }
    else if(a==='craft'){ const sel=$('wh-recipe'); r=whCraft(sel? sel.value : ''); }
    if(r.msg) log(r.ok? ('<span class="loot">'+r.msg+'</span>') : ('<span class="dmg">'+r.msg+'</span>'));
    renderTab(); renderHero();
  });
  // 神魔：入道
  el.querySelectorAll('[data-sm]').forEach(d=> d.onclick=()=>{
    if(d.getAttribute('data-sm')==='join'){
      const r=smJoin(d.getAttribute('data-f'));
      log(r.ok? ('<span class="loot">'+r.msg+'</span>') : ('<span class="dmg">'+r.msg+'</span>'));
      if(r.ok){ refreshStats(); eventLog('<span class="lv">'+r.msg+'</span>'); }
    }
    else if(d.getAttribute('data-sm')==='go_xz'){ travelTo('xianzhijing'); }
    renderTab(); renderHero();
  });
  // 修验任务（炼丹产线）
  el.querySelectorAll('[data-xy]').forEach(d=> d.onclick=()=>{
    const v=d.getAttribute('data-xy'), parts=v.split(':'), act=parts[0], arg=parts[1];
    let r=null;
    if(act==='accept') r=xyAccept(arg);
    else if(act==='submit') r=xySubmitMaterials();
    else if(act==='refine') r=xyRefine();
    else if(act==='handin') r=xyHandIn();
    else if(act==='refresh') r=xyRefresh();
    else if(act==='str') r=xyStrengthen();
    else if(act==='trial_start') r=xyTrialStart();
    if(r) log(r.ok? ('<span class="loot">'+r.msg+'</span>') : ('<span class="dmg">'+r.msg+'</span>'));
    renderTab(); renderHero();
  });
  // 副本兑换
  el.querySelectorAll('[data-inst]').forEach(d=> d.onclick=()=> doInstanceExchange(d.getAttribute('data-inst')));
  // 召唤兽出战切换
  el.querySelectorAll('[data-summon]').forEach(d=> d.onclick=()=>{
    const k=d.getAttribute('data-summon');
    state.player.summon = (state.player.summon===k)? null : k;
    log(state.player.summon? ('<span class="loot">'+summonDef(k).name+' 出战</span>') : '<span class="sys">召唤兽转为待命</span>');
    renderTab();
  });
  // 神魔：修验技能树加点 / 重置
  el.querySelectorAll('[data-smnode]').forEach(d=> d.onclick=()=>{
    const r=smAddPoint(d.getAttribute('data-smnode'));
    log(r.ok? ('<span class="loot">'+r.msg+'</span>') : ('<span class="dmg">'+r.msg+'</span>'));
    renderTab(); renderHero();
  });
  el.querySelectorAll('[data-smact]').forEach(d=> d.onclick=()=>{
    if(d.getAttribute('data-smact')==='reset'){
      const r=smResetPoints();
      log(r.ok? ('<span class="loot">'+r.msg+'</span>') : ('<span class="dmg">'+r.msg+'</span>'));
      renderTab(); renderHero();
    }
  });
  // 云存档 / 账号 / 排行 / 统计 / 自动设置
  const cu=$('cloud-user'), cp=$('cloud-pass');
  el.querySelectorAll('[data-cloudact]').forEach(d=> d.onclick=async ()=>{
    const a=d.getAttribute('data-cloudact');
    const u=cu? cu.value.trim():'', pw=cp? cp.value:'';
    if(a==='register'){ const r=await cloudRegister(u,pw); log(r.ok? ('<span class="loot">注册成功：'+r.user+'</span>') : ('<span class="dmg">'+r.msg+'</span>')); if(r.ok) renderTab(); }
    else if(a==='login'){ const r=await cloudLogin(u,pw); log(r.ok? ('<span class="loot">登录成功：'+r.user+'</span>') : ('<span class="dmg">'+r.msg+'</span>')); if(r.ok) renderTab(); }
    else if(a==='logout'){ await cloudLogout(); location.reload(); }   // 强制登录：退出后回登录页
    else if(a==='save'){ const slot=parseInt(d.getAttribute('data-slot'),10); const r=await cloudSave(slot, true);
      log(r.ok? ('<span class="loot">已保存到云端槽位 '+slot+'</span>') : ('<span class="dmg">保存失败：'+r.msg+'</span>')); state.cloud.slot=slot; persistCloud(); renderTab(); }
    else if(a==='load'){ const slot=parseInt(d.getAttribute('data-slot'),10); const r=await cloudLoad(slot);
      if(r.ok){ state.cloud.slot=slot; persistCloud(); refreshStats(); save(true); renderAll(); log('<span class="loot">'+r.msg+'</span>'); }
      else log('<span class="dmg">'+r.msg+'</span>'); }
    else if(a==='del'){ const slot=parseInt(d.getAttribute('data-slot'),10); const dr=await cloudDelete(slot); log(dr&&dr.ok? ('<span class="sys">已删除云端槽位 '+slot+'</span>') : ('<span class="dmg">删除失败：'+((dr&&dr.msg)||'未知错误')+'</span>')); renderTab(); }
    else if(a==='rank-up'){ const r=await cloudRank(); log(r&&r.ok? ('<span class="loot">战力已上传，当前排名 '+r.rank+'/'+r.total+'</span>') : '<span class="dmg">上传失败</span>'); loadCloudUI(); }
    else if(a==='rank-refresh'){ state.cloudUI.rank=null; loadCloudUI(); }
    else if(a==='stats-refresh'){ state.cloudUI.summary=null; loadCloudUI(); }
    else if(a==='auto-zone'){ autoZone(true); renderTab(); }
    else if(a==='export-file'){ exportSaveFile(); }
    else if(a==='export-copy'){ copySaveText(); }
    else if(a==='import-file'){ const f=$('save-file'); if(f) f.click(); else log('<span class="dmg">当前环境不支持文件选择。</span>'); }
    else if(a==='import-text'){ const ta=$('save-text'); importSaveText(ta? ta.value : ''); }
  });
  const sf=$('save-file');
  if(sf) sf.onchange=()=>{
    const f=sf.files && sf.files[0];
    if(f) importSaveFile(f);
    sf.value='';   // 允许连续导入同一个文件
  };
  el.querySelectorAll('[data-autochk]').forEach(d=> d.onchange=()=>{
    const k=d.getAttribute('data-autochk'); state.auto[k]=d.checked; saveAuto();
    log('<span class="sys">'+(d.checked?'已开启':'已关闭')+'：'+k+'</span>');
  });
  const ah=$('auto-hp'); if(ah) ah.onchange=()=>{ state.auto.hp=parseInt(ah.value,10); saveAuto(); };
  const am=$('auto-mp'); if(am) am.onchange=()=>{ state.auto.mp=parseInt(am.value,10); saveAuto(); };
  const rj=$('rank-job'); if(rj) rj.onchange=()=>{ state.cloudUI.job=rj.value; state.cloudUI.rank=null; loadCloudUI(); };
  // 神秘商人部位选择
  const ms=$('mystic-slot'); if(ms) ms.onchange=()=>{ window._mysticSlot=ms.value; };
  // 探矿 / 宝石炼制 下拉
  const mcp=$('mine-compass'); if(mcp) mcp.onchange=()=>{ LS.mineGrade=mcp.value; renderTab(); };
  const mmp=$('mine-map'); if(mmp) mmp.onchange=()=>{ LS.mineMap=mmp.value; renderTab(); };
  const gsr=$('gem-series'); if(gsr) gsr.onchange=()=>{ LS.gemSeries=gsr.value; renderTab(); };
  const ggr=$('gem-grade'); if(ggr) ggr.onchange=()=>{ LS.gemGrade=ggr.value; renderTab(); };
  // 生活技能：下拉与按钮
  const fs=$('forge-slot'); if(fs) fs.onchange=()=>{ LS.forgeSlot=fs.value; renderTab(); };
  const ft=$('forge-tier'); if(ft) ft.onchange=()=>{ LS.forgeTier=parseInt(ft.value,10); renderTab(); };
  const fm=$('forge-mode'); if(fm) fm.onchange=()=>{ LS.forgeMode=fm.value; renderTab(); };
  const be=$('bail-equip'); if(be) be.onchange=()=>{ LS.bailEquip=be.value; };
  const ee=$('extract-equip'); if(ee) ee.onchange=()=>{ LS.extractEquip=ee.value; };
  const re=$('refine-equip'); if(re) re.onchange=()=>{ LS.refineEq=re.value; renderTab(); };
  const ig=$('inlay-gem'); if(ig) ig.onchange=()=>{ LS.inlayGem=ig.value; LS.inlayEquip=null; renderTab(); };
  const ie=$('inlay-equip'); if(ie) ie.onchange=()=>{ LS.inlayEquip=ie.value; };
  const orr=$('ore-recipe'); if(orr) orr.onchange=()=>{ LS.oreRecipe=orr.value; };
  const fr=$('furnace-recipe'); if(fr) fr.onchange=()=>{ LS.furnace=fr.value; };
  el.querySelectorAll('[data-act]').forEach(d=> d.onclick=()=>{
    const a=d.getAttribute('data-act');
    if(a==='forge') doForge();
    else if(a==='bailian-craft') doBailianCraft(parseInt(d.getAttribute('data-l'),10));
    else if(a==='bailian-use') doBailianUse();
    else if(a==='extract') doExtract();
    else if(a==='refine-eq'){ const rq=$('refine-equip'); if(rq && rq.value) doRefine(findItem(rq.value)); }
    else if(a==='inlay') doInlaySelected();
    else if(a==='ore-refine') doOreRefine();
    else if(a==='furnace') doFurnace();
    else if(a==='buy-mat') buyMaterial(d.getAttribute('data-key'), parseInt(d.getAttribute('data-price'),10));
    else if(a==='buy-crystal'){
      const k=d.getAttribute('data-key'), price=parseInt(d.getAttribute('data-price'),10);
      if(state.player.gold<price) log('<span class="dmg">金币不足</span>');
      else { state.player.gold-=price; addCrystalStone(k,1); log('购买 <span class="loot">'+crystalName(k)+' x1</span>'); renderTab(); renderHeader(); }
    }
    else if(a==='courier'){ const r=courierTravel(d.getAttribute('data-map')); log(r.ok? ('<span class="loot">'+r.msg+'</span>') : ('<span class="dmg">'+r.msg+'</span>')); renderMap(); renderHeader(); }
    else if(a==='consolidate'){
      const n=consolidateBag();
      log('<span class="sys">整理完成，合并 '+n+' 个同类物品。</span>');
      renderTab();
    }
    else if(a==='extract-junk') autoExtractJunk();
    else if(a==='mine-start'){ const r=mineStart(LS.mineGrade, LS.mineMap); log(r.ok? ('<span class="loot">'+r.msg+'</span>') : ('<span class="dmg">'+r.msg+'</span>')); renderTab(); }
    else if(a==='gem-refine') doGemRefine(LS.gemSeries, LS.gemGrade);
    else if(a==='potion-refine') doPotionRefine(d.getAttribute('data-r'));
    else if(a==='equip-title'){
      const k=d.getAttribute('data-key');
      if(equipTitle(k)){ log('<span class="sys">佩戴称号：'+((titleByKey(k)||{}).name||k)+'</span>'); renderTab(); renderHeader(); }
    }
  });
  // （原先这里有个空的 [data-equip-inlay] 占位，属性从未渲染，已删）
}
export function findItem(uid){
  const p=state.player;
  for(const s in p.equip) if(p.equip[s]&&p.equip[s].uid===uid) return p.equip[s];
  return p.bag.find(b=>b.uid===uid);
}

// 装备面板也支持镶嵌（点击已装备或背包装备触发选为镶嵌目标）
