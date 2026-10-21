/* ===== 模块 core.js —— 全局索引与常量 + 工具函数 + 数据加载 loadData =====
 * 来源：game.js L180-429（2026-10-21 模块化切分，内容逐字节保留）
 * 导出 41 个顶层名；import 由 AST 跨模块引用自动计算。
 */
import { DATA_FILES, state } from './state.js';
import { EXTRA_ITEM_NAME } from './life.js';

// ---------- 武魂系统参数 ----------
// 原版武魂为长期养成（0★满级约需 4000 万经验），网页挂机版放大吸经验倍率以便体验
export const WUHUN_EXP_MULT = 30;
// 武魂类型 -> 属性归属分类（用于激活时按星级取数值区间）
export const WUHUN_ATTR_CAT = {
  strength:'five_dim', agility:'five_dim', constitution:'five_dim', intelligence:'five_dim', spirit:'five_dim',
  phys_atk:'atk_flat', magic_atk:'atk_flat', dark_atk:'atk_flat',
  phys_atk_pct:'atk_pct', magic_atk_pct:'atk_pct',
  phys_def:'def_flat', magic_def:'def_flat',
  phys_def_pct:'def_pct', magic_def_pct:'def_pct',
  max_hp:'hp_flat', max_hp_pct:'hp_pct',
  phys_crit:'crit', magic_crit:'crit', dmg_reduce_pct:'reduce'
};
export const WUHUN_TYPE_KEYS = ['qinglong','baihu','zhuque','xuanwu'];
// 三魂七魄材料键（武魂炼制原料）
export const SANHUN_KEYS = ['sanhun_tian','sanhun_di','sanhun_ren'];
export const QIPO_KEYS = ['qipo_xi','qipo_nu','qipo_ai_sorrow','qipo_ju','qipo_ai_love','qipo_wu','qipo_yu'];

// 日志显示条数：本命日志已合并到中间战斗日志，统一显示 10 条
export const EVENT_SHOW = 10;  // 保留，供事件查询/外部引用使用
export const EVENT_KEEP = 20;  // 本命日志保留上限
export const LOG_SHOW   = 10;  // 合并后日志显示条数
export const LOG_KEEP   = 60;  // 合并后日志保留上限

export const DATA = {};
export let MONSTERS = {};   // key -> monster
export let MON_SKILLS = {}; // monster key -> [怪物技能]
export let SUMMON_SKILLS = {}; // 召唤兽技能 key -> skill
export let GEM_ORDER = [];  // 宝石品级链（低 -> 高）
export let SM_ACTIVE = {};  // 神魔主动技能 key -> def（合并 shenmo_active_skills*）
export let TITLES = [];     // achievements.json#titles（称号配置）
export let JOB_BASES = {};  // job -> bases object
export let BASE_BY_KEY = {}; // base_key -> base object (跨职业)
export let LOOT = {};       // 合并后的掉落表
// 生活技能：矿石 / 材料 资源索引
export let ORE_BY_TIER = ['hantie','chitong','moyin','wujin','liufang','lihuo','haihun'];
export let ORE_NAME = {};   // ore key -> 中文名
export let ORE_PRICE = {};  // ore key -> 价格
export let ORE_KEYS = new Set();
export let ITEM_NAME_CACHE = {}; // key -> 统一中文显示名
export const LS = { forgeSlot:'weapon', forgeTier:1, bailEquip:null, extractEquip:null, oreRecipe:'recipe_ore_4', furnace:null,
  mineGrade:'yipin', mineMap:'tianshengyuan', gemSeries:null, gemGrade:null, forgeMode:'random', refineEq:null, inlayGem:null, inlayEquip:null };
export const MAT_SHOP_LIST = [
  {key:'bailian_shi', price:5}, {key:'lianhua_ping', price:50},
  {key:'yipin_luopan', price:200}, {key:'erpin_luopan', price:600}, {key:'sanpin_luopan', price:1500},
  {key:'hantie', price:15}, {key:'chitong', price:30}, {key:'moyin', price:60},
  {key:'tiangong_shi', price:100}, {key:'lunhui_shi', price:150},
  {key:'baoxia_xuangui', price:50}, {key:'baiyu_lingpai', price:5000}, {key:'yuquan_box', price:50},
  {key:'tong_ban', price:5}
];

// 词条名 → 战斗属性（让防御/生命等词条真正生效，高品质装备更强）
export const PERK_STAT_MAP = {
  // 精炼隐藏词条（refine_hidden_perks）：攻击部位 → 致命(物爆+1%)，其余 → 守御(减伤+1%)
  '致命':'phys_crit', '守御':'dmg_reduce_pct',
  '物理防御':'phys_def', '法术防御':'magic_def', '生命值':'max_hp',
  '物理攻击':'phys_atk', '法术攻击':'magic_atk',
  '冰系法术防御':'magic_def', '火系法术防御':'magic_def',
  '暗系法术防御':'magic_def', '电系法术防御':'magic_def',
  '最小物理攻击':'phys_atk', '最大物理攻击':'phys_atk'
};

// ---------- 工具 ----------
export const rnd = (a,b)=> a + Math.random()*(b-a);
export const ri  = (a,b)=> Math.floor(a + Math.random()*(b-a+1));
export const pick = arr => arr[Math.floor(Math.random()*arr.length)];
export const clamp = (v,a,b)=> Math.max(a,Math.min(b,v));
export const _ids = { n: 1 };   // 物品 UID 计数器（对象形式：load() 跨模块恢复存档里的 _uid）
export const uid = ()=> 'it'+(_ids.n++);

export const ATTR_EFFECT_KEY = {
  '力量':'strength','敏捷':'agility','体质':'constitution','智力':'intelligence',
  '精神':'spirit','耐力':'constitution','体力':'constitution','根骨':'constitution'
};
export const SLOT_CAT = {
  helmet:'helmets', shoulder_l:'shoulders', armor:'armors', pants:'pants',
  cloak:'cloaks', gloves:'gloves', belt:'belts', shoes:'shoes',
  weapon:'weapons', shield:'shields', necklace:'necklaces', ring1:'rings', ring2:'rings'
};
export const CAT_SLOT = {helmets:'helmet', shoulders:'shoulder_l', armors:'armor', pants:'pants',
  cloaks:'cloak', gloves:'gloves', belts:'belt', shoes:'shoes', weapons:'weapon',
  shields:'shield', necklaces:'necklace', rings:'ring1'};
export const SLOT_NAME = {
  helmet:'头盔', shoulder_l:'护肩', armor:'盔甲', pants:'护腿', cloak:'披风',
  gloves:'护手', belt:'腰带', shoes:'鞋子', weapon:'武器', shield:'盾牌',
  necklace:'项链', ring1:'戒指', ring2:'戒指', soul1:'武魂', soul2:'武魂'
};

// ---------- 数据加载 ----------
// 并行加载全部配置：CDN 部署下 57 个文件串行 await 实测 13.3s，Promise.all 并行 0.96s（13.9 倍）。
// 单文件失败自动重试一次；仍失败则抛出带文件名的错误由 boot() 展示重试入口——
// 绝不静默缺数据启动（旧实现串行 + 静默 catch，缺文件会带着半份 DATA 进游戏）。
export async function loadData(){
  const bar = (typeof document!=='undefined') && document.getElementById('load-bar-fill');
  const msg = (typeof document!=='undefined') && document.getElementById('load-msg');
  let done = 0;
  const bump = ()=>{
    done++;
    if(bar) bar.style.width = Math.round(done/DATA_FILES.length*100)+'%';
    if(msg) msg.textContent = '正在加载游戏数据 '+done+'/'+DATA_FILES.length;
  };
  const one = async (f)=>{
    let lastErr = null;
    for(let attempt=0; attempt<2; attempt++){           // 失败重试一次（网络抖动/冷启动）
      try{
        const r = await fetch('data/'+f+'.json');
        if(r.ok === false) throw new Error('HTTP '+(r.status || '?'));   // 显式 false 才判失败，兼容精简响应桩
        DATA[f] = await r.json();                        // 404 页是 HTML，解析即抛，不会静默吞掉
        return;
      }catch(e){ lastErr = e; }
    }
    throw new Error(f+'.json（'+(lastErr && lastErr.message || lastErr)+'）');
  };
  const settled = await Promise.allSettled(DATA_FILES.map(f => one(f).then(bump)));
  const failed = settled.filter(s => s.status==='rejected').map(s => s.reason.message);
  if(failed.length){
    throw new Error('数据加载失败 '+failed.length+'/'+DATA_FILES.length+' 个文件：'
      + failed.slice(0,5).join('；') + (failed.length>5 ? ' 等' : ''));
  }
  if(bar) bar.style.width = '100%';
  if(msg) msg.textContent = '数据加载完成';
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
export function rebuildItemNameCache(){
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
export function getMonster(key){
  return MONSTERS[key] || null;
}

export let SKILLS = {};    // job -> [主动技能]（原 L474，随 loadData 移至 core：与赋值同模块）
export let PASSIVES = [];  // 通用被动技能（原 L475，同上）
