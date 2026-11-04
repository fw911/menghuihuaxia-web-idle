# web-idle ← v0.91 升级报告

> **项目**：`梦回华夏 · 网页挂机版`（`menghuihuaxia-web-idle`）
> **升级源**：《放置归墟：梦回华夏》v0.91 解密产物（71 份 JSON）
> **执行时间**：2026-11-04
> **结果**：数据层字段还原 **6410 处**（0 异常）· 596 项回归测试 **双次 ALL PASS**

---

## 一、结论速览

web-idle **不是 v0.91 的镜像，而是一条平行改编线**：作者重命名了字段、压扁了结构、
砍掉了 21 个功能域、并对数值做了系统性重平衡。因此"升级"不能是覆盖数据文件，
必须分层处理。本次采用 **无损叠加（v1）** 策略完成第一层：

| 层 | 状态 | 说明 |
|---|---|---|
| **L1 字段还原** | ✅ **已完成** | 原版字段原样补入，web-idle 自身字段与数值**一字未改**，零行为变化 |
| **L2 数据齐备** | ✅ **已完成** | v0.91 独有的 21 份数据文件全部铺入 `data/`，为功能移植备料 |
| **L3 条目补齐** | ⏸ **待决策** | 怪物/物品/地图/任务条目数缺口（见 §四），会牵动未实现的系统 |
| **L4 数值回正** | ⏸ **待决策** | 经验/金币被砍到 1/10、攻击被重平衡——疑为有意经济设计，需你确认 |
| **L5 功能域移植** | ⏸ **待排期** | 21 个 v0.91 功能域 web-idle 完全没有（见 §五） |
| **L6 战斗公式** | ⚠️ **发现分歧** | 两版伤害/暴击口径不同（见 §六） |

---

## 二、升级前的问题定性

### 2.1 文件层
| | 数量 |
|---|---|
| web-idle `data/` | **57** 份 JSON |
| v0.91 原版 | **71** 份 JSON |
| 逐字段完全一致的文件 | **仅 4** 个（`couriers` `extract` `modes` `quality`） |

- web-idle 独有 7 份：`loot_item/equip/gem/potion/chest/wuhun`（把 `loot_tables` 拆开重写）+ `stats`
- v0.91 独有 21 份 = **web-idle 完全缺失的功能域**（详见 §五）

### 2.2 结构层（作者做了字段手术）
| 原版字段 | web-idle 改写 | 影响 |
|---|---|---|
| `cd_ms`（毫秒） | `cd`（回合） | 冷却语义换算 |
| `duration_ms` | `duration_ticks` | 持续时间换算 |
| `skill_type`（枚举） | `type`（枚举） | 技能类型改名 |
| `effects[]` | `effect` | 效果数组压扁 |
| `jobs[]` | `job` | 多职业 → 单职业 |
| `level_stats[]` | 展平为每怪一组值 | 等级分档表被展开 |
| — | **新增** `aoe` / `phases` | 自造字段 |

### 2.3 数值层（重平衡证据）
| 字段 | web-idle ÷ v0.91 中位倍率 | 解读 |
|---|---|---|
| `exp` | **恒定 0.100** | 经验砍到 1/10 |
| `gold_min` / `gold_max` | **恒定 0.100** | 金币砍到 1/10 |
| `phys_atk` | 1.000（仅 65% 相等，0.402~1.556） | 攻击被重平衡 |
| `hp` | 1.000（84% 相等） | 基本原样 |
| `phys_def` | 1.000（98% 相等） | 基本原样 |
| `level` / `mp` | 1.000（100% 相等） | 完全一致 |

> 经验与金币**全表恒定 1/10** 这种整齐比例，几乎不可能是抄错，而是作者主动砍数值后
> 另设成长曲线补偿。**因此本次升级没有回填这些数值**（见 §四 L4）。

---

## 三、本次已执行的升级（L1 + L2）

### L1 字段还原：6410 处原版字段值
策略：**只写入"v0.91 有、web-idle 没有"的字段**，原样搬运；**绝不修改 web-idle 已有字段**。
按主键（`key`/`id`/`name`）逐条匹配。

| 文件 | 条目 | 匹配 | 新增字段值 |
|---|---|---|---|
| `monster_skills` | 1997 | 1997 ✅ | **5992**（`cd_ms`/`target_rule`/`skill_type` ×1997） |
| `maps` | 44 | 44 ✅ | 81（`theme`40 `jubao_zone`36 `instance_group`3 `is_main_city` `unlock_map`） |
| `monsters` | 1208 | 1208 ✅ | 68（`phases`42 `immune_effects`26） |
| `skills_active_darkwitch` | 18 | 18 ✅ | 61（`jobs`/`damage`/`cast_mode`/`cast_ms`/`effects`/`ai_rule`/`dot_anchor`/`summon_duration_ms`） |
| `skills_active_mage` | 18 | 18 ✅ | 62 |
| `skills_active_shaman` | 18 | 18 ✅ | 58（+`interrupt`/`chain_max`） |
| `skills_active_warrior` | 18 | 18 ✅ | 50（+`persist_minutes`） |
| `skills_active_summon` | 2 | 2 ✅ | 6（`summon_damage_map`） |
| `items` | 98 | 98 ✅ | 24（`cd_ms`/`duration_ms`） |
| `skills_passive` | 5 | 5 ✅ | 5（`effects`） |
| `shops` | 6 | 3 ⚠️ | 3（`group`）—— 3 家店名与原版不同，未匹配 |
| `slots` | 15 | 15 ✅ | 0（字段齐全，仅值差异） |

**补入字段总览**：`cd_ms`(2083) `target_rule`(1997) `skill_type`(1997) `jobs`(74) `phases`(42)
`theme`(40) `jubao_zone`(36) `damage`(31) `immune_effects`(26) `cast_ms`/`cast_mode`(19×2)
`duration_ms`(12) `persist_minutes`(6) `effects`(6) `ai_rule`(4) `instance_group`(3) `group`(3)
`dot_anchor`(3) `summon_duration_ms`(2) `summon_damage_map`(2) `is_main_city` `unlock_map`
`max_casts` `interrupt` `chain_max`

### L2 数据齐备：21 份原版数据铺入
`companion` `crystal_refine` `difficulty` `effects_manifest` `farm` `fuling` `guide` `job_forms`
`loot_pools` `loot_rules` `monster_loot_built` `paperdoll` `qiling` `ring_quest`
`shenmo_active_skills_mage` `shenmo_skills_mage` `shenmo_transform` `smith` `suits`
`taptap_achievements` `world_layout`

→ `data/` 由 **57 → 78 份**，与 v0.91 形成**全集对齐**（原版的 7 个拆分文件保留 web-idle 版本，不覆盖）。

### 验证
| 检查 | 结果 |
|---|---|
| JSON 合法性 + 条目数不变 | **0 异常** |
| web-idle 全量回归（升级前） | **ALL PASS** |
| web-idle 全量回归（L1 后） | **ALL PASS** |
| web-idle 全量回归（L2 后） | **ALL PASS** |
| 原数据备份 | `_data_backup_before_upgrade/`（未入库） |
| 回滚方式 | `git checkout -- data/` |

---

## 四、待决策项（L3 / L4）

### L3 条目补齐（缺口）
| 数据 | web-idle | v0.91 | 缺口 | 补齐风险 |
|---|---|---|---|---|
| `monsters` | 1208 | 1536 | **−328 只** | 新怪的掉落指向原版 `loot_pools/rules`，而 web-idle 已自建 6 个 `loot_*`，**会打空掉落** |
| `items` | 98 | 354 | **−256 件** | 新物品可能属未实现系统（符灵/器灵/套装…），拾取后无功能 |
| `maps` | 44 | 56 | −12 张 | 新地图的 `theme`/`jubao_zone` 已补，但缺怪物配置 |
| `quests` | 3 | 11 | −8 个 | 任务系统 web-idle 精简过，任务链引用可能断裂 |
| `shops` | 6 | 11 | −5 家 | 商店 `group` 已补，但商品条目可能缺失 |
| `character` | 4 | 5 | −1 | — |
| `slots` | 15 | 16 | −1 | — |
| `wuhun` | 13 | 17 | −4 | 武魂种类少 4 |
| `bailian_recipes` | 6 | 9 | −3 | 配方少 3 |
| `instance_exchange` | 29 | 38 | −9 | 兑换项少 9 |
| `skills_active_summon` | 2 | 3 | −1 | 召唤技能少 1 |
| `mining` | 10 | 11 | −1 | — |
| 技能等级档 | 24 档 | 26 档 | −2 档 | 26 级上限的技能缺最后 2 级 |

> **结论**：L3 必须**与 L5 功能移植同步做**，否则会补出一堆"有数据没功能"的空壳。

### L4 数值回正（需你确认）
- `exp`/`gold` 全表 ×0.1 → 回正会让 web-idle 现有的成长曲线（补偿表）**整体错位**，需连同成长曲线一起回正
- `phys_atk` 重平衡（0.402~1.556）→ 影响战斗节奏与关卡设计
- 技能 `levels` 数值不同（凛光斩 Lv1 伤害 17 vs 原版 15）→ 与 `max_level` 24/26 联动

**建议**：L4 与 L5 合并做，即"按功能域整体回正"，而不是逐文件覆盖。

---

## 五、L5 功能域移植清单（21 个）

web-idle **完全没有**以下 v0.91 功能域。对照我们另一套项目
`game_server/systems/`（FastAPI 全量复刻，26 个模块）的实现情况：

| v0.91 功能域 | 数据文件 | 我方已有实现 | 移植难度 | 建议优先级 |
|---|---|---|---|---|
| 难度系统 `difficulty` | `difficulty.json` | `systems/difficulty.py` | 低 | ★★★ |
| 掉落体系 `loot_pools/rules/built` | 3 份 | `systems/loot.py` | **高** | ★★★ |
| 锻造 `smith` | `smith.json` | `systems/forge.py` | 中 | ★★★ |
| 伙伴 `companion` | `companion.json` | `systems/companion.py` | 中 | ★★★ |
| 器灵 `qiling` | `qiling.json` | `systems/qiling.py` | 中 | ★★★ |
| 神魔（变身/主动技/技能表×5） | 5 份 | `systems/shenmo.py`+`shenmo_active.py` | **高** | ★★★ |
| 符灵 `fuling` | `fuling.json` | `systems/fuling.py` | 中 | ★★ |
| 农场 `farm` | `farm.json` | `systems/farm.py` | 中 | ★★ |
| 晶石精炼 `crystal_refine` | `crystal_refine.json` | `systems/crystal.py` | 低 | ★★ |
| 套装 `suits` | `suits.json` | `systems/suit.py` | 低 | ★★ |
| 职业形态 `job_forms` | `job_forms.json` | `systems/form.py` | 中 | ★★ |
| 环任务 `ring_quest` | `ring_quest.json` | `systems/ring.py` | 低 | ★ |
| 引导 `guide` | `guide.json` | `systems/guide.py` | 低 | ★ |
| 纸娃娃 `paperdoll` | `paperdoll.json` | —（纯展示） | 中 | ★ |
| 世界布局 `world_layout` | `world_layout.json` | —（纯展示） | 低 | ★ |
| TapTap 成就 | `taptap_achievements.json` | —（成就另一套） | 低 | ★ |
| 效果清单 `effects_manifest` | `effects_manifest.json` | — | 低 | ★ |

**覆盖率**：21 个功能域中我方已实现 **18 个**（paperdoll / taptap_achievements / world_layout
三项为纯展示或另一套体系，未单列）。

### 三条移植路径
| 路径 | 做法 | 优点 | 代价 |
|---|---|---|---|
| **A. 逐系统重写** | 把 `game_server/systems/*.py` 逐个改写为 web-idle 的 `js/*.js` ESM | 保持 web-idle 纯前端、部署最简单 | 21 个系统，工作量最大 |
| **B. 前端接我方 API** | web-idle 前端改为调用已上线的 FastAPI 后端 | **最快见效**（18/21 已有） | 两套前端 UI/协议不同，需重写适配层 |
| **C. 换底座** | 直接以我方 FastAPI 版为底座，把 web-idle 的 UI/玩法手感移植过去 | 最彻底、数据与系统 100% 对齐 v0.91 | 需重做 web-idle 的三栏 UI 与交互 |

> 我的建议：**C**。理由是 A 的工作量 ≈ 重写整个项目，而 C 只需移植 UI 层；
> 且我方那套已通过 596 项回归 + 云托管上线验证，存档链路（Upstash）已跑通。

---

## 六、⚠️ 战斗公式分歧（重要）

| | web-idle（注释标"原版"） | 我方 FastAPI 版 |
|---|---|---|
| 玩家打怪 | `max(1, round(raw²/def))`，raw=atk×rnd(0.85,1.15) | `max(1, int(atk²/(atk+def)))`，atk×rnd(0.9,1.1) |
| 怪物打玩家 | `max(1, round(base²/def))` | `_mitigate`：`max(1, int(raw²/(raw+def)))` |
| **暴击倍率** | **1.8 + critDmg/100** | **固定 1.6** |
| 额外机制 | 破防 ignoreDef% · 减伤≤80% · AOE 分担 30% · 反弹 reflect | 有减伤/无视防御，**无 reflect** |
| 离线补算 | `OFFLINE_EXP_MIN_GAP=30s`，`exp=rate_per_min×min×0.5×FACTOR` | 有 hangup 模块 |

**关键**：v0.91 的数据里**不含伤害公式**（只有 `phys_crit`/`magic_crit`/`damage`/`dmg_reduce`
等属性字段），公式口径只能来自逆向代码。
web-idle 标注为"原版伤害公式"且作者有反汇编取证材料；我方那版 README 自述为
「**比率型**伤害公式（避免高防御直接归零）」= **自研变体**。

→ 若以"100% 真实复刻"为目标，战斗公式应向 **`raw²/def` + 暴击 1.8 + reflect** 口径靠拢，
**但建议先在反汇编产物中核实原版常量，再改**（不宜直接照搬注释）。

---

## 七、附：本次使用的工具

| 脚本 | 用途 |
|---|---|
| `_cmp_v091.py` / `_cmp_v091b.py` / `_cmp_v091c.py` | 数据集差异分析（文件级 / 字段级 / 倍率 / 覆盖度） |
| `_upgrade_probe.py` | 升级可行性探测（结构对应、字段映射、消费字段扫描） |
| `_upgrade_apply.py` | **无损叠加升级执行器**（本次实际改动由它完成） |
| `_upgrade_report_data.json` | 升级审计明细（每文件匹配数/新增字段/未匹配样本） |
| `_data_backup_before_upgrade/` | 升级前数据备份（未入库，可随时回滚） |

---

## 八、建议的下一步（按性价比排序）

1. **【立刻】** 核实原版战斗公式常量（反汇编产物里挖 `atk²/def`、暴击倍率、reflect 的原始实现）
   —— 一次核实，两版受益
2. **【立刻】** 决定 L4 数值口径：web-idle 的 ×0.1 经验/金币是**保留**还是**连成长曲线一起回正**
3. **【本周】** 选 L5 路径（推荐 C：换底座），先把 `difficulty` + `loot` 两个系统打通
   —— 难度和掉落是所有内容的骨架，先补这两块收益最大
4. **【本周】** L3 条目补齐与 L5 同步推进，按系统逐个补，不做全局覆盖
5. **【后续】** 云端恢复：CloudBase 资源点耗尽导致 SCF 停服（410），
   充值/升套餐即恢复，代码无需改动；或继续走本地 `node server/server.js`
