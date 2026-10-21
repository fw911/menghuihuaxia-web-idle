/* ===== 模块 tabs.js —— 右侧页签/二级子菜单 + 背包/已装备/属性渲染 =====
 * 来源：game.js L2947-3207（2026-10-21 模块化切分，内容逐字节保留）
 * 导出 23 个顶层名；import 由 AST 跨模块引用自动计算。
 */
import { state } from './state.js';
import { DATA, SLOT_NAME } from './core.js';
import { expToNext, whName } from './player.js';
import { smNodeTiers, smTierDef } from './smtree.js';
import { QNAME } from './equip.js';
import { equipScore, isTwoHand } from './bag.js';
import { $, expPct, renderHero, renderShenmo, renderSkill, renderWuhun, whStatLine } from './render.js';
import { gemSeriesName, renderLife } from './inlay.js';
import { loadCloudUI, renderAch, renderCloud, renderInstance } from './panels.js';
import { itemName, renderQuest, renderShop } from './shop.js';
import { achCats, achList, fmtNum, instEntries, instName } from './life.js';
import { bindTabClicks } from './binds.js';

// ---------- 右侧页签的二级菜单（子菜单） ----------
// 为什么要：单页内容过长时玩家要长距离下拉才能看到下面的东西。实测（1440x900，成熟存档）
// 10 个页签里 8 个要下拉：背包 x7.7 屏 / 成就 x6.9 / 商店 x4.1 / 神魔 x3.1 / 生活技能 x2.8 /
// 技能 x2.5 / 副本 x2.1 / 云存档 x1.4，只有 任务、武魂 一屏装得下。
// 做法：按「功能/类别」再拆一层横向子菜单（栏位在 #tab-pane 之外，所以滚动时菜单不跟着跑）。
// 约定：subTabs(tab).length > 1 才显示子菜单栏；≤1 表示该页本身够短，整页直出、不显示空栏。
//       所有 renderXxx(sub) 都遵守：sub 为空 → 全量渲染（= 旧行为），保证拆分不丢内容。

// 背包子菜单：按「物品用途」分（分组规则集中在 bagSubOf()，调分组只动那一处）。
// 装备单独按部位大类再拆 —— 长局背包里未装备的装备最多（逐件显示、每件两行），
// 不拆的话「装备」一页会是全背包最长的一页。
export const BAG_SUBS=[
  {key:'eq_weapon', label:'装备·武器'},
  {key:'eq_armor',  label:'装备·防具'},
  {key:'eq_jewelry',label:'装备·首饰'},
  {key:'potion',label:'药品'},
  {key:'box',   label:'宝箱·钥匙'},
  {key:'pill',  label:'百炼丹'},
  {key:'shenmo',label:'神魔道具'},
  {key:'exp',   label:'经验·辅助'},
  {key:'gem',   label:'宝石·矿石'},
  {key:'wuhun', label:'武魂'},
  {key:'other', label:'其他'}
];
// 装备部位 → slots.json 的 slot_type（weapon/offhand/armor/jewelry）。
// 用配置而不是自己维护一张部位表：slots.json 里每个部位都带 slot_type。
export function bagSlotType(slot){
  const raw=(DATA.slots||{}).slots;
  const arr=Array.isArray(raw)? raw : (raw? Object.keys(raw).map(k=>raw[k]) : []);
  const d=arr.find(x=>x && x.key===slot);
  return (d && d.slot_type) || 'armor';
}
export function equipSubOf(it){
  const t=bagSlotType(it && it.slot);
  if(t==='weapon'||t==='offhand') return 'eq_weapon';
  if(t==='jewelry') return 'eq_jewelry';
  return 'eq_armor';                  // armor 与任何未知部位：宁可落到「防具」也不要产生孤儿
}
// 背包物品 → 子菜单 key（依据 items.json 的 effect_type，即配置里的分类语义）
export function bagSubOf(it){
  if(!it) return 'other';
  if(it.type==='equip') return equipSubOf(it);
  if(it.type==='gem'||it.type==='ore') return 'gem';
  if(it.type==='wuhun') return 'wuhun';
  if(it.type!=='consumable') return 'other';
  const def=(DATA.items.items||[]).find(i=>i.key===it.key);
  const et=(def&&def.effect_type)||'';
  if(et==='hp_hot'||et==='mp_hot'||et==='instant') return 'potion';
  if(et==='box'||et==='chest_key'||et==='lucky_box') return 'box';
  if(et==='bailian_dan'||et==='bailian_recipe') return 'pill';
  if(et.indexOf('shenmo_')===0) return 'shenmo';
  if(et==='exp_buff'||et==='exp_instant'||et==='online_reward'||et==='offline_exp'
    ||et==='refine_protect'||et==='craft_reroll'||et==='craft_reroll_adv'
    ||et==='summon_souls'||et==='bless_recharge'||et==='bless_container') return 'exp';
  return 'other';
}
export function bagSubLabel(key){ const d=BAG_SUBS.find(x=>x.key===key); return d? d.label : key; }

// 主动技能子菜单：按「可学等级」分 3 段（战士 18 个主动技能一屏放不下；每个技能卡 3 行）。
export const SKILL_BANDS=[{key:'lv1',label:'初阶'},{key:'lv2',label:'中阶'},{key:'lv3',label:'高阶'}];
export function skillBand(lv){ lv=lv||1; return lv<=30? 'lv1' : (lv<=60? 'lv2' : 'lv3'); }

// 其余页签的固定子菜单（需要按数据动态生成的页签走 subTabs() 的分支）
export const TAB_SUBS={
  life:   [{key:'mine',label:'探矿'},{key:'craft',label:'打造'},
           {key:'refine',label:'炼丹·药水'},{key:'combine',label:'合成'},{key:'recycle',label:'提取·商店'}],
  wuhun:  [{key:'wear',label:'佩戴·背包'},{key:'craft',label:'炼制'}],
  shenmo: [{key:'level',label:'修验·变身'},{key:'tree',label:'技能树'}],
  skill:  [{key:'passive',label:'被动'},{key:'summon',label:'召唤兽'}],   // 主动部分由 SKILL_BANDS 拼在前
  cloud:  [{key:'save',label:'存档'},{key:'auto',label:'挂机设置'},{key:'stats',label:'统计'},{key:'rank',label:'排行'}]
};
export function subTabs(tab){
  if(tab==='bag') return BAG_SUBS;
  if(tab==='skill') return SKILL_BANDS.concat(TAB_SUBS.skill);
  if(tab==='shop') return (((DATA.shops||{}).shops)||[]).map(x=>({key:x.key,label:x.name}));
  if(tab==='instance'){
    const ks=[];
    for(const e of instEntries()) if(ks.indexOf(e.instance)<0) ks.push(e.instance);
    return ks.map(k=>({key:k,label:instName(k)}));
  }
  if(tab==='ach') return achSubs();
  // 未入道时神魔页很短（只有一段说明 + 两个按钮），不拆；
  // 入道后技能树本身还有 30+ 个节点 → 再按 tier 拆（标签用 shenmo.json#tiers 的 name）
  if(tab==='shenmo'){
    const joined=!!(state.player&&state.player.shenmo&&state.player.shenmo.faction);
    if(!joined) return [{key:'level',label:'修验·变身'}];
    const out=TAB_SUBS.shenmo.slice(0,1);          // 「修验·变身」
    for(const t of smNodeTiers()) out.push({key:'tree_'+t, label:(smTierDef(t)||{}).name || ('第'+t+'档')});
    out.push({key:'xianzhijing', label:'仙之境'});
    out.push({key:'xr_task', label:'修验任务'});
    out.push({key:'xr_str', label:'强化'});
    out.push({key:'xr_trial', label:'导师考验'});
    return out;
  }
  return TAB_SUBS[tab]||[];
}
// 成就子菜单：普通分类一项一个；「等级」24 条按 target 再拆 3 段
export function achSubs(){
  const cats=achCats(), ks=[];
  for(const a of achList()) if(ks.indexOf(a.category)<0) ks.push(a.category);
  const out=[];
  for(const k of ks){
    if(k==='level')
      out.push({key:'level_1',label:'等级·初'},{key:'level_2',label:'等级·中'},{key:'level_3',label:'等级·高'});
    else out.push({key:k,label:cats[k]||k});
  }
  out.push({key:'titles',label:'称号'});
  return out;
}
export function achSubOf(a){
  if(!a || a.category!=='level') return a? a.category : 'level_1';
  const t=a.target||0;
  return t<=40? 'level_1' : (t<=80? 'level_2' : 'level_3');
}
export function subKey(tab){
  const subs=subTabs(tab);
  if(subs.length<=1) return '';
  const cur=(state.subSel||{})[tab];
  return (cur && subs.some(x=>x.key===cur)) ? cur : subs[0].key;
}
// 子菜单栏 HTML（做成纯函数，便于测试断言）
export function renderSubtabsHtml(tab, subs, sub){
  if(!subs || subs.length<=1) return '';
  let h='';
  for(const x of subs)
    h+='<button data-subtab="'+x.key+'" class="'+(x.key===sub?'active':'')+'">'+x.label+'</button>';
  return h;
}
// 把子菜单栏写进 #subtabs（独立于 #tab-pane，内容滚动时菜单不跟着跑）。
// 点击用事件委托挂在容器上：按钮每次渲染都是新建的，逐个挂 onclick 会失效。
export function renderSubBar(tab, subs, sub){
  const el=$('subtabs'); if(!el) return;
  el.innerHTML = renderSubtabsHtml(tab, subs, sub);
  el.style.display = subs.length>1? '' : 'none';
}

export function renderTab(){
  const p=state.player; if(!p) return;
  const el=$('tab-pane'); if(!el) return;
  const tab=state.selTab;
  const subs=subTabs(tab);
  const sub = subs.length>1 ? subKey(tab) : '';   // 只有 1 个子页 = 不需要子菜单，整页直出
  renderSubBar(tab, subs, sub);
  // 装备/属性已移至常驻角色列
  if(tab==='life') el.innerHTML = renderLife(sub);
  else if(tab==='instance') el.innerHTML = renderInstance(sub);
  else if(tab==='ach') el.innerHTML = renderAch(sub);
  else if(tab==='cloud'){ el.innerHTML = renderCloud(sub); loadCloudUI(); }
  else if(tab==='skill') el.innerHTML = renderSkill(sub);
  else if(tab==='wuhun') el.innerHTML = renderWuhun(sub);
  else if(tab==='shenmo') el.innerHTML = renderShenmo(sub);
  else if(tab==='shop') el.innerHTML = renderShop(sub);
  else if(tab==='quest') el.innerHTML = renderQuest();
  else el.innerHTML = renderBag(sub);
  bindTabClicks();
  renderHero();                      // 装备/属性变动时同步角色面板
}
export function renderBag(sub){
  const p=state.player;
  const eqCount = p.bag.filter(b=>b.type==='equip').length;
  let html='<div class="bag-tools">'
    +'<button class="mini" data-act="consolidate">整理背包</button>'
    +'<button class="mini" data-act="extract-junk">分解白/绿装</button>'
    +'<span class="muted">共 '+p.bag.length+' 件（装备 '+eqCount+' 件·逐件显示；消耗品/宝石/矿石/武魂自动叠加）</span></div>';
  if(!p.bag.length){ html+='<div class="muted">空空如也，去挂机打怪吧。</div>'; return html; }

  // ① 可叠加物品（按子菜单过滤；sub 为空 = 全部，与旧行为一致）
  const shown=p.bag.filter(it=> it.type!=='equip' && (!sub || bagSubOf(it)===sub));
  for(const it of shown){
    const cnt = (it.count&&it.count>1) ? ' <span class="stack-n">×'+it.count+'</span>' : '';
    if(it.type==='consumable'){
      html+='<div class="item" data-item="'+it.uid+'">'+itemName(it.key)+cnt+'</div>';
    }else if(it.type==='gem'){
      html+='<div class="item" data-item="'+it.uid+'">宝石·'+gemSeriesName(it.series)+'·'+it.grade+cnt+'</div>';
    }else if(it.type==='wuhun'){
      html+='<div class="item" data-item="'+it.uid+'"><b>'+whName(it)+'</b> <span class="pill">Lv.'+it.level+'</span>'
        +(it.activated?'<span class="pill on">已激活</span>':'')
        +'<br><span class="muted">'+whStatLine(it)+'（到「武魂」页佩戴）</span></div>';
    }else if(it.type==='ore'){
      html+='<div class="item" data-item="'+it.uid+'">'+itemName(it.key)+'矿石'+cnt+'</div>';
    }else if(it.type==='material'){
      html+='<div class="item" data-item="'+it.uid+'">'+itemName(it.key)+cnt+'</div>';
    }
  }

  // ② 装备：每件词条/属性独立，逐件显示（不合并），按战力评分从高到低。
  //    按子菜单过滤（武器·副手 / 防具 / 首饰）；sub 为空时全部渲染（保持旧行为）。
  const allEq = p.bag.filter(b=>b.type==='equip');
  const eqs = (sub ? allEq.filter(b=>equipSubOf(b)===sub) : allEq)
    .sort((a,b)=>equipScore(b)-equipScore(a));
  if(eqs.length){
    html+='<h3 class="sec">装备（'+eqs.length+' 件 · 词条各不相同，逐件显示）</h3>';
    for(const it of eqs){
      const lt = it.bailian>0 ? ('百炼+'+it.bailian) : ('精炼+'+it.refine);
      const twoH = isTwoHand(it) ? ' <span class="pill">双手</span>' : '';
      html+='<div class="item q-'+it.quality+'" data-item="'+it.uid+'">'
        +'['+QNAME[it.quality]+'] '+SLOT_NAME[it.slot]+'·'+it.name+' <span class="pill">'+lt+'</span>'+twoH
        +'<br><span class="muted">需求'+it.reqLevel+'级 · '+statLine(it)+'</span></div>';
    }
  }
  // 子页为空时给一句提示，免得看起来像坏了
  if(sub && !shown.length && !eqs.length) html+='<div class="muted">「'+bagSubLabel(sub)+'」分类下暂无物品。</div>';
  return html;
}
export function renderEquip(){
  const p=state.player;
  let html='<h3>已装备</h3>';
  for(const slot in p.equip){
    const it=p.equip[slot];
    if(!it){ html+='<div class="item" style="opacity:.5">'+SLOT_NAME[slot]+'：空</div>'; continue; }
    const twoH = isTwoHand(it) ? ' <span class="pill">双手</span>' : '';
    html+='<div class="item equipped q-'+it.quality+'">['+QNAME[it.quality]+'] '+SLOT_NAME[slot]+'·'+it.name+' <span class="pill">+'+it.refine+'</span>'+twoH+'</div>';
    html+='<div class="muted" style="margin:-4px 0 6px 4px">'+statLine(it)+'</div>';
  }
  return html;
}
export function statLine(it){
  const parts=[];
  for(const s in it.stats) parts.push(s+':'+it.stats[s]);
  for(const pk of it.perks) parts.push(pk.name+'+'+pk.value+(pk.suffix||''));
  for(const g of it.gems) if(g) parts.push(gemSeriesName(g.series)+'(+'+g.value+')');
  if(it.durability!=null) parts.push('耐久:'+it.durability);   // 原版耐久：打造 roll + 精炼 ×1.04/级，无消耗机制
  return parts.join('  ');
}
export function renderStat(){
  const p=state.player, s=p._s;
  const a=s.attr;
  let html='<h3>基础属性 (Lv.'+p.level+')</h3><div class="muted">';
  for(const k in a) html+=k+'：'+Math.round(a[k])+'<br>';
  html+='</div><h3>战斗属性</h3><div class="muted">';
  const c=s.combat;
  const order=['phys_atk','magic_atk','phys_def','magic_def','max_hp','max_mp','phys_crit','dodge'];
  for(const k of order) if(c[k]!=null) html+=k+'：'+fmtNum(c[k])+'<br>';
  html+='</div><h3>状态</h3><div class="bar hp"><i style="width:'+(p.hp/s.max_hp*100)+'%"></i></div>'+
        '<div class="muted">HP '+fmtNum(Math.round(p.hp))+'/'+fmtNum(s.max_hp)+'</div>'+
        '<div class="bar exp" style="margin-top:6px"><i style="width:'+expPct()+'%"></i></div>'+
        '<div class="muted">EXP '+fmtNum(p.exp)+'/'+fmtNum(Math.round(expToNext(p.level)))+'</div>';
  return html;
}
// 生活技能面板辅助
export function slotOpts(sel){
  const slots=['weapon','armor','helmet','shoulder_l','pants','cloak','gloves','belt','shoes','shield','necklace','ring1','ring2'];
  return slots.map(s=> '<option value="'+s+'"'+(sel===s?' selected':'')+'>'+SLOT_NAME[s]+'</option>').join('');
}
export function tierOpts(sel){ let h=''; for(let t=1;t<=7;t++) h+='<option value="'+t+'"'+(sel===t?' selected':'')+'>'+t+'档</option>'; return h; }
export function equipOpts(sel){
  const p=state.player; const list=[];
  for(const s in p.equip) if(p.equip[s]) list.push(p.equip[s]);
  for(const b of p.bag) if(b.type==='equip') list.push(b);
  if(!list.length) return '<option value="">（无装备）</option>';
  return list.map(it=> '<option value="'+it.uid+'"'+(sel===it.uid?' selected':'')+'>'+(it.bailian?'+'+it.bailian+' ':'')+'['+QNAME[it.quality]+'] '+SLOT_NAME[it.slot]+'·'+it.name+'</option>').join('');
}
// 可精炼装备（未满级的，按战力评分从高到低）—— 下拉与面板详情共用同一份口径
export function refineEquipList(){
  const p=state.player; if(!p) return [];
  const max=(DATA.refine||{}).refine_max||7;
  const list=[];
  for(const s in p.equip) if(p.equip[s]) list.push(p.equip[s]);
  for(const b of p.bag) if(b.type==='equip') list.push(b);
  return list.filter(it=> (it.refine||0)<max).sort((a,b)=>equipScore(b)-equipScore(a));
}
