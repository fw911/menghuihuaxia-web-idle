# 梦回华夏 · 网页挂机版（web_idle）

纯前端零依赖的文字挂机游戏，配置数据来自原版 exe 解密后的 `data/*.json`（57 个 JSON）。

## 运行

```bash
# 方式一：直接用 Node 静态服务（推荐，含云存档后端 API）
node server/server.js        # 默认端口 8014，浏览器打开 http://localhost:8014

# 方式二：任意静态服务器托管本目录（云存档不可用）
python -m http.server 8014
```

> 注意：`data/*.json` 通过 fetch 加载，直接双击 `index.html`（file://）会被浏览器同源策略拦截，必须走 HTTP 服务。
>
> 启动后为**强制登录**：必须注册 / 登录账号才能进入游戏（存档存服务器，换设备可继续）。后端未启动时页面会提示启动命令。

## 目录

| 路径 | 说明 |
| --- | --- |
| `index.html` | 页面结构与样式（三列布局）；以 `<script type="module" src="js/start.js">` 启动 |
| `js/` | 全部游戏逻辑（ES Modules，21 个域模块 + `main.js` 总装 + `start.js` 入口，模块地图见 `js/main.js` 头注） |
| `data/` | 解密后的配置数据（怪物 / 地图 / 装备基底 / 掉落表 / 商店 / 配方 …） |
| `server/server.js` | 零依赖静态服务 + 云存档后端（端口 8014） |
| `cloudfunctions/api/` | 云端部署用 HTTP 云函数（由 server.js 移植，存储切换为 CloudBase NoSQL） |
| `_patch.py` | 生成测试入口 `_test_entry.mjs`（从 `js/main.js` 桶导出 `global.__exp`） |
| `_run_test.js` | 全量回归测试（断言战斗模型、掉落、精炼、称号、物品名等） |
| `_sim_progress.js` / `_sim_boss.js` / `_sim_zoneboss.js` | 数值模拟：推进曲线 / 副本首领 / 野外首领区 |
| `_uicdp.js` | 无头 Chrome 截图 + 布局量化报告 |

> 2026-10-21 起 `game.js`（单文件 IIFE，5253 行）已模块化为 `js/*.js`。切分内容逐字节保留
> （生成时做过等价校验），仅 3 处为跨模块语义必需的微调：`_uid` 计数器改 `_ids` 对象、
> `SKILLS/PASSIVES` 声明随 `loadData` 落到 core、`boot()` 的定时器赋值改走 `setGameTimer()`
> （ES Module 的 imported 绑定只读，跨模块赋值会直接抛错）。回滚点：git tag `pre-modular`。

## 云端部署（腾讯云 CloudBase）

线上版与本地版**同一套前端**，仅后端从 Node 文件存储换成云函数 + NoSQL 文档库：

| 层 | 资源 | 地址 |
| --- | --- | --- |
| 静态站点 | CloudBase 静态托管（`index.html` + `js/` + `data/`） | `https://fw911-d0gy6gkq41d1f6d5a-1512169574.tcloudbaseapp.com/` |
| API | HTTP 云函数 `api`（Nodejs18.15，网关路由 `/api`） | `https://fw911-d0gy6gkq41d1f6d5a-1512169574.ap-shanghai.app.tcloudbase.com/api` |
| 数据 | NoSQL 集合：`users` / `tokens` / `saves` / `leaderboard` / `stats` / `stats_byJob` / `stats_byBand` / `stats_drops` / `ratelimit` | 环境 `fw911-d0gy6gkq41d1f6d5a` |

- **前端如何找到后端**：`js/` 的 `apiProbe()` 按顺序探测 同源 `''` → 云端 API 域 → `localhost:8014`，
  任一候选返回 `{"ok":true}` 即采用，因此本地与线上共用同一份 `js/`。
- **重新部署前端**：把 `index.html` / `js/`（24 个文件，含 `package.json`）/ `data/` 上传到静态托管
  （MCP `manageHosting action=upload`）。注意 `.js` 需以 `text/javascript` 提供（模块脚本 MIME 错误会被浏览器拒绝执行）。
- **重新部署后端**：改 `cloudfunctions/api/index.js` 后 `node --check`，再部署函数代码
  （MCP `manageFunctions action=updateFunctionCode`，`functionRootPath=cloudfunctions`）。
  注意：`scf_bootstrap` 必须存在且 LF 行尾；凭证走函数环境变量 `CLOUDBASE_APIKEY` + `TCB_ENV`，不进代码。
- **IP 限流（双层，防 PBKDF2 爆破 / 防 hammer）**：
  - 实例内固定窗口（内存 Map，全路径）：auth 10/min · save 30/min · stats 20/min · rank 120/min · health 300/min · 其余 120/min；
  - auth 路径（`/register` `/login`）额外走 NoSQL 全局窗口（`ratelimit` 集合，_id=`rl_<ip>_auth`）——
    SCF 多实例内存不共享，纯内存层拦不住顺序爆破，全局层专治这个；DB 异常时放行并打日志；
  - 命中返回 429 + `Retry-After: 60`；`OPTIONS` 预检不计数；客户端 IP 取 `X-Forwarded-For` 首段；
  - `ratelimit` 集合由函数引导时幂等创建（NoSQL 不会自动建集合）。
- **已知平台行为（踩坑记录）**：
  - 静态托管默认域（`*.tcloudbaseapp.com`）是系统保留域，不能挂 `/api` 函数路由，故 API 与静态站不同源；
  - 网关会把请求 Origin 追加到上游 `Access-Control-Allow-Origin` 之后，函数设任何值都会翻倍成非法值，
    因此函数**不设** ACAO，只保留网关的单值回显（CORS 合法）；
  - 该版本 SDK：`doc(id).get()` 对不存在文档返回 `{data: []}`（须归一化为 null）；
    `update()` 对不存在文档是静默无操作；`set()` 不允许带 `_id`——存储层已按这三点处理；
  - SCF 顺序请求多命中新实例（内存态不保留），并发才会复用热实例——限流必须按这个形态设计；
  - NoSQL 集合不会随 `doc().set()` 自动创建，写不存在的集合会抛错。
- **本地自测函数**：不设 `CLOUDBASE_APIKEY` 启动会自动切内存存储（DEV_MEMORY），
  `node cloudfunctions/api/index.js` 后访问 `http://127.0.0.1:9000/api/health`。

## 数据与备份

- **存档位置**：`server/data/saves/<账号>__<槽位>.json`（明文 JSON，每账号 3 槽）。
- **自动备份**：覆盖保存或删除前，后端自动把上一代存档复制为同路径 `.bak`（单代）。
  误删/误覆盖后，把 `xxx__1.json.bak` 改回 `xxx__1.json` 即可恢复。
- **定期备份**：`server/data/` 整个目录拷贝一份即可（含账号、令牌、榜单、统计）。
- **公网部署**：后端无 HTTPS、无速率限制，仅供本机/内网自用；公网请自行加反向代理。
- **历史产物归档**：反汇编取证文本与历史 .bak 已压缩归档到工作区
  `F:\梦回华夏\_archive\`（见其中 README.md），不再滞留本目录。

## 回归验证

```bash
python _patch.py            # 生成 _test_entry.mjs（从 js/main.js 桶导出）
node _run_test.js           # 全量断言（596 项），期望 ALL PASS
node _sim_progress.js       # 长模拟（推进曲线 / 成就 / 区域探索）
```

> 测试管线说明：`_test_entry.mjs` 以 ESM 从 `js/main.js` 再导出全部内部名（`global.__exp`），
> 由 `_run_test.js` 先桩好 DOM/localStorage/fetch 再 `require()`（Node ≥22.12 支持 require(esm)）。
> `js/package.json` 的 `{"type":"module"}` 是给 Node 看的（浏览器不需要），勿删。
> 注意：跑全量回归前先起后端 `node server/server.js`（532 项断言含云存档段，
> 后端不在时「后端探测」按设计 FAIL 并 SKIP 云存档用例，非 bug）。

## 装备耐久（口径备忘）

- 基底数据 `bases_*.json` 每件带 `durability:[n,n]`（等值对，10~45）；原版打造时由
  `stat_roller.roll_durability` 产出，等值对使 roll 结果恒为 n，直接取 `[0]`。
- 部位门控 `slots.json#has_durability`：项链/戒指/武魂为 false → 无耐久字段。
- 精炼每级 `int(d×1.04)` 复合（`refine.json#refine_durability_pct=0.04`）；
  精炼失败降级/归零**不回退**耐久（原版 `_revert_refine_stats` 只回退四维攻防）。
- 原版无耐久消耗/修理/损坏机制——耐久是随精炼成长的静态值，UI 在装备详情行展示。
- 旧存档读档时自动补 `durability`（精炼过的按 ×1.04/级 补回增益，首饰跳过）。

## 说明

- 本仓库只包含可运行的网页版游戏本体，反汇编/解密脚本与产物不在其中。
- 数据来自逆向解密，仅供学习交流。
