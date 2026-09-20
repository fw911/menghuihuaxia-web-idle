/* 梦回华夏·文字挂机版 — 基于解密真实配置数据复刻
 * 核心循环：选职业 → 地图挂机 → 自动战斗 → 经验/掉落/升级 → 装备 → 精炼/镶嵌
 * 数据全部来自 data/*.json（由 config_enc 解密而来）
 */
(function(){
'use strict';

const DATA_FILES = [
  'maps','monsters','character','jobs','slots','stats','quality',
  'loot_tables','loot_equip','loot_probs','loot_gem','loot_item','loot_potion','loot_chest','loot_wuhun',
  'bases_warrior','bases_mage','bases_shaman','bases_darkwitch','bases_accessory',
  'perk_pool','gems','refine','items','extract','craft','ores','bailian_recipes','furnace_recipes','ore_recipes',
  'modes','quality','shops','quests',
  'wuhun','wuhun_recipes','shenmo','shenmo_skills','shenmo_active_skills',
  'shenmo_skills_darkwitch','shenmo_skills_shaman','shenmo_active_skills_darkwitch','shenmo_active_skills_shaman',
  'crystals','couriers','modes',
  'skills_passive','skills_active_warrior','skills_active_mage','skills_active_shaman',
  'skills_active_darkwitch','skills_active_summon',
  'monster_skills','summons','mining','gem_recipes','potion_recipes','instance_exchange','achievements'
];

const state = {
  loaded:false,
  player:null,
  combat:null,    // 当前战斗中的怪物实例
  idle:false,
  speed:1,
  zone:null,      // {mapKey, zoneKey, isBoss}
  kills:0,
  ticks:0,        // 累计 tick 数（自动换区节流用）
  selTab:'bag',
  subSel:{},       // 每个页签选中的二级菜单（子菜单）key：{bag:'equip', ...}（不写存档，刷新回默认首项）
  logLines:[],
  events:[],      // 本命日志（只记录重要事件，与战斗日志不重复）
  whSel:[],       // 武魂面板已选中的武魂 uid（进化/融合用）
  summonHp:0,     // 当前战斗中召唤兽剩余生命
  mine:null,      // 挖矿进程 {grade, map, step, t}
  buff:null,      // 战斗内增益（增益/防御类技能提供，战斗开始重置）
  // 后端 / 云存档
  cloud:{ ok:false, base:null, user:null, token:null, slot:1, slots:[], checked:false, lastSync:0 },
  // 自动挂机设置（AUTO 持久化到 localStorage）
  auto:{ hp:60, mp:30, potion:true, buy:true, zone:false, save:true, stats:true, rank:true, junk:true },
  // 云存档页签的异步数据缓存
  cloudUI:{ rank:null, summary:null, job:'', loading:false },
  // 挂机统计（用于后端上报与面板展示）
  sess:{ t0:Date.now(), kills:0, exp:0, gold:0, drops:{}, deaths:0, dmgDealt:0, dmgTaken:0, lastReport:Date.now(),
    history:[],      // 本局趋势采样：{t,power,expPerMin,goldPerMin}
    dropTotal:{},    // 本局掉落品质累计（仅装备，不随上报清零）
    dropCount:0,     // 本局全部实物掉落件数（含消耗品/矿石/宝石/武魂）
    levelUps:[] },   // 本局升级时间线：{t,level}
};
const AUTO_KEY='menghuihuaxia_auto_v1';
function loadAuto(){
  try{ const a=JSON.parse(localStorage.getItem(AUTO_KEY)||'null'); if(a) Object.assign(state.auto, a); }catch(e){}
}
function saveAuto(){ try{ localStorage.setItem(AUTO_KEY, JSON.stringify(state.auto)); }catch(e){} }

// ---------- 后端 API 层 ----------
function apiCall(path, opts){
  opts = opts||{};
  const base = state.cloud.base;
  if(!state.cloud.ok || base==null) return Promise.reject(new Error('backend unavailable'));
  if(typeof fetch!=='function') return Promise.reject(new Error('no fetch'));
  const headers = Object.assign({'Content-Type':'application/json'}, opts.headers||{});
  if(state.cloud.token) headers['Authorization']='Bearer '+state.cloud.token;
  return fetch(base+path, { method:opts.method||'GET', headers, body: opts.body? JSON.stringify(opts.body):undefined })
    .then(r=> r.json().catch(()=>({ok:false,msg:'bad json'})));
}
// 探测后端：优先同源 /api，其次 8014（旧静态服务端口）
async function apiProbe(){
  if(state.cloud.checked) return state.cloud.ok;
  // 候选为「源」而非路径：同源 ''（后端托管静态时），或独立端口 8014
  const cands=['', 'http://localhost:8014'];
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
function cloudUser(){ return state.cloud.user; }
async function cloudRegister(u, pw){
  if(!await apiProbe()) return {ok:false,msg:'后端未启动（运行 node server/server.js）'};
  const r = await apiCall('/api/register',{method:'POST', body:{username:u, password:pw}});
  if(r.ok){ state.cloud.user=r.user; state.cloud.token=r.token; persistCloud(); refreshSlots(); }
  return r;
}
async function cloudLogin(u, pw){
  if(!await apiProbe()) return {ok:false,msg:'后端未启动（运行 node server/server.js）'};
  const r = await apiCall('/api/login',{method:'POST', body:{username:u, password:pw}});
  if(r.ok){ state.cloud.user=r.user; state.cloud.token=r.token; persistCloud(); refreshSlots(); }
  return r;
}
async function cloudLogout(){
  try{ await apiCall('/api/logout',{method:'POST'}); }catch(e){}
  state.cloud.user=null; state.cloud.token=null; state.cloud.slots=[]; persistCloud();
}
function persistCloud(){
  try{ localStorage.setItem('menghuihuaxia_cloud_v1', JSON.stringify({user:state.cloud.user, token:state.cloud.token, slot:state.cloud.slot, base:state.cloud.base})); }catch(e){}
}
function restoreCloud(){
  try{ const c=JSON.parse(localStorage.getItem('menghuihuaxia_cloud_v1')||'null');
    if(c){ state.cloud.user=c.user||null; state.cloud.token=c.token||null; state.cloud.slot=c.slot||1; if(c.base) state.cloud.base=c.base; }
  }catch(e){}
}
async function refreshSlots(){
  if(!state.cloud.ok || !state.cloud.token) return [];
  try{ const r=await apiCall('/api/slots'); if(r.ok){ state.cloud.slots=r.slots; return r.slots; } }catch(e){}
  return [];
}
// 云保存：节流 45 秒；失败静默回落本地
async function cloudSave(slot, force){
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
async function cloudLoad(slot){
  if(!state.cloud.ok || !state.cloud.token) return {ok:false,msg:'未登录'};
  const r=await apiCall('/api/load?slot='+(slot||state.cloud.slot));
  if(r.ok && r.payload){ applySavePayload(r.payload); return {ok:true,msg:'已从云端读取 '+((slot||state.cloud.slot))+' 号槽位'}; }
  return r;
}
async function cloudDelete(slot){
  if(!state.cloud.ok || !state.cloud.token) return {ok:false,msg:'未登录'};
  const r=await apiCall('/api/save?slot='+(slot||state.cloud.slot),{method:'DELETE'});
  refreshSlots(); return r;
}
async function cloudRank(){
  if(!state.cloud.ok || !state.player) return null;
  try{
    return await apiCall('/api/rank',{method:'POST', body:{name:state.player.name, job:state.player.job,
      level:state.player.level, power:powerScore(state.player), kills:state.player.stats.kills||0}});
  }catch(e){ return null; }
}
async function cloudRankList(job){
  if(!state.cloud.ok) return null;
  try{ return await apiCall('/api/rank?limit=20'+(job? '&job='+encodeURIComponent(job):'')); }catch(e){ return null; }
}
async function cloudStatsSummary(){
  if(!state.cloud.ok) return null;
  try{ return await apiCall('/api/stats/summary'); }catch(e){ return null; }
}

// ---------- 战力评分 ----------
function powerScore(p){
  if(!p || !p._s) return 0;
  const c=p._s.combat||{};
  const atk=Math.max(c.phys_atk||0, c.magic_atk||0);
  const def=Math.max(c.phys_def||0, c.magic_def||0);
  return Math.round(atk*2 + def*1.5 + (c.max_hp||0)*0.4 + (c.phys_crit||0)*8 + (c.crit_dmg_pct||0)*3
    + (c.hit||0)*2 + (c.dodge||0)*2 + p.level*30);
}

// ---------- 武魂系统参数 ----------
// 原版武魂为长期养成（0★满级约需 4000 万经验），网页挂机版放大吸经验倍率以便体验
const WUHUN_EXP_MULT = 30;
// 武魂类型 -> 属性归属分类（用于激活时按星级取数值区间）
const WUHUN_ATTR_CAT = {
  strength:'five_dim', agility:'five_dim', constitution:'five_dim', intelligence:'five_dim', spirit:'five_dim',
  phys_atk:'atk_flat', magic_atk:'atk_flat', dark_atk:'atk_flat',
  phys_atk_pct:'atk_pct', magic_atk_pct:'atk_pct',
  phys_def:'def_flat', magic_def:'def_flat',
  phys_def_pct:'def_pct', magic_def_pct:'def_pct',
  max_hp:'hp_flat', max_hp_pct:'hp_pct',
  phys_crit:'crit', magic_crit:'crit', dmg_reduce_pct:'reduce'
};
const WUHUN_TYPE_KEYS = ['qinglong','baihu','zhuque','xuanwu'];
// 三魂七魄材料键（武魂炼制原料）
const SANHUN_KEYS = ['sanhun_tian','sanhun_di','sanhun_ren'];
const QIPO_KEYS = ['qipo_xi','qipo_nu','qipo_ai_sorrow','qipo_ju','qipo_ai_love','qipo_wu','qipo_yu'];

// 日志显示条数：本命日志已合并到中间战斗日志，统一显示 10 条
const EVENT_SHOW = 10;  // 保留，供事件查询/外部引用使用
const EVENT_KEEP = 20;  // 本命日志保留上限
const LOG_SHOW   = 10;  // 合并后日志显示条数
const LOG_KEEP   = 60;  // 合并后日志保留上限

const DATA = {};
let MONSTERS = {};   // key -> monster
let MON_SKILLS = {}; // monster key -> [怪物技能]
let SUMMON_SKILLS = {}; // 召唤兽技能 key -> skill
let GEM_ORDER = [];  // 宝石品级链（低 -> 高）
let SM_ACTIVE = {};  // 神魔主动技能 key -> def（合并 shenmo_active_skills*）
let TITLES = [];     // achievements.json#titles（称号配置）
let JOB_BASES = {};  // job -> bases object
let BASE_BY_KEY = {}; // base_key -> base object (跨职业)
let LOOT = {};       // 合并后的掉落表
// 生活技能：矿石 / 材料 资源索引
let ORE_BY_TIER = ['hantie','chitong','moyin','wujin','liufang','lihuo','haihun'];
let ORE_NAME = {};   // ore key -> 中文名
let ORE_PRICE = {};  // ore key -> 价格
let ORE_KEYS = new Set();
let ITEM_NAME_CACHE = {}; // key -> 统一中文显示名
const LS = { forgeSlot:'weapon', forgeTier:1, bailEquip:null, extractEquip:null, oreRecipe:'recipe_ore_4', furnace:null,
  mineGrade:'yipin', mineMap:'tianshengyuan', gemSeries:null, gemGrade:null, forgeMode:'random', refineEq:null, inlayGem:null, inlayEquip:null };
const MAT_SHOP_LIST = [
  {key:'bailian_shi', price:5}, {key:'lianhua_ping', price:50},
  {key:'yipin_luopan', price:200}, {key:'erpin_luopan', price:600}, {key:'sanpin_luopan', price:1500},
  {key:'hantie', price:15}, {key:'chitong', price:30}, {key:'moyin', price:60},
  {key:'tiangong_shi', price:100}, {key:'lunhui_shi', price:150},
  {key:'baoxia_xuangui', price:50}, {key:'baiyu_lingpai', price:5000}, {key:'yuquan_box', price:50},
  {key:'tong_ban', price:5}
];

// 词条名 → 战斗属性（让防御/生命等词条真正生效，高品质装备更强）
const PERK_STAT_MAP = {
  // 精炼隐藏词条（refine_hidden_perks）：攻击部位 → 致命(物爆+1%)，其余 → 守御(减伤+1%)
  '致命':'phys_crit', '守御':'dmg_reduce_pct',
  '物理防御':'phys_def', '法术防御':'magic_def', '生命值':'max_hp',
  '物理攻击':'phys_atk', '法术攻击':'magic_atk',
  '冰系法术防御':'magic_def', '火系法术防御':'magic_def',
  '暗系法术防御':'magic_def', '电系法术防御':'magic_def',
  '最小物理攻击':'phys_atk', '最大物理攻击':'phys_atk'
};

// ---------- 工具 ----------
const rnd = (a,b)=> a + Math.random()*(b-a);
const ri  = (a,b)=> Math.floor(a + Math.random()*(b-a+1));
const pick = arr => arr[Math.floor(Math.random()*arr.length)];
const clamp = (v,a,b)=> Math.max(a,Math.min(b,v));
let _uid = 1; const uid = ()=> 'it'+(_uid++);

const ATTR_EFFECT_KEY = {
  '力量':'strength','敏捷':'agility','体质':'constitution','智力':'intelligence',
  '精神':'spirit','耐力':'constitution','体力':'constitution','根骨':'constitution'
};
const SLOT_CAT = {
  helmet:'helmets', shoulder_l:'shoulders', armor:'armors', pants:'pants',
  cloak:'cloaks', gloves:'gloves', belt:'belts', shoes:'shoes',
  weapon:'weapons', shield:'shields', necklace:'necklaces', ring1:'rings', ring2:'rings'
};
const CAT_SLOT = {helmets:'helmet', shoulders:'shoulder_l', armors:'armor', pants:'pants',
  cloaks:'cloak', gloves:'gloves', belts:'belt', shoes:'shoes', weapons:'weapon',
  shields:'shield', necklaces:'necklace', rings:'ring1'};
const SLOT_NAME = {
  helmet:'头盔', shoulder_l:'护肩', armor:'盔甲', pants:'护腿', cloak:'披风',
  gloves:'护手', belt:'腰带', shoes:'鞋子', weapon:'武器', shield:'盾牌',
  necklace:'项链', ring1:'戒指', ring2:'戒指', soul1:'武魂', soul2:'武魂'
};

// ---------- 数据加载 ----------
async function loadData(){
  for(const f of DATA_FILES){
    try{
      const r = await fetch('data/'+f+'.json');
      DATA[f] = await r.json();
    }catch(e){ /* 部分文件可能不存在，忽略 */ }
  }
  MONSTERS = {};
  (DATA.monsters.monsters||[]).forEach(m=> MONSTERS[m.key]=m);
  // 职业基础装备：武器/防具按职业，戒指项链用 accessory（战士等无戒指基底时）
  JOB_BASES = {
    warrior:DATA.bases_warrior, mage:DATA.bases_mage,
    shaman:DATA.bases_shaman, darkwitch:DATA.bases_darkwitch
  };
  // 合并所有 loot_* 表，便于按怪物 loot_table 键统一解析
  LOOT = {};
  for(const f of ['loot_tables','loot_equip','loot_gem','loot_potion','loot_item','loot_wuhun','loot_chest']){
    const t = DATA[f]; if(!t) continue;
    for(const k in t) LOOT[k]=t[k];
  }
  // 建立 base_key -> base 对象 索引（商店装备兑换用）
  for(const k in BASE_BY_KEY) delete BASE_BY_KEY[k];
  for(const f of ['bases_warrior','bases_mage','bases_shaman','bases_darkwitch','bases_accessory']){
    const obj = DATA[f]; if(!obj) continue;
    for(const cat in obj){
      if(Array.isArray(obj[cat])) for(const b of obj[cat]) if(b.key) BASE_BY_KEY[b.key]=b;
    }
  }
  // 矿石索引
  ORE_NAME={}; ORE_PRICE={}; ORE_KEYS=new Set();
  (DATA.ores.ore_types||[]).forEach(o=>{ ORE_NAME[o.key]=o.name; ORE_PRICE[o.key]=o.price; ORE_KEYS.add(o.key); });
  // 技能索引：job -> 主动技能列表；通用被动技能
  SKILLS = {};
  for(const j of ['warrior','mage','shaman','darkwitch','summon']){
    const d = DATA['skills_active_'+j];
    if(d && d.active_skills) SKILLS[j]=d.active_skills;
  }
  PASSIVES = (DATA.skills_passive||{}).passive_skills || [];
  // 怪物技能：技能 key 以怪物 key 开头（如 anyingguiyuan1_magic -> anyingguiyuan1）
  MON_SKILLS = {};
  const mkeys = Object.keys(MONSTERS);
  for(const sk of ((DATA.monster_skills||{}).monster_skills||[])){
    let best=null;
    for(const k of mkeys){ if(sk.key.indexOf(k)===0 && (!best || k.length>best.length)) best=k; }
    if(best){ (MON_SKILLS[best]=MON_SKILLS[best]||[]).push(sk); }
  }
  // 神魔主动技能（shenmo_active_skills* 合并）
  SM_ACTIVE = {};
  for(const f of ['shenmo_active_skills','shenmo_active_skills_darkwitch','shenmo_active_skills_shaman']){
    const d=DATA[f]; if(!d) continue;
    for(const sk of (d.active_skills||[])) SM_ACTIVE[sk.key]=sk;
  }
  // 称号配置
  TITLES = (DATA.achievements || {}).titles || [];
  // 召唤兽技能
  SUMMON_SKILLS = {};
  for(const sk of ((DATA.skills_active_summon||{}).active_skills||[])) SUMMON_SKILLS[sk.key]=sk;
  // 宝石品级链（从 gem_recipes 推导 碎石 -> 石 -> ...）
  GEM_ORDER = [];
  {
    const gr = DATA.gem_recipes||{};
    const srcSet={}, dstSet={}, map={};
    for(const k in gr){ const r=gr[k]; if(r.src_grade){ srcSet[r.src_grade]=1; map[r.src_grade]=r; } if(r.dst_grade) dstSet[r.dst_grade]=1; }
    let g = Object.keys(srcSet).filter(x=> !dstSet[x])[0];
    while(g && GEM_ORDER.indexOf(g)<0){
      GEM_ORDER.push(g);
      const nx = map[g];
      g = (nx && nx.dst_grade && GEM_ORDER.indexOf(nx.dst_grade)<0)? nx.dst_grade : null;
    }
    if(!GEM_ORDER.length) GEM_ORDER=['碎石','石','玉','晶','魂'];
  }
  rebuildItemNameCache();
  state.loaded = true;
}
function rebuildItemNameCache(){
  const cache = {};
  // 1) items.json 主物品表
  (DATA.items.items||[]).forEach(i=>{ if(i.key && i.name) cache[i.key]=i.name; });
  // 2) 武魂系统的材料/成品名（覆盖 items 中不存在的键）
  const wuhunItems = (DATA.wuhun||{}).items||{};
  for(const k in wuhunItems){
    if(cache[k]) continue;
    const v=wuhunItems[k];
    cache[k] = (typeof v==='string'? v : (v && v.name) || k);
  }
  // 3) 武魂配方卷轴与产物名
  for(const k in (DATA.wuhun_recipes||{})){
    const r=DATA.wuhun_recipes[k];
    if(r.name && !cache[k]) cache[k]=r.name;
    if(r.result_item && r.result_name && !cache[r.result_item]) cache[r.result_item]=r.result_name;
  }
  // 4) 矿石
  (DATA.ores.ore_types||[]).forEach(o=>{ if(o.key && o.name && !cache[o.key]) cache[o.key]=o.name; });
  // 5) 晶石
  ((DATA.crystals||{}).crystal_types||[]).forEach(c=>{ if(c.key && c.name && !cache[c.key]) cache[c.key]=c.name; });
  // 6) 宝石炼制配方：卷轴名 + 原料/产物名
  for(const k in (DATA.gem_recipes||{})){
    const r=DATA.gem_recipes[k];
    if(r.name && !cache[k]) cache[k]=r.name;
    if(r.src_key && r.src_name && !cache[r.src_key]) cache[r.src_key]=r.src_name;
    if(r.dst_key && r.dst_name && !cache[r.dst_key]) cache[r.dst_key]=r.dst_name;
    if(r.result_key && r.result_name && !cache[r.result_key]) cache[r.result_key]=r.result_name;
  }
  // 7) 乾坤炉配方：配方名，以及产物/来源的拆分名（如 玄龟匣→青鸾匣）
  for(const k in (DATA.furnace_recipes||{})){
    const r=DATA.furnace_recipes[k];
    if(r.name){
      if(!cache[k]) cache[k]=r.name;
      if(r.result_key){
        const dst = r.name.includes('→') ? r.name.split('→').pop().trim() : r.name;
        if(!cache[r.result_key]) cache[r.result_key]=dst;
      }
    }
  }
  // 8) 矿石转换配方
  for(const k in (DATA.ore_recipes||{})){
    const r=DATA.ore_recipes[k];
    if(r.name && !cache[k]) cache[k]=r.name;
  }
  // 9) 百炼丹产物
  for(const k in (DATA.bailian_recipes||{})){
    const r=DATA.bailian_recipes[k];
    if(r.result_item && r.result_name && !cache[r.result_item]) cache[r.result_item]=r.result_name;
  }
  // 10) 药水炼制产物
  for(const k in (DATA.potion_recipes||{})){
    const r=DATA.potion_recipes[k];
    if(r.result_item && r.result_name && !cache[r.result_item]) cache[r.result_item]=r.result_name;
  }
  // 显式覆盖表最后生效，保证人工指定名不被其它数据源覆盖
  Object.assign(cache, EXTRA_ITEM_NAME);
  ITEM_NAME_CACHE = cache;
}
function getMonster(key){
  return MONSTERS[key] || null;
}

// ---------- 经验/属性 ----------
function expToNext(level){
  const ef = DATA.character.exp_formula;
  // exp_formula(15*L^3) 是「升到该等级的累计经验」曲线，单级需求取差分。
  // 若直接把 15*L^3 当作单级需求，会因怪物经验仅线性增长（Lv120 怪仅 734 经验）
  // 导致 Lv30 起需击杀 2700+ 只怪才能升 1 级，中期彻底卡死。
  return Math.round(ef.coefficient * (Math.pow(level+1, ef.power) - Math.pow(level, ef.power)));
}
// 等级差经验缩放（口径对齐原版 battle/encounter.py:scale_monster_exp，本次由 exe 反汇编裁定）：
//   diff = 怪物等级 − 角色等级
//     diff > 0 → min(over_high_factor^diff, max_cap)      跨级打怪收益指数放大，封顶 max_cap
//     diff = 0 → 1.0
//     diff < 0 → max(0, 1 − (−diff) × over_low_factor)     刷低级怪线性衰减，低 5 级即 0 经验
// 旧实现用 ratio = 角色等级/怪物等级 做阶梯（>=1.5 → 0.2；<=0.7 → 1.2）：
// 既丢了指数放大、又丢了线性衰减，且 max_cap 被 min() 吃掉变成死配置。
function expScale(diff){
  const ms = (DATA.character || {}).monster_exp_scale || {};
  if(diff > 0) return Math.min(Math.pow(ms.over_high_factor || 1, diff), ms.max_cap || 1);
  if(diff < 0) return Math.max(0, 1 - (-diff) * (ms.over_low_factor || 0));
  return 1.0;
}
// 类型经验倍率：type_exp_tiers 按【怪物等级】每 10 级一档（原版 tier_idx=(mon_level-1)//10，越界取末档），
// 缺表/缺档时回落到 type_exp_multiplier 的基础值（= tiers 第 1 段）。
// 旧实现误用【角色等级】按 ceil(level/20) 取档：高级角色刷低级精英会白拿 1.83~4.17 倍。
function typeExpMul(type, monLevel){
  const ch = DATA.character || {};
  const tiers = ch.type_exp_tiers && ch.type_exp_tiers[type];
  if(tiers && tiers.length){
    const t = clamp(Math.floor(((monLevel || 1) - 1) / 10) + 1, 1, tiers.length);
    const v = tiers[t - 1];
    if(typeof v === 'number' && v > 0) return v;
  }
  return (ch.type_exp_multiplier || {})[type] || 1;
}
function monsterExp(m, playerLevel){
  const base = m.exp || 0;
  if(base <= 0) return 0;                                  // 原版：mon_exp <= 0 直接返回 0
  const scale = expScale((m.level || 1) - playerLevel);
  if(scale <= 0) return 0;                                 // 怪低 5 级以上 → 0 经验
  return Math.max(0, Math.trunc(base * scale * typeExpMul(m.type, m.level || 1)));
}

// 计算角色派生属性
// ================= 技能系统（skills_active_* / skills_passive） =================
let SKILLS = {};    // job -> [主动技能]
let PASSIVES = [];  // 通用被动技能

function jobSkills(job){ return SKILLS[job] || []; }
function skillLvData(s, lv){          // 取技能第 lv 级数据（levels 为 0 基数组）
  const arr = s.levels || [];
  if(!arr.length) return {};
  return arr[Math.max(0, Math.min(lv-1, arr.length-1))];
}
function skillUpgradeReq(s, curLv){   // 升到 curLv+1 的条件（requirements 索引对齐等级）
  return (s.requirements||[])[curLv] || null;
}
// 被动等级：数据未提供升级消耗，改为随角色等级自动成长（learn_level 起每 5 级 +1）
function passiveLevel(p, ps){
  if(!(p.passives||{})[ps.key]) return 0;
  const auto = 1 + Math.floor(Math.max(0,(p.level||1)-(ps.learn_level||1))/5);
  return Math.max(1, Math.min(auto, ps.max_level||1));
}
// 达到 learn_level 自动学会技能/领悟被动
function syncSkills(){
  const p=state.player; if(!p) return;
  if(!p.skills) p.skills={};
  if(!p.passives) p.passives={};
  if(!p.skillCd) p.skillCd={};
  for(const s of jobSkills(p.job)){
    if(p.level >= (s.learn_level||1) && !p.skills[s.key]){
      p.skills[s.key]=1;
      eventLog('学会技能 <span class="loot">'+s.name+'</span>');
    }
  }
  for(const ps of PASSIVES){
    if((ps.jobs||[]).indexOf(p.job)<0) continue;
    if(p.level >= (ps.learn_level||1) && !p.passives[ps.key]){
      p.passives[ps.key]=1;
      eventLog('领悟被动 <span class="loot">'+ps.name+'</span>');
    }
  }
}
function upgradeSkill(key){
  const p=state.player;
  const s=jobSkills(p.job).find(x=>x.key===key);
  if(!s) return {ok:false,msg:'技能不存在'};
  const lv=p.skills[key]||0;
  if(lv<=0) return {ok:false,msg:'尚未学会该技能'};
  if(lv>=(s.max_level||1)) return {ok:false,msg:'已达最高等级'};
  const req=skillUpgradeReq(s, lv);
  if(req){
    if(p.level<(req.level||0)) return {ok:false,msg:'角色等级不足（需 Lv.'+req.level+'）'};
    if(p.gold<(req.money||0)) return {ok:false,msg:'金币不足（需 '+fmtNum(req.money||0)+'）'};
    if(p.exp<(req.exp||0)) return {ok:false,msg:'经验不足（需 '+fmtNum(req.exp||0)+'）'};
    p.gold-=req.money||0; p.exp-=req.exp||0;
  }
  p.skills[key]=lv+1;
  refreshStats();
  return {ok:true,msg:s.name+' 提升至 '+p.skills[key]+' 级'};
}
// 被动技能提供的属性加成
function passiveBonus(p){
  const out={};
  for(const ps of PASSIVES){
    const lv=passiveLevel(p, ps);
    if(lv<=0) continue;
    const arr=ps.levels||[];
    const e = arr.length ? arr[Math.max(0,Math.min(lv-1,arr.length-1))] : (ps.effect||{});
    for(const k in e) out[k]=(out[k]||0)+e[k];
  }
  return out;
}
// 技能释放条件：不在冷却 且 MP 足够
function canCast(s){
  const p=state.player;
  const lv=p.skills[s.key]||0; if(lv<=0) return false;
  if((p.skillCd||{})[s.key]>0) return false;
  const L=skillLvData(s, lv);
  return (p.mp||0) >= (L.mp||0);
}
// 技能冷却每回合递减
function tickSkillCd(){
  const p=state.player; if(!p||!p.skillCd) return;
  for(const k in p.skillCd) if(p.skillCd[k]>0) p.skillCd[k]--;
  // 神魔主动技能冷却
  if(p.shenmo && p.shenmo.cd) for(const k in p.shenmo.cd) if(p.shenmo.cd[k]>0) p.shenmo.cd[k]--;
}
function paySkill(s){
  const p=state.player;
  const lv=p.skills[s.key]||1;
  const L=skillLvData(s, lv);
  p.mp=Math.max(0,(p.mp||0)-(L.mp||0));
  p.skillCd[s.key]=L.cd!=null? L.cd : (s.cd||1);
  return L;
}
// 选一个可用的攻击类技能（伤害最高优先）
function pickAttackSkill(){
  const p=state.player; let best=null, bestDmg=-1;
  for(const s of jobSkills(p.job)){
    const st=s.skill_type;
    if(st!=='attack'&&st!=='control') continue;
    if(!canCast(s)) continue;
    const lv=p.skills[s.key]||1;
    const d=skillLvData(s,lv).damage||0;
    if(d>bestDmg){ bestDmg=d; best=s; }
  }
  return best;
}
// 选一个可用的治疗技能
function pickHealSkill(){
  const p=state.player; let best=null, bestV=-1;
  for(const s of jobSkills(p.job)){
    if(s.skill_type!=='heal') continue;
    if(!canCast(s)) continue;
    const lv=p.skills[s.key]||1;
    const L=skillLvData(s,lv);
    let v=0;
    for(const e of (L.effects||[])){
      if(e.type==='heal') v+=e.value||0;
      else if(e.type==='hot') v+=(e.value||0)*Math.max(1,Math.round((e.duration||1)/2));
    }
    if(v>bestV){ bestV=v; best=s; }
  }
  return best;
}
// 战斗开始时释放增益/防御类技能，加成本场战斗
function castBattleStartBuffs(){
  const p=state.player;
  state.buff={atk:0, phys_def:0, magic_def:0};
  for(const s of jobSkills(p.job)){
    const st=s.skill_type;
    if(st!=='buff'&&st!=='defense') continue;
    if(!canCast(s)) continue;
    const L=paySkill(s);
    for(const e of (L.effects||[])){
      if(e.type==='phys_def_flat') state.buff.phys_def+=e.value||0;
      else if(e.type==='magic_def_flat') state.buff.magic_def+=e.value||0;
      else if(e.type==='phys_atk_flat'||e.type==='magic_atk_flat'||e.type==='atk_flat') state.buff.atk+=e.value||0;
    }
    log('施放 <span class="skill">'+s.name+'</span>');
  }
}
// 技能伤害（基础伤害 + 主属性 30% 加成，保证技能始终强于普攻且随成长）
function skillDamage(s, lv){
  const p=state.player, s0=p._s;
  const L=skillLvData(s, lv);
  const main=s0.main||0;
  // 基础伤害 + 主属性 30% 加成；但至少为普攻的 1.1 倍（技能有 MP/CD 成本，应强于普攻）
  let dmg = Math.max((L.damage||0) + Math.round(main*0.3), Math.round(main*1.1));
  const ag = smAggCached();
  if(ag.dmgBonus) dmg = Math.round(dmg*(1+ag.dmgBonus/100));
  if(ag.skillDmg[s.name]!=null) dmg = Math.round(dmg*(1+ag.skillDmg[s.name]/100));
  return dmg;
}
// 对怪物应用一次伤害（含防御减伤与暴击）
// 神魔：命中追加攻击（on_hit_append），普攻与技能命中均触发
function smAppendHit(m, def){
  const ag=smAggCached(); const s=state.player._s; let sum=0;
  for(const ap of (ag.append||[])){
    if(Math.random()*100 < (ap.prob||0)){
      const extra=Math.max(1, Math.round((s.main*(ap.pct||0)/100)*(s.main*(ap.pct||0)/100)/def));
      m.curHp-=extra; sum+=extra;
    }
  }
  if(ag.silence && Math.random()*100 < ag.silence.prob) m.silence=Math.max(m.silence||0, ag.silence.dur);
  if(ag.healReduce && Math.random()*100 < ag.healReduce.prob) m.healReduce=Math.max(m.healReduce||0, ag.healReduce.pct);
  return sum;
}
// 怪物真实防御：数据里 phys_def / magic_def 字段恒为 0（解密残留），
// 真实防御在 min/max 区间，取中值（与攻击 (min+max)/2 一致）。
function monsterDef(m, type){
  const isMagic = type==='magic_def' || type==='magic';
  const lo = isMagic ? (m.min_magic_def||0) : (m.min_phys_def||0);
  const hi = isMagic ? (m.max_magic_def||0) : (m.max_phys_def||0);
  return lo + (hi-lo)/2;
}
function damageMonster(m, raw){
  const p=state.player, s0=p._s;
  const v=raw*rnd(0.85,1.15);
  const def=monsterDef(m, s0.defType);
  // 原版伤害公式：max(1, round(atk²/def))；怪物完全闪避则 0 伤害
  const dodged = Math.random()*100 < (m.dodge||0);
  let dmg = dodged ? 0 : Math.max(1, Math.round((v*v/def)*titleDmgMult(m)));
  const crit = !dodged && Math.random() < (s0.combat.phys_crit||0)/100;
  const critMult=1.8 + (smAggCached().critDmg||0)/100;
  if(crit) dmg=Math.round(dmg*critMult);
  if(!dodged) m.curHp-=dmg;
  state.pendingAppend = (state.pendingAppend||0) + (dodged?0:smAppendHit(m, def));
  return {dmg, crit, dodged};
}
function castHeal(s){
  const L=paySkill(s);
  const p=state.player;
  let heal=0;
  for(const e of (L.effects||[])){
    if(e.type==='heal') heal+=e.value||0;
    else if(e.type==='hot') heal+=(e.value||0)*Math.max(1,Math.round((e.duration||1)/2));
  }
  if(heal<=0) heal=Math.round((p._s.max_hp||100)*0.2);
  p.hp=Math.min(p._s.max_hp, p.hp+heal);
  return {heal:Math.round(heal)};
}

// ================= 武魂系统（wuhun.json） =================
function wh(){ return DATA.wuhun || {}; }
function whStarDef(t, star){
  const arr = (wh().stars||{})[t] || [];
  return arr[star!=null?star:0] || arr[0] || null;
}
function whMaxLevel(t, star){ const d=whStarDef(t,star); return d? (d.max_level||10) : 10; }
function whReqLevel(star){                       // 星级对应的角色等级要求 [60,60,70,80,90,100]
  const r=(wh().star_rules||{}).level_required||[];
  return r[star]!=null ? r[star] : 60;
}
function whTypeName(t){ const w=(wh().wuhun_types||{})[t]; return w? w.name : t; }
function whStarName(star){ const n=(wh().star_rules||{}).star_names||[]; return n[star]||('★'.repeat(star||0)); }
function whName(o){ return whTypeName(o.whType)+whStarName(o.star); }
function whItemName(key){ const it=(wh().items||{})[key]; return it? it.name : key; }

// 生成一个武魂（背包物品：type='wuhun'，不叠加）
function genWuhun(star, type){
  star = clamp(star||0, 0, 5);
  const t = type || pick(WUHUN_TYPE_KEYS);
  return { uid:uid(), type:'wuhun', whType:t, star, level:1, exp:0,
           activated:false, actAttr:null, count:1 };
}
// 武魂当前属性：按 base→max 在 max_level 内线性插值
function wuhunStats(o){
  const W=wh();
  const td=(W.wuhun_types||{})[o.whType]; if(!td) return {};
  const sd=whStarDef(o.whType,o.star);     if(!sd) return {};
  const stats=td.stats||[], base=sd.base||[], mx=sd.max||[];
  const maxLv=sd.max_level||10;
  const k = maxLv>1 ? clamp((o.level-1)/(maxLv-1),0,1) : 0;
  const out={};
  for(let i=0;i<stats.length;i++) out[stats[i]] = Math.round((base[i]||0) + ((mx[i]||0)-(base[i]||0))*k);
  return out;
}
// 升到下一级所需经验：ceil(coef_by_star[star] * level^power)
function wuhunExpNeed(o){
  const f=wh().exp_formula||{power:2.4,coef_by_star:[64701]};
  const c=(f.coef_by_star||[])[o.star]||f.coef_by_star[0]||64701;
  return Math.ceil(c * Math.pow(o.level, f.power||2.4));
}
// 佩戴后杀怪吸经验：双槽各 50% 角色经验，满级停吸
function wuhunAbsorb(charExp){
  const p=state.player; if(!p||!p.wuhunSlots) return;
  for(const o of p.wuhunSlots){
    if(!o) continue;
    const maxLv=whMaxLevel(o.whType,o.star);
    if(o.level>=maxLv){ o.exp=0; continue; }
    o.exp += charExp*0.5*WUHUN_EXP_MULT;
    let up=false;
    while(o.level<maxLv && o.exp>=wuhunExpNeed(o)){ o.exp-=wuhunExpNeed(o); o.level++; up=true; }
    if(o.level>=maxLv){
      o.exp=0;
      if(up) eventLog('<span class="lv">武魂 '+whName(o)+' 修炼圆满（'+maxLv+' 级），可进化升星</span>');
    }else if(up) eventLog('武魂 <span class="loot">'+whName(o)+'</span> 升至 '+o.level+' 级');
  }
}
// 潜能激活：消耗对应星级启魂符，附加一条随机激活属性
function wuhunActivate(o){
  const W=wh();
  if(!o) return {ok:false,msg:'武魂不存在'};
  if(o.activated) return {ok:false,msg:'该武魂已激活'};
  const p=state.player;
  const item='lingyin_'+o.star;
  if((p.materials[item]||0)<1) return {ok:false,msg:'缺少材料：'+whItemName(item)+' x1'};
  const sd=whStarDef(o.whType,o.star);
  const pool=(sd&&sd.attr_pool)||[];
  const name = pool.length? pick(pool) : 'phys_atk';
  const cat = WUHUN_ATTR_CAT[name]||'atk_flat';
  const rg = ((W.star_rules||{}).attr_value_ranges||{})[cat];
  const r = rg ? (rg[''+o.star]||rg['0']) : [1,1];
  p.materials[item] = (p.materials[item]||0)-1;
  o.activated=true; o.actAttr={ name, value: ri(r[0],r[1]) };
  return {ok:true,msg:'激活成功，附加 '+(W.attr_labels[name]||name)+' +'+o.actAttr.value};
}
// 武魂进化：两个满级同类型同星级 + 目标星级化星诀 → 高一级 0 级未激活武魂
function wuhunEvolve(uidA, uidB){
  const p=state.player;
  const a=p.bag.find(b=>b.uid===uidA), b2=p.bag.find(b=>b.uid===uidB);
  if(!a||!b2||a===b2) return {ok:false,msg:'需要两个不同的武魂'};
  if(a.type!=='wuhun'||b2.type!=='wuhun') return {ok:false,msg:'只能选择武魂'};
  if(a.whType!==b2.whType||a.star!==b2.star) return {ok:false,msg:'需两个同类型、同星级武魂'};
  const maxLv=whMaxLevel(a.whType,a.star);
  if(a.level<maxLv||b2.level<maxLv) return {ok:false,msg:'需两个均修炼圆满（'+maxLv+' 级）'};
  if(a.star>=5) return {ok:false,msg:'已达最高星级'};
  const item='niepan_'+(a.star+1);
  if((p.materials[item]||0)<1) return {ok:false,msg:'缺少材料：'+whItemName(item)+' x1'};
  const newStar=a.star+1;
  if(p.level < whReqLevel(newStar)) return {ok:false,msg:'角色等级不足，佩戴 '+newStar+'★ 需 Lv.'+whReqLevel(newStar)};
  p.materials[item]=(p.materials[item]||0)-1;
  const nw=genWuhun(newStar, a.whType);
  p.bag = p.bag.filter(b=>b.uid!==uidA && b.uid!==uidB);
  p.bag.push(nw);
  return {ok:true,msg:'进化成功，获得 '+whName(nw)+'（0 级未激活）', item:nw};
}
// 武魂融合：两个已激活武魂 + 融魂令 → 激活属性重组
function wuhunFuse(uidA, uidB){
  const p=state.player;
  const a=p.bag.find(b=>b.uid===uidA), b2=p.bag.find(b=>b.uid===uidB);
  if(!a||!b2||a===b2) return {ok:false,msg:'需要两个不同的武魂'};
  if(a.type!=='wuhun'||b2.type!=='wuhun') return {ok:false,msg:'只能选择武魂'};
  if(!a.activated||!b2.activated) return {ok:false,msg:'需两个均已激活的武魂'};
  const item='mingqi_'+Math.max(a.star,b2.star);
  if((p.materials[item]||0)<1) return {ok:false,msg:'缺少材料：'+whItemName(item)+' x1'};
  p.materials[item]=(p.materials[item]||0)-1;
  for(const o of [a,b2]){
    const sd=whStarDef(o.whType,o.star), pool=(sd&&sd.attr_pool)||[];
    const name=pool.length?pick(pool):'phys_atk';
    const cat=WUHUN_ATTR_CAT[name]||'atk_flat';
    const rg=((wh().star_rules||{}).attr_value_ranges||{})[cat];
    const r=rg?(rg[''+o.star]||rg['0']):[1,1];
    o.actAttr={name, value: ri(r[0],r[1])};
  }
  return {ok:true,msg:'融合完成，两个武魂的激活属性已重组'};
}
// 武魂湮灭：解除激活状态
function wuhunAnnihilate(o){
  if(!o||o.type!=='wuhun') return {ok:false,msg:'武魂不存在'};
  if(!o.activated) return {ok:false,msg:'该武魂未激活'};
  o.activated=false; o.actAttr=null;
  return {ok:true,msg:'已解除激活状态'};
}
// 武魂回收：按 recycle_price 折算为神秘结晶
function wuhunRecycleValue(o){
  const rp=wh().recycle_price||{base:[5,15,40,100,250,600],activated_bonus:1.5,level_bonus_per:0.1};
  const base=(rp.base||[])[o.star]||5;
  return Math.round(base*(o.activated?(rp.activated_bonus||1.5):1)*(1+o.level*(rp.level_bonus_per||0.1)));
}
function wuhunRecycle(o){
  if(!o||o.type!=='wuhun') return {ok:false,msg:'武魂不存在'};
  const v=wuhunRecycleValue(o);
  state.player.crystal=(state.player.crystal||0)+v;
  state.player.bag=state.player.bag.filter(b=>b.uid!==o.uid);
  return {ok:true,msg:'已回收，获得神秘结晶 +'+v};
}
// 佩戴 / 卸下（双槽）
function equipWuhun(o, slot){
  const p=state.player;
  if(!p.wuhunSlots) p.wuhunSlots=[null,null];
  if(slot==null) slot = p.wuhunSlots[0]? (p.wuhunSlots[1]?0:1) : 0;
  const req=whReqLevel(o.star);
  if(p.level<req) return {ok:false,msg:'佩戴 '+o.star+'★ 武魂需角色 Lv.'+req};
  const old=p.wuhunSlots[slot];
  p.wuhunSlots[slot]=o;
  p.bag=p.bag.filter(b=>b.uid!==o.uid);
  if(old) p.bag.push(old);
  return {ok:true,msg:'已佩戴 '+whName(o)+' 于槽位'+(slot+1)};
}
function unequipWuhun(slot){
  const p=state.player; if(!p.wuhunSlots) return {ok:false,msg:'未佩戴'};
  const o=p.wuhunSlots[slot]; if(!o) return {ok:false,msg:'槽位为空'};
  p.wuhunSlots[slot]=null; p.bag.push(o);
  return {ok:true,msg:'已卸下 '+whName(o)};
}

// ================= 神魔修验（shenmo.json） =================
function sm(){ return DATA.shenmo || {}; }
function smTransform(lv){                       // 按修验等级取当前变身阶位
  const arr=sm().transform_levels||[]; let cur=null;
  for(const t of arr) if(lv>=(t.min_level||1)) cur=t;
  return cur;
}
function smExpNeed(lv){
  const c=(sm().level||{}).exp_curve||[];
  return c[lv]!=null ? c[lv] : Math.ceil(1200*Math.pow(lv,2));
}
function smMaxLevel(){ return (sm().level||{}).max || 100; }
function smTitle(faction, lv){
  const t=smTransform(lv); if(!t) return '';
  const job=(state.player&&state.player.job)||'';
  if(faction==='mo'){
    if(job==='shaman'&&t.title_mo_shaman) return t.title_mo_shaman;
    if(job==='darkwitch'&&t.title_mo_darkwitch) return t.title_mo_darkwitch;
    return t.title_mo||'';
  }
  if(job==='shaman'&&t.title_shen_shaman) return t.title_shen_shaman;
  if(job==='darkwitch'&&t.title_shen_darkwitch) return t.title_shen_darkwitch;
  return t.title_shen||'';
}
function smTier(spent){
  const arr=sm().tiers||[]; let cur=arr[0]||{tier:1,name:'一档',points_per_level:1};
  for(const t of arr) if(spent>=(t.spent_required||0)) cur=t;
  return cur;
}
// 入道（选阵营）
function smJoin(faction){
  const p=state.player;
  const need=(sm().entry||{}).min_char_level||101;
  if(p.level<need) return {ok:false,msg:'入道需角色 Lv.'+need+'（当前 Lv.'+p.level+'）'};
  if(p.shenmo&&p.shenmo.faction) return {ok:false,msg:'已入'+(p.shenmo.faction==='shen'?'神':'魔')+'道'};
  p.shenmo={ faction, level:1, exp:0, spent:0, points:1, nodes:{}, cd:{} };
  return {ok:true,msg:'入道成功：'+((sm().factions||{})[faction]||{}).name};
}
// 修验值增长（挂机获得，按角色经验比例）
function smGain(charExp){
  const s=state.player.shenmo; if(!s||!s.faction) return;
  const maxLv=smMaxLevel();
  if(s.level>=maxLv) return;
  s.exp += charExp*0.25;
  let up=false;
  while(s.level<maxLv && s.exp>=smExpNeed(s.level)){ s.exp-=smExpNeed(s.level); s.level++; up=true; }
  if(up){
    s.points=(s.points||0)+ (smTier(s.spent||0).points_per_level||1);
    eventLog('修验等级提升至 <span class="lv">'+s.level+'</span>，称号：'+smTitle(s.faction,s.level));
  }
}

// ---------- 神魔修验技能树（shenmo_skills.json） ----------
function smNodes(){
  // 各职业技能树分散在 shenmo_skills(_darkwitch|_shaman).json
  const job=(state.player&&state.player.job)||'warrior';
  let file = job==='darkwitch'? DATA.shenmo_skills_darkwitch
           : job==='shaman'?  DATA.shenmo_skills_shaman
           : job==='warrior'? DATA.shenmo_skills : null;
  let fallback=false;
  if(!file || !(file.skills||[]).length){ file=DATA.shenmo_skills; fallback=true; }  // 法师无专属树，沿用战士
  return {list:(file&&file.skills)||[], fallback};
}
function smNodeDef(key){ const n=smNodes().list.find(x=>x.key===key); return n||null; }
// 当前职业的修验节点实际用到了哪些档位（升序）—— 子菜单按它动态生成
function smNodeTiers(){
  const s=state.player&&state.player.shenmo;
  const seen=[];
  for(const d of smNodes().list) if(d.faction===(s&&s.faction) && seen.indexOf(d.tier)<0) seen.push(d.tier);
  return seen.sort((a,b)=>a-b);
}
function smNodeLv(key){ const s=state.player.shenmo; return (s&&s.nodes&&s.nodes[key])||0; }
function smTierDef(tier){ const arr=sm().tiers||[]; return arr.find(t=>t.tier===tier)||{tier:1,name:'一档',spent_required:0,points_per_level:1}; }
function smSpent(){
  const s=state.player.shenmo; if(!s||!s.nodes) return 0;
  let n=0;
  for(const k in s.nodes){ const d=smNodeDef(k); if(!d) continue; n += (s.nodes[k]||0)*(smTierDef(d.tier).points_per_level||1); }
  return n;
}
function smNodeLevelData(d, lv){ const arr=d.levels||[]; if(!arr.length) return {}; return arr[Math.max(0,Math.min((lv||1)-1,arr.length-1))]; }
function smFmt(d, lv){
  let f=d.fmt||d.desc||'';
  const v=smNodeLevelData(d, Math.max(1, lv||1));
  f=f.replace(/\{(\w+)\}/g, (m,k)=> (v[k]!=null? v[k] : (v[k]==null&&d.levels&&d.levels[0]&&d.levels[0][k]!=null? d.levels[0][k] : m)));
  return f;
}
function smEquipOk(d){
  const p=state.player, r=d.require||{};
  if(r.equip_weapon_kind){
    const map={dao:'刀', fu:'斧', qiang:'枪', jian:'剑', gun:'棍', blade:'刀'};
    const kw=map[r.equip_weapon_kind]||r.equip_weapon_kind;
    const w=p.equip.weapon;
    if(!w || (w.name||'').indexOf(kw)<0) return false;
  }
  if(r.equip_shield && !p.equip.shield) return false;
  return true;
}
function smPrereqOk(d){
  for(const pr of ((d.require||{}).prereq||[])) if(smNodeLv(pr.key) < (pr.level||1)) return false;
  return true;
}
function smAddPoint(key){
  const s=state.player.shenmo, d=smNodeDef(key);
  if(!s||!s.faction||!d) return {ok:false, msg:'尚未入道'};
  const lv=smNodeLv(key);
  if(lv>=(d.max_level||1)) return {ok:false, msg:d.name+' 已满级'};
  const td=smTierDef(d.tier);
  if(smSpent() < (td.spent_required||0)) return {ok:false, msg:'需累计投入 '+(td.spent_required||0)+' 点解锁'+(td.name||'')};
  if(!smPrereqOk(d)){
    const pr=((d.require||{}).prereq||[]).find(x=> smNodeLv(x.key)<(x.level||1));
    const pd=smNodeDef(pr.key);
    return {ok:false, msg:'需前置 '+(pd? pd.name : pr.key)+' Lv.'+pr.level};
  }
  const cost=td.points_per_level||1;
  if((s.points||0) < cost) return {ok:false, msg:'修验点不足（需 '+cost+' 点）'};
  s.points-=cost;
  s.nodes[key]=lv+1; s.spent=smSpent();
  refreshStats();
  return {ok:true, msg:d.name+' → Lv.'+(lv+1)+(smEquipOk(d)?'':'（当前装备不满足，暂不生效）')};
}
function smResetPoints(){
  const p=state.player, s=p.shenmo;
  if(!s||!s.faction) return {ok:false, msg:'尚未入道'};
  const R=(sm().reset||{}), lv=s.level||1;
  if(lv<50){
    const cost=lv*((R.below_level_50&&R.below_level_50.formula)? 100 : 100);
    if(p.gold<cost) return {ok:false, msg:'重置需金币 '+fmtNum(cost)};
    p.gold-=cost;
  }else{
    const starBy=(R.above_level_50||{}).star_by_level||{};
    let star=1; for(const k of Object.keys(starBy).map(Number).sort((a,b)=>a-b)) if(lv>=k) star=starBy[''+k];
    if(itemCount('shoushan_shi')<star) return {ok:false, msg:'重置需寿山石 x'+star};
    itemConsume('shoushan_shi', star);
  }
  const back=smSpent();
  s.nodes={}; s.spent=0; s.points=(s.points||0)+back;
  refreshStats();
  return {ok:true, msg:'已重置修验加点，返还 '+back+' 点'};
}
// 汇总已加点节点的效果（战斗与属性共用）
function smAgg(){
  const out={ atk:0, crit:0, critDmg:0, constitutionPct:0, defPct:0, dmgBonus:0, ignoreDef:0,
    append:[], reflect:0, block:0, critGuard:0, silence:null, healReduce:null, cdReduce:{}, skillDmg:{}, actives:[] };
  const s=state.player.shenmo;
  if(!s||!s.faction||!s.nodes) return out;
  for(const key in s.nodes){
    const lv=s.nodes[key]||0; if(lv<=0) continue;
    const d=smNodeDef(key); if(!d) continue;
    if(d.faction!==s.faction) continue;
    if(!smEquipOk(d)) continue;          // 装备要求不满足则不生效
    const v=smNodeLevelData(d, lv);
    const mode=d.mode||'';
    const name=(function(){ const m=/【(.+?)】/.exec(d.fmt||d.desc||''); return m? m[1] : null; })();
    if(d.type==='active'){ out.actives.push({key:d.active_key, node:d, lv}); continue; }
    switch(d.hook){
      case 'stat_buff':
        if(mode==='atk_flat') out.atk += (v.atk||0);
        else if(mode==='constitution_pct') out.constitutionPct += (v.constitution_pct||0);
        else if(mode==='crit_flat') out.crit += (v.crit_pct||0);
        else if(mode==='crit_dmg_pct') out.critDmg += (v.crit_dmg_pct||0);
        break;
      case 'on_hit_append':
        out.append.push({prob: v.prob||0, pct: mode==='append_attack_full'? 100 : (v.bonus_pct||0)});
        break;
      case 'on_damage_taken':
        if(mode==='reflect_pct') out.reflect += (v.reflect_pct||0);
        else if(mode==='block_pct') out.block += (v.block_pct||0);
        else if(mode==='crit_guard_pct') out.critGuard += (v.crit_guard_pct||0);
        break;
      case 'on_hit':
        if(mode==='silence_chance') out.silence={prob:v.prob||0, dur:v.duration||0};
        else if(mode==='apply_debuff') out.healReduce={prob:v.prob||0, pct:v.heal_reduce_pct||0, dur:v.duration||0};
        break;
      case 'reduce_cd':
        if(name) out.cdReduce[name]=Math.max(out.cdReduce[name]||0, v.cd_reduce||0);
        break;
      case 'enhance_skill':
        if(mode==='dmg_bonus'){ if(name) out.skillDmg[name]=(out.skillDmg[name]||0)+(v.dmg_bonus_pct||0); else out.dmgBonus += (v.dmg_bonus_pct||0); }
        else if(mode==='set_field') out.ignoreDef = Math.max(out.ignoreDef, v.ignore_def_pct||0);
        else out.dmgBonus += (v.dmg_bonus_pct||v.scale_pct||v.value_add||v.ignore_def_pct||v.def_down_pct||v.duration_add||v.prob||0)*0.5;
        break;
      case 'unlock_skill':
        if(d.active_key) out.actives.push({key:d.active_key, node:d, lv});
        break;
      default: break;
    }
  }
  return out;
}
function smAggCached(){
  const p=state.player;
  if(!p) return smAggEmpty();
  if(!p._smAgg) p._smAgg = smAgg();
  return p._smAgg;
}
function smAggEmpty(){ return {atk:0,crit:0,critDmg:0,constitutionPct:0,defPct:0,dmgBonus:0,ignoreDef:0,append:[],reflect:0,block:0,critGuard:0,silence:null,healReduce:null,cdReduce:{},skillDmg:{},actives:[]}; }
// 神魔主动技能：取已解锁且冷却就绪的一个
function smActivePick(){
  const s=state.player.shenmo; const ag=smAggCached();
  if(!s||!s.faction||!ag.actives.length) return null;
  s.cd=s.cd||{};
  const ready=ag.actives.filter(a=>{
    const d=SM_ACTIVE[a.key]; if(!d) return false;
    return !(s.cd[a.key]>0);
  });
  if(!ready.length) return null;
  const pickOne=ready[Math.floor(Math.random()*ready.length)];
  const d=SM_ACTIVE[pickOne.key];
  const L=(d.levels||[])[Math.max(0,Math.min(pickOne.lv-1,(d.levels||[]).length-1))]||{};
  return {def:d, lvdata:L, node:pickOne};
}
function smActiveCast(m){
  const s=state.player.shenmo; const a=smActivePick(); if(!a) return null;
  const p=state.player;
  const cd=(a.lvdata.cd||a.def.cd||4);
  s.cd[a.def.key]=cd;
  const mp=a.lvdata.mp||0;
  if(mp>0){ if((p.mp||0)<mp) return null; p.mp-=mp; }
  const dmg=a.lvdata.damage||0;
  if(dmg>0 && m){
    const atk=p._s.main;
    const base=atk*(dmg/100) + dmg*0.5;
    const def=monsterDef(m, p._s.defType);
    const val=Math.max(1, Math.round(base*base/def));
    m.curHp-=val;
    return {name:a.def.name, dmg:val, kind:'attack'};
  }
  if((a.def.skill_type==='defense'||a.def.skill_type==='buff') && state.buff){
    state.buff.phys_def=(state.buff.phys_def||0)+Math.round((a.lvdata.damage||10)*2);
    return {name:a.def.name, dmg:0, kind:'defense'};
  }
  return {name:a.def.name, dmg:0, kind:'other'};
}

function computeStats(p){
  const job = DATA.jobs.jobs.find(j=>j.key===p.job);
  // 基础属性
  const attr = {};
  for(const k in job.base_stats) attr[k]=0;
  for(const k in job.base_stats){
    attr[k] = job.base_stats[k] + job.growth[k]*(p.level-1) + job.per_level_points*(p.level-1);
  }
  // 神魔技能树：体质百分比（需在属性→战斗属性转换前生效）
  const _smAg = (p.shenmo && p.shenmo.faction) ? smAggCached() : null;
  if(_smAg && _smAg.constitutionPct) attr.constitution = Math.round(attr.constitution*(1+_smAg.constitutionPct/100));
  // 装备 + 词条 + 宝石 + 精炼 加成
  const bonus = {}; // stat -> val
  const addStat = (s,v)=> bonus[s]=(bonus[s]||0)+v;
  for(const slot in p.equip){
    const it = p.equip[slot];
    if(!it) continue;
    for(const s in (it.stats||{})) addStat(s, it.stats[s]);
    for(const pk of (it.perks||[])){
      if(ATTR_EFFECT_KEY[pk.name]) addStat(ATTR_EFFECT_KEY[pk.name], pk.value);
      else if(PERK_STAT_MAP[pk.name]) addStat(PERK_STAT_MAP[pk.name], pk.value);
    }
    for(const g of (it.gems||[])) if(g) addStat(g.stat, g.value);
  }
  // 被动技能加成
  const pb = passiveBonus(p);
  for(const k in pb) addStat(k, pb[k]);
  // 武魂（双槽）：基础属性 + 激活属性
  for(const o of (p.wuhunSlots||[])){
    if(!o) continue;
    const ws = wuhunStats(o);
    for(const s in ws) addStat(s, ws[s]);
    if(o.activated && o.actAttr) addStat(o.actAttr.name, o.actAttr.value);
  }
  // 神魔变身：按修验等级给攻/防/血/减伤
  if(p.shenmo && p.shenmo.faction){
    const tl = smTransform(p.shenmo.level||1);
    if(tl){
      addStat('phys_atk', tl.atk||0); addStat('magic_atk', tl.atk||0);
      addStat('phys_def', tl.def||0); addStat('magic_def', tl.def||0);
      addStat('max_hp', tl.hp||0);
      if(tl.dmg_reduce) addStat('dmg_reduce_pct', tl.dmg_reduce);
    }
    // 修验技能树被动
    const ag = smAggCached();
    if(ag.atk){ addStat('phys_atk', ag.atk); addStat('magic_atk', ag.atk); }
    if(ag.crit){ addStat('phys_crit', ag.crit); addStat('magic_crit', ag.crit); }
    if(ag.critDmg) addStat('crit_dmg_pct', ag.critDmg);
    if(ag.block) addStat('dmg_reduce_pct', ag.block);
  }
  // 属性 → 战斗属性
  const combat = {};
  const eff = job.attribute_effects;
  for(const a in attr){
    const amt = attr[a] + (bonus[a]||0);
    const map = eff[a] || {};
    for(const s in map) combat[s] = (combat[s]||0) + amt*map[s];
  }
  for(const s in bonus){
    if(['strength','agility','constitution','intelligence','spirit'].includes(s)) continue;
    combat[s] = (combat[s]||0) + bonus[s];
  }
  // ⚠️ 这里原本还有一行 `combat.phys_crit += attr.agility*0.142857;`，是【重复计算】已删除：
  //    敏捷 → 暴击 已经由上面的 job.attribute_effects 循环统一累加
  //    （战士/法师/暗巫/幻师的表里都有 agility → phys_crit: 0.142857），
  //    再加一次会让敏捷贡献翻倍（Lv120 战士实测 239.71，只计一次应为 128.07）。
  // 闪避 / 速度（原版战斗模型，按 agility 派生）
  //  dodge = min(10, trunc(10*agi/(agi+100)))：命中则完全闪避（0 伤害）
  //  speed = 4 + min(12, trunc(12*agi/(agi+60)))：速度条每 tick 累加，跑满 100 出手（上限 16）
  const _agi = (attr.agility||0) + (bonus.agility||0);
  combat.agility = _agi;
  combat.dodge = Math.min(10, Math.trunc(10*_agi/(_agi+100)));
  combat.speed = 4 + Math.min(12, Math.trunc(12*_agi/(_agi+60)));
  // 主攻击
  const main = job.main_damage==='magic' ? (combat.magic_atk||0) : (combat.phys_atk||0);
  const defType = job.main_damage==='magic' ? 'magic_def' : 'phys_def';
  return {
    attr, combat, main, defType,
    max_hp: Math.round((combat.max_hp||100) + 100),
    max_mp: Math.round((combat.max_mp||50) + 50),
  };
}
function refreshStats(){
  const p = state.player;
  p._smAgg = null;                 // 神魔技能树加成缓存失效
  const s = computeStats(p);
  p._s = s;
  if(p.hp > s.max_hp) p.hp = s.max_hp;
  if(p.mp > s.max_mp) p.mp = s.max_mp;
}

// ---------- 装备生成 ----------
function tierFromLevel(lv){
  return clamp(1 + Math.floor((lv-5)/15), 1, 7);
}
function qualityFromPerks(n){
  const t = DATA.quality.quality_thresholds;
  for(const th of t) if(n >= th.min_perks) return th.quality;
  return 'white';
}
const QNAME = {white:'白板',green:'绿色',blue:'蓝色',purple:'紫色',gold:'橙色',red:'红色'};

// 词条数量上限：放宽到可出紫/橙（原 tier_perk_max 恒为 3，最高仅蓝）。
// 高档装备天花板更高，且分层掷骰保证低品质仍占多数（稀有度高）。
const PERK_CAP = {1:6, 2:7, 3:8, 4:9, 5:9, 6:9, 7:9};
function rollPerkCount(tier){
  const cap = PERK_CAP[tier] || 4;
  const r = Math.random();
  let lo=0, hi=3;
  if(r<0.60)      { lo=0; hi=3; }                         // 多数 0~3（白/绿/蓝）
  else if(r<0.85) { lo=4; hi=Math.min(5,cap); }           // 4~5（蓝/紫）
  else if(r<0.97) { lo=6; hi=Math.min(7,cap); }           // 6~7（紫/金）
  else            { lo=Math.min(8,cap); hi=cap; }         // 8~cap（金/红）
  if(lo>hi) hi=lo;
  return ri(lo, hi);
}
function rollPerks(tier, job, mode){
  const pool = DATA.perk_pool[job+'_general_pool'] || DATA.perk_pool['warrior_general_pool'];
  if(!pool) return [];
  // 生成模式（modes.json）：限定词条类别与数量
  const cats = ((DATA.modes||{}).mode_categories||{})[mode||''] || null;
  let groups = ['stat_fixed','stat_percent','atk_fixed','atk_percent','elemental'];
  if(cats) groups = (cats.length? cats : []);
  if(mode==='whiteboard') return [];
  let all = [];
  for(const g of groups) all = all.concat(pool[g]||[]);
  if(!all.length) all = (pool.stat_fixed||[]).concat(pool.stat_percent||[], pool.atk_fixed||[]);
  if(!all.length) return [];
  let n;
  if(mode==='full_perk') n = PERK_CAP[tier] || 4;             // 满词条
  else n = rollPerkCount(tier);
  const perks = [];
  for(let i=0;i<n;i++){
    const sf = pick(all);
    const vals = sf.values[''+tier] || sf.values['1'] || [1,1];
    perks.push({name:sf.name, suffix:sf.suffix||'', value: ri(vals[0], vals[1])});
  }
  return perks;
}
// 从具体 base 对象构建一件装备（商店/兑换/掉落共用）
function buildEquip(base, job, tier, slot, mode){
  tier = clamp(tier,1,7);
  const stats = {};
  for(const f in (base.stats||{})){
    const rg = base.stats[f];
    stats[f] = ri(rg[0], rg[1]);
  }
  const perks = rollPerks(tier, job, mode);
  const quality = qualityFromPerks(perks.length);
  return {
    type:'equip', uid: uid(), slot, job, tier, name: base.name, reqLevel: base.req_level||1,
    stats, perks, quality, refine:0, sockets: base.sockets||0, bailian:0,
    gems: new Array(base.sockets||0).fill(null), baseKey: base.key
  };
}
// 按「需求等级最接近参考等级」挑基底；部位无基底时回退到该职业能生成的部位，保证一定出货
function pickBase(slot, job, refLevel, maxReq){
  refLevel = refLevel||1;
  const src = JOB_BASES[job] || DATA.bases_warrior;
  const tryCat = (cat, limit)=>{
    let list = src[cat];
    if((!list || !list.length) && (cat==='rings'||cat==='necklaces')) list = DATA.bases_accessory[cat];
    if(!list || !list.length) return null;
    let cand = list;
    if(limit!=null){
      cand = list.filter(b=>(b.req_level||0)<=limit);
      if(!cand.length) return null;
    }
    // req_level 最接近参考等级；并列时取需求更低的（保证穿得上）
    return cand.slice().sort((a,b)=>{
      const da=Math.abs((a.req_level||0)-refLevel), db=Math.abs((b.req_level||0)-refLevel);
      return da-db || (a.req_level||0)-(b.req_level||0);
    })[0];
  };
  const cat = SLOT_CAT[slot] || 'armors';
  const order=['armors','weapons','helmets','pants','shoes','gloves','belts','cloaks','shoulders','shields','necklaces','rings'];
  let base = tryCat(cat, maxReq);                 // ①同部位且满足需求上限
  if(base) return {base, slot};
  if(maxReq!=null){                                // ②其他部位找满足上限的（法师无低级护肩→改掉别的能穿的部位）
    const cands=[];
    for(const c of order){ const b=tryCat(c, maxReq); if(b) cands.push({b, c}); }
    if(cands.length){
      cands.sort((x,y)=>Math.abs((x.b.req_level||0)-refLevel)-Math.abs((y.b.req_level||0)-refLevel));
      const win = cands[Math.floor(Math.random()*Math.min(3, cands.length))];
      return {base:win.b, slot: CAT_SLOT[win.c] || 'armor'};
    }
  }
  base = tryCat(cat, null);                        // ③同部位不设限
  if(base) return {base, slot};
  for(const c of order){                           // ④兜底：任意有基底的部位
    const b = tryCat(c, null);
    if(b) return {base:b, slot: CAT_SLOT[c] || 'armor'};
  }
  return null;
}
function genEquip(slot, job, tier, refLevel, maxReq){
  const r = pickBase(slot, job, refLevel, maxReq);
  if(!r) return null;
  return buildEquip(r.base, job, r.base.tier || tier || 1, r.slot);
}
// 掉落装备：优先按怪物等级取；若需求等级远超玩家（如法师无低级护肩/项链），
// 退而按玩家等级取一件当前穿得上的（必要时回退到有基底的部位），避免掉落一堆废装
function genEquipWithFallback(slot, job, m, p){
  const refLevel = Math.max(m.level, (p.level||1) - 5);
  let it = genEquip(slot, job, tierFromLevel(m.level), refLevel);
  if(it && it.reqLevel > p.level + 8){
    const it2 = genEquip(slot, job, tierFromLevel(p.level), p.level, p.level + 8);
    if(it2) it = it2;   // 同部位无低级基底时，pickBase 会回退到玩家能穿的其他部位
  }
  return it;
}
// 商店神秘商人：按部位+职业取对应基底
function genEquipBaseForSlot(slot, job, tier){
  let src = JOB_BASES[job] || DATA.bases_warrior;
  let cat = SLOT_CAT[slot] || 'armors';
  let list = src[cat];
  if((!list || !list.length) && (cat==='rings'||cat==='necklaces')) list = DATA.bases_accessory[cat];
  if(!list || !list.length) return null;
  return list.filter(b=>b.tier===tier).sort((a,b)=>a.req_level-b.req_level)[0]
      || list.slice().sort((a,b)=>Math.abs(a.tier-tier)-Math.abs(b.tier-tier))[0];
}
function jobFromBaseKey(k){
  if(k.startsWith('base_warrior')) return 'warrior';
  if(k.startsWith('base_mage')) return 'mage';
  if(k.startsWith('base_shaman')) return 'shaman';
  if(k.startsWith('base_darkwitch')) return 'darkwitch';
  if(k.startsWith('base_accessory')) return 'accessory';
  return null;
}

// ---------- 掉落 ----------
function rollLoot(m, p){
  const drops = [];
  // 金币（怪物固定区间，gold 类型的掉落表项跳过以避免重复）
  const gold = ri(m.gold_min||0, m.gold_max||0);
  if(gold>0) drops.push({type:'gold', value:gold});
  // 装备：按怪物类型多次掷骰（loot_probs）
  const lp = DATA.loot_probs[m.type] || DATA.loot_probs.normal;
  const equipTables = [];
  for(const key of (m.loot_table||[])){
    const t = LOOT[key];
    if(!t) continue;
    for(const d of (t.drops||[])) if(d.item==='equip') equipTables.push(d);
  }
  for(let i=0;i<(lp.rolls||1);i++){
    const prob = (lp.probs&&lp.probs[i]!=null)?lp.probs[i]:0.01;
    if(Math.random()<prob && equipTables.length){
      const e = pick(equipTables);
      const job = e.job && JOB_BASES[e.job] ? e.job : p.job;
      const it = genEquipWithFallback(e.slot, job, m, p);
      if(it) drops.push({type:'equip', item:it});
    }
  }
  // 其余掉落（宝石 / 药水 / 道具 / 武魂 / 宝匣）
  for(const key of (m.loot_table||[])){
    const t = LOOT[key];
    if(!t) continue;
    for(const d of (t.drops||[])){
      if(d.item==='equip'||d.item==='gold') continue;
      if(Math.random()<(d.prob||0)){
        if(d.item==='consumable') drops.push({type:'consumable', key:d.key, count:d.count||1});
        else if(d.item==='gem'){
          const parts=(d.key||'').split('_'); const grade=parts.pop(); const series=parts.join('_');
          drops.push({type:'gem', series, grade, count:d.count||1});
        }
        else if(d.item==='wuhun') drops.push({type:'wuhun', stars: ri(d.star_min||0, d.star_max||0), count:d.count||1});
      }
    }
  }
  // 矿石掉落（生活技能材料来源）：按权重随机一种，数量随怪物等级提升
  const ow = DATA.ores && DATA.ores.ore_gen_weights;
  if(ow && Math.random()<0.6){
    const rk = weightedPick(Object.keys(ow), ow);
    const amt = ri(1, 2+Math.floor(m.level/8));
    p.ores[rk]=(p.ores[rk]||0)+amt;
    drops.push({type:'ore', key:rk, count:amt});
  }
  return drops;
}

// ---------- 战斗 ----------
// 首领威胁加成：让刚解锁的首领有真实压力（普通/精英区不受影响），配合死亡惩罚形成「挑战」感
const BOSS_HP_MULT = 1.3, BOSS_ATK_MULT = 1.5;
function spawnMonster(){
  const z = state.zone;
  let key, isBoss=false, isElite=false;
  if(z.isBoss){
    const _bm=DATA.maps.maps.find(m=>m.key===z.mapKey);
    if(_bm.boss_zone){
      // 首领区：未清剿完 minion_target 前只刷小怪，首领不现身
      if(!bossZoneCleared(_bm)){
        const _t=bossMinionTarget(_bm)||{normal:0, elite:0};
        const _pool=(_bm.boss_zone.monsters||[]).slice();
        const _el=(_bm.boss_zone.elite_monsters||[]).slice();
        const _needElite=minionKillCount(_bm.key,'elite')<_t.elite;
        if(_needElite && _el.length && Math.random()<0.25){ key=pick(_el); isElite=true; }
        else if(_pool.length){ key=pick(_pool); }
        else if(_el.length){ key=pick(_el); isElite=true; }
        else return null;
      }else{
        key=pick(_bm.boss_zone.boss); isBoss=true;
      }
    } else { const _db=(_bm.dungeon_bosses||[]).find(x=>x.key===z.bossKey); if(!_db) return null; key=_db.monster; isBoss=true; }
  }else{
    const map = DATA.maps.maps.find(m=>m.key===z.mapKey);
    const zone = map.zones.find(zz=>zz.key===z.zoneKey);
    const pool = (zone.monsters||[]).slice();
    if(zone.elite_monsters && zone.elite_monsters.length && Math.random()<0.08){
      key = pick(zone.elite_monsters); isElite=true;
    }else if(pool.length){
      key = pick(pool);
    }else if(zone.elite_monsters && zone.elite_monsters.length){
      key = pick(zone.elite_monsters); isElite=true;
    }
  }
  const base = getMonster(key);
  if(!base){ return null; }
  const m = Object.assign({}, base);
  m.isBoss=isBoss; m.isElite=isElite;
  if(isBoss){
    m.hp = Math.round((m.hp||0)*BOSS_HP_MULT);
    m.min_phys_atk  = Math.round((m.min_phys_atk||0)*BOSS_ATK_MULT);
    m.max_phys_atk  = Math.round((m.max_phys_atk||0)*BOSS_ATK_MULT);
    m.min_magic_atk = Math.round((m.min_magic_atk||0)*BOSS_ATK_MULT);
    m.max_magic_atk = Math.round((m.max_magic_atk||0)*BOSS_ATK_MULT);
  }
  m.curHp = m.hp;
  m.skills = MON_SKILLS[key] || [];
  m.skillCd = {};
  return m;
}

// ---------- 召唤兽 ----------
function summonDef(key){ return (DATA.summons||{})[key] || null; }
function summonAvailable(){
  if(!DATA.summons) return [];
  return Object.keys(DATA.summons).filter(k=>{
    const d=DATA.summons[k]; const lvs=Object.keys(d.levels||{}).map(Number);
    return lvs.length && state.player.level >= Math.min.apply(null, lvs);
  });
}
function summonTier(key, playerLevel){
  const d=summonDef(key); if(!d) return null;
  const lvs=Object.keys(d.levels||{}).map(Number).sort((a,b)=>a-b);
  let t=lvs[0]; for(const l of lvs) if(l<=playerLevel) t=l;
  return {lv:t, data:d.levels[''+t]};
}
function summonAttack(m){
  const p=state.player;
  const key=p.summon; const d=summonDef(key); if(!d) return null;
  const t=summonTier(key, p.level); if(!t) return null;
  const st=t.data;
  const sk = SUMMON_SKILLS[pick(d.skills||[])] || null;
  const pct = sk && sk.levels && sk.levels[0] ? (sk.levels[0].damage||60) : 60;
  const isMagic = d.type==='magic';
  const lo = isMagic? (st.min_magic||st.min_phys||1) : (st.min_phys||1);
  const hi = isMagic? (st.max_magic||st.max_phys||1) : (st.max_phys||1);
  const base = (lo+hi)/2 * (pct/100);
  const def = monsterDef(m, isMagic?'magic_def':'phys_def');
  const dodged = Math.random()*100 < (m.dodge||0);
  const dmg = dodged ? 0 : Math.max(1, Math.round(base*base/def));
  if(!dodged) m.curHp -= dmg;
  return {dmg, name: sk? sk.name : '扑击', dodged};
}

function playerHit(m){
  const p = state.player, s = p._s;
  const ag = smAggCached();
  const atk = s.main + ((state.buff&&state.buff.atk)||0);
  const raw = atk * rnd(0.85,1.15);
  let def = monsterDef(m, s.defType);
  if(ag.ignoreDef) def = Math.round(def*(1-ag.ignoreDef/100));
  const dodged = Math.random()*100 < (m.dodge||0);
  let dmg = dodged ? 0 : Math.max(1, Math.round((raw*raw/def)*titleDmgMult(m)));
  let crit = !dodged && Math.random() < (s.combat.phys_crit||0)/100;
  const critMult = 1.8 + (ag.critDmg||0)/100;
  if(crit) dmg = Math.round(dmg*critMult);
  if(!dodged) m.curHp -= dmg;
  state.pendingAppend = (state.pendingAppend||0) + (dodged?0:smAppendHit(m, def));
  return {dmg, crit, dodged};
}
function monsterHit(m){
  const p = state.player, s = p._s;
  // 怪物技能：按 weight 抽取已就绪技能，元素决定攻防类型
  let sk=null;
  const list = m.skills || [];
  if(list.length){
    for(const k in (m.skillCd||{})) if(m.skillCd[k]>0) m.skillCd[k]--;
    const ready = list.filter(x=> !(m.skillCd[x.key]>0));
    if(ready.length && Math.random()<0.35 && !(m.silence>0)){
      const wmap={}; ready.forEach(x=> wmap[x.key]=(x.weight||1));
      const kk = weightedPick(ready.map(x=>x.key), wmap);
      sk = ready.find(x=>x.key===kk) || null;
    }
  }
  const magic = sk && (sk.element==='magic' || sk.element==='dark' || sk.element==='fire' || sk.element==='elec');
  const mult = sk? (sk.mult||1) : 1;
  const lo = magic? (m.min_magic_atk||m.min_phys_atk||1) : (m.min_phys_atk||1);
  const hi = magic? (m.max_magic_atk||m.max_phys_atk||1) : (m.max_phys_atk||1);
  const raw = ((lo+hi)/2) * mult;
  const def = (magic? (s.combat.magic_def||0) : (s.combat.phys_def||0)) + ((state.buff&&state.buff.phys_def)||0);
  // 原版伤害公式：max(1, round(atk²/def))；玩家完全闪避则 0 伤害（不触发分担/减伤/反弹）
  const dodged = Math.random()*100 < (s.combat.dodge||0);
  let dmg = dodged ? 0 : Math.max(1, Math.round(raw*raw/def));
  if(!dodged){
    // 出战召唤兽承担 30% 伤害
    if(p.summon && state.summonHp>0){
      const share = Math.round(dmg*0.3);
      state.summonHp -= share; dmg -= share;
      if(state.summonHp<=0){ state.summonHp=0; log('<span class="dmg">召唤兽 '+summonDef(p.summon).name+' 被击退！</span>'); }
    }
    // 神魔：减伤（变身 dmg_reduce / 格挡）
    const ag0 = smAggCached();
    const reduce = ((s.combat.dmg_reduce_pct||0) + (ag0.block||0));
    if(reduce) dmg = Math.max(1, Math.round(dmg*(1 - clamp(reduce,0,80)/100)));
    // 神魔：反弹（on_damage_taken reflect_pct）
    if(ag0.reflect>0 && m){ const rf=Math.max(1, Math.round(dmg*ag0.reflect/100)); m.curHp-=rf; state.pendingReflect=(state.pendingReflect||0)+rf; }
  }
  p.hp -= dmg;
  if(sk) m.skillCd[sk.key] = sk.cd||2;
  if(m.silence>0) m.silence--;
  return {dmg, skill:sk, dodged};
}

function tick(){
  if(!state.idle || !state.player) return;
  state.ticks++;
  const p = state.player;
  tickSkillCd();
  autoPotion();                      // P0：低血/低蓝自动喝药（不足自动补给）
  // 法力自然回复（每回合 3% 上限），保证技能可持续循环
  if(p._s) p.mp = Math.min(p._s.max_mp, (p.mp||0) + Math.max(2, Math.round(p._s.max_mp*0.03)));
  // 称号地图 Buff：每 tick 按百分比回血/回蓝
  if(p._s && p.hp>0){
    const th=titleHeal();
    if(th.hp>0){ p.hp=Math.min(p._s.max_hp, p.hp+th.hp); }
    if(th.mp>0){ p.mp=Math.min(p._s.max_mp, p.mp+th.mp); }
  }
  if(!state.combat){
    const m = spawnMonster();
    if(!m){ return; }
    state.combat = m;
    state.atbP = 0; state.atbM = 0;   // 速度条（ATB）累加器
    // 召唤兽出场：按角色等级取阶段属性
    if(p.summon){ const t=summonTier(p.summon, p.level); state.summonHp = t? (t.data.hp||0) : 0; }
    castBattleStartBuffs();   // 战斗开始先放增益/防御技能
    log((m.isBoss?'<span class="boss">【首领】':'<span class="sys">') + (m.isElite?'【精英】':'') + m.name + ' (Lv.'+m.level+') 出现了'+(m.isBoss?'</span>':'</span>'), m.isBoss?'boss':'sys');
  }
  const m = state.combat;
  // 速度条累加器（外部直接构造战斗时可能没有，兜底为 0）
  if(state.atbP==null) state.atbP=0;
  if(state.atbM==null) state.atbM=0;
  // 生命偏低时优先治疗（每 tick 一次，不占出手）
  if(p.hp < p._s.max_hp*0.6){
    const hs = pickHealSkill();
    if(hs){
      const r = castHeal(hs);
      log('施放 <span class="skill">'+hs.name+'</span>，回复 <span class="loot">'+fmtNum(r.heal)+'</span> 生命（HP '+fmtNum(Math.round(p.hp))+'/'+fmtNum(p._s.max_hp)+'）');
    }
  }
  // 速度条推进：双方按敏捷派生速度累加，跑满 100 各出手一次（原版战斗模型）
  state.atbP += p._s.combat.speed;
  state.atbM += (m.speed||4);
  let guard = 0;
  while((state.atbP>=100 || state.atbM>=100) && guard++<30){
    if(state.atbP>=100){ state.atbP-=100; playerTurn(m); if(m.curHp<=0){ onMonsterDead(m); return; } }
    if(state.atbM>=100){ state.atbM-=100; monsterTurn(m); if(p.hp<=0){ onPlayerDead(); return; } }
  }
  renderBattle();
}

// 玩家一次出手（技能/普攻 → 神魔追击 → 神魔主动 → 召唤兽）
function playerTurn(m){
  const p = state.player;
  state.pendingAppend = 0;
  const sk = pickAttackSkill();
  if(sk){
    const lv = p.skills[sk.key]||1;
    paySkill(sk);
    const h = damageMonster(m, skillDamage(sk, lv));
    if(h.dodged) log(m.name+' 闪避了你的 <span class="skill">'+sk.name+'</span>');
    else log('施放 <span class="skill">'+sk.name+'</span>，对 '+m.name+' 造成 <span class="dmg">'+fmtNum(h.dmg)+'</span>'+(h.crit?' 暴击!':'')+' 伤害（剩余'+fmtNum(Math.max(0,m.curHp))+'/'+fmtNum(m.hp)+'）');
    if(m.curHp<=0) return;
  }else{
    const h = playerHit(m);
    if(h.dodged) log(m.name+' 闪避了你的攻击');
    else log('你对 '+m.name+' 造成 <span class="dmg">'+fmtNum(h.dmg)+'</span>'+(h.crit?' 暴击!':'')+' 伤害（剩余'+fmtNum(Math.max(0,m.curHp))+'/'+fmtNum(m.hp)+'）');
    if(m.curHp<=0) return;
  }
  if(state.pendingAppend>0){ log('<span class="skill">神魔追击</span> 追加 <span class="dmg">'+state.pendingAppend+'</span> 伤害'); state.pendingAppend=0; }
  // 神魔主动技能（变身/修验解锁后自动施放）
  if(p.shenmo && p.shenmo.faction){
    const sc = smActiveCast(m);
    if(sc){
      if(sc.kind==='attack') log('神魔技 <span class="skill">'+sc.name+'</span> 造成 <span class="dmg">'+fmtNum(sc.dmg)+'</span> 伤害（剩余'+fmtNum(Math.max(0,m.curHp))+'/'+fmtNum(m.hp)+'）');
      else log('神魔技 <span class="skill">'+sc.name+'</span> 发动');
      if(m.curHp<=0) return;
    }
  }
  // 召唤兽出手（出战且存活）
  if(p.summon && state.summonHp>0){
    const sh = summonAttack(m);
    if(sh){
      if(sh.dodged) log('<span class="skill">'+summonDef(p.summon).name+'</span> 的 '+sh.name+' 被 '+m.name+' 闪避');
      else log('<span class="skill">'+summonDef(p.summon).name+'</span> 施放 '+sh.name+'，造成 <span class="dmg">'+fmtNum(sh.dmg)+'</span> 伤害（剩余'+fmtNum(Math.max(0,m.curHp))+'/'+fmtNum(m.hp)+'）');
      if(m.curHp<=0) return;
    }
  }
}

// 怪物一次出手（含技能/普攻，玩家可完全闪避）
function monsterTurn(m){
  const p = state.player;
  state.pendingReflect = 0;
  const mh = monsterHit(m);
  if(mh.dodged) log('你闪避了 '+m.name+(mh.skill? ' 的 <span class="skill">'+mh.skill.name+'</span>':' 的反击')+'！');
  else log(m.name+(mh.skill? ' 施放 <span class="skill">'+mh.skill.name+'</span>':' 反击')+'，你受到 <span class="dmg">'+fmtNum(mh.dmg)+'</span> 伤害（HP '+fmtNum(Math.max(0,Math.round(p.hp)))+'/'+fmtNum(p._s.max_hp)+'）');
  if(state.pendingReflect>0){ log('<span class="skill">伤害反弹</span> 反弹 <span class="dmg">'+state.pendingReflect+'</span> 给 '+m.name); state.pendingReflect=0; }
}

function onMonsterDead(m){
  const p = state.player;
  state.kills++;
  sessBump('kills', 1);
  const exp = monsterExp(m, p.level);
  sessBump('exp', exp);
  log('<span class="lv">击败 '+m.name+'，获得经验 '+fmtNum(exp)+'</span>');
  gainExp(exp);
  // 佩戴中的武魂吸经验（双槽各 50%）+ 神魔修验值
  wuhunAbsorb(exp);
  smGain(exp);
  const gold = ri(m.gold_min||0, m.gold_max||0);
  if(gold>0){ p.gold += gold; sessBump('gold', gold); log('获得金币 <span class="loot">'+fmtNum(gold)+'</span>'); }
  // 神秘结晶（商店兑换高阶装备用）：精英/首领掉落
  if(m.isElite){ p.crystal += 1; p.stats.crystalTotal=(p.stats.crystalTotal||0)+1; log('获得神秘结晶 <span class="loot">+1</span>'); }
  if(m.isBoss){ p.crystal += 5; p.stats.crystalTotal=(p.stats.crystalTotal||0)+5; log('获得神秘结晶 <span class="loot">+5</span>'); }
  // 副本护符：首领掉落本地图 NPC 兑换所需护符（1~2 个）
  if(m.isBoss){
    const grp = instGroup(state.zone? state.zone.mapKey : p.map);
    if(grp.length){
      const f = grp[0];
      if(Math.random()<0.4){        // 首领 40% 概率掉落副本护符
        const n = ri(1,2);
        addToBag({type:'consumable', key:f.cost_key, count:n});
        log('首领掉落 <span class="loot">'+itemName(f.cost_key)+' x'+fmtNum(n)+'</span>（'+instName(f.instance)+'兑换用）');
        eventLog('获得 <span class="loot">'+itemName(f.cost_key)+' x'+fmtNum(n)+'</span>');
      }
    }
    // 地图通关记录（成就·地图通关）
    // 野外图：击杀该图首领即通关；副本：需击杀全部 dungeon_bosses
    const mk = state.zone? state.zone.mapKey : p.map;
    const _zmap = mapByKey(mk);
    if(_zmap && dungeonBosses(_zmap).length){
      if(state.zone && state.zone.bossKey) noteDungeonBossKilled(_zmap, state.zone.bossKey, m.name);
    }else if(mk && (p.stats.mapClear||[]).indexOf(mk)<0){
      p.stats.mapClear.push(mk);
      const _rmap=mapByKey(mk);
      if(_rmap){ log('<span class="lv">★ 首次通关 '+_rmap.name+'！</span>首领已被击败，继续探索其他区域吧'); eventLog('<span class="lv">★ 通关 '+_rmap.name+'</span>'); }
    }
    // 首领掉落晶石（按角色等级档位）
    if(Math.random()<0.5){
      const ck = crystalForTier(Math.max(1, Math.ceil(p.level/20)));
      addCrystalStone(ck, 1);
      log('首领掉落 <span class="loot">'+crystalName(ck)+' x1</span>（精炼 +5 起消耗）');
    }
  }
  // 成就统计：总击杀 / 同类型猎杀 / 单图击杀
  p.stats.kills=(p.stats.kills||0)+1;
  {
    for(const a of achList()){
      if(a.metric==='kill_type' && a.kill_keyword && (m.name||'').indexOf(a.kill_keyword)>=0){
        p.stats.killType[a.kill_keyword]=(p.stats.killType[a.kill_keyword]||0)+1;
      }
    }
    const mk2 = state.zone? state.zone.mapKey : p.map;
    if(mk2) p.stats.mapKills[mk2]=(p.stats.mapKills[mk2]||0)+1;
  }
  // 称号/成就解锁检查（击杀类型计数已更新）
  checkTitles(); checkAchievements();
  // 区域探索进度（explore_target）/ 首领区清剿进度（minion_target）
  {
    const _emk = state.zone? state.zone.mapKey : p.map;
    if(state.zone && state.zone.isBoss){ if(!m.isBoss) noteMinionKill(_emk, m.isElite); }
    else if(state.zone && state.zone.zoneKey) noteZoneKill(_emk, state.zone.zoneKey);
  }
  if(m.isBoss) eventLog('<span class="boss">击败首领 '+m.name+'</span>，获得神秘结晶 +5');
  else if(m.isElite) eventLog('<span class="ev-elite">击败精英 '+m.name+'</span>，获得神秘结晶 +1');
  // 掉落
  const drops = rollLoot(m, p);
  let dropN=0;
  for(const d of drops){
    if(d.type!=='gold') dropN++;   // 只统计实物掉落（品质分布另计，见下）
    if(d.type==='equip'){
      addToBag(d.item);
      log('掉落装备 <span class="loot">['+QNAME[d.item.quality]+']'+d.item.name+'</span>');
      sessBump('drop', 1, d.item.quality);   // 品质分布只统计装备（消耗品/矿石/宝石无“品质”概念）
      // 蓝装以上才进本命日志
      if(['blue','purple','gold','red'].indexOf(d.item.quality)>=0)
        eventLog('获得 <span class="q-'+d.item.quality+'">['+QNAME[d.item.quality]+']'+d.item.name+'</span>');
      tryAutoEquip(d.item);
    }
    else if(d.type==='gold'){ /* 已加 */ }
    else if(d.type==='consumable'){ addToBag({uid:uid(),type:'consumable',key:d.key,count:d.count}); log('掉落道具 <span class="loot">'+itemName(d.key)+' x'+d.count+'</span>'); }
    else if(d.type==='gem'){ addToBag({type:'gem',series:d.series,grade:d.grade,count:d.count||1}); log('掉落宝石 <span class="loot">'+gemSeriesName(d.series)+'·'+d.grade+(d.count>1?' x'+d.count:'')+'</span>'); }
    else if(d.type==='wuhun'){
      const n = d.count||1;
      for(let i=0;i<n;i++){
        const o = genWuhun(d.stars||0);
        addToBag(o);
        log('掉落武魂 <span class="loot">'+whName(o)+'</span>');
        eventLog('获得武魂 <span class="loot">'+whName(o)+'</span>（佩戴需 Lv.'+whReqLevel(o.star)+'）');
      }
    }
  }
  if(dropN) sessBump('dropCount', dropN);
  // 任务进度
  questProgress(m);
  checkAchievements();
  state.combat = null;
  renderBattle();
  renderHeader(); renderTab();
}
// 死亡惩罚（轻罚）：损失「当前等级已积累经验」的 5%，不掉金币、无虚弱，避免挫败挂机节奏
const DEATH_EXP_PENALTY = 0.05;
function onPlayerDead(){
  const p = state.player;
  sessBump('deaths', 1);
  const lose = Math.floor((p.exp||0) * DEATH_EXP_PENALTY);
  if(lose>0) p.exp -= lose;
  log('<span class="dmg">你被击败了！</span>损失经验 <span class="dmg">'+fmtNum(lose)+'</span>，传送回安全区并恢复状态。');
  p.hp = p._s.max_hp; p.mp = p._s.max_mp;
  eventLog('<span class="dmg">被击败，损失经验 '+fmtNum(lose)+'，已传送回安全区</span>');
  // 回到当前地图安全区
  state.combat=null;
  renderAll();
}

function gainExpCheck(){ checkAchievements(); }
function gainExp(n){
  const p = state.player;
  p.exp += n;
  let leveled=false;
  while(p.exp >= expToNext(p.level)){
    p.exp -= expToNext(p.level);
    p.level++;
    leveled=true;
  }
  if(leveled){
    syncSkills();   // 升级可能学会新技能/被动
    refreshStats();
    p.hp = p._s.max_hp; p.mp = p._s.max_mp;
    log('<span class="lv">★ 升级！当前等级 '+p.level+'</span>');
    eventLog('<span class="lv">★ 升级至 Lv.'+p.level+'</span>');
    sessLevelUp(p.level);      // 升级时间线
    gainExpCheck();
    autoZoneOnLevelUp();
    if(state.auto.rank) cloudRank();
  }
}

// ---------- 背包 / 装备 ----------
function addToBag(item){
  const p = state.player;
  // 装备每件属性独立，不叠加
  if(item.type==='equip'){
    if(item.uid==null) item.uid = uid();
    p.bag.push(item);
    trimBag();
    return;
  }
  // 武魂每件独立（类型/星级/等级/激活状态各异），不叠加
  if(item.type==='wuhun'){
    if(item.uid==null) item.uid = uid();
    p.bag.push(item);
    trimBag();
    return;
  }
  // 可叠加物品：消耗品 / 宝石 / 矿石 按标识合并，避免背包被同类刷屏
  if(item.count==null) item.count = 1;
  if(item.uid==null) item.uid = uid();
  const sig = stackSig(item);
  const ex = p.bag.find(b=> b.type!=='equip' && stackSig(b)===sig);
  if(ex){ ex.count = (ex.count||1) + item.count; return; }
  p.bag.push(item);
  trimBag();
}
// 相同物品判定（用于背包叠加；装备不叠加）
function stackSig(it){
  if(it.type==='consumable') return 'c|'+it.key;
  if(it.type==='gem')       return 'g|'+it.series+'|'+it.grade;
  if(it.type==='wuhun')     return 'x|'+it.uid;   // 武魂不叠加
  if(it.type==='ore')       return 'o|'+it.key;
  return 'x|'+it.uid;
}
// 堆叠物品扣减数量（扣到 0 自动移除），供镶嵌/使用调用
function decStack(it, n){
  const p=state.player;
  it.count = (it.count||1) - n;
  if(it.count<=0) p.bag = p.bag.filter(b=>b.uid!==it.uid);
}
// 装备战力评分：用于背包排序与超限淘汰（装备词条各不相同，不做叠加）
function equipScore(it){
  let s=0;
  for(const k in (it.stats||{})) s += it.stats[k]||0;
  for(const pk of (it.perks||[])) s += (pk.value||0)*1.5;
  for(const g of (it.gems||[])) if(g) s += (g.value||0);
  s += (it.refine||0)*20 + (it.bailian||0)*60;
  return Math.round(s);
}
// 整理背包：合并同类可叠加物（兼容旧存档），并排序
function consolidateBag(){
  const p=state.player; if(!p||!p.bag) return 0;
  const map=new Map(); const equips=[]; let merged=0;
  for(const it of p.bag){
    if(it.type==='equip'){ equips.push(it); continue; }
    if(it.count==null) it.count=1;
    const sig=stackSig(it);
    if(map.has(sig)){ map.get(sig).count += it.count; merged++; }
    else map.set(sig, it);
  }
  const order={consumable:0,gem:1,ore:2,wuhun:3,material:4};
  p.bag = Array.from(map.values()).concat(equips);
  p.bag.sort((a,b)=>{
    const oa=order[a.type]!=null?order[a.type]:9, ob=order[b.type]!=null?order[b.type]:9;
    if(oa!==ob) return oa-ob;
    if(a.type==='equip'&&b.type==='equip') return equipScore(b)-equipScore(a);
    return String(stackSig(a)).localeCompare(String(stackSig(b)));
  });
  return merged;
}
// 背包超限：优先丢弃评分最低的白/绿装，避免误删高价值物品
const BAG_CAP = 300;
function trimBag(){
  const p=state.player; if(!p||!p.bag) return;
  if(p.bag.length<=BAG_CAP) return;
  const equipped=new Set();
  for(const s in p.equip) if(p.equip[s]) equipped.add(p.equip[s].uid);
  const victims=p.bag
    .filter(b=> b.type==='equip' && !equipped.has(b.uid) && (b.quality==='white'||b.quality==='green') && !(b.refine>0) && !(b.bailian>0))
    .sort((a,b)=>equipScore(a)-equipScore(b));
  let i=0;
  while(p.bag.length>BAG_CAP && i<victims.length){ p.bag=p.bag.filter(b=>b.uid!==victims[i].uid); i++; }
  if(p.bag.length>BAG_CAP) p.bag.splice(0, p.bag.length-BAG_CAP);
}
// 一键分解白/绿装（未装备、未强化），回收矿石与宝石
// quiet=true 供挂机循环自动调用：只记一行日志，不重渲染右侧面板，返回分解件数
function autoExtractJunk(quiet){
  const p=state.player;
  const equipped=new Set(); for(const s in p.equip) if(p.equip[s]) equipped.add(p.equip[s].uid);
  const junk=p.bag.filter(b=> b.type==='equip' && (b.quality==='white'||b.quality==='green')
    && !equipped.has(b.uid) && !(b.refine>0) && !(b.bailian>0));
  if(!junk.length){ if(!quiet) log('<span class="sys">背包中没有可分解的白/绿装备。</span>'); return 0; }
  const gain={};
  for(const it of junk){
    for(const g of (it.gems||[])) if(g) addToBag({type:'gem', series:g.series, grade:g.grade, count:1});
    const ok=ORE_BY_TIER[(it.tier||1)-1]; const amt=DATA.extract.ore_per_equip||1;
    addOre(ok, amt); gain[ok]=(gain[ok]||0)+amt;
  }
  const ids=new Set(junk.map(j=>j.uid));
  p.bag=p.bag.filter(b=>!ids.has(b.uid));
  const gs=Object.keys(gain).map(k=>ORE_NAME[k]+'x'+gain[k]).join('、');
  log('<span class="loot">'+(quiet?'自动':'')+'分解 '+junk.length+' 件白/绿装备，回收 '+gs+'</span>');
  if(!quiet){ renderHeader(); renderTab(); }
  return junk.length;
}
// 挂机自动分解：包裹达到阈值即回收白/绿装，避免超过 BAG_CAP(300) 后被 trimBag 静默丢弃
const AUTO_SALVAGE_AT = 200;
function maybeAutoSalvage(){
  if(!state.auto.junk) return 0;
  const p=state.player; if(!p||!p.bag) return 0;
  if(p.bag.length < AUTO_SALVAGE_AT) return 0;
  return autoExtractJunk(true);
}
function tryAutoEquip(item){
  const p = state.player;
  if(item.reqLevel > p.level) return; // 等级不足不自动穿
  const cur = p.equip[item.slot];
  if(!cur){ equipItem(item); return; }
  // 比较主属性总和
  const sum = it=> Object.values(it.stats||{}).reduce((a,b)=>a+b,0) + (it.perks||[]).reduce((a,b)=>a+b.value,0);
  if(sum(item) > sum(cur)){
    equipItem(item);
    eventLog('自动换装 <span class="q-'+item.quality+'">'+item.name+'</span>（'+SLOT_NAME[item.slot]+'）');
  }
}
function equipItem(item){
  const p = state.player;
  // 找空位（戒指有两个）
  let slot = item.slot;
  if(slot==='ring'){ slot = p.equip.ring1? (p.equip.ring2?'ring1':(p.equip.ring1?'ring2':'ring1')) : 'ring1'; }
  if(item.slot!==slot) item.slot = slot;
  const old = p.equip[slot];
  p.equip[slot] = item;
  p.bag = p.bag.filter(b=>b.uid!==item.uid);
  if(old) p.bag.push(old);
  refreshStats();
  renderHeader(); renderTab();
}

// ---------- 生活技能：精炼 / 镶嵌 ----------
// 精炼加成口径（按原版 refine.py 反汇编还原，勿改回「按精炼等级取表 × 百分比」）：
//   · flat 表按【装备档位】索引（原版 refine_flat_per_level(equip.tier)），每级增量恒定
//   · 原版无任何百分比缩放：refine_per_level_pct / refine_per_level_pct_list 在原版是死代码
//     （config.py 里定义 + refine.py import 进命名空间，全 exe 零次使用；配套的
//      apply_range_bonus / apply_stat_range_bonus 也从未被调用）
//   · 只作用于四个白板攻防键，且【跳过 (0,0) 的键】（原版 `if int(v[0])==0 and int(v[1])==0: continue`）
//   · 失败降级/归零必须回退已得加成（原版 _revert_refine_stats），否则会白送属性
//   · 隐藏词条仅在达到精炼上限时解锁，按部位分 attack/defense，文案取自 refine_hidden_perks
function refineFlatOf(it){
  const m=(DATA.refine&&DATA.refine.refine_per_level_flat)||{};
  return m[''+((it&&it.tier)||1)] || m['1'] || [3,3];
}
// 本 port 装备属性是标量（原版是 [lo,hi] 区间）：原版给区间两端分别加 flat_lo / flat_hi，
// 标量下的等价期望增量就是中值，且【逐级恒定】—— 这样回退能精确还原，不必额外存字段
function refineStep(it){ const f=refineFlatOf(it); return Math.round((f[0]+f[1])/2); }
function refineKeys(it){
  return ['phys_atk','magic_atk','phys_def','magic_def'].filter(k=> it.stats && (it.stats[k]||0)!==0);
}
function refineApplyOne(it){
  const d=refineStep(it);
  for(const k of refineKeys(it)) it.stats[k]+= d;
  return d;
}
function refineRevert(it, levels){
  if(!(levels>0)) return;
  const d=refineStep(it)*levels;
  for(const k of refineKeys(it)) it.stats[k]=Math.max(0, it.stats[k]-d);
}
// 隐藏词条：攻击部位（武器/双戒）→ 致命；其余部位 → 守御。返回展示文案，未解锁返回 null
function refineAddHidden(it){
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
function doRefine(item){
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
function doInlay(item, gem){
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
function removeItem(item){
  const p=state.player;
  p.bag = p.bag.filter(b=>b.uid!==item.uid);
  for(const s in p.equip) if(p.equip[s] && p.equip[s].uid===item.uid) p.equip[s]=null;
  refreshStats(); renderHeader(); renderTab();
}

// ---------- 地图 / 导航 ----------
function travelTo(mapKey){
  const p = state.player;
  const map = DATA.maps.maps.find(m=>m.key===mapKey);
  if(!map) return;
  if(map.unlock_map && !p.unlocked[map.unlock_map]){ log('<span class="dmg">需先探索 '+map.unlock_map+' 才能进入</span>'); return; }
  p.map = mapKey; p.unlocked[mapKey]=true;
  state.zone=null; state.combat=null;
  log('<span class="sys">来到 '+map.name+'（安全区：'+(map.safe_zone?map.safe_zone.name:'无')+'）</span>');
  renderMap();
}

// ---------- 副本（dungeon_bosses / enter_level_min / daily_enter_limit） ----------
function mapByKey(k){ return (DATA.maps.maps||[]).find(m=>m.key===k) || null; }
function dungeonBosses(map){ return (map && map.dungeon_bosses) || []; }
function isDungeon(map){ return !!(map && (map.is_dungeon || (map.dungeon_bosses||[]).length)); }
function todayKey(){ const d=new Date(); return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate(); }
function dungeonBossKilled(mapKey, bossKey){ const mb=(state.player.stats.mapBoss||{})[mapKey]; return !!(mb && mb[bossKey]); }
function dungeonKilledCount(map){ return dungeonBosses(map).filter(b=>dungeonBossKilled(map.key, b.key)).length; }
function dungeonAllBossKilled(map){ const n=dungeonBosses(map).length; return n>0 && dungeonKilledCount(map)>=n; }
// 今日剩余进入次数（无 daily_enter_limit 时不限）
function dungeonEntryLeft(map){
  const lim=map.daily_enter_limit||0; if(!lim) return Infinity;
  const rec=(state.player.stats.dungeonEnter||{})[map.key];
  if(!rec || rec.d!==todayKey()) return lim;
  return Math.max(0, lim-(rec.n||0));
}
function consumeDungeonEntry(map){
  const lim=map.daily_enter_limit||0; if(!lim) return true;
  if(dungeonEntryLeft(map)<=0) return false;
  const p=state.player; p.stats.dungeonEnter=p.stats.dungeonEnter||{};
  const rec=p.stats.dungeonEnter[map.key];
  if(!rec || rec.d!==todayKey()) p.stats.dungeonEnter[map.key]={d:todayKey(), n:1};
  else rec.n=(rec.n||0)+1;
  return true;
}
// 记录一次副本首领击杀；全部首领击杀后记入 mapClear（= 通关，可领地图通关成就）
function noteDungeonBossKilled(map, bossKey, mname){
  const p=state.player; p.stats.mapBoss=p.stats.mapBoss||{};
  const mb=p.stats.mapBoss[map.key]=p.stats.mapBoss[map.key]||{};
  if(mb[bossKey]) return false;
  mb[bossKey]=1;
  log('<span class="loot">副本首领 '+mname+' 已击败</span>（'+dungeonKilledCount(map)+'/'+dungeonBosses(map).length+'）');
  if(dungeonAllBossKilled(map)){
    p.stats.mapClear=p.stats.mapClear||[];
    if(p.stats.mapClear.indexOf(map.key)<0){
      p.stats.mapClear.push(map.key);
      log('<span class="lv">★ 通关副本：'+map.name+'</span>（已记入地图通关）');
      eventLog('<span class="lv">★ 通关 '+map.name+'</span>');
      checkAchievements();
    }
  }
  return true;
}
// ---------- 区域探索（explore_target）/ 首领区清剿（minion_target） ----------
// explore_target：在该区域累计击杀这么多只普通怪即算「探索完成」（野外 35 / 洞窟 35 / 副本区域 10~15）
function zoneTarget(map, zone){ return (zone && zone.explore_target) || 0; }
function zoneKillCount(mapKey, zoneKey){ const zk=(state.player.stats.zoneKills||{})[mapKey]; return (zk && zk[zoneKey]) || 0; }
function zoneExplored(mapKey, zoneKey){
  const map=mapByKey(mapKey); if(!map) return false;
  const z=(map.zones||[]).find(x=>x.key===zoneKey); if(!z) return false;
  const t=zoneTarget(map,z); if(!t) return true;
  return zoneKillCount(mapKey, zoneKey) >= t;
}
function zoneExploredCount(map){ return (map.zones||[]).filter(z=>zoneExplored(map.key, z.key)).length; }
// 地图探索度（按各区域目标加权）
function mapExplorePct(map){
  const zs=(map.zones||[]); if(!zs.length) return 100;
  let done=0, tot=0;
  for(const z of zs){ const t=zoneTarget(map,z)||1; tot+=t; done+=Math.min(t, zoneKillCount(map.key, z.key)); }
  return tot? Math.round(done/tot*100) : 100;
}
// 该图的「首次通关」奖励（成就 map_single）—— 用于在地图面板上把奖励显性化。
// 成就奖励本身就是通关收益，但玩家在挂机流程里看不到它，导致「打首领区」这件事在体感上不存在。
function mapClearReward(mapKey){
  for(const a of achList()){
    if(a.metric==='map_single' && a.map_key===mapKey)
      return { key:a.key, name:a.name, coins:a.reward_coins||0, coupon:a.reward_coupon||0, items:(a.reward_items||[]) };
  }
  return null;
}
function mapCleared(mapKey){ return ((state.player.stats.mapClear)||[]).indexOf(mapKey)>=0; }
function rewardText(r){
  if(!r) return '';
  const parts=[];
  if(r.coins) parts.push(fmtNum(r.coins)+'金币');
  if(r.coupon) parts.push(r.coupon+'神秘结晶');
  for(const it of (r.items||[])) parts.push(itemName(it.key)+'x'+(it.count||1));
  return parts.join(' + ');
}
// minion_target：首领区需先清剿指定数量的普通/精英小怪，首领才会现身
function bossMinionTarget(map){
  const bz=map && map.boss_zone; if(!bz || !bz.minion_target) return null;
  return { normal: bz.minion_target.normal||0, elite: bz.minion_target.elite||0 };
}
function minionKillCount(mapKey, kind){ const mk=(state.player.stats.minionKills||{})[mapKey]; return (mk && mk[kind]) || 0; }
function bossZoneCleared(map){
  const t=bossMinionTarget(map); if(!t) return true;   // 没配 minion_target 就不设前置
  return minionKillCount(map.key,'normal')>=t.normal && minionKillCount(map.key,'elite')>=t.elite;
}
// 普通区域：记一次击杀（不含首领）
function noteZoneKill(mapKey, zoneKey){
  const p=state.player; p.stats.zoneKills=p.stats.zoneKills||{};
  const zk=p.stats.zoneKills[mapKey]=p.stats.zoneKills[mapKey]||{};
  const before=zk[zoneKey]||0; zk[zoneKey]=before+1;
  const map=mapByKey(mapKey); if(!map) return;
  const z=(map.zones||[]).find(x=>x.key===zoneKey); if(!z) return;
  const t=zoneTarget(map,z); if(!t) return;
  if(before<t && zk[zoneKey]>=t){
    log('<span class="lv">★ 区域探索完成：'+z.name+'</span>（'+zoneExploredCount(map)+'/'+map.zones.length+'）');
    eventLog('<span class="lv">★ 探索完成 '+map.name+'·'+z.name+'</span>');
  }
}
// 首领区：记一次小怪清剿；凑齐 minion_target 时首领现身
function noteMinionKill(mapKey, isElite){
  const p=state.player, map=mapByKey(mapKey);
  if(!map || !map.boss_zone) return;
  const was=bossZoneCleared(map);
  p.stats.minionKills=p.stats.minionKills||{};
  const mk=p.stats.minionKills[mapKey]=p.stats.minionKills[mapKey]||{normal:0, elite:0};
  const kind=isElite? 'elite':'normal';
  mk[kind]=(mk[kind]||0)+1;
  if(!was && bossZoneCleared(map)){
    log('<span class="lv">★ 清剿完成：'+map.name+'·'+map.boss_zone.name+'</span> 首领已现身，可挑战');
    eventLog('<span class="lv">★ 清剿完成 '+map.boss_zone.name+'</span>');
  }
}
// ---------- 渲染 ----------
function $(id){return document.getElementById(id);}
function appendLog(line){
  state.logLines.push(line);
  if(state.logLines.length>LOG_KEEP) state.logLines.shift();
  const el = $('log'); if(!el) return;
  el.innerHTML = state.logLines.slice(-LOG_SHOW).join('<br>');
  el.scrollTop = el.scrollHeight;
}
function log(html, cls){
  // cls 参数历史遗留，调用方已在 html 内联 class；保持签名兼容但不再二次包装
  appendLog(html);
}
// 本命日志：只记录重要事件（升级 / 高品质掉落 / 首领精英 / 任务 / 换装 / 存档），不复读战斗过程
// 2026-09-19：本命日志已合并到中间战斗日志，事件也进 state.logLines 以便按时间线混排
function eventLog(html){
  const d=new Date();
  const pad=n=>(''+n).padStart(2,'0');
  const line = '<span class="ev-t">'+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds())+'</span> '+html;
  state.events.push(line);
  if(state.events.length>EVENT_KEEP) state.events.shift();
  appendLog(line);
}
function expPct(){ const p=state.player; return clamp(p.exp/expToNext(p.level)*100,0,100); }

function renderHeader(){
  const p=state.player; if(!p) return;
  $('h-lv').textContent = p.level;
  $('h-job').textContent = (DATA.jobs.jobs.find(j=>j.key===p.job)||{}).name||p.job;
  $('h-gold').textContent = fmtNum(p.gold);
  $('h-crystal').textContent = fmtNum(p.crystal);
  $('h-kills').textContent = fmtNum(state.kills);
  // 底部状态栏
  const fc=$('f-char'), fz=$('f-zone');
  if(fc) fc.textContent = p.name+' · Lv.'+p.level+' · '+((DATA.jobs.jobs.find(j=>j.key===p.job)||{}).name||p.job);
  if(fz) fz.textContent = state.zone? ('挂机中：'+zoneName(state.zone)) : '未挂机';
}
// 底部时钟
setInterval(()=>{
  const t=$('f-time'); if(!t) return;
  const d=new Date();
  const pad=n=>(''+n).padStart(2,'0');
  t.textContent = '现在时间 '+d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());
},1000);
function zoneName(z){
  const map = DATA.maps.maps.find(m=>m.key===z.mapKey);
  if(!map) return '';
  if(z.isBoss){ if(map.boss_zone) return map.name+'·'+map.boss_zone.name; const _db=(map.dungeon_bosses||[]).find(x=>x.key===z.bossKey); return map.name+'·'+(_db?_db.name:'首领'); }
  const zone = map.zones.find(zz=>zz.key===z.zoneKey);
  return map.name+'·'+(zone?zone.name:'');
}
function renderMap(){
  const p=state.player; if(!p) return;
  const el=$('map-pane'); if(!el) return;
  const map = DATA.maps.maps.find(m=>m.key===p.map);
  let html = '<div class="map-name">'+map.name+'</div>';
  html += '<div class="muted" style="margin-bottom:6px">'+(map.safe_zone?('安全区：'+map.safe_zone.name):'危险区域')+((map.zones||[]).length? ' · 探索度 '+mapExplorePct(map)+'%（'+zoneExploredCount(map)+'/'+map.zones.length+'）':'')+'</div>';
  html += '<h3>练级区域（点击挂机）</h3><div class="zone-wrap">';
  for(const z of map.zones){
    const isCur = state.zone && !state.zone.isBoss && state.zone.zoneKey===z.key;
    const _t=zoneTarget(map,z), _n=zoneKillCount(map.key,z.key), _done=_t>0 && _n>=_t;
    html += '<div class="zone'+(isCur?' active':'')+(_done?' done':'')+'" data-zone="'+z.key+'" '
            +'title="怪物等级 '+z.monster_level+(z.elite_monsters&&z.elite_monsters.length?' · 含精英':'')
            +(_t? ' · 探索进度 '+Math.min(_n,_t)+'/'+_t+(_done?'（已完成）':''):'')+'">'+
            z.name+'<span class="zlv">Lv.'+z.monster_level+'</span>'
            +(_t? '<span class="zex">'+(_done?'✔':(Math.min(_n,_t)+'/'+_t))+'</span>':'')+'</div>';
  }
  html += '</div>';
  if(map.boss_zone){
    const bz=map.boss_zone;
    const ok = p.level>=bz.unlock_level;
    const isCur = state.zone && state.zone.isBoss;
    const _cleared=bossZoneCleared(map), _mt=bossMinionTarget(map);
    const _done=mapCleared(map.key), _rw=mapClearReward(map.key), _rwTxt=rewardText(_rw);
    let _tip;
    if(!ok) _tip='需等级 '+bz.unlock_level+' 解锁';
    else if(!_cleared && _mt) _tip='需先清剿：普通 '+Math.min(minionKillCount(map.key,'normal'),_mt.normal)+'/'+_mt.normal
      +' · 精英 '+Math.min(minionKillCount(map.key,'elite'),_mt.elite)+'/'+_mt.elite;
    else if(_done) _tip='已通关 · 可继续挑战刷掉落';
    else _tip='推荐等级 '+bz.unlock_level+' · 点击挑战首领';
    if(_rwTxt) _tip += ' ｜ 首次通关奖励：'+_rwTxt+(_done?'（已领取）':'');
    // 未通关且已清剿 → 首领已现身，直接把首通奖励打进按钮，让这件事被看见
    const _showRw = (!_done && _cleared && _rwTxt);
    html += '<h3>首领区'+(_done?' · 已通关':(_cleared?'':' · 清剿中'))+'</h3><div class="zone-wrap"><div class="zone boss'+(isCur?' active':'')+(_cleared && !_done?' ready':'')+(_done?' done':'')+'" data-boss="1" '+
            'title="'+_tip+'">'+(_done?'✔ ':(_cleared?'☠ ':'⚔ '))+bz.name+'<span class="zlv">Lv.'+bz.unlock_level+'</span>'+
            ((!_cleared && _mt)? '<span class="zex">'+Math.min(minionKillCount(map.key,'normal'),_mt.normal)+'/'+_mt.normal
              +' · '+Math.min(minionKillCount(map.key,'elite'),_mt.elite)+'/'+_mt.elite+'</span>'
              : (_showRw? '<span class="zex rw">首通 '+fmtNum(_rw.coins)+'金</span>':''))+'</div></div>';
  }
  const _dboss=dungeonBosses(map);
  if(_dboss.length){
    const lim=map.daily_enter_limit||0, left=dungeonEntryLeft(map), lvOk=p.level>=(map.enter_level_min||0);
    const _ddone=mapCleared(map.key), _drw=mapClearReward(map.key), _drwTxt=rewardText(_drw);
    html += '<h3>副本首领（'+dungeonKilledCount(map)+'/'+_dboss.length+
            (lim? ' · 今日剩 '+left+'/'+lim+' 次':'')+(_ddone?' · 已通关':'')+'）</h3>';
    if(_drwTxt) html += '<div class="rwline">首次通关奖励：'+_drwTxt+(_ddone?'（已领取）':'')+'</div>';
    html += '<div class="zone-wrap">';
    for(const b of _dboss){
      const killed=dungeonBossKilled(map.key,b.key);
      const cur=state.zone && state.zone.isBoss && state.zone.bossKey===b.key;
      const tip=b.name+' Lv.'+b.level+(killed?' · 已击败':'')+(!lvOk?' · 需等级 '+(map.enter_level_min||0):'')+((lim && left<=0)? ' · 今日次数已用完':'');
      html += '<div class="zone boss'+(killed?' done':'')+(cur?' active':'')+'" data-dboss="'+b.key+'" title="'+tip+'">'+
              (killed?'✔ ':'☠ ')+b.name+'<span class="zlv">Lv.'+b.level+'</span></div>';
    }
    html += '</div>';
  }
  html += '<h3>前往（邻居）</h3><div>';
  for(const nk of (map.neighbors||[])){
    const nm = DATA.maps.maps.find(m=>m.key===nk);
    if(!nm) continue;
    const lock = nm.unlock_map && !p.unlocked[nm.unlock_map];
    html += '<span class="neighbor" data-go="'+nk+'">'+nm.name+(lock?' 🔒':'')+'</span>';
  }
  html += '</div>';
  // 信使（couriers.json）：付费传送到更远的地图
  const routes=courierRoutes(p.map);
  if(routes.length){
    html += '<h3>信使传送</h3><div>';
    for(const r of routes){
      const nm = DATA.maps.maps.find(m=>m.key===r.map_key);
      if(!nm) continue;
      const afford = p.gold >= (r.price||0);
      html += '<span class="neighbor" data-act="courier" data-map="'+r.map_key+'"'+(afford?'':' style="opacity:.55"')+'>'+nm.name+'（'+fmtNum(r.price||0)+'金）</span>';
    }
    html += '</div>';
  }
  el.innerHTML = html;
  el.querySelectorAll('[data-zone]').forEach(d=> d.onclick=()=> startZone(p.map, d.getAttribute('data-zone'), false));
  el.querySelectorAll('[data-boss]').forEach(d=> d.onclick=()=> { if(p.level>=map.boss_zone.unlock_level) startZone(p.map, null, true); else log('<span class="dmg">等级不足，无法挑战首领区</span>'); });
  el.querySelectorAll('[data-dboss]').forEach(d=> d.onclick=()=> startZone(p.map, null, true, d.getAttribute('data-dboss')));
  el.querySelectorAll('[data-go]').forEach(d=> d.onclick=()=> travelTo(d.getAttribute('data-go')));
  el.querySelectorAll('[data-act="courier"]').forEach(d=> d.onclick=()=>{
    const r=courierTravel(d.getAttribute('data-map'));
    log(r.ok? ('<span class="loot">'+r.msg+'</span>') : ('<span class="dmg">'+r.msg+'</span>'));
    renderMap(); renderHeader();
  });
  return html;      // 返回渲染结果，便于无头测试断言
}
// ---------- 战斗状态面板（中间栏：当前怪物卡片 + 血条） ----------
function renderBattle(){
  const el=$('battle-pane'); if(!el) return;
  const m=state.combat, p=state.player;
  if(!m || !p || !p._s){
    el.innerHTML='<div class="battle-empty">'+(state.idle?'搜索怪物中…':'未在战斗 —— 选择区域并开始挂机')+'</div>';
    return;
  }
  const tag = m.isBoss?'<span class="btag tag-boss">【首领】</span>':(m.isElite?'<span class="btag tag-elite">【精英】</span>':'');
  el.innerHTML='<div class="battle-card"><span class="bname">'+m.name+'</span><span class="blv">Lv.'+m.level+'</span>'+tag+
    '<div class="bar hp"><i style="width:'+clamp(m.curHp/m.hp*100,0,100)+'%"></i></div>'+
    '<div class="bar-label">怪物 HP '+fmtNum(Math.max(0,m.curHp))+' / '+fmtNum(m.hp)+'</div>'+
    '<div class="bar mp"><i style="width:'+clamp(p.hp/p._s.max_hp*100,0,100)+'%"></i></div>'+
    '<div class="bar-label">我的 HP '+fmtNum(Math.max(0,Math.round(p.hp)))+' / '+fmtNum(p._s.max_hp)+' · MP '+fmtNum(Math.round(p.mp))+' / '+fmtNum(p._s.max_mp)+'</div></div>';
}
// ---------- 角色常驻面板（属性 + 装备栏，独立成列，不与功能页签混在一起） ----------
const HERO_SLOTS=['helmet','necklace','shoulder_l','cloak','armor','weapon','gloves','shield','belt','ring1','pants','ring2','shoes'];
const CN_COMBAT={phys_atk:'物理攻击',magic_atk:'法术攻击',phys_def:'物理防御',magic_def:'法术防御',
  max_hp:'生命上限',max_mp:'法力上限',phys_crit:'物理暴击',dodge:'闪避',hit:'命中',crit_resist:'抗暴'};
const CN_ATTR={strength:'力量',agility:'敏捷',constitution:'体质',intelligence:'智力',spirit:'精神'};
function renderHero(){
  const p=state.player; if(!p||!p._s) return;
  const el=$('hero-pane'); if(!el) return;
  const s=p._s;
  const job=(DATA.jobs.jobs.find(j=>j.key===p.job)||{}).name||p.job;
  let html='<div class="char-card"><div class="hero-head"><span class="hero-name">'+p.name+'</span>'
    +'<span class="muted">'+job+' · Lv.'+p.level+'</span></div>';
  html+='<div class="bar hp"><i style="width:'+clamp(p.hp/s.max_hp*100,0,100)+'%"></i></div>'
    +'<div class="bar-label">生命 '+fmtNum(Math.round(p.hp))+' / '+fmtNum(s.max_hp)+'</div>';
  html+='<div class="bar mp"><i style="width:'+clamp(p.mp/s.max_mp*100,0,100)+'%"></i></div>'
    +'<div class="bar-label">法力 '+fmtNum(Math.round(p.mp))+' / '+fmtNum(s.max_mp)+'</div>';
  html+='<div class="bar exp"><i style="width:'+expPct()+'%"></i></div>'
    +'<div class="bar-label">经验 '+fmtNum(p.exp)+' / '+fmtNum(Math.round(expToNext(p.level)))+'（'+Math.round(expPct())+'%）</div></div>';
  // 战斗属性
  html+='<h3>战斗属性</h3><div class="stat-grid">';
  const order=['phys_atk','magic_atk','phys_def','magic_def','max_hp','max_mp','phys_crit','dodge'];
  const shown={};
  for(const k of order){ if(s.combat[k]==null) continue; shown[k]=1;
    html+='<div class="st"><span>'+(CN_COMBAT[k]||k)+'</span><b>'+fmtNum(s.combat[k])+'</b></div>'; }
  for(const k in s.combat){ if(shown[k]) continue;
    html+='<div class="st"><span>'+(CN_COMBAT[k]||k)+'</span><b>'+fmtNum(s.combat[k])+'</b></div>'; }
  html+='</div>';
  // 基础属性
  html+='<h3>基础属性</h3><div class="stat-grid">';
  for(const k in s.attr) html+='<div class="st"><span>'+(CN_ATTR[k]||k)+'</span><b>'+fmtNum(Math.round(s.attr[k]))+'</b></div>';
  html+='</div>';
  // 装备栏
  html+='<h3>装备（点击卸下）</h3><div class="eqgrid">';
  for(const sl of HERO_SLOTS){
    const it=p.equip[sl];
    if(it){
      const tag = it.bailian>0 ? ('百炼+'+it.bailian) : (it.refine>0 ? ('+'+it.refine) : '');
      const tip = SLOT_NAME[sl]+'·'+it.name+'\n'+statLine(it);
      html+='<div class="eqslot q-'+it.quality+'" data-unequip="'+sl+'" title="'+tip+'">'
        +'<span class="sl">'+SLOT_NAME[sl]+(tag?' '+tag:'')+'</span>'
        +'<span class="nm">'+it.name+'</span></div>';
    }else{
      html+='<div class="eqslot empty"><span class="sl">'+SLOT_NAME[sl]+'</span><span class="nm">—</span></div>';
    }
  }
  html+='</div>';
  // 本命日志已合并到中间战斗日志，不再在左侧重复渲染
  el.innerHTML=html;
  bindHeroClicks();
}
function bindHeroClicks(){
  const el=$('hero-pane'); if(!el) return;
  el.querySelectorAll('[data-unequip]').forEach(d=> d.onclick=()=>{
    const sl=d.getAttribute('data-unequip');
    const it=state.player.equip[sl]; if(!it) return;
    // 若已选中宝石，则优先镶嵌到该装备
    if(window._pendingGem){
      doInlay(it, window._pendingGem); window._pendingGem=null;
      const t=$('inlay-target'); if(t) t.textContent='已镶嵌';
      return;
    }
    state.player.equip[sl]=null;
    addToBag(it);
    refreshStats();
    log('<span class="sys">卸下 '+SLOT_NAME[sl]+'·'+it.name+'</span>');
    renderAll();
  });
}
// ---------- 武魂面板 ----------
const ATTR_LABEL = {
  phys_atk:'物攻', magic_atk:'法攻', phys_def:'物防', magic_def:'法防',
  max_hp:'生命', max_hp_pct:'生命%', max_mp:'法力', dark_atk:'暗攻',
  strength:'力量', agility:'敏捷', constitution:'体质', intelligence:'智力', spirit:'精神',
  phys_crit:'物爆', magic_crit:'法爆', dmg_reduce_pct:'减伤%',
  phys_atk_pct:'物攻%', magic_atk_pct:'法攻%', phys_def_pct:'物防%', magic_def_pct:'法防%'
};
function whStatLine(o){
  const st=wuhunStats(o); const parts=[];
  for(const s in st) parts.push((ATTR_LABEL[s]||s)+' +'+st[s]);
  if(o.activated&&o.actAttr) parts.push('<span class="loot">'+(ATTR_LABEL[o.actAttr.name]||o.actAttr.name)+' +'+o.actAttr.value+'</span>');
  return parts.join('　');
}
function soulCount(){
  const p=state.player; let n=0;
  for(const k of SANHUN_KEYS.concat(QIPO_KEYS)) n+=(p.materials[k]||0);
  return n;
}
function matSeries(s){
  const p=state.player; const parts=[];
  for(let i=0;i<=5;i++){ const v=p.materials[s+'_'+i]||0; if(v>0) parts.push(i+'★:'+v); }
  return parts.length? parts.join(' ') : '0';
}
// 武魂炼制：消耗 淬魂瓶 + 下级符令 + 三魂七魄
function whCraft(recipeKey){
  const R=(DATA.wuhun_recipes||{})[recipeKey];
  if(!R) return {ok:false,msg:'配方不存在'};
  const p=state.player;
  const res=R.result_item||'';
  const mm=res.match(/^(.+)_(\d+)$/);
  if(!mm) return {ok:false,msg:'配方产物异常'};
  const series=mm[1], star=parseInt(mm[2],10);
  const lowerKey = star>0 ? (series+'_'+(star-1)) : null;
  let ping=0, lowerCnt=0, soulNeed=0;
  for(const md of (R.materials||[])){
    const nm=md['名称']||'';
    const q=parseInt(String(md['数量']||'0/1').split('/')[1]||'1',10)||1;
    if(nm.indexOf('淬魂瓶')>=0) ping+=q;
    else if(nm.indexOf('符')>=0||nm.indexOf('令')>=0||nm.indexOf('诀')>=0) lowerCnt+=q;
    else soulNeed+=q;
  }
  if((p.materials.lianhua_ping||0) < ping) return {ok:false,msg:'淬魂瓶不足（需 '+ping+'）'};
  if(lowerKey && (p.materials[lowerKey]||0) < lowerCnt) return {ok:false,msg:whItemName(lowerKey)+' 不足（需 '+lowerCnt+'）'};
  const pool=SANHUN_KEYS.concat(QIPO_KEYS).filter(k=>(p.materials[k]||0)>0);
  let have=0; for(const k of pool) have+=p.materials[k];
  if(have < soulNeed) return {ok:false,msg:'三魂七魄不足（需 '+soulNeed+' 个，现有 '+have+'）'};
  p.materials.lianhua_ping = (p.materials.lianhua_ping||0) - ping;
  if(lowerKey) p.materials[lowerKey] -= lowerCnt;
  let need=soulNeed;
  for(const k of pool){ if(need<=0) break; const take=Math.min(need,p.materials[k]); p.materials[k]-=take; need-=take; }
  p.materials[res]=(p.materials[res]||0)+(R.result_count||1);
  return {ok:true,msg:'炼制成功：'+whItemName(res)+' x'+(R.result_count||1)};
}
// ---------- 技能面板 ----------
const SKILL_TYPE_CN={attack:'攻击',control:'控制',buff:'增益',defense:'防御',heal:'治疗',purify:'净化',summon:'召唤'};
function renderSkill(sub){
  const p=state.player;
  const any=!sub, on=k=>any||sub===k;         // sub 为空 = 全量渲染（旧行为）
  let html='<div class="muted">达到学习等级自动学会；升级消耗金币与经验（取自技能真实 requirements）。挂机时会自动施放技能。</div>';
  if(any || sub==='active' || SKILL_BANDS.some(b=>b.key===sub)){
    const allSkill=jobSkills(p.job);
    const learned=Object.keys(p.skills||{}).length;
    const list = (any || sub==='active') ? allSkill : allSkill.filter(x=>skillBand(x.learn_level||1)===sub);
    html+='<h3 class="sec">主动技能（已学 '+learned+'/'+allSkill.length+'）</h3>';
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
}
function renderWuhun(sub){
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
}
function renderShenmo(sub){
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
    // sub='tree_<档位>' 时只渲染该档（sub='tree' / 空 表示全部档位）
    if(sub && sub.indexOf('tree_')===0 && Number(sub.slice(5))!==Number(tk)) continue;
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
  return (sub==='tree' || sub.indexOf('tree_')===0) ? tree : (info+lvls);
}

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
const BAG_SUBS=[
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
function bagSlotType(slot){
  const raw=(DATA.slots||{}).slots;
  const arr=Array.isArray(raw)? raw : (raw? Object.keys(raw).map(k=>raw[k]) : []);
  const d=arr.find(x=>x && x.key===slot);
  return (d && d.slot_type) || 'armor';
}
function equipSubOf(it){
  const t=bagSlotType(it && it.slot);
  if(t==='weapon'||t==='offhand') return 'eq_weapon';
  if(t==='jewelry') return 'eq_jewelry';
  return 'eq_armor';                  // armor 与任何未知部位：宁可落到「防具」也不要产生孤儿
}
// 背包物品 → 子菜单 key（依据 items.json 的 effect_type，即配置里的分类语义）
function bagSubOf(it){
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
function bagSubLabel(key){ const d=BAG_SUBS.find(x=>x.key===key); return d? d.label : key; }

// 主动技能子菜单：按「可学等级」分 3 段（战士 18 个主动技能一屏放不下；每个技能卡 3 行）。
const SKILL_BANDS=[{key:'lv1',label:'初阶'},{key:'lv2',label:'中阶'},{key:'lv3',label:'高阶'}];
function skillBand(lv){ lv=lv||1; return lv<=30? 'lv1' : (lv<=60? 'lv2' : 'lv3'); }

// 其余页签的固定子菜单（需要按数据动态生成的页签走 subTabs() 的分支）
const TAB_SUBS={
  life:   [{key:'mine',label:'探矿'},{key:'craft',label:'打造'},
           {key:'refine',label:'炼丹·药水'},{key:'combine',label:'合成'},{key:'recycle',label:'提取·商店'}],
  wuhun:  [{key:'wear',label:'佩戴·背包'},{key:'craft',label:'炼制'}],
  shenmo: [{key:'level',label:'修验·变身'},{key:'tree',label:'技能树'}],
  skill:  [{key:'passive',label:'被动'},{key:'summon',label:'召唤兽'}],   // 主动部分由 SKILL_BANDS 拼在前
  cloud:  [{key:'save',label:'存档'},{key:'auto',label:'挂机设置'},{key:'stats',label:'统计'},{key:'rank',label:'排行'}]
};
function subTabs(tab){
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
    return out;
  }
  return TAB_SUBS[tab]||[];
}
// 成就子菜单：普通分类一项一个；「等级」24 条按 target 再拆 3 段
function achSubs(){
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
function achSubOf(a){
  if(!a || a.category!=='level') return a? a.category : 'level_1';
  const t=a.target||0;
  return t<=40? 'level_1' : (t<=80? 'level_2' : 'level_3');
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

function renderTab(){
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
function renderBag(sub){
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
      html+='<div class="item q-'+it.quality+'" data-item="'+it.uid+'">'
        +'['+QNAME[it.quality]+'] '+SLOT_NAME[it.slot]+'·'+it.name+' <span class="pill">'+lt+'</span>'
        +'<br><span class="muted">需求'+it.reqLevel+'级 · '+statLine(it)+'</span></div>';
    }
  }
  // 子页为空时给一句提示，免得看起来像坏了
  if(sub && !shown.length && !eqs.length) html+='<div class="muted">「'+bagSubLabel(sub)+'」分类下暂无物品。</div>';
  return html;
}
function renderEquip(){
  const p=state.player;
  let html='<h3>已装备</h3>';
  for(const slot in p.equip){
    const it=p.equip[slot];
    if(!it){ html+='<div class="item" style="opacity:.5">'+SLOT_NAME[slot]+'：空</div>'; continue; }
    html+='<div class="item equipped q-'+it.quality+'">['+QNAME[it.quality]+'] '+SLOT_NAME[slot]+'·'+it.name+' <span class="pill">+'+it.refine+'</span></div>';
    html+='<div class="muted" style="margin:-4px 0 6px 4px">'+statLine(it)+'</div>';
  }
  return html;
}
function statLine(it){
  const parts=[];
  for(const s in it.stats) parts.push(s+':'+it.stats[s]);
  for(const pk of it.perks) parts.push(pk.name+'+'+pk.value+(pk.suffix||''));
  for(const g of it.gems) if(g) parts.push(gemSeriesName(g.series)+'(+'+g.value+')');
  return parts.join('  ');
}
function renderStat(){
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
function slotOpts(sel){
  const slots=['weapon','armor','helmet','shoulder_l','pants','cloak','gloves','belt','shoes','shield','necklace','ring1','ring2'];
  return slots.map(s=> '<option value="'+s+'"'+(sel===s?' selected':'')+'>'+SLOT_NAME[s]+'</option>').join('');
}
function tierOpts(sel){ let h=''; for(let t=1;t<=7;t++) h+='<option value="'+t+'"'+(sel===t?' selected':'')+'>'+t+'档</option>'; return h; }
function equipOpts(sel){
  const p=state.player; const list=[];
  for(const s in p.equip) if(p.equip[s]) list.push(p.equip[s]);
  for(const b of p.bag) if(b.type==='equip') list.push(b);
  if(!list.length) return '<option value="">（无装备）</option>';
  return list.map(it=> '<option value="'+it.uid+'"'+(sel===it.uid?' selected':'')+'>'+(it.bailian?'+'+it.bailian+' ':'')+'['+QNAME[it.quality]+'] '+SLOT_NAME[it.slot]+'·'+it.name+'</option>').join('');
}
// 可精炼装备（未满级的，按战力评分从高到低）—— 下拉与面板详情共用同一份口径
function refineEquipList(){
  const p=state.player; if(!p) return [];
  const max=(DATA.refine||{}).refine_max||7;
  const list=[];
  for(const s in p.equip) if(p.equip[s]) list.push(p.equip[s]);
  for(const b of p.bag) if(b.type==='equip') list.push(b);
  return list.filter(it=> (it.refine||0)<max).sort((a,b)=>equipScore(b)-equipScore(a));
}
// ---------- 宝石镶嵌（gems.json）----------
// 系列限定部位必须接通：北斗/天行 → 武器·护手·戒指；望月/无相 → 头盔·护肩·盔甲·项链·护腿·盾牌；
// 元如 → 上面六件 + 鞋子·披风·腰带；修仙石 → 仅武器。不检查会把专用宝石镶到不合适的部位上白费一颗。
function gemSeriesDef(key){ return ((DATA.gems||{}).gem_series||[]).find(g=>g.key===key)||null; }
function gemSeriesName(key){ const s=gemSeriesDef(key); return s? s.name : key; }
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
// 可精炼装备下拉（只列未满级的，显示「+N [品质] 部位·名称」）
function refineEquipOpts(){
  const ok2=refineEquipList();
  if(!ok2.length) return '<option value="">（没有可精炼的装备）</option>';
  return ok2.map(it=> '<option value="'+it.uid+'"'+(LS.refineEq===it.uid?' selected':'')+'>'
    +'+'+(it.refine||0)+' ['+QNAME[it.quality]+'] '+SLOT_NAME[it.slot]+'·'+it.name+'</option>').join('');
}
function oreRecipeOpts(){ let h=''; for(const k in (DATA.ore_recipes||{})){ const r=DATA.ore_recipes[k]; h+='<option value="'+k+'"'+(LS.oreRecipe===k?' selected':'')+'>'+r.name+'</option>'; } return h; }
function furnaceOpts(){
  const catName={stone:'精炼石',compass:'罗盘',box:'宝匣',lingpai:'令牌',potion_box:'药水盒',ore:'矿石',yuanbao:'元宝'};
  let h=''; for(const k in (DATA.furnace_recipes||{})){ const r=DATA.furnace_recipes[k]; h+='<option value="'+k+'"'+(LS.furnace===k?' selected':'')+'>['+(catName[r.category]||r.category)+'] '+r.name+'</option>'; } return h;
}
function modeOpts(){
  const gm=(DATA.modes||{}).generate_modes||{}; let h='';
  if(!gm[LS.forgeMode]) LS.forgeMode='random';
  for(const k in gm) h+='<option value="'+k+'"'+(LS.forgeMode===k?' selected':'')+'>'+gm[k]+'</option>';
  return h;
}
function compassOpts(){
  let h=''; const c=(mineConf().compass||{});
  if(!c[LS.mineGrade]) LS.mineGrade=Object.keys(c)[0];
  for(const g in c) h+='<option value="'+g+'"'+(LS.mineGrade===g?' selected':'')+'>'+c[g].name+'</option>';
  return h;
}
function mineMapOpts(){
  let h=''; const cd=compassDef(LS.mineGrade); const maps=(cd&&cd.open_maps)||[];
  if(maps.indexOf(LS.mineMap)<0) LS.mineMap=maps[0];
  for(const mk of maps) h+='<option value="'+mk+'"'+(LS.mineMap===mk?' selected':'')+'>'+instMapName(mk)+'</option>';
  return h;
}
function gemSeriesOpts(){
  let h=''; const arr=(DATA.gems.gem_series||[]);
  if(!LS.gemSeries && arr.length) LS.gemSeries=arr[0].key;
  for(const g of arr) h+='<option value="'+g.key+'"'+(LS.gemSeries===g.key?' selected':'')+'>'+g.name+'</option>';
  return h;
}
function gemGradeOpts(){
  let h='';
  if(!LS.gemGrade) LS.gemGrade=GEM_ORDER[0];
  for(let i=0;i<GEM_ORDER.length-1;i++){ const g=GEM_ORDER[i]; h+='<option value="'+g+'"'+(LS.gemGrade===g?' selected':'')+'>'+g+' → '+GEM_ORDER[i+1]+'</option>'; }
  return h;
}
function oreCostPreview(){ const t=LS.forgeTier; const ore=ORE_BY_TIER[t-1]; return ORE_NAME[ore]+' x'+(3+t*2)+' + 金币 '+fmtNum(t*150); }
function bailianCostStr(r){
  const parts=[];
  for(const m of r.materials){ if(m.key==='bailian_shi') parts.push('百炼石x'+m.count); else if(m.kind==='crystal') parts.push('晶石x'+m.count); else if(m.bottle) parts.push('炼化瓶x1'); }
  const lowL=parseInt(r.key.split('_').pop(),10)-1;
  if(lowL>=1) parts.push('百炼丹·'+cn(lowL)+'x2');
  return parts.join(' ');
}
function bailianDanSummary(){
  const p=state.player; const s=[];
  for(let L=1;L<=5;L++){ const n=p.bag.filter(b=>b.type==='consumable'&&b.key==='bailian_dan_'+L).reduce((a,b)=>a+b.count,0); if(n>0) s.push('百炼丹·'+cn(L)+'x'+n); }
  return s.length?s.join(' '):'（无）';
}

function renderLife(sub){
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
}
// ---------- 副本兑换 / 成就 ----------
function renderInstance(sub){
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
function renderAch(sub){
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
function jobCn(k){ const j=(DATA.jobs.jobs||[]).find(x=>x.key===k); return j? j.name : k; }
function timeAgo(ms){
  if(!ms) return '—';
  const d=Math.floor((Date.now()-ms)/1000);
  if(d<60) return d+' 秒前'; if(d<3600) return Math.floor(d/60)+' 分钟前';
  if(d<86400) return Math.floor(d/3600)+' 小时前'; return Math.floor(d/86400)+' 天前';
}
async function loadCloudUI(){
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
function svgTrend(history){
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
function svgBandBars(bands){
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
const QUALITY_ORDER = ['white','green','blue','purple','gold','red'];
const QUALITY_COLOR = { white:'#c8c0b0', green:'#7fae5a', blue:'#5f9fd8', purple:'#a97ad2', gold:'#e8c76f', red:'#d95c50' };

// 战力曲线（本局）
function svgPower(history){
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
function svgDropBars(total){
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
function svgLevelTimeline(ups){
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

function renderCloud(sub){
  const p=state.player, C=state.cloud;
  const any=!sub, on=k=>any||sub===k;         // sub 为空 = 全量渲染（旧行为，测试依赖）
  let html='';
  if(on('save')) html+='<h3>后端服务</h3>';
  html+='<div class="muted">状态：'+(C.ok? '<span style="color:var(--green)">已连接 '+C.base+'</span>'
    : '<span style="color:var(--red)">未连接</span>（本地仍可存档；启动后端：node server/server.js，端口 8014）')+'</div>';

  // 账号
  if(on('save')) html+='<hr><h3>账号'+(C.user? '（已登录）':'')+'</h3>';
  if(on('save')){
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

// ---------- 商店 ----------
function itemName(key){ return ITEM_NAME_CACHE[key] || key; }
function mysticSlotOptions(){
  const slots = ['weapon','armor','helmet','shoulder_l','pants','cloak','gloves','belt','shoes','shield','necklace','ring1','ring2'];
  const p=state.player;
  return slots.map(s=>'<option value="'+s+'"'+(window._mysticSlot===s?' selected':'')+'>'+SLOT_NAME[s]+'</option>').join('');
}
function renderShop(sub){
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
}
function buyShopItem(shopKey, idx){
  const p=state.player;
  const shop=(DATA.shops.shops||[]).find(s=>s.key===shopKey); if(!shop) return;
  const it=shop.items[idx]; if(!it) return;
  const price=it.price;
  if(it.kind==='mystic_equip'){
    if(p.crystal<price){ log('<span class="dmg">神秘结晶不足</span>'); return; }
    const slot=window._mysticSlot||'weapon';
    const base=genEquipBaseForSlot(slot, p.job, it.tier);
    if(!base){ log('<span class="dmg">该部位暂无可用基底</span>'); return; }
    const eq=buildEquip(base, p.job, it.tier, slot);
    p.crystal-=price; addToBag(eq);
    log('<span class="loot">兑换 '+SLOT_NAME[slot]+'·'+eq.name+'（'+it.name+'，['+QNAME[eq.quality]+']）</span>');
  }else if(it.kind==='equip'){
    if(p.gold<price){ log('<span class="dmg">金币不足</span>'); return; }
    const base=BASE_BY_KEY[it.base_key]; if(!base){ log('<span class="dmg">装备基底缺失</span>'); return; }
    const job=jobFromBaseKey(it.base_key)||p.job;
    const eq=buildEquip(base, job, it.tier||1, it.slot);
    p.gold-=price; addToBag(eq);
    log('<span class="loot">购买 '+eq.name+'（['+QNAME[eq.quality]+']）</span>');
  }else if(it.kind==='consumable'||it.kind==='ore'){
    if(p.gold<price){ log('<span class="dmg">金币不足</span>'); return; }
    p.gold-=price;
    addToBag({uid:uid(), type:it.kind==='ore'?'ore':'consumable', key:it.item, count:1});
    log('<span class="loot">购买 '+itemName(it.item)+'</span>');
  }
  renderHeader(); renderTab();
}

// ---------- 任务 ----------
function renderQuest(){
  let html='<h3>委托任务</h3><div class="muted">接取后击杀指定怪物即推进；完成阶段领取经验与银两。</div>';
  const quests = DATA.quests||{};
  for(const qk in quests){
    const qd=quests[qk];
    const st=state.player.quests[qk]||{accepted:false,done:false,stage:0,progress:0};
    html+='<div class="quest"><div class="shop-name">'+qd.name+'</div>';
    html+='<div class="muted">'+qd.desc+'（委托人：'+qd.npc+'）</div>';
    if(!st.accepted){
      html+='<div class="item" data-accept="'+qk+'" style="border-color:var(--green)">接受委托</div>';
    }else if(st.done){
      html+='<div class="muted" style="color:var(--gold)">★ 已完成</div>';
    }else{
      const stg=qd.stages[st.stage];
      if(stg){
        html+='<div class="muted">阶段 '+stg.stage+'/'+qd.stages.length+'：'+stg.name+
              '（'+Math.min(st.progress,stg.target.count)+'/'+stg.target.count+'）目标：'+qd.map_key+'</div>';
        html+='<div class="muted">奖励：经验 '+fmtNum(stg.reward.exp||0)+' · 银两 '+fmtNum(stg.reward.silver||0)+'</div>';
      }
    }
    html+='</div>';
  }
  return html;
}
function acceptQuest(key){
  state.player.quests[key]={accepted:true,done:false,stage:0,progress:0};
  const qd=DATA.quests[key];
  log('<span class="lv">已接受委托：'+(qd?qd.name:key)+'</span>');
  renderTab();
}
function questProgress(m){
  const p=state.player;
  for(const qk in p.quests){
    const st=p.quests[qk]; if(!st.accepted||st.done) continue;
    const qd=DATA.quests[qk]; if(!qd) continue;
    const stg=qd.stages[st.stage]; if(!stg) continue;
    // 匹配怪物 key（放宽地图限制，按怪物匹配即可推进）
    if(stg.target.monsters.includes(m.key)){
      st.progress++;
      if(st.progress>=stg.target.count){
        gainExp(stg.reward.exp||0);
        p.gold += stg.reward.silver||0;
        log('<span class="loot">委托阶段完成【'+stg.name+'】，经验 '+fmtNum(stg.reward.exp||0)+' · 银两 '+fmtNum(stg.reward.silver||0)+'</span>');
        st.stage++; st.progress=0;
        if(st.stage>=qd.stages.length){
          st.done=true;
          log('<span class="loot">★ 委托【'+qd.name+'】全部完成！</span>');
          eventLog('<span class="loot">★ 委托【'+qd.name+'】全部完成！</span>');
        }
      }
    }
  }
}
// 背包内使用丹药（回血/回蓝）
function useConsumable(it){
  const def=(DATA.items.items||[]).find(i=>i.key===it.key); if(!def) return;
  const p=state.player;
  const per = def.effect && (def.effect.hp_per_tick!=null?def.effect.hp_per_tick:def.effect.mp_per_tick||0);
  const isMp = def.effect && def.effect.mp_per_tick!=null;
  const total = per*(def.duration_ticks||1);
  if(isMp){ p.mp=Math.min(p._s.max_mp, p.mp+total); log('<span class="loot">使用 '+def.name+'，恢复法力 '+fmtNum(total)+'</span>'); }
  else { p.hp=Math.min(p._s.max_hp, p.hp+total); log('<span class="loot">使用 '+def.name+'，恢复生命 '+fmtNum(total)+'</span>'); }
  it.count--; if(it.count<=0) p.bag=p.bag.filter(b=>b.uid!==it.uid);
  renderHeader(); renderTab();
}

// ---------- 生活技能：打造 / 百炼 / 提取 / 矿石炼制 / 乾坤炉 ----------
function weightedPick(keys, wmap){
  let tot=0; for(const k of keys) tot+=(wmap[k]||0);
  if(tot<=0) return keys[0];
  let r=Math.random()*tot;
  for(const k of keys){ r-=(wmap[k]||0); if(r<=0) return k; }
  return keys[keys.length-1];
}
function cn(n){ return ['零','壹','贰','叁','肆','伍','陆','柒','捌','玖'][n]||(''+n); }
function oreName(k){ return ORE_NAME[k]||k; }
// 大数字格式化：中文计数（万/亿/兆/京/垓/秭），每级 ×1e4
function fmtNum(n){
  if(n==null || isNaN(n)) return '0';
  n = +n;
  if(n < 10000){
    if(Math.floor(n)===n) return ''+n;            // 整数（含小数百分比如暴击0.15）直出
    return ''+(Math.round(n*100)/100);
  }
  const u=['','万','亿','兆','京','垓','秭'];
  let i=0, v=n;
  while(v>=10000 && i<u.length-1){ v/=10000; i++; }
  const s = v>=100 ? (''+Math.round(v)) : (v.toFixed(2).replace(/\.?0+$/,''));
  return s+u[i];
}
// ---------- 晶石（crystals.json）：精炼 +5 起需消耗对应档晶石 ----------
function crystalDef(k){ return ((DATA.crystals||{}).crystal_types||[]).find(c=>c.key===k)||null; }
function crystalName(k){ const d=crystalDef(k); return d? d.name : k; }
function crystalForTier(tier){ const m=(DATA.crystals||{}).tier_to_crystal||{}; return m[''+clamp(tier||1,1,7)] || m['1']; }
function crystalStartRefine(){ return (DATA.crystals||{}).crystal_start_refine || 5; }
function crystalCount(k){ return ((state.player.crystals||{})[k])||0; }
function useCrystalStone(k, n){
  const p=state.player; p.crystals=p.crystals||{};
  if((p.crystals[k]||0) < n) return false;
  p.crystals[k]-=n; return true;
}
function addCrystalStone(k, n){ const p=state.player; p.crystals=p.crystals||{}; p.crystals[k]=(p.crystals[k]||0)+n; }
// ---------- 信使（couriers.json）：付费传送 ----------
function courierRoutes(mapKey){ return ((DATA.couriers||{})[mapKey])||[]; }
function courierTravel(toMap){
  const p=state.player;
  const r=courierRoutes(p.map).find(x=>x.map_key===toMap);
  if(!r) return {ok:false, msg:'当前地图无此信使线路'};
  if(p.gold < (r.price||0)) return {ok:false, msg:'金币不足，需 '+fmtNum(r.price||0)};
  p.gold -= (r.price||0);
  travelTo(toMap);
  return {ok:true, msg:'支付 '+fmtNum(r.price||0)+' 金币，信使送你抵达 '+(instMapName(toMap))};
}
// 配置外补充物品名（炼化瓶/晶石/太古残片等）
const EXTRA_ITEM_NAME = {lianhua_ping:'炼化瓶', yumo_crystal:'镇魔晶石', taigu_canpian:'太古残片',
  bailian_shi:'百炼石', shengzhe_fufu:'英灵护符', guangming_fufu:'光明护符', siwang_fufu:'死亡护符'};
function itemCount(key){
  const p=state.player; let n=0;
  for(const b of p.bag) if(b.type==='consumable' && b.key===key) n += (b.count||1);
  return n;
}
function itemConsume(key, n){
  if(itemCount(key) < n) return false;
  const p=state.player;
  for(const b of p.bag){
    if(n<=0) break;
    if(b.type==='consumable' && b.key===key){
      const c=b.count||1;
      if(c>n){ b.count=c-n; n=0; }
      else { n-=c; b.count=0; }
    }
  }
  p.bag = p.bag.filter(b=> !(b.type==='consumable' && (b.count||0)<=0));
  return true;
}
function gemCount(series, grade){
  const p=state.player; let n=0;
  for(const b of p.bag) if(b.type==='gem' && b.series===series && b.grade===grade) n += (b.count||1);
  return n;
}
function gemConsume(series, grade, n){
  if(gemCount(series,grade) < n) return false;
  const p=state.player;
  for(const b of p.bag){
    if(n<=0) break;
    if(b.type==='gem' && b.series===series && b.grade===grade){
      const c=b.count||1;
      if(c>n){ b.count=c-n; n=0; } else { n-=c; b.count=0; }
    }
  }
  p.bag = p.bag.filter(b=> !(b.type==='gem' && (b.count||0)<=0));
  return true;
}

// ---------- 探矿（mining.json 驱动） ----------
function mineConf(){ return (DATA.mining||{}).mining || {}; }
function compassDef(g){ return (mineConf().compass||{})[g] || null; }
function mineExpNeed(lv){ const lu=mineConf().levelup||{base_exp:30, growth:1.18}; return Math.round(lu.base_exp*Math.pow(lu.growth, lv-1)); }
function mineStart(grade, mapKey){
  const p=state.player;
  const cd=compassDef(grade);
  if(!cd){ return {ok:false, msg:'未知罗盘'}; }
  if(p.level < (cd.level_required||1)) return {ok:false, msg:'等级不足，'+cd.name+' 需 Lv.'+cd.level_required};
  if((cd.open_maps||[]).indexOf(mapKey)<0) return {ok:false, msg:cd.name+' 无法在 '+mapKey+' 使用'};
  if(state.mine) return {ok:false, msg:'已有探矿作业进行中'};
  if(itemCount(cd.key) < 1) return {ok:false, msg:'需要 '+cd.name+'（商店有售）'};
  state.mine={grade, map:mapKey, step:0, t:0};
  return {ok:true, msg:'开始探矿：'+cd.name+' @ '+mapKey};
}
function mineProgress(){
  if(!state.mine) return 0;
  const steps=mineConf().steps||[];
  let total=0, done=0;
  steps.forEach((st,i)=>{ const sec=st.seconds||10; total+=sec; if(i<state.mine.step) done+=sec; });
  return total? clamp((done+state.mine.t)/total*100,0,100) : 0;
}
function mineTick(dt){
  if(!state.mine) return;
  const steps=mineConf().steps||[];
  if(!steps.length){ state.mine=null; return; }
  state.mine.t += dt;
  const cur=steps[state.mine.step];
  if(!cur){ mineSettle(); return; }
  if(state.mine.t >= (cur.seconds||10)){
    state.mine.t -= (cur.seconds||10);
    state.mine.step++;
    if(state.mine.step>=steps.length){ mineSettle(); return; }
    log('<span class="sys">探矿：'+steps[state.mine.step].name+'</span>');
  }
}
function mineSettle(){
  const m=state.mine; if(!m) return;
  state.mine=null;
  const p=state.player;
  const mc=mineConf(), cd=compassDef(m.grade);
  if(!itemConsume(cd.key, (mc.rounds_per_compass||1))){ log('<span class="dmg">罗盘不足，探矿中止</span>'); return; }
  const oc=mc.outcomes||{};
  const r=Math.random();
  const ml = p.mining.level;
  const yieldMult = 1 + (ml-1)*0.05;
  let gain = 0, oreKey = null;
  if(r < (oc.empty||0.05)){
    log('<span class="sys">探矿结束：矿脉空空，一无所获。</span>');
    gain = 0;
  }else if(r < (oc.empty||0.05)+(oc.ore||0.9)){
    const tbl = ((mc.ore_tables_by_map||{})[m.grade]||{})[m.map] || (mc.ore_tables||{})[m.grade] || {};
    const keys=Object.keys(tbl);
    if(keys.length){
      const wmap={}; keys.forEach(k=> wmap[k]=tbl[k]);
      oreKey = weightedPick(keys, wmap);
      gain = Math.max(1, Math.round((mc.ore_group_base||20)*yieldMult*rnd(0.8,1.2)));
      addOre(oreKey, gain);
      log('<span class="loot">探矿收获：'+ORE_NAME[oreKey]+' x'+gain+'</span>');
    }
  }else{
    // 太古：双倍矿石 + 太古残片 + 远古宝箱（随机装备）
    const tbl = ((mc.ore_tables_by_map||{})[m.grade]||{})[m.map] || (mc.ore_tables||{})[m.grade] || {};
    const keys=Object.keys(tbl);
    if(keys.length){
      const wmap={}; keys.forEach(k=> wmap[k]=tbl[k]);
      oreKey = weightedPick(keys, wmap);
      gain = Math.max(1, Math.round((mc.ore_group_base||20)*yieldMult*rnd(0.8,1.2)*2));
      addOre(oreKey, gain);
    }
    addMaterial('taigu_canpian', 1);
    const box = genEquipWithFallback(pick(['weapon','armor','helmet','pants','shoes','gloves']), p.job, {level:p.level, hp:1}, p);
    if(box){ addToBag(box); eventLog('<span class="loot">太古矿脉：获得 '+box.name+'</span>'); }
    log('<span class="boss">太古矿脉！'+ORE_NAME[oreKey||'']+' x'+gain+'、太古残片 x1'+(box?'、['+QNAME[box.quality]+']'+box.name:'')+'</span>');
  }
  // 挖矿经验
  const exp = (12 + ml*6) * (r>=(oc.empty||0.05)+(oc.ore||0.9) ? 3 : 1);
  p.mining.exp += exp;
  while(p.mining.level < ((mc.levelup||{}).max_level||100) && p.mining.exp >= mineExpNeed(p.mining.level)){
    p.mining.exp -= mineExpNeed(p.mining.level);
    p.mining.level++;
    log('<span class="lv">探矿等级提升至 '+p.mining.level+' 级（产量 +5%/级）</span>');
    eventLog('<span class="lv">探矿等级 '+p.mining.level+'</span>');
  }
  renderTab(); renderHeader();
}

// ---------- 副本护符兑换（instance_exchange.json 驱动） ----------
function instEntries(){
  const ie=DATA.instance_exchange||{}; const out=[];
  for(const k in ie){ if(k.charAt(0)==='_') continue; out.push(Object.assign({_k:k}, ie[k])); }
  return out;
}
function instSpec(){ return (DATA.instance_exchange||{})._exchange_spec || {}; }
function instName(key){ const n={xianghunzhong_instance:'香魂冢', xuanyuantai:'轩辕台', guimu:'古墓'}; return n[key]||key; }
function instMapName(mapKey){ const m=(DATA.maps.maps||[]).find(x=>x.key===mapKey); return m? m.name : mapKey; }
function instGroup(mapKey){ return instEntries().filter(e=> e.npc_map===mapKey); }
// 逐级套用精炼加成（与手动精炼到同级结果一致，不判定成败）
function applyRefineLevels(it, lv){
  const rf=DATA.refine; if(!rf) return;
  const max=rf.refine_max||7;
  for(let n=0;n<Math.max(0,Math.floor(lv||0));n++){
    if((it.refine||0)>=max) break;
    it.refine=(it.refine||0)+1;
    refineApplyOne(it);
  }
  if((it.refine||0)>=max && !(it.perks||[]).some(pk=>pk.hidden)) refineAddHidden(it);
}
// 取词条在该档位的中值（perk_value=mid）
function perkMidValue(name, tier, job){
  const pool=DATA.perk_pool[job+'_general_pool'] || DATA.perk_pool['warrior_general_pool'];
  if(!pool) return 1;
  const all=(pool.stat_fixed||[]).concat(pool.stat_percent||[], pool.atk_fixed||[]);
  const f=all.find(x=>x.name===name);
  if(!f) return 1;
  const v=f.values[''+tier] || f.values['1'] || [1,1];
  return Math.round((v[0]+v[1])/2);
}
function buildExchangeEquip(e){
  const p=state.player, spec=instSpec();
  const it=genEquip(e.slot, p.job, e.tier, p.level);
  if(!it) return null;
  applyRefineLevels(it, spec.refine||5);
  it.sockets = spec.sockets||3;
  it.gems = new Array(it.sockets).fill(null);
  const poolKey = (e.slot==='weapon'||e.slot==='gloves')? 'weapon':'general';
  const names = ((spec.perks_by_pool_job||{})[poolKey]||{})[p.job] || [];
  it.perks = names.map(n=>({name:n, value:perkMidValue(n, e.tier, p.job)}));
  it.quality = qualityFromPerks(it.perks.length);
  it.fromInstance = e.instance;
  return it;
}
function doInstanceExchange(key){
  const p=state.player;
  const e=instEntries().find(x=>x._k===key);
  if(!e) return;
  if(itemCount(e.cost_key) < e.cost_count){ log('<span class="dmg">护符不足：需 '+itemName(e.cost_key)+' x'+e.cost_count+'</span>'); return; }
  const it=buildExchangeEquip(e);
  if(!it){ log('<span class="dmg">兑换失败：无可用基底</span>'); return; }
  itemConsume(e.cost_key, e.cost_count);
  addToBag(it);
  log('<span class="loot">兑换成功：['+QNAME[it.quality]+']'+it.name+'（+'+(it.refine)+'精炼·'+it.sockets+'孔）</span>');
  eventLog('副本兑换 <span class="q-'+it.quality+'">['+QNAME[it.quality]+']'+it.name+'</span>');
  renderTab(); renderHeader();
}

// ---------- 成就（achievements.json 驱动） ----------
function achList(){ return (DATA.achievements||{}).achievements || []; }
function achCats(){ return (DATA.achievements||{}).categories || {}; }
// ---------- 称号系统（achievements.json#titles 驱动） ----------
function titleList(){ return TITLES; }
function titleByKey(key){ return TITLES.find(t=>t.key===key) || null; }
function titleUnlocked(key){ const p=state.player; return !!(p && p.titles && p.titles[key]); }
function titleEffect(){
  const p=state.player; if(!p || !p.equippedTitle) return null;
  const t = titleByKey(p.equippedTitle); return t ? (t.effect||null) : null;
}
// 称号对当前怪物的伤害倍率：monster_dmg（怪物名含 keyword） / map_buff（在指定地图内）
function titleDmgMult(m){
  const eff = titleEffect(); if(!eff) return 1;
  if(eff.type==='monster_dmg'){
    const kw = eff.keyword || ''; if(!kw) return 1;
    const name = (m && (m.name||'')) || '';
    return name.indexOf(kw)>=0 ? (eff.mult||1) : 1;
  }
  if(eff.type==='map_buff'){
    const mk = (state.zone && state.zone.mapKey) || (state.player && state.player.map);
    if(mk === eff.map_key) return 1 + (eff.dmg_pct||0)/100;
  }
  return 1;
}
// 当前地图下每 tick 回血/回蓝（map_buff）
function titleHeal(){
  const p=state.player; if(!p || !p._s) return {hp:0,mp:0};
  const eff = titleEffect(); if(!eff || eff.type!=='map_buff') return {hp:0,mp:0};
  if(!state.zone || state.zone.mapKey !== eff.map_key) return {hp:0,mp:0};
  const hp = Math.max(0, Math.floor(p._s.max_hp * (eff.hp_pct||0)/100));
  const mp = Math.max(0, Math.floor(p._s.max_mp * (eff.mp_pct||0)/100));
  return {hp, mp};
}
function titleProgress(t){
  const p=state.player; const st=(p&&p.stats)||{}; const un=t.unlock||{};
  switch(un.type){
    case 'kill_type': return (st.killType||{})[un.keyword]||0;
    case 'map_clear': return ((st.mapClear||[]).indexOf(un.map_key)>=0) ? 1 : 0;
    case 'achieve_count': { let n=0; for(const k in (p.ach||{})) n++; return n; }
  }
  return 0;
}
function titleTarget(t){ return ((t.unlock||{}).count)||(((t.unlock||{}).type==='map_clear')?1:0); }
function grantTitle(t){
  const p=state.player; if(!p || !p.titles) return;
  if(p.titles[t.key]) return;
  p.titles[t.key]={t:Date.now()};
  log('<span class="lv">解锁称号：'+t.name+'</span>');
  eventLog('解锁称号 <span class="lv">'+t.name+'</span>');
  // 首次解锁自动装备（若当前未装备任何称号）
  if(!p.equippedTitle) p.equippedTitle=t.key;
}
function checkTitles(){
  const p=state.player; if(!p || !p.titles) return;
  for(const t of titleList()){
    if(p.titles[t.key]) continue;
    if(titleProgress(t) >= titleTarget(t)) grantTitle(t);
  }
}
function equipTitle(key){
  const p=state.player; if(!p) return false;
  if(!key){ p.equippedTitle=null; return true; }
  if(!titleByKey(key) || !p.titles || !p.titles[key]) return false;
  p.equippedTitle=key; return true;
}

function achValue(a){
  const p=state.player; const st=p.stats||{};
  switch(a.metric){
    case 'level': return p.level;
    case 'kill': return st.kills||0;
    case 'kill_type': return (st.killType||{})[a.kill_keyword]||0;
    case 'map_single': return (st.mapClear||[]).indexOf(a.map_key)>=0 ? 1 : 0;   // 必须按该成就指定的 map_key 判定；原先取「全地图击杀最大值」，导致 18 条 target=1 的「XX通关」杀第一只怪就全部达成（瞬间发放 1,986,000 金币）
    case 'map_clear': return (st.mapClear||[]).length;
    case 'refine7': return st.refine7||0;
    case 'craft53': return st.craftCount||0;
    case 'jubao': return st.crystalTotal||0;
  }
  return 0;
}
function achDone(key){ const p=state.player; return !!(p.ach && p.ach[key]); }
function grantAchievement(a){
  const p=state.player;
  p.ach[a.key]={t:Date.now()};
  if(a.reward_coins) p.gold += a.reward_coins;
  if(a.reward_coupon) p.crystal += a.reward_coupon;
  for(const ri_ of (a.reward_items||[])) addToBag({type:'consumable', key:ri_.key, count:ri_.count||1});
  log('<span class="lv">成就达成：'+a.name+'（'+(a.reward_coins? fmtNum(a.reward_coins)+'金币 ':'')+((a.reward_items||[]).length? (a.reward_items||[]).map(r=>itemName(r.key)+'x'+r.count).join('、'):'')+'）</span>');
  eventLog('<span class="lv">成就 '+a.name+'</span>');
}
function checkAchievements(){
  const p=state.player; if(!p || !p.ach) return;
  for(const a of achList()){
    if(achDone(a.key)) continue;
    if(achValue(a) >= (a.target||1)) grantAchievement(a);
  }
  // 成就数量型称号（解锁 N 个成就）在这里一并检查
  checkTitles();
}

// ---------- 宝石炼制 / 药水炼制 ----------
function gemRecipeFor(series, grade){
  const gr=DATA.gem_recipes||{};
  for(const k in gr){ const r=gr[k]; if(r.series===series && r.src_grade===grade) return r; }
  return null;
}
function doGemRefine(series, grade){
  const p=state.player;
  const r=gemRecipeFor(series, grade);
  if(!r){ log('<span class="dmg">无对应炼制配方</span>'); return; }
  if(p.level < (r.level_required||0)){ log('<span class="dmg">等级不足（需 Lv.'+r.level_required+'）</span>'); return; }
  if(gemCount(series, grade) < 4){ log('<span class="dmg">需要 '+r.src_name+' x4</span>'); return; }
  if(!useMaterial(r.bottle_key||'lianhua_ping', 1)){ log('<span class="dmg">需要炼化瓶 x1</span>'); return; }
  gemConsume(series, grade, 4);
  addToBag({type:'gem', series:series, grade:r.dst_grade, count:1});
  log('<span class="loot">炼制成功：'+r.dst_name+' x1</span>');
  eventLog('炼制宝石 <span class="loot">'+r.dst_name+'</span>');
  renderTab();
}
function doPotionRefine(recipeKey){
  const p=state.player;
  const r=(DATA.potion_recipes||{})[recipeKey];
  if(!r){ log('<span class="dmg">无此配方</span>'); return; }
  if(p.level < (r.level_required||0)){ log('<span class="dmg">等级不足（需 Lv.'+r.level_required+'）</span>'); return; }
  const c=r.cost||{};
  if(c.hp_potion && itemCount(c.hp_potion.key) < c.hp_potion.count){ log('<span class="dmg">需要 '+itemName(c.hp_potion.key)+' x'+c.hp_potion.count+'</span>'); return; }
  if(c.mp_potion && itemCount(c.mp_potion.key) < c.mp_potion.count){ log('<span class="dmg">需要 '+itemName(c.mp_potion.key)+' x'+c.mp_potion.count+'</span>'); return; }
  if(c.crystal && p.crystal < c.crystal.count){ log('<span class="dmg">需要神秘结晶 x'+c.crystal.count+'</span>'); return; }
  if(c.bottle && !useMaterial(c.bottle.key, c.bottle.count||1)){ log('<span class="dmg">需要炼化瓶 x'+(c.bottle.count||1)+'</span>'); return; }
  if(c.hp_potion) itemConsume(c.hp_potion.key, c.hp_potion.count);
  if(c.mp_potion) itemConsume(c.mp_potion.key, c.mp_potion.count);
  if(c.crystal) useCrystal(c.crystal.count);
  addToBag({type:'consumable', key:r.result_item, count:r.result_count||1});
  log('<span class="loot">炼制成功：'+r.result_name+' x'+(r.result_count||1)+'</span>');
  renderTab(); renderHeader();
}
// 资源增减
function addOre(k,n){ const p=state.player; p.ores[k]=(p.ores[k]||0)+n; }
function useOre(k,n){ const p=state.player; if((p.ores[k]||0)>=n){ p.ores[k]-=n; return true; } return false; }
function addCrystal(n){ state.player.crystal+=n; }
function useCrystal(n){ if(state.player.crystal>=n){ state.player.crystal-=n; return true; } return false; }
function addMaterial(k,n){ const p=state.player; p.materials[k]=(p.materials[k]||0)+n; }
function useMaterial(k,n){ const p=state.player; if((p.materials[k]||0)>=n){ p.materials[k]-=n; return true; } return false; }

// ---- ① 打造 ----
function doForge(){
  const p=state.player;
  const slot=LS.forgeSlot;
  const tier=clamp(parseInt(LS.forgeTier,10)||1,1,7);
  const oreKey=ORE_BY_TIER[tier-1];
  const oreCost=3+tier*2, goldCost=tier*150;
  const base=genEquipBaseForSlot(slot, p.job, tier);
  if(!base){ log('<span class="dmg">该职业/部位暂无 '+tier+' 档基底</span>'); return; }
  const mode=LS.forgeMode||'random';
  const goldNeeded = Math.round(goldCost * (mode==='full_perk'? 2 : 1));
  if(!useOre(oreKey, oreCost)){ log('<span class="dmg">矿石不足：需 '+ORE_NAME[oreKey]+' x'+oreCost+'（拥有 '+(p.ores[oreKey]||0)+'）</span>'); return; }
  if(p.gold<goldNeeded){ log('<span class="dmg">金币不足，打造需 '+fmtNum(goldNeeded)+'</span>'); return; }
  p.gold-=goldNeeded;
  const eq=buildEquip(base, p.job, tier, slot, mode);
  const cm=DATA.craft;
  if(eq.perks.length>cm.craft_max_attr) eq.perks.length=cm.craft_max_attr;
  if(eq.sockets>cm.craft_max_slots) eq.sockets=cm.craft_max_slots;
  eq.gems=new Array(eq.sockets).fill(null);
  addToBag(eq);
  p.stats.craftCount=(p.stats.craftCount||0)+1;
  log('<span class="loot">打造成功：'+SLOT_NAME[slot]+'·'+eq.name+' ['+QNAME[eq.quality]+']（'+ORE_NAME[oreKey]+' x'+oreCost+' + '+fmtNum(goldNeeded)+'金）</span>');
  checkAchievements();
  refreshStats(); renderHeader(); renderTab();
}
// ---- ② 百炼丹炼制链 ----
function doBailianCraft(L){
  const p=state.player;
  const r=DATA.bailian_recipes['level_'+L]; if(!r) return;
  if(!useMaterial('lianhua_ping',1)){ log('<span class="dmg">需要 炼化瓶 x1</span>'); return; }
  let shi=0; for(const m of r.materials) if(m.key==='bailian_shi') shi+=m.count;
  if(!useMaterial('bailian_shi',shi)){ log('<span class="dmg">需要 百炼石 x'+shi+'</span>'); return; }
  let cry=0; for(const m of r.materials) if(m.kind==='crystal') cry+=m.count;
  if(cry && !useCrystal(cry)){ log('<span class="dmg">需要 晶石(神秘结晶) x'+cry+'</span>'); return; }
  const lowL=L-1;
  if(lowL>=1){
    const have=p.bag.filter(b=>b.type==='consumable'&&b.key==='bailian_dan_'+lowL);
    if(have.length<2){ log('<span class="dmg">需要 百炼丹·'+cn(lowL)+' x2</span>'); return; }
    for(let i=0;i<2;i++){ const d=have[i]; d.count--; if(d.count<=0) p.bag=p.bag.filter(b=>b.uid!==d.uid); }
  }
  addToBag({uid:uid(), type:'consumable', key:r.result_item, count:1});
  log('<span class="loot">炼制成功：'+r.result_name+'</span>');
  renderHeader(); renderTab();
}
// ---- ③ 百炼装备升阶 ----
function doBailianUse(){
  const p=state.player;
  const u=LS.bailEquip; if(!u){ log('<span class="dmg">请先选择要百炼的装备</span>'); return; }
  const it=findItem(u); if(!it||it.type!=='equip'){ log('<span class="dmg">装备不存在</span>'); return; }
  const cap=DATA.craft.craft_upgrade_max_tier;
  if(it.bailian>=cap){ log('<span class="dmg">'+it.name+' 已达百炼上限 +'+cap+'</span>'); return; }
  const needL=it.bailian+1;
  const have=p.bag.filter(b=>b.type==='consumable'&&b.key==='bailian_dan_'+needL);
  if(!have.length){ log('<span class="dmg">需要 百炼丹·'+cn(needL)+'（背包不足）</span>'); return; }
  const dan=have[0]; dan.count--; if(dan.count<=0) p.bag=p.bag.filter(b=>b.uid!==dan.uid);
  it.bailian=needL;
  for(const s in it.stats) it.stats[s]=Math.round(it.stats[s]*1.15);
  if(Math.random()<0.5){
    const pool=DATA.perk_pool[it.job+'_general_pool']||DATA.perk_pool['warrior_general_pool'];
    const all=(pool.stat_fixed||[]).concat(pool.stat_percent||[],pool.atk_fixed||[]);
    if(all.length){ const sf=pick(all); const vals=sf.values[''+it.tier]||sf.values['1']||[1,1]; it.perks.push({name:sf.name, suffix:sf.suffix||'', value:ri(vals[0],vals[1])}); }
  }
  refreshStats();
  log('<span class="loot">百炼成功！'+it.name+' 提升至 +'+needL+'（属性大幅增强）</span>');
  renderHeader(); renderTab();
}
// ---- ④ 提取回收 ----
function doExtract(){
  const p=state.player;
  const u=LS.extractEquip; if(!u){ log('<span class="dmg">请先选择要提取的装备</span>'); return; }
  const it=findItem(u); if(!it||it.type!=='equip'){ log('<span class="dmg">装备不存在</span>'); return; }
  const oreKey=ORE_BY_TIER[(it.tier||1)-1];
  const amt=DATA.extract.ore_per_equip||1;
  addOre(oreKey, amt);
  log('<span class="loot">提取 '+it.name+'，回收 '+ORE_NAME[oreKey]+' x'+amt+'</span>');
  for(const g of (it.gems||[])) if(g){ addToBag({uid:uid(), type:'gem', series:g.series, grade:g.grade}); log('回收宝石 <span class="loot">'+gemSeriesName(g.series)+'·'+g.grade+'</span>'); }
  removeItem(it);
  refreshStats(); renderHeader(); renderTab();
}
// ---- ⑤ 矿石炼制 ----
function doOreRefine(){
  const p=state.player;
  const key=LS.oreRecipe; if(!key){ log('<span class="dmg">请选择矿石炼制配方</span>'); return; }
  const r=DATA.ore_recipes[key]; if(!r) return;
  const c=r.cost;
  if(!useOre(c.ore.key, c.ore.count)){ log('<span class="dmg">矿石不足：需 '+oreName(c.ore.key)+' x'+c.ore.count+'</span>'); return; }
  if(!useCrystal(c.crystal.count)){ log('<span class="dmg">晶石(神秘结晶)不足：需 '+c.crystal.count+'</span>'); return; }
  if(p.gold<c.coin){ log('<span class="dmg">金币不足，需 '+fmtNum(c.coin)+'</span>'); return; }
  p.gold-=c.coin;
  addOre(r.result_item, r.result_count);
  log('<span class="loot">矿石炼制成功：'+oreName(r.result_item)+' x'+r.result_count+'</span>');
  renderHeader(); renderTab();
}
// ---- ⑥ 乾坤炉合成 ----
function doFurnace(){
  const p=state.player;
  const key=LS.furnace; if(!key){ log('<span class="dmg">请选择乾坤炉配方</span>'); return; }
  const r=DATA.furnace_recipes[key]; if(!r) return;
  if(ORE_KEYS.has(r.src_key)){ if(!useOre(r.src_key, r.src_count)){ log('<span class="dmg">材料不足：需 '+oreName(r.src_key)+' x'+r.src_count+'</span>'); return; } }
  else { if(!useMaterial(r.src_key, r.src_count)){ log('<span class="dmg">材料不足：需 '+itemName(r.src_key)+' x'+r.src_count+'</span>'); return; } }
  if(p.gold<(r.gold_cost||0)){ log('<span class="dmg">金币不足，需 '+fmtNum(r.gold_cost||0)+'</span>'); return; }
  p.gold-=(r.gold_cost||0);
  if(ORE_KEYS.has(r.result_key)) addOre(r.result_key, r.result_count);
  else addMaterial(r.result_key, r.result_count);
  log('<span class="loot">乾坤炉合成：'+itemName(r.result_key)+' x'+r.result_count+'</span>');
  renderHeader(); renderTab();
}
// ---- 材料商店 ----
function buyMaterial(key, price){
  const p=state.player;
  if(p.gold<price){ log('<span class="dmg">金币不足（需 '+fmtNum(price)+'）</span>'); return; }
  p.gold-=price;
  if(ORE_KEYS.has(key)) addOre(key,1); else addMaterial(key,1);
  log('<span class="loot">购入 '+itemName(key)+(ORE_KEYS.has(key)?'矿石':'')+'</span>');
  renderHeader(); renderTab();
}

function bindTabClicks(){
  const el=$('tab-pane');
  el.querySelectorAll('[data-item]').forEach(d=> d.onclick=()=>{
    const it=findItem(d.getAttribute('data-item')); if(!it) return;
    if(it.type==='consumable'){ useConsumable(it); return; }
    if(it.type==='equip'){
      if(window._pendingGem){ doInlay(it, window._pendingGem); window._pendingGem=null; const t=$('inlay-target'); if(t) t.textContent='已镶嵌'; return; }
      equipItem(it); log('装备了 '+it.name);
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
    else if(a==='logout'){ await cloudLogout(); log('<span class="sys">已退出账号</span>'); renderTab(); }
    else if(a==='save'){ const slot=parseInt(d.getAttribute('data-slot'),10); const r=await cloudSave(slot, true);
      log(r.ok? ('<span class="loot">已保存到云端槽位 '+slot+'</span>') : ('<span class="dmg">保存失败：'+r.msg+'</span>')); state.cloud.slot=slot; persistCloud(); renderTab(); }
    else if(a==='load'){ const slot=parseInt(d.getAttribute('data-slot'),10); const r=await cloudLoad(slot);
      if(r.ok){ state.cloud.slot=slot; persistCloud(); refreshStats(); renderAll(); log('<span class="loot">'+r.msg+'</span>'); }
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
function findItem(uid){
  const p=state.player;
  for(const s in p.equip) if(p.equip[s]&&p.equip[s].uid===uid) return p.equip[s];
  return p.bag.find(b=>b.uid===uid);
}

// 装备面板也支持镶嵌（点击已装备或背包装备触发选为镶嵌目标）
function startZone(mapKey, zoneKey, isBoss, bossKey){
  const p=state.player;
  const map=DATA.maps.maps.find(m=>m.key===mapKey);
  if(!map) return false;
  if(isBoss){
    if(map.boss_zone){
      if(p.level < map.boss_zone.unlock_level){ log('<span class="danger">等级不足</span>'); return false; }
    }else{
      // 副本首领：进入等级门槛 + 每日次数限制
      const b=dungeonBosses(map).find(x=>x.key===bossKey);
      if(!b){ log('<span class="dmg">无此副本首领</span>'); return false; }
      if(p.level < (map.enter_level_min||0)){ log('<span class="danger">等级不足（'+map.name+'需 Lv.'+map.enter_level_min+'）</span>'); return false; }
      if(!consumeDungeonEntry(map)){ log('<span class="dmg">今日进入次数已用完（每日 '+(map.daily_enter_limit||0)+' 次）</span>'); return false; }
    }
  }
  state.zone={mapKey, zoneKey, isBoss, bossKey};
  state.combat=null;
  log('<span class="sys">开始挂机：'+zoneName(state.zone)+'</span>');
  setIdle(true);
  renderMap(); renderHeader();
  return true;
}

// ---------- 主循环 ----------
let timer=null;
function setIdle(on){
  state.idle=on;
  $('btn-toggle').textContent = on?'暂停挂机':'开始挂机';
  $('btn-toggle').classList.toggle('primary', !on);
}
function loop(){
  if(!state.idle) return;
  if(!state.zone){ setIdle(false); log('<span class="danger">请先在左侧选择一个区域开始挂机。</span>'); return; }
  const steps = state.speed;
  for(let i=0;i<steps;i++) tick();
  maybeAutoZone();        // P0：定期按经验/秒自动换区
  maybeAutoSalvage();     // 包裹将满时自动分解白/绿装（回收矿石/宝石，避免被静默丢弃）
  // 头部与角色面板刷新（HP/MP/EXP）每轮
  renderHeader(); renderHero();
}

// ---------- 存档 ----------
const SAVE_KEY='menghuihuaxia_idle_save_v1';
// 构造存档数据：本地 localStorage 与云端共用同一份结构
function buildSavePayload(){
  const p=state.player;
  return { name:p.name, job:p.job, level:p.level, exp:p.exp, gold:p.gold, crystal:p.crystal, hp:p.hp, mp:p.mp,
    map:p.map, unlocked:p.unlocked, equip:p.equip, bag:p.bag, kills:state.kills, quests:p.quests||{},
    ores:p.ores, materials:p.materials, wuhunSlots:p.wuhunSlots||[null,null], shenmo:p.shenmo||null,
    skills:p.skills||{}, passives:p.passives||{}, events:state.events.slice(-12), _uid:_uid,
    summon:p.summon||null, mining:p.mining||{level:1,exp:0}, stats:p.stats||{}, ach:p.ach||{}, mine:state.mine||null,
    titles:p.titles||{}, equippedTitle:p.equippedTitle||null, crystals:p.crystals||{}, power:powerScore(p), v:2, ts:Date.now(), rate:idleRate() };
}
// 应用存档数据（本地读档与云端读档共用）
function applySavePayload(d){
  state.player={ name:d.name, job:d.job, level:d.level, exp:d.exp, gold:d.gold, crystal:d.crystal||0, hp:d.hp, mp:d.mp,
    map:d.map, unlocked:d.unlocked||{}, equip:d.equip||{}, bag:d.bag||[], quests:d.quests||{},
    ores:d.ores||{}, materials:d.materials||{},
    wuhunSlots:d.wuhunSlots||[null,null], shenmo:d.shenmo||null,
    skills:d.skills||{}, passives:d.passives||{}, skillCd:{}, _s:null,
    summon:d.summon||null, mining:d.mining||{level:1, exp:0},
    stats:d.stats||{kills:0, killType:{}, mapKills:{}, mapClear:[], mapBoss:{}, dungeonEnter:{}, zoneKills:{}, minionKills:{}, refine7:0, craftCount:0, crystalTotal:0}, ach:d.ach||{}, titles:d.titles||{}, equippedTitle:d.equippedTitle||null, crystals:d.crystals||{} };
  state.kills=d.kills||0; _uid=d._uid||1; state.events=d.events||[];
  state.mine = d.mine||null;
  state._loadedTs = d.ts||null;       // 离线收益：读取上次存档时间
  state._loadedRate = d.rate||null;   // 离线收益：读取上次挂机速率
  if(state.player.shenmo){ state.player.shenmo.nodes=state.player.shenmo.nodes||{}; state.player.shenmo.cd=state.player.shenmo.cd||{}; }
  consolidateBag(); // 兼容旧存档：合并同类可叠加物品（装备不合并）
  refreshStats();
  state.player.hp=Math.min(state.player.hp, state.player._s.max_hp);
}
function save(quiet){
  if(!state.player) return;
  localStorage.setItem(SAVE_KEY, JSON.stringify(buildSavePayload()));
  if(!quiet) log('<span class="sys">已存档</span>');
}
function load(){
  const s=localStorage.getItem(SAVE_KEY); if(!s) return false;
  try{ applySavePayload(JSON.parse(s)); return true; }catch(e){ return false; }
}

// ---------- 本地存档 导出 / 导入（云存档之外的兜底，防浏览器清档丢档） ----------
// 读取本地存档时间戳（可能为 null / 解析失败）
function localSaveStamp(){
  try{ const s=localStorage.getItem(SAVE_KEY); if(!s) return null; const d=JSON.parse(s); return (d&&d.ts)||null; }
  catch(e){ return null; }
}
// 校验导入的存档结构，坏档不许覆盖好档
function validateSavePayload(d){
  if(!d || typeof d!=='object' || Array.isArray(d)) return {ok:false, msg:'不是有效的存档对象'};
  if(typeof d.name!=='string' || !d.name) return {ok:false, msg:'缺少角色名'};
  if(typeof d.job!=='string' || !d.job) return {ok:false, msg:'缺少职业'};
  if(typeof d.level!=='number' || !(d.level>=1)) return {ok:false, msg:'等级字段异常'};
  if(typeof d.gold!=='number' || !isFinite(d.gold)) return {ok:false, msg:'金币字段异常'};
  if(typeof d.exp!=='number' || !isFinite(d.exp)) return {ok:false, msg:'经验字段异常'};
  return {ok:true, msg:''};
}
// 导出文件名：梦回华夏_角色名_职业Lv_时间.json
function exportFileName(){
  const p=state.player, d=new Date(), pad=n=>('0'+n).slice(-2);
  const stamp=d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+'_'+pad(d.getHours())+pad(d.getMinutes());
  const safe=String(p.name||'游侠').replace(/[\\/:*?"<>|\s]/g,'_');
  return '梦回华夏_'+safe+'_'+jobCn(p.job)+'Lv'+p.level+'_'+stamp+'.json';
}
// 导出为可下载的 .json 文件
function exportSaveFile(){
  if(!state.player) return {ok:false, msg:'无角色'};
  const text=JSON.stringify(buildSavePayload());
  const fname=exportFileName();
  try{
    const blob=new Blob([text], {type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download=fname;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>{ try{ URL.revokeObjectURL(url); }catch(e){} }, 4000);
    log('<span class="loot">已导出本地存档：'+fname+'（'+text.length+' 字节）</span>');
    return {ok:true, msg:fname};
  }catch(e){
    log('<span class="dmg">导出失败：'+(e&&e.message||e)+'，可改用「复制存档」。</span>');
    return {ok:false, msg:'下载失败'};
  }
}
// 复制存档文本到剪贴板；不可用时回填到文本框由用户手动复制
async function copySaveText(){
  if(!state.player) return {ok:false, msg:'无角色'};
  const text=JSON.stringify(buildSavePayload());
  try{
    if(!(navigator.clipboard && navigator.clipboard.writeText)) throw new Error('no clipboard');
    await navigator.clipboard.writeText(text);
    log('<span class="loot">存档已复制到剪贴板（'+text.length+' 字节），可粘贴保存。</span>');
    return {ok:true, msg:'copied'};
  }catch(e){
    const ta=$('save-text');
    if(ta){ ta.value=text; log('<span class="sys">浏览器不允许自动写剪贴板，已把存档填入下方文本框，请手动复制。</span>'); }
    else log('<span class="dmg">复制失败，请改用「导出存档文件」。</span>');
    return {ok:false, msg:'fallback'};
  }
}
// 从 JSON 文本导入存档（二次确认，校验通过才落盘）
function importSaveText(txt){
  if(!txt || !String(txt).trim()){ log('<span class="dmg">没有可导入的内容。</span>'); return {ok:false, msg:'空内容'}; }
  let d;
  try{ d=JSON.parse(txt); }catch(e){ log('<span class="dmg">导入失败：不是合法的 JSON 文本。</span>'); return {ok:false, msg:'JSON 解析失败'}; }
  const v=validateSavePayload(d);
  if(!v.ok){ log('<span class="dmg">导入失败：存档校验不通过（'+v.msg+'）。</span>'); return {ok:false, msg:v.msg}; }
  const cur = state.player ? (state.player.name+' '+jobCn(state.player.job)+' Lv.'+state.player.level) : '（当前无角色）';
  if(!confirm('导入将覆盖当前角色：'+cur+'\n\n即将导入：'+d.name+' '+jobCn(d.job)+' Lv.'+d.level+'\n\n确定继续？')) {
    log('<span class="sys">已取消导入。</span>'); return {ok:false, msg:'用户取消'};
  }
  applySavePayload(d);
  state._loadedTs=null; state._loadedRate=null;   // 导入后不触发离线补算
  state.zone=null; state.combat=null; state.idle=false;
  save(true);
  const ov=$('overlay'); if(ov) ov.style.display='none';
  renderAll();
  log('<span class="loot">已导入存档：'+d.name+' '+jobCn(d.job)+' Lv.'+d.level+'（战力 '+fmtNum(powerScore(state.player))+'）</span>');
  return {ok:true, msg:'ok'};
}
// 从 <input type="file"> 读文件后导入
function importSaveFile(file){
  if(!file){ log('<span class="dmg">没有选择文件。</span>'); return; }
  if(typeof FileReader==='undefined'){ log('<span class="dmg">当前环境不支持读取文件，请改用「导入文本」。</span>'); return; }
  const rd=new FileReader();
  rd.onload=()=>{ importSaveText(String(rd.result||'')); };
  rd.onerror=()=>{ log('<span class="dmg">读取文件失败。</span>'); };
  try{ rd.readAsText(file,'utf-8'); }catch(e){ log('<span class="dmg">读取文件失败：'+(e&&e.message||e)+'</span>'); }
}

// ---------- 离线收益（离线挂机也能赚） ----------
const OFFLINE_MAX_SEC = 12*3600;   // 最多补算 12 小时
const OFFLINE_EFF = 0.5;           // 离线效率 50%
// 当前（或最优）区域的每秒收益：经验/秒来自 zoneEval，金币/秒按平均金币 ÷ 击杀耗时
function idleRate(){
  const p=state.player; if(!p||!p._s) return {exp:0, gold:0};
  let z = state.zone;
  if(!z){ const b=bestZone(); if(b) z={mapKey:b.mapKey, zoneKey:b.zoneKey, isBoss:b.isBoss}; }
  if(!z) return {exp:0, gold:0};
  const map=DATA.maps.maps.find(m=>m.key===z.mapKey); if(!map) return {exp:0, gold:0};
  const keys=zoneKeys(map, z.zoneKey, z.isBoss)||[];
  const a=zoneMonsterAvg(keys); if(!a) return {exp:0, gold:0};
  const ttk=Math.max(0.8, a.hp/playerDps());
  const expPerSec = zoneEval(z.mapKey, z.zoneKey, z.isBoss);
  const goldPerSec = ((a.gold_min||0)+(a.gold_max||0))/2 / ttk;
  return { exp: Math.max(0,expPerSec||0), gold: Math.max(0,goldPerSec) };
}
// 启动补算离线收益（在 load 之后调用）
function applyOfflineEarnings(){
  const p=state.player;
  if(!p || !state._loadedTs) return;
  const away = (Date.now() - state._loadedTs)/1000;
  state._loadedTs = null;
  if(away < 60) return;                  // 离开不足 1 分钟不算
  const earnSec = Math.min(away, OFFLINE_MAX_SEC);
  const rate = state._loadedRate || idleRate();
  const expGain = Math.floor((rate.exp||0) * earnSec * OFFLINE_EFF);
  const goldGain = Math.floor((rate.gold||0) * earnSec * OFFLINE_EFF);
  if(expGain>0) gainExp(expGain);
  if(goldGain>0) p.gold += goldGain;
  renderHeader(); renderHero(); renderTab();
  if(expGain>0 || goldGain>0) showOfflineModal(away, earnSec, expGain, goldGain);
}
function showOfflineModal(awaySec, earnSec, exp, gold){
  const el=$('offline-modal'); if(!el) return;
  const fmtTime = s=>{ const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), ss=Math.floor(s%60);
    if(h>0) return h+' 小时 '+m+' 分'; if(m>0) return m+' 分 '+ss+' 秒'; return ss+' 秒'; };
  $('offline-summary').innerHTML = '你离开了 <b>'+fmtTime(awaySec)+'</b>（按 '+Math.round(OFFLINE_EFF*100)+'% 效率结算 '+fmtTime(earnSec)+'）<br>'+
    '离线挂机收益：经验 <b style="color:var(--gold)">'+fmtNum(exp)+'</b> · 金币 <b style="color:var(--gold)">'+fmtNum(gold)+'</b>';
  el.style.display='flex';
  const btn=$('offline-close'); if(btn) btn.onclick=()=>{ el.style.display='none'; renderHeader(); renderHero(); renderTab(); };
}

// ---------- 自动挂机（P0 闭环） ----------
const HP_POTIONS = ['xumingdan','xuming_xiao','xuming_da','xuming_sanqing','xuming_jiuzhuan','xuming_longxian'];
const MP_POTIONS = ['ningshenye','ningshen_lingfu','ningshen_yuquan','ningshen_sanhua','ningshen_jiuzhuan','ningshen_longxian'];
function potionTier(level){          // 按角色等级挑合适的药水档位（0~5）
  if(level<20) return 0; if(level<40) return 1; if(level<60) return 2;
  if(level<80) return 3; if(level<100) return 4; return 5;
}
function itemPrice(key){ const d=(DATA.items.items||[]).find(i=>i.key===key); return d? (d.price||0) : 0; }
// 找背包里该 key 的第一瓶药
function findPotion(key){
  const p=state.player;
  return p.bag.find(b=> b.type==='consumable' && b.key===key && (b.count||0)>0) || null;
}
// 自动补给：按 items.json 价格买一瓶（优先选买得起的最高档）
function buyPotion(list, tier){
  const p=state.player;
  for(let t=tier; t>=0; t--){
    const k=list[t], price=itemPrice(k);
    if(price>0 && p.gold>=price){
      p.gold-=price;
      const found=p.bag.find(b=> b.type==='consumable' && b.key===k);
      if(found) found.count=(found.count||1)+1;
      else addToBag({type:'consumable', key:k, count:1});
      log('<span class="sys">自动补给：'+itemName(k)+' x1（-'+fmtNum(price)+'金）</span>');
      return true;
    }
  }
  return false;
}
// 自动喝药：低血/低蓝时喝，药水不足自动购买
function autoPotion(){
  const p=state.player, A=state.auto;
  if(!A.potion || !p || !p._s) return;
  const tier=potionTier(p.level);
  if(p.hp < p._s.max_hp*(A.hp/100)){
    let k=HP_POTIONS[tier], it=findPotion(k);
    if(!it && A.buy && buyPotion(HP_POTIONS, tier)) it=findPotion(k);
    if(!it){ // 高等级药没有就往下找一瓶能用的
      for(let t=tier-1;t>=0 && !it;t--){ it=findPotion(HP_POTIONS[t]); if(it) k=HP_POTIONS[t]; }
    }
    if(it) useConsumable(it);
  }
  if(p.mp < p._s.max_mp*(A.mp/100)){
    let k=MP_POTIONS[tier], it=findPotion(k);
    if(!it && A.buy && buyPotion(MP_POTIONS, tier)) it=findPotion(k);
    if(!it){ for(let t=tier-1;t>=0 && !it;t--){ it=findPotion(MP_POTIONS[t]); if(it) k=MP_POTIONS[t]; } }
    if(it) useConsumable(it);
  }
}

// ---------- 自动换区：按「经验/秒」挑最优区域 ----------
function zoneMonsterAvg(keys){
  let lv=0, exp=0, hp=0, n=0;
  for(const k of (keys||[])){
    const m=getMonster(k); if(!m) continue;
    lv+=m.level||0; exp+=m.exp||0; hp+=m.hp||0; n++;
  }
  if(!n) return null;
  return { level:lv/n, exp:exp/n, hp:hp/n };
}
function playerDps(){
  const p=state.player, s=p._s||{};
  return Math.max(1, (s.main||1) * 1.4 + 10);   // 含技能加成的粗估
}
// 区域出怪列表（与实际遭遇一致：小怪 + 1 只精英；首领区未清剿完时以清剿对象计）
function zoneKeys(map, zoneKey, isBoss){
  if(!map) return null;
  if(isBoss){
    if(!map.boss_zone) return null;
    if(bossZoneCleared(map)) return map.boss_zone.boss|| [];
    return (map.boss_zone.monsters||[]).concat((map.boss_zone.elite_monsters||[]).slice(0,1));
  }
  const z=(map.zones||[]).find(zz=>zz.key===zoneKey); if(!z) return null;
  return (z.monsters||[]).concat((z.elite_monsters||[]).slice(0,1));
}
// 区域「打穿一轮」的产出：经验走 monsterExp（与实际掉落同源，含类型倍率与等级差缩放），
// HP 用于估算耗时。角色等级超出怪物上限时各区经验都会是 0（exp=0）。
function zoneYield(keys, playerLevel){
  let exp=0, hp=0, n=0;
  for(const k of (keys||[])){
    const m=getMonster(k); if(!m) continue;
    exp += monsterExp(m, playerLevel); hp += (m.hp||0); n++;
  }
  return n? {exp, hp, n} : null;
}
// 评估某区域收益：返回经验/秒，不可打返回 -1
function zoneEval(mapKey, zoneKey, isBoss){
  const p=state.player;
  const map=DATA.maps.maps.find(m=>m.key===mapKey); if(!map) return -1;
  if(isBoss && p.level < (map.boss_zone? (map.boss_zone.unlock_level||0) : 0)) return -1;
  const keys=zoneKeys(map, zoneKey, isBoss); if(!keys) return -1;
  const a=zoneMonsterAvg(keys); if(!a) return -1;
  if(a.level > p.level+8) return -1;                       // 太强打不过
  const y=zoneYield(keys, p.level); if(!y) return -1;
  const exp=y.exp*(isBoss? 0.9 : 1);                       // 首领区略折（要走机制，实际更慢）
  const ttk=Math.max(0.8, y.hp/playerDps());               // 估算击杀耗时（秒等效）
  if(p.hp>0 && a.level > p.level+3 && p._s && a.hp > p._s.max_hp*0.9) return -1;  // 容易被打死
  return exp/ttk;
}
function bestZone(){
  const p=state.player; let best=null, fb=null;
  const consider=(map, zoneKey, isBoss, name)=>{
    const mk=map.key;
    const sc=zoneEval(mk, zoneKey, isBoss);
    if(sc>0){
      if(!best || sc>best.score) best={mapKey:mk, zoneKey, isBoss, score:sc, name};
      return;
    }
    // 保底：角色等级超出怪物上限后（最高怪 Lv120，怪低 5 级即 0 经验）所有区域经验都为 0，
    // 此时仍要能继续挂机刷金币/材料，退化为「均怪等级最高且打得过」的区域。
    const keys=zoneKeys(map, zoneKey, isBoss); if(!keys) return;
    const a=zoneMonsterAvg(keys); if(!a || a.level > p.level+8) return;
    if(!fb || a.level>fb.lv) fb={mapKey:mk, zoneKey, isBoss, name, lv:a.level};
  };
  // 遍历全部地图：只要 unlock_map 前置满足即可前往（travelTo 会自动解锁），
  // 等级门槛由 zoneEval 过滤，这样挂机才能随等级自动推进到新地图。
  for(const map of (DATA.maps.maps||[])){
    if(map.unlock_map && !p.unlocked[map.unlock_map]) continue;
    if(!(map.zones||[]).length && !map.boss_zone) continue;
    for(const z of (map.zones||[])) consider(map, z.key, false, map.name+' · '+(z.name||z.key));
    if(map.boss_zone) consider(map, null, true, map.name+' · 首领');
  }
  if(best) return best;
  return fb? {mapKey:fb.mapKey, zoneKey:fb.zoneKey, isBoss:fb.isBoss, score:0, name:fb.name} : null;
}
function autoZone(force){
  const A=state.auto, p=state.player;
  if(!A.zone || !p) return;
  const b=bestZone(); if(!b) return;
  const cur=state.zone;
  const same = cur && cur.mapKey===b.mapKey && cur.zoneKey===b.zoneKey && cur.isBoss===b.isBoss;
  if(same && !force) return;
  if(p.map!==b.mapKey){ travelTo(b.mapKey); }
  state.zone={mapKey:b.mapKey, zoneKey:b.zoneKey, isBoss:b.isBoss};
  state.combat=null;
  log('<span class="sys">自动换区 → '+zoneName(state.zone)+'（预估 '+b.score.toFixed(1)+' 经验/秒）</span>');
  renderMap(); renderHeader();
}
// 升到新等级时重新评估区域（异步，避免打断当前结算）
function autoZoneOnLevelUp(){ if(state.auto.zone) setTimeout(()=>autoZone(false), 0); }
// 挂机中定期评估：每 30 tick 一次、且只在非战斗中切换，避免打断战斗
let _lastZoneTick = -999;
function maybeAutoZone(){
  if(!state.auto.zone || !state.player) return;
  if(state.combat) return;
  if(state.ticks - _lastZoneTick < 30) return;
  _lastZoneTick = state.ticks;
  autoZone(false);
}

// ---------- 挂机统计与后端上报 ----------
function sessBump(field, n, key){
  const S=state.sess;
  if(field==='drop'){
    S.drops[key]=(S.drops[key]||0)+(n||0);
    if(!S.dropTotal) S.dropTotal={};                       // 兼容旧 state
    S.dropTotal[key]=(S.dropTotal[key]||0)+(n||0);          // 累计版（不被上报清零）
  }
  else S[field]=(S[field]||0)+(n||0);
}
// 记录升级时间点（用于「升级时间线」图）
function sessLevelUp(level){
  const S=state.sess;
  if(!S.levelUps) S.levelUps=[];
  const last=S.levelUps[S.levelUps.length-1];
  if(last && last.level===level) return;
  S.levelUps.push({ t:Date.now(), level });
  if(S.levelUps.length>60) S.levelUps.shift();
}
function sessPerMin(){
  const S=state.sess, min=Math.max(1/60,(Date.now()-S.t0)/60000);
  return { kills:Math.round(S.kills/min*10)/10, exp:Math.round(S.exp/min), gold:Math.round(S.gold/min),
    minutes:Math.round(min*10)/10 };
}
// 本局趋势采样：每隔一段时间记录一帧（战力 / 经验·分 / 金币·分），用于折线图
function sessSample(){
  const S=state.sess, p=state.player;
  if(!p || !p._s) return;
  const pm=sessPerMin();
  S.history.push({ t:Date.now(), power:powerScore(p), expPerMin:pm.exp, goldPerMin:pm.gold });
  if(S.history.length>120) S.history.shift();   // 最多保留 1 小时（30s 一帧）
}
async function reportStats(force){
  if(!state.auto.stats || !state.cloud.ok || !state.player) return;
  const S=state.sess, now=Date.now();
  if(!force && now-S.lastReport < 60000) return;
  const seconds=(now-S.lastReport)/1000;
  S.lastReport=now;
  const body={ job:state.player.job, level:state.player.level, kills:S.kills, exp:S.exp, gold:S.gold,
    seconds, deaths:S.deaths, drops:S.drops, samples:1 };
  S.kills=0; S.exp=0; S.gold=0; S.drops={}; S.deaths=0;
  try{ await apiCall('/api/stats',{method:'POST', body}); }catch(e){}
}

// ---------- 启动 ----------
function newPlayer(name, job){
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

function showJobPicker(){
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
function setAuthMsg(txt, bad){
  const el=$('auth-msg');
  if(el) el.innerHTML = (bad? '<span style="color:var(--red)">':'')+txt+(bad? '</span>':'');
}
function wireAuthUI(){
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
function renderCloudResume(){
  const box=$('cloud-resume'); if(!box) return;
  const used=(state.cloud.slots||[]).filter(s=>!s.empty);
  if(!used.length){ box.innerHTML='<span class="muted">云端暂无存档，创建角色后会自动上传。</span>'; return; }
  box.innerHTML='<span class="muted">云端存档：</span>'
    + used.map(s=>'<button class="mini" data-resume="'+s.slot+'">读取槽位'+s.slot+'（'+s.name+' '+jobCn(s.job)+' Lv.'+s.level+'）</button>').join('');
  box.querySelectorAll('[data-resume]').forEach(b=> b.onclick=async ()=>{
    const slot=parseInt(b.getAttribute('data-resume'),10);
    const r=await cloudLoad(slot);
    if(r.ok){ state.cloud.slot=slot; persistCloud(); const ov=$('overlay'); if(ov) ov.style.display='none';
      renderAll(); log('<span class="loot">'+r.msg+'</span>'); }
    else log('<span class="dmg">'+(r.msg||'读取失败')+'</span>');
  });
}
async function afterLogin(){
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
async function startAuthFlow(){
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

async function boot(){
  await loadData();
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
  timer=setInterval(loop, 700);
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
function renderAll(){ renderHeader(); renderMap(); renderTab(); renderBattle(); } // renderTab 内部会同步刷新角色面板

// 让背包/装备点击时支持镶嵌：重写 findItem 点击逻辑，detect 待镶嵌宝石
const _origEquip = equipItem;
function renderTabWrap(){}





boot();
})();
