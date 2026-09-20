# -*- coding: utf-8 -*-
"""一次性补丁：把「怪物经验缩放 + 类型倍率取档」按原版口径还原。

背景（本次反汇编原版 exe 裁定，详见 _dis_exp.txt 第 1191-1311 行 battle/encounter.py:scale_monster_exp）：
  原版：
    if mon_exp <= 0: return 0
    diff  = mon_level - char_level
    scale = 1.0
    if diff > 0:  scale = min(over_high_factor ** diff, max_cap)      # 指数 1.2^diff，封顶 2.5
    elif diff < 0: scale = max(0.0, 1.0 - (-diff) * over_low_factor)  # 线性衰减，怪低 5 级即 0 经验
    type_mult = TYPE_EXP_MULTIPLIER.get(mon_type, 1.0)
    if mon_type in TYPE_EXP_TIERS and tiers:
        tier_idx  = min(max(0, (mon_level - 1) // 10), len(tiers) - 1)  # 按【怪物等级】每 10 级一档
        type_mult = tiers[tier_idx]
    return max(0, int(mon_exp * scale * type_mult))

  本 port 现状（两个结构性错误）：
    ① lf 由 ratio = 角色等级 / 怪物等级 阶梯取值（>=1.5 → over_low_factor；<=0.7 → min(1.2, max_cap)）：
       丢了指数、丢了线性衰减，怪低 1~4 级完全不衰减、怪低 5 级以上也只扣到 0.2 而非 0；
       max_cap(2.5) 因为 min(1.2, 2.5) 恒等于 1.2 而变成死配置。
       后果：挂机自动择区（bestZone）会一路跑去刷比自己低 30+ 级的怪 —— 实测 Lv120 选
       「七曲洞二层·左翼通道」(均怪 Lv84)，原版该处经验恰为 0；而正确的最优区是
       「幻月海四层·北部海域」(均怪 Lv119)。这与 game.js:4285 自己的注释
       「等级门槛由 zoneEval 过滤，这样挂机才能随等级自动推进到新地图」直接矛盾。
    ② type_exp_tiers 误用【角色等级】按 ceil(level/20) 取档（原版按【怪物等级】每 10 级）：
       高级角色刷低级精英会白拿 1.83~4.17 倍类型倍率。

  另：zoneEval 里有一份 lf 的重复实现，且局部变量 tc 声明后从未使用（死变量）。
      本次把区域收益统一走 monsterExp（与实际掉落同源），消除重复实现。

  注意：原版经验曲线 exp_to_next = ceil(15*L^3) 是【直接值】，本 port 用差分
       （game.js:325-330 有注释说明），这是 port 有意做的节奏适配，本次【不动】。

规则形如 (old, new, expect, tag)；任一规则命中次数 != expect 就 sys.exit(1)，不写回。
"""
import io, os, sys

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'game.js')
s = io.open(SRC, encoding='utf-8', newline='').read()
assert s.count('\r\n') > 0 and (s.count('\n') - s.count('\r\n')) == 0, 'game.js 应为纯 CRLF'


def cr(x):
    """把 LF 片段转成 CRLF 片段，方便书写。"""
    assert '\r' not in x
    return x.replace('\n', '\r\n')


R = []

# ---------- ① 经验缩放 + 类型倍率取档 + monsterExp ----------
R.append((
    cr("""// 类型经验倍率：优先查按等级档位递进的 type_exp_tiers（每 20 级一档，与晶石档位同源），
// 缺表/缺档时回落到 type_exp_multiplier 的基础值（= tiers 的第 1 段）。
// character.json 里两套都在，此前只用了基础值 → Lv101+ 的精英/首领经验被低估最多 1.9 倍。
function typeExpMul(type, level){
  const ch = DATA.character || {};
  const tiers = ch.type_exp_tiers && ch.type_exp_tiers[type];
  if(tiers && tiers.length){
    const t = clamp(Math.ceil((level || 1) / 20), 1, tiers.length);
    const v = tiers[t - 1];
    if(typeof v === 'number' && v > 0) return v;
  }
  return (ch.type_exp_multiplier || {})[type] || 1;
}
function monsterExp(m, playerLevel){
  const ms = DATA.character.monster_exp_scale;
  const mul = typeExpMul(m.type, playerLevel);
  const ratio = playerLevel / Math.max(1, m.level);
  let lf = 1.0;
  if(ratio >= 1.5) lf = ms.over_low_factor;
  else if(ratio <= 0.7) lf = Math.min(ms.over_high_factor, ms.max_cap);
  return Math.round((m.exp||1) * mul * lf);
}"""),
    cr("""// 等级差经验缩放（口径对齐原版 battle/encounter.py:scale_monster_exp，本次由 exe 反汇编裁定）：
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
}"""),
    1, '① 经验缩放/类型倍率/monsterExp 按原版口径还原'))

# ---------- ② zoneEval：抽出 zoneKeys/zoneYield，删掉重复的 lf 与死变量 tc ----------
R.append((
    cr("""// 评估某区域收益：返回经验/秒，不可打返回 -1
function zoneEval(mapKey, zoneKey, isBoss){
  const p=state.player;
  const map=DATA.maps.maps.find(m=>m.key===mapKey); if(!map) return -1;
  let keys, tag='';
  if(isBoss){
    if(!map.boss_zone) return -1;
    if(p.level < (map.boss_zone.unlock_level||0)) return -1;
    if(!bossZoneCleared(map)){   // 尚未清剿完 → 实际收益是刷小怪，不是打首领
      keys=(map.boss_zone.monsters||[]).concat((map.boss_zone.elite_monsters||[]).slice(0,1));
      tag='清剿';
    }else{ keys=map.boss_zone.boss||[]; tag='首领'; }
  }else{
    const z=(map.zones||[]).find(zz=>zz.key===zoneKey); if(!z) return -1;
    keys=(z.monsters||[]).concat((z.elite_monsters||[]).slice(0,1));
  }
  const a=zoneMonsterAvg(keys); if(!a) return -1;
  if(a.level > p.level+8) return -1;                       // 太强打不过
  const tc=DATA.character.type_exp_multiplier, ms=DATA.character.monster_exp_scale;
  const ratio=p.level/Math.max(1,a.level);
  let lf=1.0;
  if(ratio>=1.5) lf=ms.over_low_factor;
  else if(ratio<=0.7) lf=Math.min(ms.over_high_factor, ms.max_cap);
  const exp=a.exp*lf*(isBoss? 0.9 : 1);
  const ttk=Math.max(0.8, a.hp/playerDps());               // 估算击杀耗时（秒等效）
  if(p.hp>0 && a.level > p.level+3 && p._s && a.hp > p._s.max_hp*0.9) return -1;  // 容易被打死
  return exp/ttk;
}"""),
    cr("""// 区域出怪列表（与实际遭遇一致：小怪 + 1 只精英；首领区未清剿完时以清剿对象计）
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
}"""),
    1, '② zoneEval 收敛到 monsterExp + 抽出 zoneKeys/zoneYield'))

# ---------- ③ bestZone：加「经验全为 0」时的保底 ----------
R.append((
    cr("""function bestZone(){
  const p=state.player; let best=null;
  // 遍历全部地图：只要 unlock_map 前置满足即可前往（travelTo 会自动解锁），
  // 等级门槛由 zoneEval 过滤，这样挂机才能随等级自动推进到新地图。
  for(const map of (DATA.maps.maps||[])){
    const mk=map.key;
    if(map.unlock_map && !p.unlocked[map.unlock_map]) continue;
    if(!(map.zones||[]).length && !map.boss_zone) continue;
    for(const z of (map.zones||[])){
      const sc=zoneEval(mk, z.key, false);
      if(sc>0 && (!best || sc>best.score)) best={mapKey:mk, zoneKey:z.key, isBoss:false, score:sc,
        name:map.name+' · '+(z.name||z.key)};
    }
    if(map.boss_zone){
      const sc=zoneEval(mk, null, true);
      if(sc>0 && (!best || sc>best.score)) best={mapKey:mk, zoneKey:null, isBoss:true, score:sc,
        name:map.name+' · 首领'};
    }
  }
  return best;
}"""),
    cr("""function bestZone(){
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
}"""),
    1, '③ bestZone 加「零经验保底」'))

# ---------- ④ idleRate 与 zoneEval 共用 zoneKeys（消除第三份取材逻辑） ----------
R.append((
    cr("""  const map=DATA.maps.maps.find(m=>m.key===z.mapKey); if(!map) return {exp:0, gold:0};
  let keys;
  if(z.isBoss){ keys = map.boss_zone? (map.boss_zone.boss||[]) : []; }
  else { const zo=(map.zones||[]).find(x=>x.key===z.zoneKey); keys = zo? (zo.monsters||[]).concat((zo.elite_monsters||[]).slice(0,1)) : []; }
  const a=zoneMonsterAvg(keys); if(!a) return {exp:0, gold:0};"""),
    cr("""  const map=DATA.maps.maps.find(m=>m.key===z.mapKey); if(!map) return {exp:0, gold:0};
  const keys=zoneKeys(map, z.zoneKey, z.isBoss)||[];
  const a=zoneMonsterAvg(keys); if(!a) return {exp:0, gold:0};"""),
    1, '④ idleRate 复用 zoneKeys'))

# ---------- 应用 ----------
for old, new, expect, tag in R:
    n = s.count(old)
    if n != expect:
        print('FAIL  %s : 命中 %d 次，期望 %d 次' % (tag, n, expect))
        sys.exit(1)
    s = s.replace(old, new)
    print('OK    %s' % tag)

assert (s.count('\n') - s.count('\r\n')) == 0, '写回后应为纯 CRLF'
io.open(SRC, 'w', encoding='utf-8', newline='').write(s)
print('written %s  %d bytes' % (SRC, len(s.encode('utf-8'))))
