/* ===== 模块 api.js —— 后端 API 层 + 云存档/账号/排行/统计 + 战力评分 =====
 * 来源：game.js L74-179（2026-10-21 模块化切分，内容逐字节保留）
 * 导出 16 个顶层名；import 由 AST 跨模块引用自动计算。
 */
import { state } from './state.js';
import { applySavePayload, buildSavePayload } from './loop.js';
import { applyOfflineEarnings } from './idle.js';

// ---------- 后端 API 层 ----------
export function apiCall(path, opts){
  opts = opts||{};
  const base = state.cloud.base;
  if(!state.cloud.ok || base==null) return Promise.reject(new Error('backend unavailable'));
  if(typeof fetch!=='function') return Promise.reject(new Error('no fetch'));
  const headers = Object.assign({'Content-Type':'application/json'}, opts.headers||{});
  if(state.cloud.token) headers['Authorization']='Bearer '+state.cloud.token;
  return fetch(base+path, { method:opts.method||'GET', headers, body: opts.body? JSON.stringify(opts.body):undefined })
    .then(r=> r.json().catch(()=>({ok:false,msg:'bad json'})));
}
// 探测后端：优先同源 /api，其次云端 API（CloudBase 部署），最后本机 8014（旧静态服务端口）
// 探测结果连同每个候选的失败原因记到 state.cloud.probeInfo，便于 UI 给出准确排障提示
// （线上曾出现云函数 410 Gone：账号资源点耗尽/欠费时 SCF 停服，此时不能再提示用户「运行 node server/server.js」）
export async function apiProbe(){
  if(state.cloud.checked) return state.cloud.ok;
  // 候选为「源」而非路径：同源 ''（后端托管静态时）、云端网关域、或独立端口 8014
  const CLOUD_API='https://fw911-d0gy6gkq41d1f6d5a-1512169574.ap-shanghai.app.tcloudbase.com';
  const cands=['', CLOUD_API, 'http://localhost:8014'];
  const info=[];
  for(const b of cands){
    const rec={ base:b||'(同源)', status:0, err:'' };
    try{
      // 6 秒超时：云端不可用时不要让登录页长时间卡在「正在检测后端…」
      const ctl = (typeof AbortController!=='undefined')? new AbortController() : null;
      const timer = ctl? setTimeout(()=>{ try{ ctl.abort(); }catch(e){} }, 6000) : 0;
      const r = await fetch(b+'/api/health', ctl? {signal:ctl.signal} : undefined);
      rec.status = (r && r.status)||0;
      const j = await r.json().catch(()=>null);
      if(timer) clearTimeout(timer);
      if(j && j.ok){ state.cloud.base=b; state.cloud.ok=true; info.push(rec); break; }
    }catch(e){ rec.err = String((e && e.message) || e); }
    info.push(rec);
  }
  state.cloud.probeInfo = info;
  state.cloud.checked=true;
  return state.cloud.ok;
}
// 探测失败时的人话摘要（供登录页显示），例：云端 API 返回 410（服务不可用）
export function probeSummary(){
  const info = state.cloud.probeInfo || [];
  const cloud = info.find(x=> x.base.indexOf('tcloudbase.com')>=0);
  if(cloud && cloud.status) return '云端 API 返回 '+cloud.status;
  if(cloud && cloud.err) return '云端 API 无法访问';
  return '服务端未就绪';
}
// 当前是否跑在本机（本机才有「启动本地后端」这条排障路径）
export function isLocalHost(){
  const host=(typeof location!=='undefined' && location.hostname)||'';
  return host==='localhost' || host==='127.0.0.1' || host==='' || host==='::1';
}
// 后端不可用时的正确指引（单一出处）
// 线上（静态托管域名）= 云端服务故障，绝不能提示「运行 node server/server.js」——那对线上用户毫无意义；
// 本机 = 才是「去项目目录起后端」。
export function backendHint(){
  if(isLocalHost()) return '后端未启动：请在项目目录执行 <b>node server/server.js</b>（端口 8014）后刷新本页面';
  return '云端服务暂不可用（'+probeSummary()+'）：账号 / 云存档 / 排行榜暂时无法使用';
}
export function cloudUser(){ return state.cloud.user; }
export async function cloudRegister(u, pw){
  if(!await apiProbe()) return {ok:false,msg:'后端未启动（运行 node server/server.js）'};
  const r = await apiCall('/api/register',{method:'POST', body:{username:u, password:pw}});
  if(r.ok){ state.cloud.user=r.user; state.cloud.token=r.token; persistCloud(); refreshSlots(); }
  return r;
}
export async function cloudLogin(u, pw){
  if(!await apiProbe()) return {ok:false,msg:'后端未启动（运行 node server/server.js）'};
  const r = await apiCall('/api/login',{method:'POST', body:{username:u, password:pw}});
  if(r.ok){ state.cloud.user=r.user; state.cloud.token=r.token; persistCloud(); refreshSlots(); }
  return r;
}
export async function cloudLogout(){
  try{ await apiCall('/api/logout',{method:'POST'}); }catch(e){}
  state.cloud.user=null; state.cloud.token=null; state.cloud.slots=[]; persistCloud();
}
export function persistCloud(){
  try{ localStorage.setItem('menghuihuaxia_cloud_v1', JSON.stringify({user:state.cloud.user, token:state.cloud.token, slot:state.cloud.slot, base:state.cloud.base})); }catch(e){}
}
export function restoreCloud(){
  try{ const c=JSON.parse(localStorage.getItem('menghuihuaxia_cloud_v1')||'null');
    if(c){ state.cloud.user=c.user||null; state.cloud.token=c.token||null; state.cloud.slot=c.slot||1; if(c.base) state.cloud.base=c.base; }
  }catch(e){}
}
// 本地存档模式偏好（独立于云端令牌）：记住玩家选择过「本地存档开始」，
// 刷新页面后自动沿用，不必每次重新点按钮（云端恢复并登录后会自动清除）。
const LOCAL_MODE_KEY='menghuihuaxia_local_mode_v1';
export function persistLocalMode(on){
  try{ if(on) localStorage.setItem(LOCAL_MODE_KEY,'1'); else localStorage.removeItem(LOCAL_MODE_KEY); }catch(e){}
}
export function restoreLocalMode(){
  try{ return localStorage.getItem(LOCAL_MODE_KEY)==='1'; }catch(e){ return false; }
}
export async function refreshSlots(){
  if(!state.cloud.ok || !state.cloud.token) return [];
  try{ const r=await apiCall('/api/slots'); if(r.ok){ state.cloud.slots=r.slots; return r.slots; } }catch(e){}
  return [];
}
// 云保存：节流 45 秒；失败静默回落本地
export async function cloudSave(slot, force){
  if(!state.cloud.ok || !state.cloud.token || !state.player) return {ok:false,msg:'未登录'};
  const now=Date.now();
  if(!force && now - state.cloud.lastSync < 45000) return {ok:false,msg:'throttled'};
  state.cloud.lastSync=now;
  try{
    const r=await apiCall('/api/save',{method:'POST', body:{slot:slot||state.cloud.slot, payload:buildSavePayload()}});
    if(r.ok) refreshSlots();
    return r;
  }catch(e){ return {ok:false,msg:String(e.message||e)}; }
}
export async function cloudLoad(slot){
  if(!state.cloud.ok || !state.cloud.token) return {ok:false,msg:'未登录'};
  const r=await apiCall('/api/load?slot='+(slot||state.cloud.slot));
  if(r.ok && r.payload){
    applySavePayload(r.payload);
    // 云端读档同样按离开时长补算离线收益（原版 _tick_realtime 读档即结算）；
    // applySavePayload 已置 state._loadedTs=payload.ts，此处直接补算
    applyOfflineEarnings();
    return {ok:true,msg:'已从云端读取 '+((slot||state.cloud.slot))+' 号槽位'};
  }
  return r;
}
export async function cloudDelete(slot){
  if(!state.cloud.ok || !state.cloud.token) return {ok:false,msg:'未登录'};
  const r=await apiCall('/api/save?slot='+(slot||state.cloud.slot),{method:'DELETE'});
  refreshSlots(); return r;
}
export async function cloudRank(){
  if(!state.cloud.ok || !state.player) return null;
  try{
    return await apiCall('/api/rank',{method:'POST', body:{name:state.player.name, job:state.player.job,
      level:state.player.level, power:powerScore(state.player), kills:state.player.stats.kills||0}});
  }catch(e){ return null; }
}
export async function cloudRankList(job){
  if(!state.cloud.ok) return null;
  try{ return await apiCall('/api/rank?limit=20'+(job? '&job='+encodeURIComponent(job):'')); }catch(e){ return null; }
}
export async function cloudStatsSummary(){
  if(!state.cloud.ok) return null;
  try{ return await apiCall('/api/stats/summary'); }catch(e){ return null; }
}

// ---------- 战力评分 ----------
export function powerScore(p){
  if(!p || !p._s) return 0;
  const c=p._s.combat||{};
  const atk=Math.max(c.phys_atk||0, c.magic_atk||0);
  const def=Math.max(c.phys_def||0, c.magic_def||0);
  return Math.round(atk*2 + def*1.5 + (c.max_hp||0)*0.4 + (c.phys_crit||0)*8 + (c.crit_dmg_pct||0)*3
    + (c.hit||0)*2 + (c.dodge||0)*2 + p.level*30);
}

