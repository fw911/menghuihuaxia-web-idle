/* 梦回华夏·文字挂机版 —— 模块总装（barrel）
 * 2026-10-21 由 game.js（单文件 IIFE，5253 行）模块化为 ES Modules。
 * 本文件只做再导出 + 模块地图，不含逻辑；浏览器启动入口是 start.js。
 * 模块地图（来源行域）：
 *   state.js     L  24-  73  全局状态（DATA_FILES / state / 自动挂机设置持久化）
 *   api.js       L  74- 179  后端 API 层 + 云存档/账号/排行/统计 + 战力评分
 *   core.js      L 180- 429  全局索引与常量 + 工具函数 + 数据加载 loadData
 *   player.js    L 430- 927  经验/属性/技能学习/武魂系统/神魔修验基础/仙之境
 *   quest.js     L 928-1109  修验任务（炼丹产线：接取/材料/炼丹/提交/强化/导师考验）
 *   smtree.js    L1110-1388  神魔技能树（加点/聚合/主动技）+ 角色属性计算
 *   equip.js     L1389-1615  装备生成（buildEquip/耐久/双手）+ 掉落 rollLoot
 *   battle.js    L1616-1998  战斗引擎（tick/出手/死亡）+ 召唤兽
 *   bag.js       L1999-2161  背包/装备操作（叠加/整理/自动换装/双手互斥）
 *   refine.js    L2162-2270  精炼 + 宝石镶嵌逻辑
 *   world.js     L2271-2400  地图/导航/副本/区域探索/首领清剿
 *   render.js    L2401-2946  渲染基础（$/日志/头部/地图/战斗）+ 角色/武魂/技能/神魔面板
 *   tabs.js      L2947-3207  右侧页签/二级子菜单 + 背包/已装备/属性渲染
 *   inlay.js     L3208-3471  宝石镶嵌 UI + 生活技能页 renderLife
 *   panels.js    L3472-3829  副本兑换/成就页 + 零依赖 SVG 图表 + 云存档页
 *   shop.js      L3830-3957  商店/任务/消耗品使用
 *   life.js      L3958-4458  打造/百炼/提取/矿石炼制/乾坤炉/晶石/信使/探矿/护符兑换/成就/称号/物品账目
 *   binds.js     L4459-4660  页签点击委托 bindTabClicks + findItem
 *   loop.js      L4661-4829  起区 startZone + 主循环 + 存档/读档 + 本地导入导出
 *   idle.js      L4830-5071  离线收益 + 自动挂机（药水/换区）+ 统计上报
 *   boot.js      L5072-5251  启动/新建角色/强制登录流程/boot
 */
export * from './state.js';
export * from './api.js';
export * from './core.js';
export * from './player.js';
export * from './quest.js';
export * from './smtree.js';
export * from './equip.js';
export * from './battle.js';
export * from './bag.js';
export * from './refine.js';
export * from './world.js';
export * from './render.js';
export * from './tabs.js';
export * from './inlay.js';
export * from './panels.js';
export * from './shop.js';
export * from './life.js';
export * from './binds.js';
export * from './loop.js';
export * from './idle.js';
export * from './boot.js';
