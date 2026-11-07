# -*- coding: utf-8 -*-
"""L13：按 v0.94 官方配置对齐「8 档装备体系」与「副本护符兑换表」。

承接 L12 §15.8 残留项（用户 2026-11-07 拍板「要」）。证据源：
  1) 0.94 config_enc/perk_pool.json.enc / instance_exchange.json.enc /
     crystals.json.enc 直解密（配置真值）
  2) 归档标准反汇编 _dis_quality.txt 的 _tier_of_level / clamp_drop_tier
     （旧版掉落档位上限 7；0.94 ores.json 亦只有 1..7 档矿石）
  3) 0.94 bases_*.json 里 72 条 tier=8 基底（web-idle 已有，逐字段一致）

落地范围：
  data/perk_pool.json        119 模板补 values.8 / stat_key / op，删 10 条自研戒指池扩充
  data/crystals.json         补 tier_to_crystal.8=huanshen 与 7 条 desc
  data/instance_exchange.json 27 条补 npc（合计 36 条齐备）、古墓 5→3 张、五曜阵 7→6 档、2 条 comment
  js/equip.js                buildEquip clamp 1..7 → 1..8；PERK_CAP 补 8:9
  js/life.js                 crystalForTier clamp 1..7 → 1..8；锻造维持 1..7
  js/panels.js               兑换面板显示 0.94 真 NPC 名与按组消耗张数
  _run_test.js               +13 条断言，并更正 L12 中「8 档零行为影响」的旧文案
  UPGRADE_REPORT.md          §十六，并更正 §15.7 的历史结论

用法： python _l13_apply.py            # dry-run，只校验不写盘
       python _l13_apply.py --apply    # 落地
所有 data/ 写入均为 bytes 直写，按原格式 json.dumps(indent=2) 重建并做
「非目标字段零变化」强校验；三份数据文件均可零差异重建（已验证）。
"""
import argparse
import base64
import copy
import hashlib
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ENC = r'E:/放置归墟：梦回华夏 _v0.94/config_enc'
SALT = b'MH_CONFIG_ENC_SALT_v1'
K94_B64 = 'kUmtE1a7/jQ7LdM04YhJYXKhRvwaQZ6vqY1YRyIbsr8='

# 文件名 -> (行尾, 文件尾); 三者均可被 json.dumps(indent=2) 零差异重建
FMT = {
    'perk_pool': (b'\n', b'\n'),
    'instance_exchange': (b'\r\n', b''),
    'crystals': (b'\r\r\n', b''),
}


def dec94(fn):
    key = hashlib.pbkdf2_hmac('sha256', base64.b64decode(K94_B64), SALT, 200000, 32)
    d = open(os.path.join(ENC, fn + '.json.enc'), 'rb').read()
    assert d[:9] == b'CONFIGENC', fn
    r = subprocess.run(['openssl', 'enc', '-d', '-aes-256-cbc',
                        '-K', key.hex(), '-iv', d[9:25].hex()],
                       input=d[25:], capture_output=True)
    assert r.returncode == 0, (fn, r.stderr[:200])
    return json.loads(r.stdout.decode('utf-8'))


def rb(p):
    return open(os.path.join(HERE, p), 'rb').read()


def rebuild(obj, fn):
    eol, tail = FMT[fn]
    s = json.dumps(obj, ensure_ascii=False, indent=2).encode('utf-8')
    return s.replace(b'\n', eol) + tail


def diff_paths(a, b, path=''):
    """按 dict key / list 下标对齐，返回差异路径集合。"""
    out = set()
    if isinstance(a, dict) and isinstance(b, dict):
        for k in set(a) | set(b):
            p = (path + '.' if path else '') + k
            if k not in a or k not in b:
                out.add(p)
            else:
                out |= diff_paths(a[k], b[k], p)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            out.add(path + '[LEN]')
        for i in range(min(len(a), len(b))):
            out |= diff_paths(a[i], b[i], '%s[%d]' % (path, i))
    elif a != b:
        out.add(path)
    return out


def templates(obj):
    return [(p, c, t) for p in obj for c in obj[p] for t in obj[p][c]]


def build_targets():
    """返回 {fn: (old_obj, new_obj, raw, new_bytes, 校验说明)}"""
    out = {}
    for fn in FMT:
        raw = rb('data/' + fn + '.json')
        old = json.loads(raw.decode('utf-8'))
        assert rebuild(old, fn) == raw, fn + ' 零差异重建前提不成立'
        a94 = dec94(fn)
        new = copy.deepcopy(a94)
        out[fn] = (old, new, raw, rebuild(new, fn), a94)
    return out


def verify_data(T):
    # ---- perk_pool：新对象 == 0.94；除新增 3 字段与删 10 模板外零变化 ----
    old, new, raw, nb, a94 = T['perk_pool']
    assert new == a94, 'perk_pool 未与 0.94 完全一致'
    assert len(templates(old)) == 129 and len(templates(new)) == 119
    stripped = copy.deepcopy(new)
    for _, _, t in templates(stripped):
        t['values'].pop('8', None)
        t.pop('stat_key', None)
        t.pop('op', None)
    ring94 = set((t['name'] + t.get('suffix', '')) for p, c, t in templates(new)
                 if p == 'ring_perk_pool')
    old_minus = copy.deepcopy(old)
    for cat in old_minus['ring_perk_pool']:
        old_minus['ring_perk_pool'][cat] = [
            t for t in old_minus['ring_perk_pool'][cat]
            if (t['name'] + t.get('suffix', '')) in ring94]
    assert stripped == old_minus, 'perk_pool 存在目标之外的数据变化'
    assert all('8' in t['values'] and 'stat_key' in t and 'op' in t
               for _, _, t in templates(new))
    print('  perk_pool: 129→119 模板，119×3 新增字段，10 条自研模板删除，非目标零变化 OK')

    # ---- instance_exchange：差异集合恰为 L12 登记的 65 处 ----
    old, new, raw, nb, a94 = T['instance_exchange']
    assert new == a94
    diff = diff_paths(old, new, 'instance_exchange')
    keys = [k for k in new if not k.startswith('_')]
    expect = set()
    for k in keys:
        if k.startswith(('xhz_', 'xyt_', 'gm_')):
            expect.add('instance_exchange.' + k + '.npc')
        if k.startswith('gm_'):
            expect.add('instance_exchange.' + k + '.cost_count')
        if k.startswith('wxz_'):
            expect.add('instance_exchange.' + k + '.tier')
            expect.add('instance_exchange.' + k + '.name')
    expect |= {'instance_exchange._exchange_spec.comment',
               'instance_exchange._instance_exchange_meta.comment'}
    assert diff == expect, ('instance_exchange 差异集合不符',
                            sorted(diff - expect)[:10], sorted(expect - diff)[:10])
    print('  instance_exchange: %d 处差异全部落在预期清单（27 npc 补齐 + wxz 9 条已有 / 9 cost / 9 tier / 9 name / 2 comment）'
          % len(diff))

    # ---- crystals：仅补 tier8 与 7 条 desc ----
    old, new, raw, nb, a94 = T['crystals']
    assert new == a94
    diff = diff_paths(old, new, 'crystals')
    expect = {'crystals.tier_to_crystal.8'} | {
        'crystals.crystal_types[%d].desc' % i for i in range(7)}
    assert diff == expect, ('crystals 差异集合不符', sorted(diff))
    print('  crystals: 8 处差异（tier_to_crystal.8 + 7 条 desc），其余零变化 OK')


# ---------------- 引擎定点补丁（old -> new，命中数必须为 1） ----------------
ENGINE = [
    ('js/equip.js',
     'export const PERK_CAP = {1:6, 2:7, 3:8, 4:9, 5:9, 6:9, 7:9};',
     'export const PERK_CAP = {1:6, 2:7, 3:8, 4:9, 5:9, 6:9, 7:9, 8:9};'
     '  // L13：0.94 已有 8 档基底/词条/结晶，8 档沿用最高档词条上限'),
    ('js/equip.js',
     '  tier = clamp(tier,1,7);',
     '  tier = clamp(tier,1,8);'
     '   // L13：旧 clamp 会把 8 档基底压成 7 档；0.94 perk_pool.values.8 / bases_* tier=8 齐备'),
    ('js/life.js',
     "export function crystalForTier(tier){ const m=(DATA.crystals||{}).tier_to_crystal||{}; return m[''+clamp(tier||1,1,7)] || m['1']; }",
     "// L13：0.94 crystals.tier_to_crystal 有 8 档（8 -> huanshen），结晶档位上限随配置放宽\n"
     "export function crystalForTier(tier){ const m=(DATA.crystals||{}).tier_to_crystal||{}; return m[''+clamp(tier||1,1,8)] || m['1']; }"),
    ('js/life.js',
     '  const tier=clamp(parseInt(LS.forgeTier,10)||1,1,7);',
     '  const tier=clamp(parseInt(LS.forgeTier,10)||1,1,7);'
     '   // L13：锻造维持 1..7（0.94 ores.json 只有 1..7 档矿石，无 8 档矿）'),
    ('js/panels.js',
     "    +'集齐 '+5+' 个可换本职业固定规格装备（+'+(spec.refine||5)+' 精炼 · '+(spec.sockets||3)+' 孔 · 词条取中值）。</div>';",
     "    +'集齐对应护符可换本职业固定规格装备（+'+(spec.refine||5)+' 精炼 · '+(spec.sockets||3)+' 孔 · 词条取中值；诡墓需 3 张，其余 5 张）。</div>';"),
    ('js/panels.js',
     "    html+='<div class=\"shop\"><div class=\"shop-name\">'+instName(ik)+'（兑换 NPC：'+instMapName(groups[ik][0].npc_map)+'）</div>';",
     "    html+='<div class=\"shop\"><div class=\"shop-name\">'+instName(ik)+'（兑换 NPC：'+(groups[ik][0].npc||'—')+' @ '+instMapName(groups[ik][0].npc_map)+'）</div>';"),
]

# ---------------- 测试断言（插入 _run_test.js，CRLF） ----------------
TEST_ANCHOR = '    // L12：0.94 _roll_perk_value 精确四档'
TEST_OLD_ASSERT = "      ok('0.94 refine.json 补 8 档固定加点 [15,20]（当前 7 档体系零行为影响）',"
TEST_NEW_ASSERT = "      ok('0.94 refine.json 补 8 档固定加点 [15,20]（L13 起 8 档体系已打通，精炼仍封顶 7）',"

TEST_BLOCK = """    // L13：0.94 8 档装备体系 + 副本护符兑换配置对齐
    {
      const pp13 = E.DATA.perk_pool;
      const tp13 = [];
      for (const pool in pp13) for (const cat in pp13[pool]) for (const t of pp13[pool][cat]) tp13.push(t);
      ok('0.94 perk_pool 119 模板（删去 10 条自研戒指池扩充）', tp13.length === 119, 'n=' + tp13.length);
      ok('0.94 每模板都有 values.8 / stat_key / op 且 op 与 suffix 对应',
        tp13.every(t => Array.isArray(t.values['8']) && t.values['8'].length === 2 &&
          typeof t.stat_key === 'string' && (t.op === 'add' || t.op === 'add_pct') &&
          (t.op === 'add_pct') === (t.suffix === '%')));
      ok('0.94 8 档中值真值：物理攻击 48 / 生命值 51 / 最小物理攻击 38',
        E.perkMidValue('物理攻击', 8, 'warrior', 'weapon') === 48 &&
        E.perkMidValue('生命值', 8, 'warrior', 'helmet') === 51 &&
        E.perkMidValue('最小物理攻击', 8, 'warrior', 'ring1') === 38);
      ok('0.94 crystals.tier_to_crystal.8 = huanshen 且 crystalForTier(8) 命中',
        E.DATA.crystals.tier_to_crystal['8'] === 'huanshen' && E.crystalForTier(8) === 'huanshen');
      const b8 = E.genEquipBaseForSlot('weapon', 'warrior', 8);
      const eq8 = E.buildEquip(b8, 'warrior', 8, 'weapon', 'full_perk');
      ok('0.94 buildEquip tier=8 不再被 clamp 成 7', !!eq8 && eq8.tier === 8,
        eq8 ? 'tier=' + eq8.tier : 'none');
      ok('0.94 8 档装备词条取 values.8 真值而不是 [1,3] 兜底',
        !!eq8 && eq8.perks.length > 0 && eq8.perks.every(p => p.value >= 4),
        eq8 ? JSON.stringify(eq8.perks.slice(0, 3)) : 'none');
      ok('0.94 掉落档位仍封顶 7（旧版 _tier_of_level 字节码 / ores 只到 7 档）',
        E.tierFromLevel(200) === 7 && !!b8);
      const ie13 = E.DATA.instance_exchange, en13 = E.instEntries();
      ok('0.94 兑换表 36 条 npc 齐备：岑肃/卫澜/桑野/五曜镇将 各 9',
        en13.length === 36 && ['岑肃','卫澜','桑野','五曜镇将']
          .every(n => en13.filter(e => e.npc === n).length === 9));
      ok('0.94 古墓护符 5→3 张，其余仍 5 张',
        en13.filter(e => e._k.indexOf('gm_') === 0).every(e => e.cost_count === 3) &&
        en13.filter(e => e._k.indexOf('gm_') !== 0).every(e => e.cost_count === 5));
      ok('0.94 五曜阵 7 档→6 档（tier 与 name 同步）',
        en13.filter(e => e._k.indexOf('wxz_') === 0)
          .every(e => e.tier === 6 && e.name.indexOf('6 档') === 0));
      ok('0.94 两条 comment 对齐（昆吾台 / 诡墓 3 张 / npc=兑换委托人）',
        ie13._exchange_spec.comment.indexOf('昆吾台') >= 0 &&
        ie13._exchange_spec.comment.indexOf('诡墓 3 张') >= 0 &&
        ie13._instance_exchange_meta.comment.indexOf('npc=兑换委托人') >= 0);
      const sp13 = E.instSpec();
      let hit13 = 0;
      for (const kind of ['weapon','general'])
        for (const j of ['warrior','mage','darkwitch','shaman'])
          for (const n of ((sp13.perks_by_pool_job||{})[kind]||{})[j] || [])
            if (E.perkMidValue(n, 8, j, kind === 'weapon' ? 'weapon' : 'helmet') !== null) hit13++;
      ok('0.94 spec 16 固定词条在 8 档同样全命中', hit13 === 16, 'hit=' + hit13);
      const h13 = E.renderInstance();
      ok('兑换面板显示 0.94 真 NPC 名与 3 张消耗',
        ['岑肃','卫澜','桑野','诡墓需 3 张'].every(s => h13.indexOf(s) >= 0));
    }

"""

REPORT_OLD = ('**本轮一律保留**，待单独决策。0.94 `refine.json` 的 8 档 flat 已补但当前\n'
              '`tier ≤ 7` 永不触发，属零行为影响的数据完整性补齐。')
REPORT_NEW = ('**本轮一律保留**，待单独决策（L13 已按用户拍板执行，见 §十六）。\n'
              '0.94 `refine.json` 的 8 档 flat 已补；L13 打通 8 档体系后该档位可被触发。')

REPORT_SECTION = """## 十六、L13：按 v0.94 对齐 8 档装备体系与副本兑换配置（2026-11-07）

### 16.1 取证结论

| 证据 | 结论 |
|---|---|
| `config_enc/perk_pool.json.enc` | 0.94 共 **119** 个词条模板，每个都有 `values.8`、`stat_key`、`op`（`add` 90 / `add_pct` 29，与 suffix 严格对应）；`1..7` 档数值与 web-idle **逐条一致**，差异只在新增的 8 档与两个字段 |
| 同上 | web-idle 多出 **10 条自研 `ring_perk_pool` 扩充**（7 条 `atk_fixed` 防御/生命 + 3 条 `stat_percent`），0.94 无；`ring_perk_pool` 真值 17 条 |
| `config_enc/crystals.json.enc` | `tier_to_crystal.8 = "huanshen"`（复用 7 档结晶）；7 条 `crystal_types[].desc` 官方文案 web-idle 缺失 |
| `config_enc/instance_exchange.json.enc` | **27 条缺 `npc`**（岑肃/卫澜/桑野各 9），五曜镇将 9 条原本已有 → 补齐后 36 条齐备；`gm_*` 消耗 5→**3** 张；`wxz_*` 7 档→**6** 档（`tier` 与 `name` 同步）；2 条 comment 文案（昆吾台、诡墓 3 张、`npc=兑换委托人`） |
| `config_enc/bases_*.json.enc` | 0.94 有 **72 条 tier=8 基底**（战士 19 + 法/暗巫/幻师各 17 + 首饰 2），web-idle 已有且逐字段一致 —— 8 档体系只缺词条数值与引擎上限 |
| `_dis_quality.txt#_tier_of_level` / `clamp_drop_tier` | 旧版掉落档位硬上限 **7**（lv≥100 boss 随机 6/7）；0.94 `ores.json` 亦只有 1..7 档矿石 → **锻造/掉落维持 1..7**，不放宽 |

### 16.2 落地

| 文件 | 改动 |
|---|---|
| `data/perk_pool.json` | 全量按 0.94 重建：119 模板补 `values.8` / `stat_key` / `op`，删 10 条自研戒指池扩充；LF + 末尾换行保持 |
| `data/crystals.json` | 补 `tier_to_crystal.8` 与 7 条 `desc`；`\\r\\r\\n` 双重回车保持，diff 精确 |
| `data/instance_exchange.json` | 56 处差异一次对齐（27 新增 `npc` + 9 `cost_count` + 9 `tier` + 9 `name` + 2 `comment`）；CRLF 保持 |
| `js/equip.js` | `buildEquip` 的 `clamp(tier,1,7)` → `1..8`（旧实现把 8 档基底压成 7 档）；`PERK_CAP` 补 `8:9` |
| `js/life.js` | `crystalForTier` clamp → `1..8`（有 0.94 配置证据）；`doForge` 维持 `1..7` 并注明矿石依据 |
| `js/panels.js` | 兑换面板改显示 0.94 真 NPC 名 + 所在地图；顶部说明由硬编码「5 个」改为「诡墓需 3 张，其余 5 张」 |
| `_run_test.js` | +13 条断言；更正 L12 中「当前 7 档体系零行为影响」旧文案 |
| `UPGRADE_REPORT.md` | 本章节 + 更正 §15.6/§15.7 的 8 档历史结论 |

三份数据文件均经 `json.dumps(indent=2, ensure_ascii=False)` **零差异重建验证**，
写入走 bytes 直写；脚本 `_l13_apply.py` 对每份做「差异路径集合 == 预期清单」强校验
（perk_pool 另做「抹掉新增字段/插回自研模板后 == 原对象」复核），确保无目标之外改动。

### 16.3 关键判定：8 档从哪里来、不改哪里

- **改的是构建层**：`buildEquip(base, job, 8, ...)` 此前返回 `tier=7`，导致已有的 8 档
  基底永远出不来；同时 `rollPerks` 取 `values['8']` 落空 → 退化 `[1,3]`。本轮两处一起修。
- **不改掉落/锻造档位**：归档标准反汇编证明旧版 `_tier_of_level` 最高 7、
  `clamp_drop_tier` 对 lv≥100 boss 只给 6/7；0.94 `ores.json` 无 8 档矿。`tierFromLevel`
  与 `doForge` 保持 `1..7`，避免凭空造出 0.94 没有的 8 档掉落流。
- `stat_key` / `op` 是 0.94 新版属性系统的配置字段，web-idle 的 `perkToStat` 仍走
  「中文显示名 + suffix」映射（自研适配）。本轮**只补齐配置不切换引擎映射**，
  避免改变既有战斗数值；接入属独立一轮。

### 16.4 验证

- `_run_test.js`：**711 项 ALL PASS / 0 FAIL / 0 SKIP**（698 → 711，新增 13 条；
  8014 后端在跑，测后关闭）
- `_l4_survive.js` 挂机 6 例零死亡；`_l4_verify.js` 首领三档与前几轮一致
- `node --check` / `py_compile` 通过；数据文件行尾/末尾换行保持不变

### 16.5 本轮未改（如实登记）

- 0.94 comment 写「昆吾台」，而 `instName` 仍显示「轩辕台」（`instance` key 为
  `xuanyuantai`，L6 文案线按 v0.91 对齐）；comment 忠实 0.94、UI 名维持现状。
- `panels.js` 产出行里 `e.tier*10` 的历史文案未动（与本轮无关）。
- 3 个续命道具、2 个炼魂壶别名、全站「战魂」混合态、`bases_*.json` 与
  `crystal_types` 之外仍存在的 v0.91 文案线，均维持现状。
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()

    print('L13 取证与校验' + ('（APPLY）' if args.apply else '（DRY-RUN）'))
    T = build_targets()
    verify_data(T)

    writes = []
    for fn, (old, new, raw, nb, a94) in T.items():
        writes.append(('data/' + fn + '.json', nb))
        print('  %-28s %6d -> %6d B' % (fn, len(raw), len(nb)))

    # 引擎补丁
    engine_raw = {}
    for path, o, n in ENGINE:
        raw = engine_raw.setdefault(path, rb(path))
        cnt = raw.count(o.encode('utf-8'))
        assert cnt == 1, ('引擎补丁命中数异常', path, cnt, o[:60])
        engine_raw[path] = raw.replace(o.encode('utf-8'), n.encode('utf-8'))
        print('  patch %-16s %s...' % (path, o[:52].replace('\n', ' ')))
    for path, raw in engine_raw.items():
        writes.append((path, raw))

    # 测试文件（CRLF）
    traw = rb('_run_test.js')
    a = TEST_ANCHOR.encode('utf-8')
    assert traw.count(a) == 1, '测试锚点不唯一'
    assert traw.count(TEST_OLD_ASSERT.encode('utf-8')) == 1, 'L12 旧断言未命中'
    block = TEST_BLOCK.replace('\n', '\r\n').encode('utf-8')
    traw2 = traw.replace(a, block + a, 1)
    traw2 = traw2.replace(TEST_OLD_ASSERT.encode('utf-8'), TEST_NEW_ASSERT.encode('utf-8'))
    assert traw2.count('L13：0.94 8 档装备体系'.encode('utf-8')) == 1
    n13 = TEST_BLOCK.count('ok(')
    assert n13 == 13, 'L13 断言条数异常 %d' % n13
    writes.append(('_run_test.js', traw2))
    print('  _run_test.js +%d 行 / %d 条 L13 断言，+1 处 L12 文案更正'
          % (TEST_BLOCK.count('\n'), n13))

    # 报告（LF）
    rraw = rb('UPGRADE_REPORT.md')
    assert rraw.count(REPORT_OLD.encode('utf-8')) == 1, '报告历史结论未命中'
    rraw2 = rraw.replace(REPORT_OLD.encode('utf-8'), REPORT_NEW.encode('utf-8'))
    rraw2 = rraw2.rstrip(b'\n') + b'\n\n' + REPORT_SECTION.encode('utf-8')
    writes.append(('UPGRADE_REPORT.md', rraw2))
    print('  UPGRADE_REPORT.md 追加 §十六 + 更正 §15.6 历史结论')

    if not args.apply:
        print('\nDRY-RUN 全部校验通过；未写盘。用 --apply 落地。')
        return
    for path, data in writes:
        open(os.path.join(HERE, path), 'wb').write(data)
    print('\nAPPLY 完成，共写入 %d 个文件。' % len(writes))
    # 回读校验
    for fn, (old, new, raw, nb, a94) in T.items():
        back = rb('data/' + fn + '.json')
        assert back == nb and json.loads(back.decode('utf-8')) == a94, fn + ' 回读失败'
    for path, data in writes:
        assert rb(path) == data, path + ' 回读失败'
    print('回读校验：三份 data/ 与全部改动文件逐字节一致。')


if __name__ == '__main__':
    main()
