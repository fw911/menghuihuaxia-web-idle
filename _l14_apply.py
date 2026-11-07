# -*- coding: utf-8 -*-
"""L14：按 v0.94 官方发行版回正「生活 / 生产 / 锻造」系统的数值与结构配置。

取证来源：E:/放置归墟：梦回华夏 _v0.94/config_enc/*.json.enc（AES-256-CBC，
派生密钥见 _l13_dis_v094.py），并用 BACKHX_v0.94.exe 常量池/docstring 交叉验证：
  - SMITH_MERGE_LADDER docstring「1:90% / 2:45% / 3:32% / 4:18% / 5:10%」
    == 0.94 merge_ladder.perk_cum，web-idle 全为 1.0 ⇒ 自研压平
  - FULING_HP_BASE / CRAFT_UPGRADE_MAX_TIER / teleport_charges / cooldown_minutes
    / exclude_maps / byproducts / src_count 均出现在 0.94 代码常量池

本轮边界：**只对齐数值与结构**；name/desc/icon/result_name/src_name/dst_name 等
展示文案差异属于 0.94 整套改名线（淬锋丹 / 玄璧石 / 焚髓碧玉 / 蕴元瓶 …），
牵动 items.json、js UI 硬编码与既有断言，整体保留并登记为下一轮。

用法：python _l14_apply.py [--apply]   （不带参数 = dry-run）
"""
import base64, copy, hashlib, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
ENC = r'E:/放置归墟：梦回华夏 _v0.94/config_enc'
APPLY = '--apply' in sys.argv

K = hashlib.pbkdf2_hmac(
    'sha256',
    base64.b64decode('kUmtE1a7/jQ7LdM04YhJYXKhRvwaQZ6vqY1YRyIbsr8='),
    b'MH_CONFIG_ENC_SALT_v1', 200000, 32)


def dec(fn):
    d = open(os.path.join(ENC, fn + '.json.enc'), 'rb').read()
    assert d[:9] == b'CONFIGENC', fn
    r = subprocess.run(['openssl', 'enc', '-d', '-aes-256-cbc',
                        '-K', K.hex(), '-iv', d[9:25].hex()],
                       input=d[25:], capture_output=True)
    assert r.returncode == 0, (fn, r.stderr[:200])
    return json.loads(r.stdout.decode('utf-8'))


def web(fn):
    return json.load(open(os.path.join(ROOT, 'data', fn + '.json'), 'r', encoding='utf-8'))


def webraw(fn):
    return open(os.path.join(ROOT, 'data', fn + '.json'), 'rb').read()


# ---------- 路径工具 ----------
def leaves(x, p=''):
    o = {}
    if isinstance(x, dict):
        for k, v in x.items():
            o.update(leaves(v, (p + '.' + str(k)) if p else str(k)))
    elif isinstance(x, list):
        for i, v in enumerate(x):
            o.update(leaves(v, p + '[%d]' % i))
    else:
        o[p or '/'] = x
    return o


def parse(p):
    return [int(s[1:-1]) if s.startswith('[') else s
            for s in re.findall(r'[^.\[\]]+|\[\d+\]', p)]


def get(o, p):
    for k in parse(p):
        o = o[k]
    return o


def setp(o, p, v):
    ks = parse(p)
    cur = o
    for k in ks[:-1]:
        cur = cur[k]
    cur[ks[-1]] = v


# 展示文案字段：这些「值不同」保持 web 现状，登记为 L15 改名线
TEXT_FIELDS = {'name', 'desc', 'icon', 'flavor', 'result_name', 'src_name',
               'dst_name', 'comment', '_comment', 'title', 'lore', 'time',
               'fmt', 'label', 'text', 'flavor_text'}
# 例外：fuling.comment / version 记录 v1.9 的 hp_base 依据，属于数值口径，按 0.94 回正
FORCE_ALIGN = {'fuling': {'comment'}}

# 可以「按原格式零差异重建」的文件：(indent, eol, tail)
REBUILD = {
    'craft':            (2, '\r\r\n', '\r\r\n'),
    'fuling':           (2, '\r\n',   ''),
    'qiling':           (2, '\r\n',   ''),
    'furnace_recipes':  (2, '\r\r\n', ''),
    'smith':            (2, '\r\n',   ''),
    'ring_quest':       (2, '\r\n',   ''),
    'mining':           (2, '\r\n',   ''),
    'gem_recipes':      (2, '\r\r\n', ''),
    'bailian_recipes':  (2, '\r\n',   ''),
}
# 历史畸形排版：只能定点插入（整文件重排会产生海量 diff）
POINT = ['loot_probs', 'ore_recipes', 'potion_recipes']
FILES = list(REBUILD) + POINT


def build_final(fn):
    """以 0.94 对象为骨架，仅回填 web 的展示文案叶子，得到最终对象。"""
    ref, old = dec(fn), web(fn)
    lr, lo = leaves(ref), leaves(old)
    changed = {p for p in (set(lr) & set(lo)) if lr[p] != lo[p]}
    keep = set()
    for p in changed:
        field = re.sub(r'\[\d+\]$', '', p.rsplit('.', 1)[-1])
        if field in TEXT_FIELDS and p not in FORCE_ALIGN.get(fn, set()):
            keep.add(p)
    numeric_aligned = changed - keep
    assert all(re.sub(r'\[\d+\]$', '', p.rsplit('.', 1)[-1]) not in TEXT_FIELDS
               or p in FORCE_ALIGN.get(fn, set())
               for p in numeric_aligned), '%s 数值差异里混入展示字段' % fn

    # 以 0.94 为骨架：数值 / 结构自动对齐，仅把展示文案回填成 web 现状
    final = copy.deepcopy(ref)
    for p in keep:
        setp(final, p, lo[p])

    # 强校验 1：final 与 0.94 的差异恰好等于 keep（展示文案线）
    lf = leaves(final)
    d1 = {p for p in set(lf) | set(lr) if lf.get(p, '<NA>') != lr.get(p, '<NA>')}
    assert d1 == keep, '%s 与 0.94 差异集合不符: %s' % (fn, sorted(d1 ^ keep)[:12])
    # 强校验 2：final 相对 web 的差异全部是「数值改变 / 结构增删」，不含任何展示文案
    d2 = {p for p in set(lf) | set(lo) if lf.get(p, '<NA>') != lo.get(p, '<NA>')}
    bad = [p for p in d2
           if re.sub(r'\[\d+\]$', '', p.rsplit('.', 1)[-1]) in TEXT_FIELDS
           and p not in FORCE_ALIGN.get(fn, set())]
    assert not bad, '%s 意外改动展示文案: %s' % (fn, bad[:8])
    return final, keep, d2


def rebuild_bytes(fn, final):
    indent, eol, tail = REBUILD[fn]
    s = json.dumps(final, ensure_ascii=False, indent=indent).replace('\n', eol)
    return (s + tail).encode('utf-8')


def point_patch(fn, final):
    """对 3 个畸形排版文件做定点插入，原文其余字节一字不动。"""
    old = webraw(fn)
    txt = old.decode('utf-8')
    E = '\r\r\n'
    if fn == 'loot_probs':
        for key, oldline in [
            ('elite', '  "elite":  { "rolls": 2, "probs": [0.03, 0.02] },'),
            ('boss',  '  "boss":   { "rolls": 3, "probs": [0.3, 0.1, 0.05] },'),
        ]:
            assert txt.count(oldline + E) == 1, (fn, key, '原行未唯一命中')
            lines = json.dumps(final[key]['segments'], ensure_ascii=False,
                               indent=2).split('\n')
            seg = lines[0] + E + E.join('    ' + l for l in lines[1:])
            body = ('  "%s":  { "rolls": %d, "probs": %s,' % (
                key, final[key]['rolls'],
                json.dumps(final[key]['probs'], ensure_ascii=False))
                + E + '    "segments": ' + seg + E + '  },')
            txt = txt.replace(oldline + E, body + E)
        return txt.encode('utf-8')

    # ore_recipes / potion_recipes：只在每个配方对象末尾（"obtain": [] 之前）插入 sources
    keys = [k for k in final if 'sources' in final[k]]
    assert keys, fn
    for key in keys:
        marker = '  "' + key + '": {'
        assert txt.count(marker) == 1, (fn, key, '对象起点')
        st = txt.index(marker)
        depth, end = 0, None
        for i in range(st + len(marker) - 1, len(txt)):
            if txt[i] == '{':
                depth += 1
            elif txt[i] == '}':
                depth -= 1
                if depth == 0:
                    end = i
                    break
        assert end is not None, key
        span = txt[st:end]
        needle = '    "obtain": []'
        assert span.count(needle) == 1, (fn, key, 'obtain 锚点')
        lines = json.dumps(final[key]['sources'], ensure_ascii=False,
                           indent=2).split('\n')
        block = lines[0] + E + E.join('    ' + l for l in lines[1:])
        ins = '    "sources": ' + block + ',' + E
        txt = txt[:st] + span.replace(needle, ins + needle) + txt[end:]
    return txt.encode('utf-8')


# ---------- 引擎：宝石炼制改读 0.94 gem_recipes[].src_count ----------
LIFE_OLD = """  if(gemCount(series, grade) < 4){ log('<span class="dmg">需要 '+r.src_name+' x4</span>'); return; }
  if(!useMaterial(r.bottle_key||'lianhua_ping', 1)){ log('<span class="dmg">需要炼化瓶 x1</span>'); return; }
  gemConsume(series, grade, 4);"""
LIFE_NEW = """  // L14：0.94 gem_recipes[].src_count 配置驱动（官方全表 4，缺省兜底 4）
  const need = r.src_count || 4;
  if(gemCount(series, grade) < need){ log('<span class="dmg">需要 '+r.src_name+' x'+need+'</span>'); return; }
  if(!useMaterial(r.bottle_key||'lianhua_ping', 1)){ log('<span class="dmg">需要炼化瓶 x1</span>'); return; }
  gemConsume(series, grade, need);"""

TEST_BLOCK = """
    // L14：0.94 生活/生产系统数值与结构对齐（展示文案线保留，见报告 §十七）
    {
      const D = E.DATA;
      // fuling / qiling / smith / ring_quest 未列入 DATA_FILES（引擎未接入的系统），测试直读配置
      const RD = f => JSON.parse(fs.readFileSync(path.join(DIR, f + '.json'), 'utf8'));
      ok('0.94 百炼上限 7→8（与 L13 的 8 档装备体系配套）',
        D.craft.craft_upgrade_max_tier === 8 && !!D.bailian_recipes.level_8);
      const fu = RD('fuling');
      const hp = Object.keys(fu.hp_base).map(Number).sort((a,b)=>a-b)
        .map(k => fu.hp_base[k]);
      ok('0.94 附灵 v1.9：hp_base 109~417 等差 44，version/comment 同步',
        fu.version === '1.9' && hp[0] === 109 && hp[7] === 417 &&
        hp.every((v,i) => i === 0 || v - hp[i-1] === 44) &&
        fu.comment.indexOf('v1.9') >= 0);
      const qi = RD('qiling');
      ok('0.94 器灵传送次数 0/3/5（web 自研 999 无限已撤销），冷却 1→10 分钟',
        JSON.stringify(qi.carriers.map(c => c.teleport_charges)) === '[0,3,5]' &&
        qi.teleport.cooldown_minutes === 10);
      const boxes = Object.keys(D.furnace_recipes).filter(k => k.indexOf('box_') === 0);
      ok('0.94 宝匣合成 src_count 50→5 且 6 条金币费回正（15/25/42/58/83/100）',
        boxes.length === 6 && boxes.every(k => D.furnace_recipes[k].src_count === 5) &&
        JSON.stringify(boxes.map(k => D.furnace_recipes[k].gold_cost).sort((a,b)=>a-b))
          === '[15,25,42,58,83,100]');
      const sm = RD('smith');
      ok('0.94 锻造词条数权重 50/35/15（web 压平成 9:100）',
        JSON.stringify(sm.forge.perk_count_weights) === '{"1":50,"2":35,"3":15}');
      ok('0.94 打孔权重 40/30/20/10（web 压平成 3:100）',
        JSON.stringify(sm.forge.hole_weights) === '{"0":40,"1":30,"2":20,"3":10}');
      ok('0.94 合成阶梯 perk_cum 90/45/32/18/10%（exe docstring 取证）',
        JSON.stringify(Object.values(sm.merge_ladder.perk_cum)) === '[0.9,0.45,0.32,0.18,0.1]' &&
        JSON.stringify(Object.values(sm.merge_ladder.hole_cum)) === '[0.9,0.45,0.2]');
      ok('0.94 loot_probs 补 elite/boss 各 5 段 segments，boss s4 = 2 掷 [0.5,0.25]',
        Object.keys(D.loot_probs.elite.segments).length === 5 &&
        Object.keys(D.loot_probs.boss.segments).length === 5 &&
        D.loot_probs.boss.segments.s4.rolls === 2 &&
        JSON.stringify(D.loot_probs.boss.segments.s4.probs) === '[0.5,0.25]' &&
        D.loot_probs.normal.rolls === 1);
      ok('0.94 巡天六祭补 exclude_maps（百兽谷 / 栖霞岭）',
        JSON.stringify(RD('ring_quest').exclude_maps) === '["baishougu","qixingling"]');
      ok('0.94 探矿补上品罗盘副产物（秘银砂 5% ×2）',
        D.mining.mining.byproducts.sanpin.length === 1 &&
        D.mining.mining.byproducts.sanpin[0].key === 'miyinsha' &&
        D.mining.mining.byproducts.sanpin[0].prob === 0.05 &&
        D.mining.mining.byproducts.sanpin[0].count === 2);
      const ores = Object.keys(D.ore_recipes);
      ok('0.94 4 条矿石配方均补 sources 三来源说明',
        ores.length === 4 && ores.every(k =>
          D.ore_recipes[k].sources && Object.keys(D.ore_recipes[k].sources).length === 3));
      const pots = Object.keys(D.potion_recipes);
      ok('0.94 3 条药水配方均补 sources 三来源说明',
        pots.length === 3 && pots.every(k =>
          D.potion_recipes[k].sources && Object.keys(D.potion_recipes[k].sources).length === 3));
      const gems = Object.keys(D.gem_recipes);
      ok('0.94 宝石配方补 src_count=4 / sources，引擎改为配置驱动',
        D.gem_recipes.recipe_gem_beidou_石.src_count === 4 &&
        gems.filter(k => D.gem_recipes[k].src_count === 4).length >= 12 &&
        E.gemRecipeFor('beidou', '石').src_count === 4);
      const bl = Object.keys(D.bailian_recipes).filter(k => k.indexOf('level_') === 0);
      ok('0.94 淬锋丹 8 级配方每条材料都补 source 说明且展示文案线原样保留',
        bl.length === 8 && bl.every(k => D.bailian_recipes[k].materials.every(m => !!m.source)) &&
        D.bailian_recipes.level_1.name.indexOf('百炼丹') >= 0);
      ok('0.94 引擎仍按 loot_probs.rolls/probs 掷骰（segments 未消费，配置忠实）',
        typeof E.rollLoot === 'function' && D.loot_probs.boss.rolls === 3);
    }
"""

REPORT = """

## 十七、L14 按 v0.94 回正生活 / 生产 / 锻造系统数值与结构

### 17.1 取证：又一处「web-idle 自研压平」

全库盘点 `config_enc` 74 份与 `data/*.json` 71 份同名文件，**25 份已逐字段全等**。
`bases_*` 5 份按数组下标比对显示 84~98 处差异，但按 `key` 复核后**全部为零差异**
（纯数组顺序不同，不属漂移）。真差异里有一组与 L7/L8 同类的系统性压平：

| 配置 | web-idle | 0.94 官方真值 | 取证 |
|---|---|---|---|
| `smith.forge.perk_count_weights` | `1..8=0, 9=100` | `1:50 / 2:35 / 3:15` | exe 常量池 `SMITH_FORGE` / `_pick_perk_count` |
| `smith.forge.hole_weights` | `0..2=0, 3=100` | `0:40 / 1:30 / 2:20 / 3:10` | 同上 |
| `smith.merge_ladder.perk_cum` | 1..9 全 `1.0` | `0.9 / 0.45 / 0.32 / 0.18 / 0.1` | exe docstring 原文「1:90% / 2:45% / 3:32% / 4:18% / 5:10%」，并注明 `P(k)=P(k)-P(k+1)` 差分口径 |
| `furnace_recipes.box_*`（6 条） | `src_count=50`、金币 ×3 | `src_count=5`、`15/25/42/58/83/100` | `config_enc/furnace_recipes.json.enc`；`js/life.js:528` 直接消费 |
| `qiling.carriers[].teleport_charges` | `999`（无限传送） | `0 / 3 / 5` | exe 常量池 `charges_max` / `_teleport_charges_now`；冷却 1→10 分钟 |
| `fuling.hp_base` | `24~92`（v1.8） | `109~417` 等差 44（v1.9） | 0.94 `comment` 明载 2026-10-18 拍板「附灵 +7 与 3 颗神石加成平齐」，exe 常量 `FULING_HP_BASE` |
| `craft.craft_upgrade_max_tier` | `7` | `8` | exe 常量 `CRAFT_UPGRADE_MAX_TIER`；与 L13 的 8 档装备体系配套 |

此外 0.94 新增了一批 web-idle 缺失的结构字段：`loot_probs.elite/boss.segments`
（各 5 段）、`ring_quest.exclude_maps`、`mining.byproducts.sanpin`、
`ore_recipes/potion_recipes[].sources`、`gem_recipes[].src_count + sources`、
`bailian_recipes[].materials[].source`。exe 常量池可见 `exclude_maps`、
`byproducts`、`src_count` 的消费代码。

### 17.2 落地

| 文件 | 改动 |
|---|---|
| `data/craft.json` | 百炼上限 7→8 |
| `data/fuling.json` | `hp_base` 8 值、`version` 1.8→1.9、`comment` v1.9 依据 |
| `data/qiling.json` | 3 条 `teleport_charges` 999→0/3/5、`teleport.cooldown_minutes` 1→10 |
| `data/furnace_recipes.json` | 6 条宝匣 `src_count` 50→5 + `gold_cost` ×1/3（12 处） |
| `data/smith.json` | 31 处权重/阶梯回正，删 10 个 web 自研压平键 |
| `data/loot_probs.json` | 补 elite/boss `segments` 共 23 个叶子 |
| `data/ring_quest.json` | 补 `exclude_maps` |
| `data/mining.json` | 补 `byproducts.sanpin` |
| `data/ore_recipes.json` / `potion_recipes.json` | 补 4+3 条 `sources` |
| `data/gem_recipes.json` | 补 `src_count` + `sources` |
| `data/bailian_recipes.json` | 补 8 级配方每条材料的 `source` |
| `js/life.js` | `doGemRefine` 由硬编码 `4` 改读 `r.src_count || 4`（官方全表 4，零行为变化） |
| `_run_test.js` | +15 条 L14 断言 |

写入方式：9 份可 `json.dumps(indent=2)` 零差异重建的文件按原行尾 / 末尾换行
bytes 直写；`loot_probs` / `ore_recipes` / `potion_recipes` 属历史畸形排版，
走**定点插入**，原文其余字节一字不动。脚本 `_l14_apply.py` 对每份做两条强校验：
① 与 0.94 的差异集合恰好等于展示文案白名单；② 相对 web 的差异不含任何展示文案字段。

### 17.3 关键判定：`loot_probs.segments` 只补数据、不接引擎

0.94 exe 常量池中的 `a_segment_of` / `level_segments` 属于 `loot_rules.json#level_segments`
（`loot_rules.json` 已与 0.94 全等），**未找到 `loot_probs.json#segments` 的消费代码**；
归档标准反汇编也没有该字段。`js/equip.js#rollLoot` 仍按 0.94 的扁平
`rolls` / `probs` 掷骰（该扁平字段两边逐值一致），本轮不改掉落行为，
避免凭空造出无证据的分段逻辑。

同理，`fuling` / `qiling` / `smith` / `ring_quest` **不在 `js/state.js#DATA_FILES`
加载清单里**（web-idle 未接入附灵 / 器灵 / 锻造 / 巡天六祭系统），本轮只回正配置数据，
不扩大引擎加载面；`_run_test.js` 对这 4 份用 `fs.readFileSync` 直读校验，
其余 8 份走 `E.DATA`。把这些系统真正接进引擎属独立一轮。

### 17.4 本轮未改：0.94 整套改名线（登记为 L15）

`items.json` / `ores.json` / `gems.json` **已经是 0.94 命名**（淬锋丹、淬锋石、
焚髓碧玉、潮生水晶、曜纹金矿、晶核刚玉、玄璧、蕴元瓶、初/中/上品勘矿罗盘），
但下列配置仍残留 web-idle 的旧名，属内部不一致，需连同 UI 硬编码与断言一起处理：

| 文件 | 旧名 → 0.94 名 | 牵连 |
|---|---|---|
| `bailian_recipes` | 百炼丹 → 淬锋丹（16 处 + `_meta.comment`） | `js/inlay.js` / `life.js` / `tabs.js` 硬编码、`_run_test.js` 两处 ② 断言 |
| `gem_recipes` | 北斗石/北斗灵石 → 玄璧石/玄璧灵石（77 处） | `E.itemName('beidou_石')` 断言（现为「北斗石」）、`js/inlay.js` 系列说明 |
| `ore_recipes` / `furnace_recipes` | 乌金矿石/六方金刚石/离火翡翠/海魂水晶 → 曜纹金矿/晶核刚玉/焚髓碧玉/潮生水晶（10+2 处） | `js/inlay.js` 提示文案 |
| `mining` | 一/二/三品罗盘 → 初/中/上品勘矿罗盘（3 处） | 面板显示 |
| `guide` | 仙之境静修 → 栖霞秘境静修（1 处） | 全站「仙之境」命名 |
| `potion_recipes` | 玉泉定神液 → 玉泉定神守心液 等（3 处） | 面板显示 |

另：`quests.json` 的「战魂 → 灵兽」整条任务线（48 处）与 `wuhun_recipes.json`
（279 处）绑定 companion / summons / wuhun 全套改造，属独立大工程；
`monster_*` / `shenmo_*` / `achievements` / `shops` 等为已知自研改编线。

### 17.5 验证

- `_run_test.js`：**726 项 ALL PASS / 0 FAIL / 0 SKIP**（711 → 726，新增 15 条）
- `_l4_survive.js` 挂机 6 例零死亡；`_l4_verify.js` 首领三档与前几轮一致
- `node --check` / `py_compile` 通过；12 份数据回读后「除展示文案外与 0.94 全等」
"""


def main():
    print('=== L14 %s ===' % ('APPLY' if APPLY else 'DRY-RUN'))
    writes = {}

    for fn in FILES:
        final, keep, changed = build_final(fn)
        new = rebuild_bytes(fn, final) if fn in REBUILD else point_patch(fn, final)
        raw = webraw(fn)
        # 行尾基调保持
        eol = '\r\r\n' if REBUILD.get(fn, (None, '\r\r\n'))[1] == '\r\r\n' else '\r\n'
        assert new.count(b'\n') == new.count(eol.encode()), '%s 行尾被破坏' % fn
        # 回读：与内存对象一致
        back = json.loads(new.decode('utf-8'))
        assert back == final, '%s 回读不一致' % fn
        # 强校验 3：与 0.94 的差异仍只有展示文案
        lb, lr = leaves(back), leaves(dec(fn))
        d = {p for p in set(lb) | set(lr) if lb.get(p, '<NA>') != lr.get(p, '<NA>')}
        assert d == keep, '%s 落地后与 0.94 差异异常' % fn
        writes['data/' + fn + '.json'] = new
        print('  %-20s %6d → %6d bytes | 对齐 %3d 处 | 保留文案 %3d 处'
              % (fn, len(raw), len(new), len(changed), len(keep)))

    # 引擎
    lp = os.path.join(ROOT, 'js', 'life.js')
    lraw = open(lp, 'rb').read()
    assert lraw.count(LIFE_OLD.encode('utf-8')) == 1, 'life.js 目标片段未唯一命中'
    writes['js/life.js'] = lraw.replace(LIFE_OLD.encode('utf-8'), LIFE_NEW.encode('utf-8'))
    print('  js/life.js: doGemRefine → r.src_count || 4')

    # 测试
    tp = os.path.join(ROOT, '_run_test.js')
    traw = open(tp, 'rb').read()
    anchor = '    // L12：0.94 _roll_perk_value'.encode('utf-8')
    assert traw.count(anchor) == 1, '_run_test.js L12 锚点未唯一命中'
    block = TEST_BLOCK.replace('\n', '\r\n').encode('utf-8')
    writes['_run_test.js'] = traw.replace(anchor, block + anchor)
    n_ok = len(re.findall(r'\bok\(', TEST_BLOCK))
    print('  _run_test.js: +%d 条 L14 断言' % n_ok)
    assert n_ok == 15, 'L14 断言条数应为 15，实际 %d' % n_ok

    # 报告（LF）
    rp = os.path.join(ROOT, 'UPGRADE_REPORT.md')
    rraw = open(rp, 'rb').read()
    assert '## 十七'.encode('utf-8') not in rraw, '报告已有 §十七'
    writes['UPGRADE_REPORT.md'] = rraw + REPORT.encode('utf-8')
    print('  UPGRADE_REPORT.md: +§十七')

    if APPLY:
        for rel, data in writes.items():
            open(os.path.join(ROOT, rel), 'wb').write(data)
        print('=== 已写入 %d 个文件 ===' % len(writes))
    else:
        print('=== DRY-RUN 全部校验通过，未写入 ===')


if __name__ == '__main__':
    main()
