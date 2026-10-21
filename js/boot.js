/* ===== 模块 boot.js —— 启动/新建角色/强制登录流程/boot =====
 * 来源：game.js L5072-5251（2026-10-21 模块化切分，内容逐字节保留）
 * 导出 11 个顶层名；import 由 AST 跨模块引用自动计算。
 */
import { loadAuto, state } from './state.js';
import { apiCall, apiProbe, cloudLoad, cloudLogin, cloudLogout, cloudRank, cloudRegister, cloudSave, persistCloud, refreshSlots, restoreCloud } from './api.js';
import { DATA, loadData } from './core.js';
import { syncSkills } from './player.js';
import { refreshStats } from './smtree.js';
import { genEquip } from './equip.js';
import { equipItem } from './bag.js';
import { $, log, renderBattle, renderHeader, renderMap } from './render.js';
import { renderTab } from './tabs.js';
import { jobCn } from './panels.js';
import { mineTick } from './life.js';
import { SAVE_KEY, load, loop, save, setGameTimer, setIdle } from './loop.js';
import { applyOfflineEarnings, reportStats, sessSample } from './idle.js';

// ---------- 启动 ----------
export function newPlayer(name, job){
  const ores0={}; (DATA.ores.ore_types||[]).forEach(o=> ores0[o.key]=0);
  ores0.hantie=20; ores0.chitong=10;          // 新手赠矿，便于体验打造
  const materials0={ bailian_shi:10, lianhua_ping:3, sanhun_tian:1, qipo_xi:1, lingyin_0:1 }; // 新手赠材料
  state.player={ name:name||'游侠', job, level:1, exp:0, gold:50, hp:1, mp:1, crystal:0,
    map:'beijun', unlocked:{beijun:true}, equip:{}, bag:[], quests:{}, ores:ores0, materials:materials0,
    wuhunSlots:[null,null], shenmo:null, skills:{}, passives:{}, skillCd:{}, _s:null,
    summon:null, mining:{level:1, exp:0}, stats:{kills:0, killType:{}, mapKills:{}, mapClear:[], mapBoss:{}, dungeonEnter:{}, zoneKills:{}, minionKills:{}, refine7:0, craftCount:0, crystalTotal:0}, ach:{}, titles:{}, equippedTitle:null, crystals:{} };
  syncSkills();   // 已达到学习等级的技能/被动自动学会
  refreshStats();
  state.player.hp=state.player._s.max_hp; state.player.mp=state.player._s.max_mp;
  // 赠送新手装
  const starter = genEquip('weapon','warrior',1,1) || genEquip('weapon',job,1,1);
  if(starter){ starter.job=job; state.player.equip.weapon=starter; }
  const starterArmor = genEquip('armor',job,1,1); if(starterArmor){ starterArmor.job=job; state.player.equip.armor=starterArmor; }
  refreshStats();
  log('<span class="lv">欢迎来到华夏，'+name+'！选择左侧地图区域开始挂机。</span>');
}

export function showJobPicker(){
  const el=$('job-list');
  el.innerHTML='';
  for(const j of DATA.jobs.jobs){
    const d=document.createElement('div');
    d.className='job';
    d.innerHTML='<h4>'+j.name+'</h4><small>'+j.desc+'</small>';
    d.onclick=()=>{
      if(!state.cloud.user){ alert('请先注册 / 登录账号，再创建角色。'); return; }   // 强制登录
      const name=($('name-input').value||'').trim()||'游侠';
      $('overlay').style.display='none';
      newPlayer(name, j.key);
      renderHeader(); renderMap(); renderTab();
      cloudSave(state.cloud.slot||1, true);                                          // 新号立即上云
    };
    el.appendChild(d);
  }
}

// ---------- 启动登录（强制登录才能进入游戏） ----------
export function setAuthMsg(txt, bad){
  const el=$('auth-msg');
  if(el) el.innerHTML = (bad? '<span style="color:var(--red)">':'')+txt+(bad? '</span>':'');
}
export function wireAuthUI(){
  const submit = async (mode) => {
    const ui=$('acc-user'), pi=$('acc-pass');
    const u=(ui&&ui.value||'').trim(), pw=(pi&&pi.value)||'';
    if(!u || !pw){ setAuthMsg('请输入账号和密码', true); return; }
    setAuthMsg('● 处理中…');
    const r = mode==='register' ? await cloudRegister(u,pw) : await cloudLogin(u,pw);
    if(!r || !r.ok){ setAuthMsg((r&&r.msg)||'操作失败', true); return; }
    await afterLogin();
  };
  const bl=$('btn-login'), br=$('btn-register');
  if(bl) bl.onclick=()=>submit('login');
  if(br) br.onclick=()=>submit('register');
  for(const id of ['acc-user','acc-pass']){
    const el=$(id);
    if(el) el.addEventListener('keydown', e=>{ if(e.key==='Enter') submit('login'); });
  }
}
export function renderCloudResume(){
  const box=$('cloud-resume'); if(!box) return;
  const used=(state.cloud.slots||[]).filter(s=>!s.empty);
  if(!used.length){ box.innerHTML='<span class="muted">云端暂无存档，创建角色后会自动上传。</span>'; return; }
  box.innerHTML='<span class="muted">云端存档：</span>'
    + used.map(s=>'<button class="mini" data-resume="'+s.slot+'">读取槽位'+s.slot+'（'+s.name+' '+jobCn(s.job)+' Lv.'+s.level+'）</button>').join('');
  box.querySelectorAll('[data-resume]').forEach(b=> b.onclick=async ()=>{
    const slot=parseInt(b.getAttribute('data-resume'),10);
    const r=await cloudLoad(slot);
    if(r.ok){ state.cloud.slot=slot; persistCloud(); const ov=$('overlay'); if(ov) ov.style.display='none';
      save(true); renderAll(); log('<span class="loot">'+r.msg+'</span>'); }
    else log('<span class="dmg">'+(r.msg||'读取失败')+'</span>');
  });
}
export async function afterLogin(){
  const authBox=$('auth-box'), charBox=$('char-box');
  if(authBox) authBox.style.display='none';
  if(charBox) charBox.style.display='';
  const who=$('auth-user');
  if(who) who.innerHTML='已登录：<b style="color:var(--gold)">'+state.cloud.user+'</b>　<button class="mini" id="btn-switch-account">切换账号</button>';
  const sw=$('btn-switch-account');
  if(sw) sw.onclick=async()=>{ await cloudLogout(); location.reload(); };
  await refreshSlots();
  renderCloudResume();
  if(state.player){                                   // 本机已有存档 → 登录后直接继续
    const ov=$('overlay'); if(ov) ov.style.display='none';
    renderAll();
    log('<span class="sys">登录成功，'+state.player.name+' 欢迎回来。</span>');
  }
}
export async function startAuthFlow(){
  const ok = await apiProbe();
  const f=$('f-cloud');
  if(f){ f.textContent = ok? '● 后端已连接' : '● 后端未启动'; f.className = ok? 'ok' : ''; }
  if(!ok){
    setAuthMsg('后端未启动：请在项目目录执行 <b>node server/server.js</b>（端口 8014），然后刷新本页面。', true);
    return;
  }
  if(state.cloud.token){                              // 有旧令牌 → 直接恢复登录
    const me = await apiCall('/api/me');
    if(me && me.ok){ state.cloud.user=me.user; persistCloud(); setAuthMsg('● 已恢复登录…'); await afterLogin(); return; }
    state.cloud.token=null; state.cloud.user=null; persistCloud();
  }
  setAuthMsg('● 后端已连接，请注册或登录账号');
}

export async function boot(){
  try{
    await loadData();
  }catch(e){
    // 数据没拉全：显示错误 + 重试按钮，绝不带着半份 DATA 启动
    const lb=$('load-box'), ab=$('auth-box'), le=$('load-err'), lm=$('load-err-msg'), rl=$('btn-load-retry');
    if(lb) lb.style.display='none';
    if(ab) ab.style.display='none';
    if(le) le.style.display='';
    if(lm) lm.textContent='● '+(e && e.message || e)+' —— 请检查网络后重试（本地运行需先在项目目录起静态服务）';
    if(rl) rl.onclick=()=>location.reload();
    return;
  }
  { const lb=$('load-box'); if(lb) lb.style.display='none'; }
  { const ab=$('auth-box'); if(ab) ab.style.display=''; }
  loadAuto(); restoreCloud();
  showJobPicker();
  wireAuthUI();
  load();                       // 读取本地存档（不再直接进游戏，先过登录）
  applyOfflineEarnings();   // 离线收益：按离开时长补算经验/金币
  // 按钮
  $('btn-toggle').onclick=()=> setIdle(!state.idle);
  $('btn-speed').onclick=()=>{ state.speed = state.speed===1?2:(state.speed===2?4:1); $('btn-speed').textContent='速度 '+state.speed+'x'; };
  $('btn-home').onclick=()=>{ state.combat=null; state.player.hp=state.player._s.max_hp; state.player.mp=state.player._s.max_mp; log('<span class="sys">已返回安全区</span>'); renderAll(); };
  $('btn-save').onclick=save;
  $('btn-reset').onclick=()=>{ if(confirm('确定重置角色？')){ localStorage.removeItem(SAVE_KEY); location.reload(); } };
  document.querySelectorAll('#tabs button').forEach(b=> b.onclick=()=>{
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
  };
  // 装备镶嵌交互：在装备/背包点击装备时若已选宝石则镶嵌
  setGameTimer(setInterval(loop, 700));
  setInterval(()=>{
    if(!state.mine) return;
    mineTick(1*(state.speed||1));
    if(state.selTab==='life') renderTab();
  }, 1000);
  // P0：自动存档（30 秒）+ 云同步（内部再节流 45 秒）+ 统计上报（60 秒）+ 排行榜（3 分钟）
  setInterval(()=>{
    if(!state.player) return;
    sessSample();                                   // 本局趋势采样（折线图数据）
    if(state.auto.save){ save(true); if(state.selTab==='cloud') renderTab(); }
    if(state.auto.save) cloudSave();
  }, 30000);
  setInterval(()=>{ if(state.auto.stats) reportStats(false); }, 60000);
  setInterval(()=>{ if(state.auto.rank && state.idle) cloudRank(); }, 180000);
  // 关页/刷新前强制存档
  if(typeof window!=='undefined' && window.addEventListener){
    window.addEventListener('beforeunload', ()=>{ try{ save(true); }catch(e){} });
  }
  if(state.player) renderAll();
  // 启动登录流程（强制）：后端未启动会给出指引；已登录过会自动恢复
  startAuthFlow();
}
export function renderAll(){ renderHeader(); renderMap(); renderTab(); renderBattle(); } // renderTab 内部会同步刷新角色面板

// 让背包/装备点击时支持镶嵌：重写 findItem 点击逻辑，detect 待镶嵌宝石
export const _origEquip = equipItem;
export function renderTabWrap(){}





