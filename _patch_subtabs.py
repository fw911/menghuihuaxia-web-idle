# -*- coding: utf-8 -*-
"""给 web_idle 加「右侧页签二级菜单（子菜单）」。

背景（实测 1440x900，见 _subtabs_report.txt）：10 个页签里 8 个需要长距离下拉才能看完
（背包 x7.68 / 成就 x6.90 / 商店 x4.09 / 神魔 x3.10 / 生活技能 x2.81 / 技能 x2.48 /
副本 x2.12 / 云存档 x1.37 屏），只有 任务 / 武魂 一屏装得下。

做法：每个页签按「功能/类别」再拆一层横向子菜单（栏位在 #tab-pane 之外的 #subtabs，
内容滚动时菜单不跟着跑）。所有 renderXxx 都加了可选的 sub 参数：
    renderXxx()        → 全量渲染（= 旧行为，测试/导出/云存档都依赖它）
    renderXxx('key')   → 只渲染该子页
这条「无参 = 全量」的约定是关键：既有断言一条都不用改，也保证拆分不丢内容。

game.js 是 CRLF，必须用显式 \\r\\n 写回。
"""
import io, os, re, sys

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, 'game.js')

s = io.open(SRC, encoding='utf-8', newline='').read()
n_before = len(s)
s = s.replace('\r\n', '\n')
if '\r' in s:
    sys.exit('发现裸 CR，无法安全处理')

hits = []


def rep(old, new, expect=1, tag=''):
    """精确替换 + 出现次数断言：不符立即退出，不写回。"""
    global s
    got = s.count(old)
    if got != expect:
        sys.exit('[%s] 期望 %d 处，实际 %d 处\n---- 片段 ----\n%s' % (tag, expect, got, old[:400]))
    hits.append((tag, got))
    s = s.replace(old, new)


def replace_func(name, new_text):
    """按「函数首行 → 首个列 0 的 }」替换整个函数，避免大段文本比对出错。"""
    global s
    m = re.search(r'^function ' + re.escape(name) + r'\([^\n]*\)\{\n', s, re.M)
    if not m:
        sys.exit('找不到函数 %s' % name)
    end = s.index('\n}\n', m.end() - 1) + 3
    if not new_text.endswith('}'):
        sys.exit('%s 的新文本应以 } 结尾' % name)
    s = s[:m.start()] + new_text + '\n' + s[end:]
    hits.append(('func:' + name, 1))


# ============================================================
# 1) state 增加 subSel（每个页签选中的子页）
# ============================================================
rep("  selTab:'bag',\n  logLines:[],",
    "  selTab:'bag',\n  subSel:{},       // 每个页签选中的二级菜单（子菜单）key：{bag:'equip', ...}（不写存档，刷新回默认首项）\n  logLines:[],",
    1, 'state.subSel')


# ============================================================
# 2) 二级菜单基础设施 + 替换 renderTab
# ============================================================
SUB_INFRA = r'''// ---------- 右侧页签的二级菜单（子菜单） ----------
// 为什么要：单页内容过长时玩家要长距离下拉才能看到下面的东西。实测（1440x900，成熟存档）
// 10 个页签里 8 个要下拉：背包 x7.7 屏 / 成就 x6.9 / 商店 x4.1 / 神魔 x3.1 / 生活技能 x2.8 /
// 技能 x2.5 / 副本 x2.1 / 云存档 x1.4，只有 任务、武魂 一屏装得下。
// 做法：按「功能/类别」再拆一层横向子菜单（栏位在 #tab-pane 之外，所以滚动时菜单不跟着跑）。
// 约定：subTabs(tab).length > 1 才显示子菜单栏；≤1 表示该页本身够短，整页直出、不显示空栏。
//       所有 renderXxx(sub) 都遵守：sub 为空 → 全量渲染（= 旧行为），保证拆分不丢内容。

// 背包子菜单：按「物品用途」分（分组规则集中在 bagSubOf()，调分组只动那一处）
const BAG_SUBS=[
  {key:'equip', label:'装备'},
  {key:'potion',label:'药品'},
  {key:'box',   label:'宝箱·钥匙'},
  {key:'pill',  label:'百炼丹'},
  {key:'shenmo',label:'神魔道具'},
  {key:'exp',   label:'经验·辅助'},
  {key:'gem',   label:'宝石·矿石'},
  {key:'wuhun', label:'武魂'},
  {key:'other', label:'其他'}
];
// 背包物品 → 子菜单 key（依据 items.json 的 effect_type，即配置里的分类语义）
function bagSubOf(it){
  if(!it) return 'other';
  if(it.type==='equip') return 'equip';
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
function bagSubLabel(key){ const d=BAG_SUBS.find(x=>x.key===key); return d? d.label : key; }

// 其余页签的固定子菜单（需要按数据动态生成的页签走 subTabs() 的分支）
const TAB_SUBS={
  life:   [{key:'mine',label:'探矿'},{key:'craft',label:'打造'},
           {key:'refine',label:'炼丹·药水'},{key:'combine',label:'合成'},{key:'recycle',label:'提取·商店'}],
  wuhun:  [{key:'wear',label:'佩戴·背包'},{key:'craft',label:'炼制'}],
  shenmo: [{key:'level',label:'修验·变身'},{key:'tree',label:'技能树'}],
  skill:  [{key:'active',label:'主动'},{key:'passive',label:'被动'},{key:'summon',label:'召唤兽'}],
  cloud:  [{key:'save',label:'存档'},{key:'auto',label:'挂机设置'},{key:'stats',label:'统计'},{key:'rank',label:'排行'}]
};
function subTabs(tab){
  if(tab==='bag') return BAG_SUBS;
  if(tab==='shop') return (((DATA.shops||{}).shops)||[]).map(x=>({key:x.key,label:x.name}));
  if(tab==='instance'){
    const ks=[];
    for(const e of instEntries()) if(ks.indexOf(e.instance)<0) ks.push(e.instance);
    return ks.map(k=>({key:k,label:instName(k)}));
  }
  if(tab==='ach'){
    const cats=achCats(), ks=[];
    for(const a of achList()) if(ks.indexOf(a.category)<0) ks.push(a.category);
    return ks.map(k=>({key:k,label:cats[k]||k}));
  }
  // 未入道时神魔页很短（只有一段说明 + 两个按钮），不拆
  if(tab==='shenmo'){
    const joined=!!(state.player&&state.player.shenmo&&state.player.shenmo.faction);
    return joined? TAB_SUBS.shenmo : [{key:'level',label:'修验·变身'}];
  }
  return TAB_SUBS[tab]||[];
}
function subKey(tab){
  const subs=subTabs(tab);
  if(subs.length<=1) return '';
  const cur=(state.subSel||{})[tab];
  return (cur && subs.some(x=>x.key===cur)) ? cur : subs[0].key;
}
// 子菜单栏 HTML（做成纯函数，便于测试断言）
function renderSubtabsHtml(tab, subs, sub){
  if(!subs || subs.length<=1) return '';
  let h='';
  for(const x of subs)
    h+='<button data-subtab="'+x.key+'" class="'+(x.key===sub?'active':'')+'">'+x.label+'</button>';
  return h;
}
// 把子菜单栏写进 #subtabs（独立于 #tab-pane，内容滚动时菜单不跟着跑）。
// 点击用事件委托挂在容器上：按钮每次渲染都是新建的，逐个挂 onclick 会失效。
function renderSubBar(tab, subs, sub){
  const el=$('subtabs'); if(!el) return;
  el.innerHTML = renderSubtabsHtml(tab, subs, sub);
  el.style.display = subs.length>1? '' : 'none';
}

'''
rep('function renderTab(){', SUB_INFRA + 'function renderTab(){', 1, 'insert-infra')

NEW_RENDERTAB = r'''function renderTab(){
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
}'''
replace_func('renderTab', NEW_RENDERTAB)


# ============================================================
# 3) renderBag(sub)
# ============================================================
NEW_RENDERBAG = r'''function renderBag(sub){
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
      const def=(DATA.items.items||[]).find(i=>i.key===it.key)||{name:it.key};
      html+='<div class="item" data-item="'+it.uid+'">'+def.name+cnt+'</div>';
    }else if(it.type==='gem'){
      html+='<div class="item" data-item="'+it.uid+'">宝石·'+it.series+'·'+it.grade+cnt+'</div>';
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
  //    只属于「装备」子页；sub 为空时也渲染（保持旧行为）。
  const eqs = (!sub || sub==='equip')
    ? p.bag.filter(b=>b.type==='equip').sort((a,b)=>equipScore(b)-equipScore(a))
    : [];
  if(eqs.length){
    html+='<h3 class="sec">装备（'+eqs.length+' 件 · 词条各不相同，逐件显示）</h3>';
    for(const it of eqs){
      const lt = it.bailian>0 ? ('百炼+'+it.bailian) : ('精炼+'+it.refine);
      html+='<div class="item q-'+it.quality+'" data-item="'+it.uid+'">'
        +'['+QNAME[it.quality]+'] '+SLOT_NAME[it.slot]+'·'+it.name+' <span class="pill">'+lt+'</span>'
        +'<br><span class="muted">需求'+it.reqLevel+'级 · '+statLine(it)+'</span></div>';
    }
  }
  // 子页为空时给一句提示，免得看起来像坏了
  if(sub && !shown.length && !eqs.length) html+='<div class="muted">「'+bagSubLabel(sub)+'」分类下暂无物品。</div>';
  return html;
}'''
replace_func('renderBag', NEW_RENDERBAG)


# ============================================================
# 4) renderLife(sub)
# ============================================================
NEW_RENDERLIFE = r'''function renderLife(sub){
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
    h+='装备：<select id="bail-equip">'+equipOpts(LS.bailEquip)+'</select> <button class="mini" data-act="bailian-use">百炼升阶</button>';
    push('craft',h);
  }

  // ④ 提取回收
  if(any || sub==='recycle'){
    let h='<hr><h3>④ 提取（回收）</h3><div class="muted">分解装备，回收 '+DATA.extract.ore_per_equip+' 个本档矿石与已镶嵌宝石，装备销毁。</div>';
    h+='装备：<select id="extract-equip">'+equipOpts(LS.extractEquip)+'</select> <button class="mini" data-act="extract">提取</button>';
    push('recycle',h);
  }

  // ⑤ 矿石炼制
  if(any || sub==='combine'){
    let h='<hr><h3>⑤ 矿石炼制</h3><div class="muted">下级矿石+晶石+金币 → 高级矿石（'+DATA.ore_recipes.recipe_ore_4.time+'/次，即时）。</div>';
    h+='配方：<select id="ore-recipe">'+oreRecipeOpts()+'</select> <button class="mini" data-act="ore-refine">炼制</button>';
    push('combine',h);
  }

  // ⑥ 乾坤炉合成
  if(any || sub==='combine'){
    let h='<hr><h3>⑥ 乾坤炉合成</h3><div class="muted">南郡·乾坤炉：消耗材料+金币，瞬间合成（详见 data/furnace_recipes.json）。</div>';
    h+='配方：<select id="furnace-recipe">'+furnaceOpts()+'</select> <button class="mini" data-act="furnace">合成</button>';
    push('combine',h);
  }

  // ⑦ 探矿
  if(any || sub==='mine'){
    const mc=mineConf();
    const ml=(p.mining&&p.mining.level)||1, mexp=(p.mining&&p.mining.exp)||0, mneed=mineExpNeed(ml);
    let h='<hr><h3>⑦ 探矿（罗盘）</h3><div class="muted">探矿等级 '+ml+'（'+mexp+'/'+mneed+'）· 矿石产量 +'+((ml-1)*5)+'%；每轮消耗 1 个罗盘，约 '+((mc.steps||[]).reduce((a,b)=>a+(b.seconds||0),0))+' 秒。</div>';
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
}'''
replace_func('renderLife', NEW_RENDERLIFE)


# ============================================================
# 5) renderInstance(sub)
# ============================================================
NEW_RENDERINSTANCE = r'''function renderInstance(sub){
  const p=state.player; const spec=instSpec();
  let html='<h3>副本护符兑换</h3><div class="muted">首领掉落对应护符：香魂冢·英灵护符（临海）、轩辕台·光明护符（轩辕）、古墓·死亡护符（葱郁沼泽）。'
    +'集齐 '+5+' 个可换本职业固定规格装备（+'+(spec.refine||5)+' 精炼 · '+(spec.sockets||3)+' 孔 · 词条取中值）。</div>';
  const groups={};
  instEntries().forEach(e=>{ (groups[e.instance]=groups[e.instance]||[]).push(e); });
  let shown=0;
  for(const ik in groups){
    if(sub && ik!==sub) continue;               // 按子菜单只显示该副本（sub 为空 = 全部）
    shown++;
    html+='<div class="shop"><div class="shop-name">'+instName(ik)+'（兑换 NPC：'+instMapName(groups[ik][0].npc_map)+'）</div>';
    for(const e of groups[ik]){
      const have=itemCount(e.cost_key), okc=have>=(e.cost_count||1);
      html+='<div class="item" data-inst="'+e._k+'"'+(okc?'':' style="opacity:.55"')+'><b>'+(SLOT_NAME[e.slot]||e.slot)+'</b> '+e.tier+' 档'
        +' <span class="pill">'+itemName(e.cost_key)+' x'+e.cost_count+'（有 '+have+'）</span>'
        +'<br><span class="muted">产出：+'+(spec.refine||5)+' 精炼 · '+(spec.sockets||3)+' 孔 · '+(e.tier*10)+' 档中值词条（本职业）</span></div>';
    }
    html+='</div>';
  }
  if(sub && !shown) html+='<div class="muted">该副本暂无可兑换条目。</div>';
  return html;
}'''
replace_func('renderInstance', NEW_RENDERINSTANCE)


# ============================================================
# 6) renderAch(sub)
# ============================================================
NEW_RENDERACH = r'''function renderAch(sub){
  const p=state.player; const cats=achCats();
  const list=achList();
  let done=0; for(const k in (p.ach||{})) done++;
  const groups={};
  list.forEach(a=>{ (groups[a.category]=groups[a.category]||[]).push(a); });
  // 按子菜单只显示该分类（sub 为空 = 全部分类，与旧行为一致）
  const cur = (sub && groups[sub]) ? sub : '';
  const use = cur ? [cur] : Object.keys(groups);
  let html='<h3>成就'+(cur? '（'+(cats[cur]||cur)+'）':'')+'</h3><div class="muted">共 '+list.length+' 项，已达成 '+done+' 项；达成后自动发放奖励（金币/道具/神秘结晶）。</div>';
  for(const c of use){
    html+='<div class="shop"><div class="shop-name">'+(cats[c]||c)+'</div>';
    for(const a of groups[c]){
      const v=Math.min(achValue(a), a.target||1), isDone=achDone(a.key);
      const rw=[];
      if(a.reward_coins) rw.push(a.reward_coins+' 金币');
      if(a.reward_coupon) rw.push(a.reward_coupon+' 结晶');
      for(const r of (a.reward_items||[])) rw.push(itemName(r.key)+' x'+r.count);
      html+='<div class="item'+(isDone?'':' lock')+'"><b>'+a.name+'</b> '+(isDone? '<span class="pill">已达成</span>' : '<span class="pill">'+v+' / '+a.target+'</span>')
        +'<br><span class="muted">'+a.desc+(rw.length? '　奖励：'+rw.join('、'):'')+'</span></div>';
    }
    html+='</div>';
  }
  if(sub && !cur) html+='<div class="muted">没有这个成就分类。</div>';
  return html;
}'''
replace_func('renderAch', NEW_RENDERACH)


# ============================================================
# 7) renderSkill(sub)
# ============================================================
NEW_RENDERSKILL = r'''function renderSkill(sub){
  const p=state.player;
  const any=!sub, on=k=>any||sub===k;         // sub 为空 = 全量渲染（旧行为）
  let html='<div class="muted">达到学习等级自动学会；升级消耗金币与经验（取自技能真实 requirements）。挂机时会自动施放技能。</div>';
  if(on('active')){
    const list=jobSkills(p.job);
    const learned=Object.keys(p.skills||{}).length;
    html+='<h3 class="sec">主动技能（已学 '+learned+'/'+list.length+'）</h3>';
    for(const s of list){
      const lv=(p.skills||{})[s.key]||0;
      if(lv<=0){
        html+='<div class="item lock"><b>'+s.name+'</b> <span class="pill">未学会</span>'
          +'<br><span class="muted">'+(SKILL_TYPE_CN[s.skill_type]||s.skill_type)+' · 需角色 Lv.'+(s.learn_level||1)+'</span></div>';
        continue;
      }
      const L=skillLvData(s,lv);
      const cd=(p.skillCd||{})[s.key]||0;
      const req=skillUpgradeReq(s,lv);
      const maxed=lv>=(s.max_level||1);
      html+='<div class="item"><b>'+s.name+'</b> <span class="pill">Lv.'+lv+'/'+s.max_level+'</span>'
        +'<span class="muted"> '+(SKILL_TYPE_CN[s.skill_type]||s.skill_type)+' · MP '+(L.mp||0)+' · CD '+(L.cd!=null?L.cd:(s.cd||1))+'</span>'
        +(cd>0?'<span class="pill">冷却 '+cd+'</span>':'')
        +'<br><span class="muted">'+(L.desc||s.desc||'')+'</span>';
      if(!maxed && req){
        html+='<br><span class="muted">升级需 Lv.'+req.level+' · 金币 '+(req.money||0)+' · 经验 '+(req.exp||0)+'</span>'
          +' <button class="mini" data-skill="'+s.key+'">升级</button>';
      }else if(maxed) html+='<br><span class="muted">已达最高等级</span>';
      html+='</div>';
    }
  }
  if(on('passive')){
    html+='<h3 class="sec">被动技能</h3>';
    for(const ps of PASSIVES){
      if((ps.jobs||[]).indexOf(p.job)<0) continue;
      const lv=passiveLevel(p,ps);
      if(lv<=0){
        html+='<div class="item lock"><b>'+ps.name+'</b> <span class="pill">未领悟</span>'
          +'<br><span class="muted">需 Lv.'+(ps.learn_level||1)+' · '+(ps.desc||'')+'</span></div>';
        continue;
      }
      const arr=ps.levels||[];
      const e=arr.length? arr[Math.max(0,Math.min(lv-1,arr.length-1))] : (ps.effect||{});
      html+='<div class="item"><b>'+ps.name+'</b> <span class="pill">Lv.'+lv+'/'+ps.max_level+'</span>'
        +'<br><span class="muted">'+Object.keys(e).map(k=>(ATTR_LABEL[k]||k)+' +'+e[k]).join('　')+'　（每 5 级自动 +1）</span></div>';
    }
  }
  // 召唤兽（summons.json + 召唤技能表）
  if(on('summon') && DATA.summons){
    html+='<h3 class="sec">召唤兽</h3>';
    for(const k in DATA.summons){
      const d=DATA.summons[k];
      const lvs=Object.keys(d.levels||{}).map(Number).sort((a,b)=>a-b);
      const minLv=lvs[0]||1;
      if(p.level<minLv){
        html+='<div class="item lock"><b>'+d.name+'</b> <span class="pill">未解锁</span><br><span class="muted">需角色 Lv.'+minLv+'</span></div>';
        continue;
      }
      const t=summonTier(k, p.level);
      const onz=(p.summon===k);
      html+='<div class="item" data-summon="'+k+'"><b>'+d.name+'</b> <span class="pill">'+(onz?'出战中':'待命')+'</span> <span class="muted">阶段 Lv.'+t.lv+'（'+(d.type==='magic'?'法术':'物理')+'）</span>'
        +'<br><span class="muted">生命 '+t.data.hp+' · 攻击 '+t.data.min_phys+'~'+t.data.max_phys+' · 物防 '+t.data.min_phys_def+' · 速度 '+t.data.speed+'　（分担 30% 伤害，每回合出手）</span></div>';
    }
    html+='<div class="muted">点击切换出战/待命。召唤兽属性随角色等级自动取对应阶段。</div>';
  }
  return html;
}'''
replace_func('renderSkill', NEW_RENDERSKILL)


# ============================================================
# 8) renderWuhun(sub)
# ============================================================
NEW_RENDERWUHUN = r'''function renderWuhun(sub){
  const p=state.player;
  if(!p.wuhunSlots) p.wuhunSlots=[null,null];
  if(!state.whSel) state.whSel=[];
  const any=!sub, on=k=>any||sub===k;         // sub 为空 = 全量渲染（旧行为）
  let html='<div class="muted">武魂佩戴后杀怪吸经验成长；圆满可进化升星，激活需对应星级启魂符。</div>';
  if(on('wear')){
    html+='<h3 class="sec">佩戴槽位（双槽）</h3>';
    for(let i=0;i<2;i++){
      const o=p.wuhunSlots[i];
      html+='<div class="wh-slot">';
      if(o){
        const maxLv=whMaxLevel(o.whType,o.star);
        const need=wuhunExpNeed(o);
        html+='<div class="wh-row"><b>'+whName(o)+'</b> <span class="pill">Lv.'+o.level+'/'+maxLv+'</span>'
          +(o.activated?'<span class="pill on">已激活</span>':'<span class="pill">未激活</span>')+'</div>';
        html+='<div class="muted">'+whStatLine(o)+'</div>';
        if(o.level<maxLv){
          html+='<div class="bar exp" style="margin:4px 0"><i style="width:'+clamp((o.exp||0)/need*100,0,100)+'%"></i></div>';
          html+='<div class="muted">修炼值 '+Math.round(o.exp||0)+' / '+need+'</div>';
        }else html+='<div class="muted">已修炼圆满，可用于进化升星</div>';
        html+='<div style="margin-top:4px"><button class="mini" data-wh="unequip" data-slot="'+i+'">卸下</button> ';
        if(!o.activated) html+='<button class="mini" data-wh="act" data-uid="'+o.uid+'">潜能激活</button>';
        else html+='<button class="mini" data-wh="anni" data-uid="'+o.uid+'">湮灭</button>';
        html+='</div>';
      }else html+='<div class="muted">槽位 '+(i+1)+'：空（点击下方武魂佩戴）</div>';
      html+='</div>';
    }
    const list=p.bag.filter(b=>b.type==='wuhun');
    html+='<h3 class="sec">武魂背包（'+list.length+'）</h3>';
    if(!list.length) html+='<div class="muted">暂无武魂，击杀精英/首领有几率掉落。</div>';
    for(const o of list){
      const maxLv=whMaxLevel(o.whType,o.star);
      const req=whReqLevel(o.star);
      const sel=state.whSel.indexOf(o.uid)>=0;
      html+='<div class="item'+(sel?' sel':'')+'" data-wh-item="'+o.uid+'">'
        +'<b>'+whName(o)+'</b> <span class="pill">Lv.'+o.level+'/'+maxLv+'</span>'
        +(o.activated?'<span class="pill on">已激活</span>':'')
        +(p.level<req?' <span class="muted">（佩戴需 Lv.'+req+'）</span>':'')
        +'<br><span class="muted">'+whStatLine(o)+'</span></div>';
    }
    if(list.length){
      html+='<div class="bag-tools">'
        +'<button class="mini" data-wh="equip">佩戴所选</button>'
        +'<button class="mini" data-wh="evolve">进化(选2同星圆满)</button>'
        +'<button class="mini" data-wh="fuse">融合(选2已激活)</button>'
        +'<button class="mini" data-wh="recycle">回收换结晶</button>'
        +'<button class="mini" data-wh="clear">取消选择</button>'
        +'<span class="muted">已选 '+state.whSel.length+' 个</span></div>';
    }
  }
  if(on('craft')){
    html+='<h3 class="sec">武魂炼制</h3><div class="muted">消耗三魂七魄 + 淬魂瓶 + 下级符令。</div>';
    const R=DATA.wuhun_recipes||{};
    html+='<div class="craft-row"><select id="wh-recipe">';
    for(const k in R) html+='<option value="'+k+'">'+R[k].name+'</option>';
    html+='</select> <button class="mini" data-wh="craft">炼制</button></div>';
    html+='<div class="muted" style="margin-top:6px">淬魂瓶 '+(p.materials.lianhua_ping||0)
      +' · 魂魄 '+soulCount()+'　|　启魂符 '+matSeries('lingyin')+'　融魂令 '+matSeries('mingqi')+'　化星诀 '+matSeries('niepan')+'</div>';
  }
  return html;
}'''
replace_func('renderWuhun', NEW_RENDERWUHUN)


# ============================================================
# 9) renderShenmo(sub) —— 拆成 修验·变身 / 技能树
# ============================================================
NEW_RENDERSHENMO = r'''function renderShenmo(sub){
  const p=state.player; const S=sm();
  const need=(S.entry||{}).min_char_level||101;
  const cur = (p.shenmo&&p.shenmo.faction) ? smTransform(p.shenmo.level||1) : null;
  if(!p.shenmo||!p.shenmo.faction){
    let html='<div class="muted">神魔修验为 101 级后开启的深层体系。入道后挂机积累修验值，提升变身阶位获得攻/防/血/减伤加成。</div>';
    html+='<div class="bar exp" style="margin:6px 0"><i style="width:'+clamp(p.level/need*100,0,100)+'%"></i></div>';
    html+='<div class="muted">入道需角色 Lv.'+need+'（当前 Lv.'+p.level+'）</div>';
    html+='<div class="bag-tools">'
      +'<button class="mini" data-sm="join" data-f="shen">入神道（防御/团队）</button>'
      +'<button class="mini" data-sm="join" data-f="mo">入魔道（输出/控制）</button></div>';
    return html;   // 未入道时页面很短，不分节
  }
  const s=p.shenmo, td=smTier(s.spent||0);
  // ---- 段一：修验概况（归「修验·变身」子页）----
  let info='<div class="wh-slot"><div class="wh-row"><b>'+(((S.factions||{})[s.faction]||{}).name)+'</b>'
    +' <span class="pill on">'+smTitle(s.faction,s.level)+'</span></div>';
  info+='<div class="muted">修验等级 '+(s.level||1)+' / '+smMaxLevel()+' · 可用修验点 '+(s.points||0)+' · 已投入 '+(s.spent||0)+'</div>';
  if((s.level||1)<smMaxLevel()){
    const nd=smExpNeed(s.level||1);
    info+='<div class="bar exp" style="margin:4px 0"><i style="width:'+clamp((s.exp||0)/nd*100,0,100)+'%"></i></div>';
    info+='<div class="muted">修验值 '+Math.round(s.exp||0)+' / '+nd+'</div>';
  }else info+='<div class="muted">修验已满级</div>';
  if(cur) info+='<div class="muted">变身加成：攻击 +'+cur.atk+' · 防御 +'+cur.def+' · 生命 +'+cur.hp+' · 减伤 '+cur.dmg_reduce+'%</div>';
  info+='<div class="muted">当前档位：'+(td.name||'一档')+'（每级 +'+(td.points_per_level||1)+' 修验点）</div></div>';
  // ---- 段二：修验技能树（归「技能树」子页）----
  const nodes=smNodes();
  const spent=smSpent();
  let tree='<h3 class="sec">修验技能树</h3>';
  tree+='<div class="muted">可用修验点 <b style="color:var(--gold)">'+(s.points||0)+'</b> · 已投入 '+spent+' 点'
    +(nodes.fallback? '　（原版配置仅含战士节点，当前职业沿用战士节点）':'')+'</div>';
  tree+='<div class="bag-tools"><button class="mini" data-smact="reset">重置加点</button></div>';
  const byTier={};
  nodes.list.filter(d=>d.faction===s.faction).forEach(d=>{ (byTier[d.tier]=byTier[d.tier]||[]).push(d); });
  for(const tk of Object.keys(byTier).sort()){
    const td2=smTierDef(Number(tk));
    tree+='<div class="muted" style="margin-top:6px">'+(td2.name||('第'+tk+'档'))+'（解锁需累计投入 '+(td2.spent_required||0)+' 点 · 每级 '+(td2.points_per_level||1)+' 点）</div>';
    for(const d of byTier[tk]){
      const lv=smNodeLv(d.key), max=d.max_level||1;
      const unlocked = spent >= (td2.spent_required||0);
      const preq = smPrereqOk(d), eq = smEquipOk(d);
      const can = unlocked && preq && lv<max && (s.points||0) >= (td2.points_per_level||1);
      tree+='<div class="item'+(lv>0?' sel':'')+(can?'':' lock')+'" data-smnode="'+d.key+'">'
        +'<b>'+d.name+'</b> <span class="pill">Lv.'+lv+'/'+max+'</span>'+(d.type==='active'?' <span class="pill">主动</span>':'')
        +'<br><span class="muted">'+smFmt(d, lv||1)+'</span>'
        +'<br><span class="muted">'+(lv>=max? '已满级' : (unlocked? (preq? '点击 +1 级（消耗 '+(td2.points_per_level||1)+' 点）' : '前置未满足') : '需累计投入 '+(td2.spent_required||0)+' 点解锁'))
        +(eq?'':' · 当前装备不满足，暂不生效')+'</span></div>';
    }
  }
  // ---- 段三：变身阶位一览（归「修验·变身」子页）----
  let lvls='<h3 class="sec">变身阶位一览</h3>';
  const fac=(p.shenmo&&p.shenmo.faction)||'shen';
  for(const t of (S.transform_levels||[])){
    const onz = cur && cur.min_level===t.min_level;
    lvls+='<div class="item'+(onz?' sel':'')+'">Lv.'+t.min_level+' · '+smTitle(fac, t.min_level)
      +'<br><span class="muted">攻+'+t.atk+' 防+'+t.def+' 血+'+t.hp+' 减伤'+t.dmg_reduce+'%</span></div>';
  }
  if(!sub) return info+tree+lvls;             // 旧行为：全量、原顺序
  return sub==='tree'? tree : (info+lvls);
}'''
replace_func('renderShenmo', NEW_RENDERSHENMO)


# ============================================================
# 10) renderShop(sub)
# ============================================================
NEW_RENDERSHOP = r'''function renderShop(sub){
  const p=state.player;
  const shops=DATA.shops.shops||[];
  const sdef=sub? shops.find(x=>x.key===sub) : null;
  let html='<h3>商店'+(sdef? '（'+sdef.name+'）':'')+'</h3><div class="muted">金币 <b style="color:var(--gold)">'+fmtNum(p.gold)+'</b> · 神秘结晶 <b style="color:var(--purple)">'+fmtNum(p.crystal)+'</b>（精英 +1 / 首领 +5）</div>';
  html+='<div class="muted" style="margin:6px 0 2px">神秘商人兑换部位：<select id="mystic-slot">'+mysticSlotOptions()+'</select></div>';
  for(const shop of shops){
    if(sub && shop.key!==sub) continue;       // 按子菜单只显示该商店（sub 为空 = 全部）
    html+='<div class="shop"><div class="shop-name">'+shop.name+'</div><div class="muted">'+shop.desc+'</div>';
    for(let i=0;i<shop.items.length;i++){
      const it=shop.items[i];
      let label='';
      if(it.kind==='consumable'||it.kind==='ore') label=itemName(it.item);
      else if(it.kind==='equip') label=it.name;
      else if(it.kind==='mystic_equip') label=it.name;
      const cur = it.kind==='mystic_equip'? p.crystal : p.gold;
      const afford = cur>=it.price;
      const unit = it.kind==='mystic_equip'?'结晶':'金';
      html+='<div class="item shop-item" data-buy="'+shop.key+'|'+i+'"'+(afford?'':' style="opacity:.55"')+'>'+label+' <span class="pill">'+fmtNum(it.price)+unit+'</span></div>';
    }
    html+='</div>';
  }
  if(sub && !sdef) html+='<div class="muted">没有这个商店。</div>';
  return html;
}'''
replace_func('renderShop', NEW_RENDERSHOP)


# ============================================================
# 11) renderCloud(sub) —— 拆成 存档 / 挂机设置 / 统计 / 排行
#     只包分节 + 加 sub 参数，节内文本一字不动（测试对 renderCloud() 无参调用有大量断言）
# ============================================================
rep("""function renderCloud(){
  const p=state.player, C=state.cloud;
  let html='<h3>后端服务</h3>';""",
    """function renderCloud(sub){
  const p=state.player, C=state.cloud;
  const any=!sub, on=k=>any||sub===k;         // sub 为空 = 全量渲染（旧行为，测试依赖）
  let html='';
  if(on('save')) html+='<h3>后端服务</h3>';""", 1, 'cloud-head')

rep("""  html+='<hr><h3>账号'+(C.user? '（已登录）':'')+'</h3>';""",
    """  if(on('save')) html+='<hr><h3>账号'+(C.user? '（已登录）':'')+'</h3>';""", 1, 'cloud-acc-head')

rep("""  if(!C.ok){
    html+='<div class="muted">后端未启动，云存档不可用。启动后刷新页面即可。</div>';
  }else if(C.user){
    html+='<div class="muted">账号 <b style="color:var(--gold)">'+C.user+'</b>　当前槽位：'+C.slot+'</div>';
    html+='<div class="bag-tools"><button class="mini" data-cloudact="logout">退出登录</button></div>';
  }else{
    html+='<div class="row"><input class="name" id="cloud-user" placeholder="账号（2~16 位）" style="flex:1;min-width:120px"/>'
      +'<input class="name" id="cloud-pass" type="password" placeholder="密码（≥6 位）" style="flex:1;min-width:120px"/></div>';
    html+='<div class="bag-tools"><button class="mini" data-cloudact="register">注册</button>'
      +'<button class="mini" data-cloudact="login">登录</button></div>';
    html+='<div class="muted">注册后存档存到服务器，换浏览器/设备都能继续；未登录时仅存本机。</div>';
  }""",
    """  if(on('save')){
  if(!C.ok){
    html+='<div class="muted">后端未启动，云存档不可用。启动后刷新页面即可。</div>';
  }else if(C.user){
    html+='<div class="muted">账号 <b style="color:var(--gold)">'+C.user+'</b>　当前槽位：'+C.slot+'</div>';
    html+='<div class="bag-tools"><button class="mini" data-cloudact="logout">退出登录</button></div>';
  }else{
    html+='<div class="row"><input class="name" id="cloud-user" placeholder="账号（2~16 位）" style="flex:1;min-width:120px"/>'
      +'<input class="name" id="cloud-pass" type="password" placeholder="密码（≥6 位）" style="flex:1;min-width:120px"/></div>';
    html+='<div class="bag-tools"><button class="mini" data-cloudact="register">注册</button>'
      +'<button class="mini" data-cloudact="login">登录</button></div>';
    html+='<div class="muted">注册后存档存到服务器，换浏览器/设备都能继续；未登录时仅存本机。</div>';
  }
  }""", 1, 'cloud-account')

rep("""  // 云槽位
  if(C.ok && C.user){""",
    """  // 云槽位
  if(on('save') && C.ok && C.user){""", 1, 'cloud-slots')

rep("""  // 本地存档（导入 / 导出）—— 云存档之外的兜底
  html+='<hr><h3>本地存档（导入 / 导出）</h3>';""",
    """  // 本地存档（导入 / 导出）—— 云存档之外的兜底
  if(on('save')){
  html+='<hr><h3>本地存档（导入 / 导出）</h3>';""", 1, 'cloud-local-head')

rep("""  html+='<div class="bag-tools"><button class="mini" data-cloudact="import-text">导入文本</button>'
    +'<span class="muted">导入会覆盖当前角色，执行前有二次确认；坏档会被校验拦截。</span></div>';""",
    """  html+='<div class="bag-tools"><button class="mini" data-cloudact="import-text">导入文本</button>'
    +'<span class="muted">导入会覆盖当前角色，执行前有二次确认；坏档会被校验拦截。</span></div>';
  }""", 1, 'cloud-local-tail')

rep("""  // 自动挂机设置
  html+='<hr><h3>自动挂机设置</h3>';
  const A=state.auto;""",
    """  // 自动挂机设置
  if(on('auto')){
  html+='<hr><h3>自动挂机设置</h3>';
  const A=state.auto;""", 1, 'cloud-auto-head')

rep("""    +'开启「自动分解」后，包裹达到 '+AUTO_SALVAGE_AT+' 件时会把未装备、未强化的白/绿装回收为矿石/宝石（否则满 300 会被丢弃）。</div>';""",
    """    +'开启「自动分解」后，包裹达到 '+AUTO_SALVAGE_AT+' 件时会把未装备、未强化的白/绿装回收为矿石/宝石（否则满 300 会被丢弃）。</div>';
  }""", 1, 'cloud-auto-tail')

rep("""  // 本次挂机统计 + 图表
  const pm=sessPerMin();""",
    """  // 本次挂机统计 + 图表
  if(on('stats')){
  const pm=sessPerMin();""", 1, 'cloud-stats-head')

rep("""  html+='<div class="muted">升级节奏</div>';
  html+='<div style="margin:4px 0">'+svgLevelTimeline(state.sess.levelUps||[])+'</div>';""",
    """  html+='<div class="muted">升级节奏</div>';
  html+='<div style="margin:4px 0">'+svgLevelTimeline(state.sess.levelUps||[])+'</div>';
  }""", 1, 'cloud-stats-tail')

rep("""  // 排行榜
  html+='<hr><h3>战力排行榜</h3>';""",
    """  // 排行榜（与下面的「统计摘要」同属「排行」子页：都是后端汇总数据）
  if(on('rank')){
  html+='<hr><h3>战力排行榜</h3>';""", 1, 'cloud-rank-head')

rep("""  return html;
}

// ---------- 商店 ----------""",
    """  }
  return html.replace(/^<hr>/,'');   // 子页里第一段带前导 <hr> 时去掉
}

// ---------- 商店 ----------""", 1, 'cloud-tail')


# ============================================================
# 12) boot() 里给子菜单栏挂事件委托
# ============================================================
rep("""  document.querySelectorAll('#tabs button').forEach(b=> b.onclick=()=>{
    document.querySelectorAll('#tabs button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active'); state.selTab=b.getAttribute('data-tab'); renderTab();
  });""",
    """  document.querySelectorAll('#tabs button').forEach(b=> b.onclick=()=>{
    document.querySelectorAll('#tabs button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active'); state.selTab=b.getAttribute('data-tab'); renderTab();
  });
  // 二级菜单（子菜单）：按钮每次渲染都是新建的，所以用事件委托挂在容器上
  const _subEl=$('subtabs');
  if(_subEl) _subEl.onclick=(ev)=>{
    const t=ev && ev.target && ev.target.getAttribute && ev.target.getAttribute('data-subtab');
    if(!t) return;
    state.subSel[state.selTab]=t;
    renderTab();
  };""", 1, 'boot-subtab-bind')


# ============================================================
# 写回（显式 CRLF，保持 game.js 的既有行尾约定）
# ============================================================
out = s.replace('\r\n', '\n').replace('\n', '\r\n')
io.open(SRC, 'w', encoding='utf-8', newline='').write(out)

print('written %s : %d -> %d bytes' % (SRC, n_before, len(out.encode('utf-8'))))
for tag, n in hits:
    print('   ok  %-22s %s' % (tag, n))
