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
export async function apiProbe(){
  if(state.cloud.checked) return state.cloud.ok;
  // 候选为「源」而非路径：同源 ''（后端托管静态时）、云端网关域、或独立端口 8014
  const CLOUD_API='https://fw911-d0gy6gkq41d1f6d5a-1512169574.ap-shanghai.app.tcloudbase.com';
  const cands=['', CLOUD_API, 'http://localhost:8014'];
  for(const b of cands){
    try{
      const r = await fetch(b+'/api/health');
      const j = await r.json();
      if(j && j.ok){ state.cloud.base=b; state.cloud.ok=true; break; }
    }catch(e){}
  }
  state.cloud.checked=true;
  return state.cloud.ok;
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

