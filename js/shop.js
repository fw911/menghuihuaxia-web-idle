/* ===== 模块 shop.js —— 商店/任务/消耗品使用 =====
 * 来源：game.js L3830-3957（2026-10-21 模块化切分，内容逐字节保留）
 * 导出 8 个顶层名；import 由 AST 跨模块引用自动计算。
 */
import { state } from './state.js';
import { BASE_BY_KEY, DATA, ITEM_NAME_CACHE, SLOT_NAME, uid } from './core.js';
import { QNAME, buildEquip, buildMysticEquip, genEquipBaseForSlot, jobFromBaseKey } from './equip.js';
import { gainExp } from './battle.js';
import { BAG_CAP, addToBag } from './bag.js';
import { eventLog, log, renderHeader } from './render.js';
import { renderTab } from './tabs.js';
import { fmtNum } from './life.js';

// 0.94 神秘商人：跨表 give key 的中文名兜底
// 47 个 give/give_pool 键里 45 个已由 items.json / wuhun / ores 进入 ITEM_NAME_CACHE，
// 仅「炼魂壶」两个键在两版配置里都无定义，按 key 含义补可读名（web-idle 自研兜底）。
const MYSTIC_GIVE_ALIAS = {
  chuji_lianhun_hu: '初级炼魂壶',
  gaoji_lianhun_hu: '高级炼魂壶'
};
function mysticGiveName(key){
  return ITEM_NAME_CACHE[key] || MYSTIC_GIVE_ALIAS[key] || key;
}
function mysticGiveType(key){
  const def=(DATA.items.items||[]).find(i=>i.key===key);
  if(def) return def.type==='ore' ? 'ore' : (def.type || 'consumable');
  if((((DATA.ores||{}).ore_types)||[]).some(o=>o.key===key)) return 'ore';
  return 'consumable';
}

// ---------- 商店 ----------
export function itemName(key){ return ITEM_NAME_CACHE[key] || key; }
export function mysticSlotOptions(){
  const slots = ['weapon','armor','helmet','shoulder_l','pants','cloak','gloves','belt','shoes','shield','necklace','ring1','ring2'];
  const p=state.player;
  return slots.map(s=>'<option value="'+s+'"'+(window._mysticSlot===s?' selected':'')+'>'+SLOT_NAME[s]+'</option>').join('');
}
export function renderShop(sub){
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
      else if(it.kind==='mystic_item') label=it.name || (it.give? mysticGiveName(it.give) : '随机材料');
      const isMystic = it.kind==='mystic_equip' || it.kind==='mystic_item';
      const cur = isMystic ? p.crystal : p.gold;
      const afford = cur>=it.price;
      const unit = isMystic ? '结晶' : '金';
      html+='<div class="item shop-item" data-buy="'+shop.key+'|'+i+'"'+(afford?'':' style="opacity:.55"')+'>'+label+' <span class="pill">'+fmtNum(it.price)+unit+'</span></div>';
    }
    html+='</div>';
  }
  if(sub && !sdef) html+='<div class="muted">没有这个商店。</div>';
  return html;
}
export function buyShopItem(shopKey, idx){
  const p=state.player;
  const shop=(DATA.shops.shops||[]).find(s=>s.key===shopKey); if(!shop) return;
  const it=shop.items[idx]; if(!it) return;
  const price=it.price;
  if(it.kind==='mystic_equip'){
    if(p.crystal<price){ log('<span class="dmg">神秘结晶不足</span>'); return; }
    // 0.94 api_shop_mystic_exchange：装备区满则拒绝兑换（不扣结晶）。
    // web-idle 的 trimBag 会在背包超容时回收白/绿装，不先检查会「扣了结晶却拿不到装备」。
    if(p.bag.length>=BAG_CAP){ log('<span class="dmg">背包已满，无法兑换装备</span>'); return; }
    const slot=window._mysticSlot||'weapon';
    const base=genEquipBaseForSlot(slot, p.job, it.tier);
    if(!base){ log('<span class="dmg">该部位暂无可用基底</span>'); return; }
    // v0.94：普通 / 完美两档走 generate_mystic_equip 规则（1~3 词条 + 四档数值分布），
    // 不再用通用 buildEquip 的 full_perk 满词条近似。
    const eq=buildMysticEquip(base, p.job, it.tier, slot, !!it.perfect);
    p.crystal-=price; addToBag(eq);
    log('<span class="loot">兑换 '+SLOT_NAME[slot]+'·'+eq.name+'（'+it.name+'，['+QNAME[eq.quality]+']）</span>');
  }else if(it.kind==='mystic_item'){
    if(p.crystal<price){ log('<span class="dmg">神秘结晶不足</span>'); return; }
    const pool = it.give_pool||[];
    const key = it.give || (pool.length? pool[Math.floor(Math.random()*pool.length)] : null);
    if(!key){ log('<span class="dmg">兑换目标缺失</span>'); return; }
    const gain = it.gain || 1;
    p.crystal-=price;
    addToBag({uid:uid(), type:mysticGiveType(key), key, count:gain, name:mysticGiveName(key)});
    log('<span class="loot">兑换 '+mysticGiveName(key)+'×'+gain+'</span>');
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
export function renderQuest(){
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
export function acceptQuest(key){
  state.player.quests[key]={accepted:true,done:false,stage:0,progress:0};
  const qd=DATA.quests[key];
  log('<span class="lv">已接受委托：'+(qd?qd.name:key)+'</span>');
  renderTab();
}
export function questProgress(m){
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
export function useConsumable(it){
  const def=(DATA.items.items||[]).find(i=>i.key===it.key); if(!def) return;
  const p=state.player;
  // 0.94 续命道具：web-idle 尚无灵兽寿命系统，明确提示且不吞掉道具
  if(def.effect_type==='companion_lifespan'){
    log('<span class="muted">灵兽寿命系统尚未开放，'+def.name+'暂未生效</span>');
    return;
  }
  const per = def.effect && (def.effect.hp_per_tick!=null?def.effect.hp_per_tick:def.effect.mp_per_tick||0);
  const isMp = def.effect && def.effect.mp_per_tick!=null;
  const total = per*(def.duration_ticks||1);
  if(isMp){ p.mp=Math.min(p._s.max_mp, p.mp+total); log('<span class="loot">使用 '+def.name+'，恢复法力 '+fmtNum(total)+'</span>'); }
  else { p.hp=Math.min(p._s.max_hp, p.hp+total); log('<span class="loot">使用 '+def.name+'，恢复生命 '+fmtNum(total)+'</span>'); }
  it.count--; if(it.count<=0) p.bag=p.bag.filter(b=>b.uid!==it.uid);
  renderHeader(); renderTab();
}

