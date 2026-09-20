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
| `_patch.py` | 生成测试副本 `_test_game.js`（注入 `global.__exp` 导出钩子） |
| `_run_test.js` | 全量回归测试（断言战斗模型、掉落、精炼、称号、物品名等） |
| `_sim_progress.js` / `_sim_boss.js` / `_sim_zoneboss.js` | 数值模拟：推进曲线 / 副本首领 / 野外首领区 |
| `_uicdp.js` | 无头 Chrome 截图 + 布局量化报告 |

## 回归验证

```bash
node --check game.js        # 语法检查
python _patch.py            # 生成 _test_game.js
node _run_test.js           # 全量断言，期望 ALL PASS
```

## 说明

- 本仓库只包含可运行的网页版游戏本体，反汇编/解密脚本与产物不在其中。
- 数据来自逆向解密，仅供学习交流。
