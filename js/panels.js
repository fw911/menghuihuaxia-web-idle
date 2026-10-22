/* ===== 模块 panels.js —— 副本兑换/成就页 + 零依赖 SVG 图表 + 云存档页 =====
 * 来源：game.js L3472-3829（2026-10-21 模块化切分，内容逐字节保留）
 * 导出 13 个顶层名；import 由 AST 跨模块引用自动计算。
 */
import { state } from './state.js';
import { backendHint, cloudRankList, cloudStatsSummary, powerScore } from './api.js';
import { DATA, SLOT_NAME, TITLES } from './core.js';
import { sm } from './player.js';
import { QNAME } from './equip.js';
import { AUTO_SALVAGE_AT } from './bag.js';
import { achSubOf, achSubs, renderTab } from './tabs.js';
import { itemName } from './shop.js';
import { achCats, achDone, achList, achValue, fmtNum, instEntries, instMapName, instName, instSpec, itemCount, titleProgress, titleTarget, titleUnlocked } from './life.js';
import { localSaveStamp } from './loop.js';
import { sessPerMin } from './idle.js';

// ---------- 副本兑换 / 成就 ----------
export function renderInstance(sub){
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
}
export function renderAch(sub){
  const p=state.player; const cats=achCats();
  const list=achList();
  let done=0; for(const k in (p.ach||{})) done++;
  const groups={}, subLabels={};
  list.forEach(a=>{ const k=achSubOf(a); (groups[k]=groups[k]||[]).push(a); });
  for(const x of achSubs()) subLabels[x.key]=x.label;

  // 称号子页（sub === 'titles'）
  if(sub==='titles'){
    let html='<h3>称号</h3><div class="muted">共 '+TITLES.length+' 个称号；解锁后点击即可佩戴（每次只能装备一个）。</div>';
    html+='<div class="shop"><div class="shop-name">已解锁</div>';
    let any=false;
    for(const t of TITLES){
      const un=titleUnlocked(t.key);
      if(!un) continue; any=true;
      const eq=(p.equippedTitle===t.key);
      const prog=titleProgress(t), tgt=titleTarget(t);
      html+='<div class="title-item'+(eq?' on':'')+'" data-act="equip-title" data-key="'+t.key+'"><b>'+t.name+'</b> '+(eq?'<span class="pill on">已佩戴</span>':'<span class="pill">点击佩戴</span>')
        +'<br><span class="muted">'+t.desc+'（进度 '+prog+' / '+tgt+'）</span></div>';
    }
    if(!any) html+='<div class="title-item lock">暂无已解锁称号</div>';
    html+='</div><div class="shop"><div class="shop-name">未解锁</div>';
    for(const t of TITLES){
      if(titleUnlocked(t.key)) continue;
      const prog=titleProgress(t), tgt=titleTarget(t);
      html+='<div class="title-item lock"><b>'+t.name+'</b> <span class="pill">'+prog+' / '+tgt+'</span><br><span class="muted">'+t.desc+'</span></div>';
    }
    html+='</div>';
    return html;
  }

  // 按子菜单只显示该子页（sub 为空 = 全部，与旧行为一致）
  const cur = (sub && groups[sub]) ? sub : '';
  const use = cur ? [cur] : Object.keys(groups);
  let html='<h3>成就'+(cur? '（'+(subLabels[cur]||cats[cur]||cur)+'）':'')+'</h3><div class="muted">共 '+list.length+' 项，已达成 '+done+' 项；达成后自动发放奖励（金币/道具/神秘结晶）。</div>';
  for(const c of use){
    html+='<div class="shop"><div class="shop-name">'+(subLabels[c]||cats[c]||c)+'</div>';
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
}

// ---------- 云存档 / 账号 / 排行 / 统计 ----------
export function jobCn(k){ const j=(DATA.jobs.jobs||[]).find(x=>x.key===k); return j? j.name : k; }
export function timeAgo(ms){
  if(!ms) return '—';
  const d=Math.floor((Date.now()-ms)/1000);
  if(d<60) return d+' 秒前'; if(d<3600) return Math.floor(d/60)+' 分钟前';
  if(d<86400) return Math.floor(d/3600)+' 小时前'; return Math.floor(d/86400)+' 天前';
}
export async function loadCloudUI(){
  if(!state.cloud.ok || state.cloudUI.loading) return;
  state.cloudUI.loading=true;
  try{
    const [rk, sm] = await Promise.all([cloudRankList(state.cloudUI.job||''), cloudStatsSummary()]);
    state.cloudUI.rank=rk; state.cloudUI.summary=sm;
  }catch(e){}
  state.cloudUI.loading=false;
  if(state.selTab==='cloud') renderTab();
}
// ---------- 零依赖 SVG 图表（统计可视化） ----------
export function svgTrend(history){
  if(!history || history.length<2) return '<div class="muted">挂机一会儿后，这里会显示本局的「经验/分 · 金币/分」趋势曲线。</div>';
  const W=320,H=130,pad=18, n=history.length;
  const exp=history.map(h=>h.expPerMin), gold=history.map(h=>h.goldPerMin);
  const mn=Math.min(...exp,...gold), mx=Math.max(...exp,...gold), rng=(mx-mn)||1;
  const xy=(vals)=> vals.map((v,i)=>{
    const x=pad+(i/(n-1))*(W-2*pad);
    const y=H-pad-((v-mn)/rng)*(H-2*pad);
    return [x,y];
  });
  const toPts=(arr)=> arr.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
  const expP=xy(exp), goldP=xy(gold);
  const area=(arr)=>{ const a=arr.slice(); a.unshift([pad,H-pad]); a.push([W-pad,H-pad]); return 'M'+a.map(p=>p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' L'); }
  const mk=(pts,color)=> '<path d="'+area(pts)+' Z" fill="'+color+'" opacity="0.12"/>'
    +'<polyline points="'+toPts(pts)+'" fill="none" stroke="'+color+'" stroke-width="1.6"/>';
  return '<svg viewBox="0 0 '+W+' '+H+'" width="100%" style="max-width:360px;height:auto;border:1px solid var(--line);'
    +'border-radius:4px;background:#191309;display:block">'
    + mk(expP,'#e8c76f') + mk(goldP,'#7fd77f')
    + '<text x="'+pad+'" y="12" fill="#e8c76f" font-size="10">经验/分</text>'
    + '<text x="'+(W-48)+'" y="12" fill="#7fd77f" font-size="10">金币/分</text>'
    + '<text x="'+pad+'" y="'+(H-4)+'" fill="#555" font-size="9">最早</text>'
    + '<text x="'+(W-pad-24)+'" y="'+(H-4)+'" fill="#555" font-size="9">现在</text></svg>';
}
export function svgBandBars(bands){
  if(!bands || !bands.length) return '';
  const W=340,H=130,pad=20, n=bands.length, bw=Math.min(28,(W-2*pad)/n*0.6);
  const maxExp=Math.max(...bands.map(b=>b.expPerMin||0),1);
  let s='';
  bands.forEach((b,i)=>{
    const x=pad+(i+0.5)*(W-2*pad)/n, h=(b.expPerMin||0)/maxExp*(H-pad-12);
    s+='<rect x="'+(x-bw/2).toFixed(1)+'" y="'+(H-pad-h).toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+h.toFixed(1)
      +'" fill="#e8c76f" opacity="0.85" rx="1"/>';
    s+='<text x="'+x.toFixed(1)+'" y="'+(H-pad+11)+'" fill="#888" font-size="9" text-anchor="middle">Lv'+b.lv+'</text>';
    if((b.goldPerMin||0)>0) s+='<text x="'+x.toFixed(1)+'" y="'+(H-pad-h-3).toFixed(1)+'" fill="#7fd77f" font-size="8" text-anchor="middle">'+fmtNum(Math.round(b.goldPerMin))+'</text>';
  });
  return '<svg viewBox="0 0 '+W+' '+H+'" width="100%" style="max-width:380px;height:auto;border:1px solid var(--line);'
    +'border-radius:4px;background:#191309;display:block">'+s
    +'<text x="'+pad+'" y="12" fill="#e8c76f" font-size="10">各等级段 经验/分（峰值 '+fmtNum(maxExp)+'）</text></svg>';
}
// 品质顺序与配色（图表用；与 CSS 的 .q-* 保持一致）
export const QUALITY_ORDER = ['white','green','blue','purple','gold','red'];
export const QUALITY_COLOR = { white:'#c8c0b0', green:'#7fae5a', blue:'#5f9fd8', purple:'#a97ad2', gold:'#e8c76f', red:'#d95c50' };

// 战力曲线（本局）
export function svgPower(history){
  if(!history || history.length<2) return '<div class="muted">挂机一会儿后，这里会显示本局「战力」随时间的走势。</div>';
  const W=320,H=120,pad=20,n=history.length;
  const vals=history.map(h=>h.power||0);
  const mn=Math.min(...vals), mx=Math.max(...vals), rng=(mx-mn)||1;
  const pts=vals.map((v,i)=>{
    const x=pad+(i/(n-1))*(W-2*pad);
    const y=H-pad-6-((v-mn)/rng)*(H-2*pad-6);
    return [x,y];
  });
  const d='M'+pts.map(p=>p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' L');
  const col='#a97ad2', last=pts[pts.length-1];
  return '<svg viewBox="0 0 '+W+' '+H+'" width="100%" style="max-width:360px;height:auto;border:1px solid var(--line);'
    +'border-radius:4px;background:#191309;display:block">'
    +'<path d="'+d+' L'+(W-pad)+' '+(H-pad)+' L'+pad+' '+(H-pad)+' Z" fill="'+col+'" opacity="0.14"/>'
    +'<path d="'+d+'" fill="none" stroke="'+col+'" stroke-width="1.6"/>'
    +'<circle cx="'+last[0].toFixed(1)+'" cy="'+last[1].toFixed(1)+'" r="2.4" fill="'+col+'"/>'
    +'<text x="'+pad+'" y="12" fill="'+col+'" font-size="10">战力 '+fmtNum(vals[vals.length-1])+'</text>'
    +'<text x="'+(W-pad)+'" y="12" fill="#555" font-size="9" text-anchor="end">峰值 '+fmtNum(mx)+'</text>'
    +'<text x="'+pad+'" y="'+(H-5)+'" fill="#555" font-size="9">最早</text>'
    +'<text x="'+(W-pad)+'" y="'+(H-5)+'" fill="#555" font-size="9" text-anchor="end">现在</text></svg>';
}

// 掉落品质分布（横向条形图；入参形如 {white:12,green:5,...}）
export function svgDropBars(total){
  if(!total) return '';
  const keys=QUALITY_ORDER.filter(k=>(total[k]||0)>0);
  if(!keys.length) return '<div class="muted">本局还没有「带品质」的掉落 —— 品质只统计装备，消耗品 / 矿石 / 宝石不计入。</div>';
  const sum=keys.reduce((a,k)=>a+(total[k]||0),0);
  const W=340, rowH=18, pad=14, barX=pad+34, labelW=104;
  const H=pad+keys.length*rowH+16;
  const barMax=(W-pad-labelW)-barX;
  const max=Math.max(...keys.map(k=>total[k]||0),1);
  let s='';
  keys.forEach((k,i)=>{
    const y=pad+i*rowH, v=total[k]||0;
    const w=Math.max(2,(v/max)*barMax);
    s+='<text x="'+pad+'" y="'+(y+10)+'" fill="#888" font-size="9">'+QNAME[k]+'</text>';
    s+='<rect x="'+barX+'" y="'+(y+1)+'" width="'+barMax.toFixed(1)+'" height="11" fill="#241c11" rx="2"/>';
    s+='<rect x="'+barX+'" y="'+(y+1)+'" width="'+w.toFixed(1)+'" height="11" fill="'+(QUALITY_COLOR[k]||'#888')+'" opacity="0.9" rx="2"/>';
    s+='<text x="'+(W-pad)+'" y="'+(y+10)+'" fill="#999" font-size="9" text-anchor="end">'
      +fmtNum(v)+' · '+(v/sum*100).toFixed(1)+'%</text>';
  });
  return '<svg viewBox="0 0 '+W+' '+H+'" width="100%" style="max-width:380px;height:auto;border:1px solid var(--line);'
    +'border-radius:4px;background:#191309;display:block">'+s
    +'<text x="'+pad+'" y="'+(H-4)+'" fill="#555" font-size="9">累计 '+fmtNum(sum)+' 件</text></svg>';
}

// 升级时间线（每个点是一次升级，纵轴为等级）
export function svgLevelTimeline(ups){
  if(!ups || ups.length<2) return '<div class="muted">升过 2 级后，这里会显示本局的升级节奏。</div>';
  const W=340,H=120,padX=24,padT=20,padB=22;
  const t0=ups[0].t, t1=ups[ups.length-1].t, tSpan=(t1-t0)||1;
  const lv0=ups[0].level, lv1=ups[ups.length-1].level, lvSpan=(lv1-lv0)||1;
  const X=t=>padX+((t-t0)/tSpan)*(W-2*padX);
  const Y=lv=>H-padB-((lv-lv0)/lvSpan)*(H-padT-padB);
  const pts=ups.map(u=>[X(u.t),Y(u.level)]);
  const d='M'+pts.map(p=>p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' L');
  const step=Math.max(1,Math.ceil(pts.length/14));
  let dots='';
  pts.forEach((p,i)=>{
    if(i===0||i===pts.length-1||i%step===0)
      dots+='<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="1.8" fill="#7fd7ff"/>';
  });
  const avg=(t1-t0)/1000/Math.max(1,ups.length-1);
  return '<svg viewBox="0 0 '+W+' '+H+'" width="100%" style="max-width:380px;height:auto;border:1px solid var(--line);'
    +'border-radius:4px;background:#191309;display:block">'
    +'<polyline points="'+pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ')+'" fill="none" stroke="#7fd7ff" stroke-width="1.5"/>'
    +dots
    +'<text x="'+padX+'" y="12" fill="#7fd7ff" font-size="10">本局升级 '+ups.length+' 次 · 均 '+avg.toFixed(1)+' 秒/级</text>'
    +'<text x="'+padX+'" y="'+(H-6)+'" fill="#555" font-size="9">Lv'+lv0+'</text>'
    +'<text x="'+(W-padX)+'" y="'+(H-6)+'" fill="#555" font-size="9" text-anchor="end">Lv'+lv1+'</text></svg>';
}

export function renderCloud(sub){
  const p=state.player, C=state.cloud;
  const any=!sub, on=k=>any||sub===k;         // sub 为空 = 全量渲染（旧行为，测试依赖）
  let html='';
  if(on('save')) html+='<h3>后端服务</h3>';
  html+='<div class="muted">状态：'+(C.ok? '<span style="color:var(--green)">已连接 '+C.base+'</span>'
    : '<span style="color:var(--red)">未连接</span>（本地仍可存档；'+backendHint()+'）')+'</div>';

  // 账号
  if(on('save')) html+='<hr><h3>账号'+(C.user? '（已登录）':'')+'</h3>';
  if(on('save')){
  if(!C.ok){
    html+='<div class="muted">'+backendHint()+'。云存档暂不可用，恢复后请<b style="color:var(--gold)">刷新页面重新登录</b>。</div>';
  }else if(C.user){
    html+='<div class="muted">账号 <b style="color:var(--gold)">'+C.user+'</b>　当前槽位：'+C.slot+'</div>';
    html+='<div class="bag-tools"><button class="mini" data-cloudact="logout">退出登录</button>'
      +'<button class="mini" data-cloudact="logout">切换账号</button></div>';
  }else{
    html+='<div class="muted">启动页未完成登录。请<b style="color:var(--gold)">刷新页面</b>，在登录框注册或登录后进入游戏。</div>';
  }
  }

  // 云槽位
  if(on('save') && C.ok && C.user){
    html+='<hr><h3>云存档槽位</h3>';
    const slots=(C.slots&&C.slots.length)? C.slots : [1,2,3].map(i=>({slot:i,label:'槽位 '+i,empty:true}));
    for(const sl of slots){
      const cur=(C.slot===sl.slot);
      html+='<div class="item'+(cur?' sel':'')+'">';
      if(sl.empty){
        html+='<b>'+sl.label+'</b> <span class="pill">空</span>';
      }else{
        html+='<b>'+sl.label+'　'+sl.name+'</b> <span class="pill">'+jobCn(sl.job)+' Lv.'+sl.level+' · 战力 '+fmtNum(sl.power)+'</span>'
          +'<br><span class="muted">更新于 '+timeAgo(sl.updatedAt)+'</span>';
      }
      html+='<div class="craft-row">'
        +'<button class="mini" data-cloudact="save" data-slot="'+sl.slot+'">保存到云</button>'
        +'<button class="mini" data-cloudact="load" data-slot="'+sl.slot+'">读取</button>'
        +(sl.empty? '' : '<button class="mini" data-cloudact="del" data-slot="'+sl.slot+'">删除</button>')
        +'</div></div>';
    }
    html+='<div class="muted">自动存档每 30 秒写本地，云端同步最快 45 秒一次（避免刷接口）。</div>';
  }

  // 本地存档（导入 / 导出）—— 云存档之外的兜底
  if(on('save')){
  html+='<hr><h3>本地存档（导入 / 导出）</h3>';
  const lsStamp=localSaveStamp();
  html+='<div class="muted">当前角色 <b style="color:var(--gold2)">'+p.name+'</b>　'+jobCn(p.job)+' Lv.'+p.level
    +' · 战力 '+fmtNum(powerScore(p))+' · 背包 '+p.bag.length+' 件</div>';
  html+='<div class="muted">本地存档时间：'+(lsStamp? timeAgo(lsStamp) : '<span style="color:var(--red)">尚未存档</span>')
    +'　·　清浏览器缓存 / 换设备前请先导出备份。</div>';
  html+='<div class="bag-tools">'
    +'<button class="mini" data-cloudact="export-file">导出存档文件</button>'
    +'<button class="mini" data-cloudact="export-copy">复制存档</button>'
    +'<button class="mini" data-cloudact="import-file">导入存档文件</button>'
    +'<input type="file" id="save-file" accept=".json,application/json" style="display:none"/>'
    +'</div>';
  html+='<div class="muted" style="margin-top:6px">或把存档 JSON 粘贴到下面，再点「导入文本」：</div>';
  html+='<textarea id="save-text" class="name" rows="3" spellcheck="false" placeholder="粘贴存档 JSON…" '
    +'style="margin-top:4px;font-size:11px;font-family:Consolas,monospace;resize:vertical"></textarea>';
  html+='<div class="bag-tools"><button class="mini" data-cloudact="import-text">导入文本</button>'
    +'<span class="muted">导入会覆盖当前角色，执行前有二次确认；坏档会被校验拦截。</span></div>';
  }

  // 自动挂机设置
  if(on('auto')){
  html+='<hr><h3>自动挂机设置</h3>';
  const A=state.auto;
  const chk=(k,label)=>'<label class="muted" style="margin-right:12px;cursor:pointer"><input type="checkbox" data-autochk="'+k+'"'
    +(A[k]?' checked':'')+'/> '+label+'</label>';
  html+='<div>'+chk('potion','自动喝药')+chk('buy','药水不足自动购买')+chk('zone','自动换区')+'</div>';
  html+='<div>'+chk('save','自动存档+云同步')+chk('stats','上报挂机统计')+chk('rank','上传战力排行')+'</div>';
  html+='<div>'+chk('junk','包裹将满自动分解白/绿装')+'</div>';
  html+='<div class="row"><span class="muted">喝药阈值　HP <select id="auto-hp">'
    +[30,40,50,60,70,80].map(v=>'<option value="'+v+'"'+(A.hp===v?' selected':'')+'>'+v+'%</option>').join('')
    +'</select>　MP <select id="auto-mp">'
    +[10,20,30,40,50].map(v=>'<option value="'+v+'"'+(A.mp===v?' selected':'')+'>'+v+'%</option>').join('')
    +'</select></span></div>';
  html+='<div class="bag-tools"><button class="mini" data-cloudact="auto-zone">立即重新选区</button></div>';
  html+='<div class="muted">自动换区会按「经验/秒」在所有已解锁地图里挑最优区域，并随等级提升自动迁移。'
    +'开启「自动分解」后，包裹达到 '+AUTO_SALVAGE_AT+' 件时会把未装备、未强化的白/绿装回收为矿石/宝石（否则满 300 会被丢弃）。</div>';
  }

  // 本次挂机统计 + 图表
  if(on('stats')){
  const pm=sessPerMin();
  html+='<hr><h3>本次挂机</h3><div class="muted">时长 '+pm.minutes+' 分钟 · 击杀 '+fmtNum(pm.kills)+'/分 · 经验 '+fmtNum(pm.exp)+'/分 · 金币 '+fmtNum(pm.gold)+'/分 · 死亡 '+state.sess.deaths+'</div>';
  html+='<div class="muted" style="margin-top:8px">经验/分 · 金币/分 趋势</div>';
  html+='<div style="margin:4px 0">'+svgTrend(state.sess.history)+'</div>';
  html+='<div class="muted">战力走势</div>';
  html+='<div style="margin:4px 0">'+svgPower(state.sess.history)+'</div>';
  const dt=state.sess.dropTotal||{};
  const eqDropN=Object.keys(dt).reduce((a,k)=>a+(dt[k]||0),0);
  html+='<div class="muted">掉落品质分布（本局装备 '+fmtNum(eqDropN)+' 件 · 全部掉落 '+fmtNum(state.sess.dropCount||0)+' 件）</div>';
  html+='<div style="margin:4px 0">'+svgDropBars(state.sess.dropTotal||{})+'</div>';
  html+='<div class="muted">升级节奏</div>';
  html+='<div style="margin:4px 0">'+svgLevelTimeline(state.sess.levelUps||[])+'</div>';
  }

  // 排行榜（与下面的「统计摘要」同属「排行」子页：都是后端汇总数据）
  if(on('rank')){
  html+='<hr><h3>战力排行榜</h3>';
  if(!C.ok) html+='<div class="muted">需要后端。</div>';
  else{
    html+='<div class="bag-tools"><select id="rank-job">'
      +'<option value=""'+(state.cloudUI.job?'':' selected')+'>全部职业</option>'
      +(DATA.jobs.jobs||[]).map(j=>'<option value="'+j.key+'"'+(state.cloudUI.job===j.key?' selected':'')+'>'+j.name+'</option>').join('')
      +'</select><button class="mini" data-cloudact="rank-refresh">刷新</button>'
      +'<button class="mini" data-cloudact="rank-up">上传我的战力（'+powerScore(p)+'）</button></div>';
    const rk=state.cloudUI.rank;
    if(rk && rk.list && rk.list.length){
      for(let i=0;i<rk.list.length;i++){
        const e=rk.list[i];
        html+='<div class="item'+(e.name===p.name?' sel':'')+'"><b>'+(i+1)+'. '+e.name+'</b> <span class="pill">'+jobCn(e.job)+' Lv.'+e.level+' · 战力 '+fmtNum(e.power)+'</span>'
          +'<br><span class="muted">累计击杀 '+e.kills+' · 更新于 '+timeAgo(e.updatedAt)+'</span></div>';
      }
    }else html+='<div class="muted">暂无数据，点「上传我的战力」加入榜单。</div>';
  }

  // 统计摘要
  html+='<hr><h3>挂机统计（数值体检）</h3>';
  if(!C.ok) html+='<div class="muted">需要后端。</div>';
  else{
    const sm=state.cloudUI.summary;
    html+='<div class="bag-tools"><button class="mini" data-cloudact="stats-refresh">刷新</button></div>';
    if(sm && sm.total){
      html+='<div class="muted">全服累计：击杀 '+fmtNum(sm.total.kills)+' · 经验 '+fmtNum(sm.total.exp)+' · 金币 '+fmtNum(sm.total.gold)+' · 死亡 '+fmtNum(sm.total.deaths)+'</div>';
      html+='<div class="muted" style="margin-top:6px">按等级段（经验/分 · 金币/分 · 击杀/分）：</div>';
      const bands=Object.keys(sm.byBand||{}).sort((a,b)=>parseInt(a)-parseInt(b));
      for(const b of bands){
        const o=sm.byBand[b];
        html+='<div class="muted">Lv.'+b+'　经验 '+fmtNum(o.expPerMin)+'/分　金币 '+fmtNum(o.goldPerMin)+'/分　击杀 '+fmtNum(o.killsPerMin)+'/分　样本 '+o.samples+'</div>';
      }
      const drops=sm.drops||{}; const dk=Object.keys(drops);
      if(dk.length){
        html+='<div class="muted" style="margin-top:8px">全服掉落品质分布</div>';
        html+='<div style="margin:4px 0">'+svgDropBars(drops)+'</div>';
      }
    }else html+='<div class="muted">暂无数据，挂机 1 分钟后会首次上报。</div>';
  }
  }
  return html.replace(/^<hr>/,'');   // 子页里第一段带前导 <hr> 时去掉
}

