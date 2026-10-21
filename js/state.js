/* ===== 模块 state.js —— 全局状态（DATA_FILES / state / 自动挂机设置持久化） =====
 * 来源：game.js L24-73（2026-10-21 模块化切分，内容逐字节保留）
 * 导出 5 个顶层名；import 由 AST 跨模块引用自动计算。
 */

export const DATA_FILES = [
  'maps','monsters','character','jobs','slots','stats','quality',
  'loot_tables','loot_equip','loot_probs','loot_gem','loot_item','loot_potion','loot_chest','loot_wuhun',
  'bases_warrior','bases_mage','bases_shaman','bases_darkwitch','bases_accessory',
  'perk_pool','gems','refine','items','extract','craft','ores','bailian_recipes','furnace_recipes','ore_recipes',
  'modes','shops','quests',
  'wuhun','wuhun_recipes','shenmo','shenmo_skills','shenmo_active_skills',
  'shenmo_skills_darkwitch','shenmo_skills_shaman','shenmo_active_skills_darkwitch','shenmo_active_skills_shaman',
  'crystals','couriers',
  'skills_passive','skills_active_warrior','skills_active_mage','skills_active_shaman',
  'skills_active_darkwitch','skills_active_summon',
  'monster_skills','summons','mining','gem_recipes','potion_recipes','instance_exchange','achievements'
];

export const state = {
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
export const AUTO_KEY='menghuihuaxia_auto_v1';
export function loadAuto(){
  try{ const a=JSON.parse(localStorage.getItem(AUTO_KEY)||'null'); if(a) Object.assign(state.auto, a); }catch(e){}
}
export function saveAuto(){ try{ localStorage.setItem(AUTO_KEY, JSON.stringify(state.auto)); }catch(e){} }

