# -*- coding: utf-8 -*-
"""一次性补丁 3：补上「⑪ 宝石镶嵌」UI 入口 + 接通 gems.json#gem_series[].slots，并清掉已证死的 data-* 绑定。

背景（同一类问题：逻辑写完了但 UI 不可达）：
  · `data-gem` 只绑事件、从不渲染 ⇒ 玩家选不了宝石 ⇒ `doInlay` 完全不可达；
    且 `#inlay-target` 这个元素在 index.html 里**不存在**。
  · `data-refine` 同理（已在 _patch_refine.py 里用 `data-act="refine-eq"` 替代）。
  · `data-equip-inlay` 是一个空 forEach 占位。
  · `doInlay` 原本不检查 `gems.json#gem_series[].slots`（北斗/天行只能镶武器·护手·戒指等），
    会把专用宝石镶到不合适的部位上白费一颗。
"""
import io, os, sys

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'game.js')
s = io.open(SRC, encoding='utf-8', newline='').read()
assert s.count('\r\n') > 0 and (s.count('\n') - s.count('\r\n')) == 0, 'game.js 应为纯 CRLF'


def cr(x):
    assert '\r' not in x
    return x.replace('\n', '\r\n')


R = []

# ---------- ① LS 加两个选择位 ----------
R.append((
    cr("""forgeMode:'random', refineEq:null };"""),
    cr("""forgeMode:'random', refineEq:null, inlayGem:null, inlayEquip:null };"""),
    1, 'LS 加镶嵌选择位'))

# ---------- ② doInlay 接通 gems.json#gem_series[].slots ----------
R.append((
    cr("""  const series = DATA.gems.gem_series.find(g=>g.key===gem.series);
  if(!series){ log('<span class="dmg">未知宝石</span>'); return; }
  const gv = DATA.gems.gem_grade_values[series.type];"""),
    cr("""  const series = DATA.gems.gem_series.find(g=>g.key===gem.series);
  if(!series){ log('<span class="dmg">未知宝石</span>'); return; }
  // gems.json#gem_series[].slots 是「本系列只能镶哪些部位」的中文白名单（如北斗→武器/护手/戒指）
  if(series.slots && series.slots.indexOf(SLOT_NAME[item.slot]) < 0){
    log('<span class="dmg">'+series.name+' 只能镶进 '+series.slots.join('/')+'，不能镶到'+SLOT_NAME[item.slot]+'</span>'); return;
  }
  const gv = DATA.gems.gem_grade_values[series.type];"""),
    1, 'doInlay 部位白名单'))

# ---------- ③ 镶嵌 helper（放在 refineEquipOpts 之前） ----------
R.append((
    cr("""// 可精炼装备下拉（只列未满级的，显示「+N [品质] 部位·名称」）"""),
    cr("""// ---------- 宝石镶嵌（gems.json）----------
// 系列限定部位必须接通：北斗/天行 → 武器·护手·戒指；望月/无相 → 头盔·护肩·盔甲·项链·护腿·盾牌；
// 元如 → 上面六件 + 鞋子·披风·腰带；修仙石 → 仅武器。不检查会把专用宝石镶到不合适的部位上白费一颗。
function gemSeriesDef(key){ return ((DATA.gems||{}).gem_series||[]).find(g=>g.key===key)||null; }
function gemSeriesLabel(g){
  const s=gemSeriesDef(g.series);
  return (s? s.name : g.series)+'·'+g.grade+(g.count>1? (' ×'+g.count) : '');
}
function inlayGemList(){ const p=state.player; return p? p.bag.filter(b=>b.type==='gem') : []; }
// 当前选中的宝石（未选/已失效时回落到第一颗，保证面板始终有内容）
function selGemForInlay(){ const gs=inlayGemList(); return findItem(LS.inlayGem) || gs[0] || null; }
function gemCanInlay(gem, it){
  if(!gem || !it || it.type!=='equip') return false;
  if(!(it.sockets>0)) return false;
  if((it.gems||[]).filter(Boolean).length >= it.sockets) return false;
  const s=gemSeriesDef(gem.series);
  return !s || !s.slots || s.slots.indexOf(SLOT_NAME[it.slot])>=0;
}
function inlayEquipList(){
  const p=state.player; if(!p) return [];
  const gem=selGemForInlay();
  const all=[];
  for(const sl in p.equip) if(p.equip[sl]) all.push(p.equip[sl]);
  for(const b of p.bag) if(b.type==='equip') all.push(b);
  return all.filter(it=> gemCanInlay(gem, it)).sort((a,b)=>equipScore(b)-equipScore(a));
}
function inlayGemOpts(){
  const gs=inlayGemList();
  if(!gs.length) return '<option value="">（背包里没有宝石）</option>';
  return gs.map(g=> '<option value="'+g.uid+'"'+(LS.inlayGem===g.uid?' selected':'')+'>'+gemSeriesLabel(g)+'</option>').join('');
}
function inlayEquipOpts(){
  const ts=inlayEquipList();
  if(!ts.length) return '<option value="">（没有可镶嵌的装备）</option>';
  return ts.map(it=> '<option value="'+it.uid+'"'+(LS.inlayEquip===it.uid?' selected':'')+'>'
    +'['+QNAME[it.quality]+'] '+SLOT_NAME[it.slot]+'·'+it.name
    +'（空孔 '+((it.sockets||0)-(it.gems||[]).filter(Boolean).length)+'/'+(it.sockets||0)+'）</option>').join('');
}
function doInlaySelected(){
  const gs=$('inlay-gem'), es=$('inlay-equip');
  const gem=(gs&&gs.value)? findItem(gs.value) : null;
  const it =(es&&es.value)? findItem(es.value) : null;
  if(!gem){ log('<span class="dmg">请先选择宝石</span>'); return; }
  if(!it){ log('<span class="dmg">没有可镶嵌的装备（需有空闲孔位且部位符合宝石限制）</span>'); return; }
  doInlay(it, gem);
}
// 可精炼装备下拉（只列未满级的，显示「+N [品质] 部位·名称」）"""),
    1, '镶嵌 helper'))

# ---------- ④ 面板 ⑪（接在 ⑩ 之后） ----------
R.append((
    cr("""  // ④ 提取回收
  if(any || sub==='recycle'){"""),
    cr("""  // ⑪ 宝石镶嵌（gems.json：系列限定部位；空孔由打造/兑换产出）
  if(any || sub==='craft'){
    let h='<hr><h3>⑪ 宝石镶嵌</h3><div class="muted">把背包里的宝石镶进有空孔的装备。'
      +'各系列限定部位：北斗/天行→武器·护手·戒指；望月/无相→头盔·护肩·盔甲·项链·护腿·盾牌；'
      +'元如→上面六件 + 鞋子·披风·腰带；修仙石→仅武器。4 颗同级宝石可在「合成」子页炼成更高一级。</div>';
    const gems=inlayGemList();
    if(!gems.length){
      h+='<div class="muted">背包里没有宝石（首领/精英掉落，或在「合成」子页炼制）。</div>';
    }else{
      h+='<div class="craft-row">宝石：<select id="inlay-gem">'+inlayGemOpts()+'</select> '
        +'装备：<select id="inlay-equip">'+inlayEquipOpts()+'</select> <button class="mini" data-act="inlay">镶嵌</button></div>';
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
  if(any || sub==='recycle'){"""),
    1, '⑪ 镶嵌面板'))

# ---------- ⑤ onchange 记忆 ----------
R.append((
    cr("""  const re=$('refine-equip'); if(re) re.onchange=()=>{ LS.refineEq=re.value; renderTab(); };"""),
    cr("""  const re=$('refine-equip'); if(re) re.onchange=()=>{ LS.refineEq=re.value; renderTab(); };
  const ig=$('inlay-gem'); if(ig) ig.onchange=()=>{ LS.inlayGem=ig.value; LS.inlayEquip=null; renderTab(); };
  const ie=$('inlay-equip'); if(ie) ie.onchange=()=>{ LS.inlayEquip=ie.value; };"""),
    1, '镶嵌下拉 onchange'))

# ---------- ⑥ 按钮 handler ----------
R.append((
    cr("""    else if(a==='refine-eq'){ const rq=$('refine-equip'); if(rq && rq.value) doRefine(findItem(rq.value)); }"""),
    cr("""    else if(a==='refine-eq'){ const rq=$('refine-equip'); if(rq && rq.value) doRefine(findItem(rq.value)); }
    else if(a==='inlay') doInlaySelected();"""),
    1, '镶嵌按钮 handler'))

# ---------- ⑦ 清掉已证死的 data-* 绑定 ----------
R.append((
    cr("""  el.querySelectorAll('[data-refine]').forEach(d=> d.onclick=()=> doRefine(findItem(d.getAttribute('data-refine'))));
  el.querySelectorAll('[data-gem]').forEach(d=> d.onclick=()=>{
    const g=findItem(d.getAttribute('data-gem'));
    window._pendingGem = g;
    const t=$('inlay-target'); if(t) t.textContent='已选宝石：'+g.series+'·'+g.grade+'，请点击装备镶嵌';
  });
"""),
    cr("""  // 注：原先这里绑过 [data-refine] / [data-gem]，但这两个属性【从未被渲染】，
  // 而 #inlay-target 元素在 index.html 里也不存在 ⇒ 全是死入口。
  // 现已分别用「⑩ 装备精炼」的 data-act="refine-eq" 和「⑪ 宝石镶嵌」的 data-act="inlay" 替代。
"""),
    1, '删除死绑定 data-refine/data-gem'))

R.append((
    cr("""  // 装备点击镶嵌
  document.querySelectorAll('#tab-pane [data-equip-inlay]').forEach(()=>{});
"""),
    cr("""  // （原先这里有个空的 [data-equip-inlay] 占位，属性从未渲染，已删）
"""),
    1, '删除空占位 data-equip-inlay'))

# ---------- 执行 ----------
for i, (old, new, expect, tag) in enumerate(R, 1):
    n = s.count(old)
    if n != expect:
        print('FAIL 规则 %d [%s]：命中 %d 次，期望 %d' % (i, tag, n, expect))
        sys.exit(1)
    s = s.replace(old, new)
    print('ok   规则 %d [%s]：命中 %d 次' % (i, tag, n))

assert (s.count('\n') - s.count('\r\n')) == 0, '结果出现裸 LF'
b = s.encode('utf-8')
io.open(SRC, 'wb').write(b)
print('written %s  %d bytes  CRLF %d' % (SRC, len(b), s.count('\r\n')))
