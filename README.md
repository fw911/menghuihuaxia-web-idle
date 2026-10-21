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
| `index.html` | 页面结构与样式（三列布局） |
| `game.js` | 全部游戏逻辑（战斗、掉落、打造、精炼、镶嵌、生活技能、神魔、武魂、副本、云存档） |
| `data/` | 解密后的配置数据（怪物 / 地图 / 装备基底 / 掉落表 / 商店 / 配方 …） |
| `server/server.js` | 零依赖静态服务 + 云存档后端（端口 8014） |
| `cloudfunctions/api/` | 云端部署用 HTTP 云函数（由 server.js 移植，存储切换为 CloudBase NoSQL） |
| `_patch.py` | 生成测试副本 `_test_game.js`（注入 `global.__exp` 导出钩子） |
| `_run_test.js` | 全量回归测试（断言战斗模型、掉落、精炼、称号、物品名等） |
| `_sim_progress.js` / `_sim_boss.js` / `_sim_zoneboss.js` | 数值模拟：推进曲线 / 副本首领 / 野外首领区 |
| `_uicdp.js` | 无头 Chrome 截图 + 布局量化报告 |

## 云端部署（腾讯云 CloudBase）

线上版与本地版**同一套前端**，仅后端从 Node 文件存储换成云函数 + NoSQL 文档库：

| 层 | 资源 | 地址 |
| --- | --- | --- |
| 静态站点 | CloudBase 静态托管（`index.html` + `game.js` + `data/`） | `https://fw911-d0gy6gkq41d1f6d5a-1512169574.tcloudbaseapp.com/` |
| API | HTTP 云函数 `api`（Nodejs18.15，网关路由 `/api`） | `https://fw911-d0gy6gkq41d1f6d5a-1512169574.ap-shanghai.app.tcloudbase.com/api` |
| 数据 | NoSQL 集合：`users` / `tokens` / `saves` / `leaderboard` / `stats` / `stats_byJob` / `stats_byBand` / `stats_drops` | 环境 `fw911-d0gy6gkq41d1f6d5a` |

- **前端如何找到后端**：`game.js` 的 `apiProbe()` 按顺序探测 同源 `''` → 云端 API 域 → `localhost:8014`，
  任一候选返回 `{"ok":true}` 即采用，因此本地与线上共用同一份 `game.js`。
- **重新部署前端**：把 `index.html` / `game.js` / `data/` 上传到静态托管（MCP `manageHosting action=upload`）。
- **重新部署后端**：改 `cloudfunctions/api/index.js` 后 `node --check`，再部署函数代码
  （MCP `manageFunctions action=updateFunctionCode`，`functionRootPath=cloudfunctions`）。
  注意：`scf_bootstrap` 必须存在且 LF 行尾；凭证走函数环境变量 `CLOUDBASE_APIKEY` + `TCB_ENV`，不进代码。
- **已知平台行为（踩坑记录）**：
  - 静态托管默认域（`*.tcloudbaseapp.com`）是系统保留域，不能挂 `/api` 函数路由，故 API 与静态站不同源；
  - 网关会把请求 Origin 追加到上游 `Access-Control-Allow-Origin` 之后，函数设任何值都会翻倍成非法值，
    因此函数**不设** ACAO，只保留网关的单值回显（CORS 合法）；
  - 该版本 SDK：`doc(id).get()` 对不存在文档返回 `{data: []}`（须归一化为 null）；
    `update()` 对不存在文档是静默无操作；`set()` 不允许带 `_id`——存储层已按这三点处理。
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
node --check game.js        # 语法检查
python _patch.py            # 生成 _test_game.js
node _run_test.js           # 全量断言，期望 ALL PASS
```

## 说明

- 本仓库只包含可运行的网页版游戏本体，反汇编/解密脚本与产物不在其中。
- 数据来自逆向解密，仅供学习交流。
