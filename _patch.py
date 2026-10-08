# -*- coding: utf-8 -*-
"""生成 _test_game.js：复制 game.js 并在 IIFE 内注入导出钩子，供 Node 无头测试用。
绝不修改 game.js 本体。
"""
import io, os, sys

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'game.js')
DST = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_test_game.js')

s = io.open(SRC, encoding='utf-8').read()

EXPORTS = [
    'state','DATA','MONSTERS','MON_SKILLS','GEM_ORDER','LOOT','LS',
    'loadData','newPlayer','refreshStats','computeStats',
    'spawnMonster','tick','onMonsterDead','rollLoot','genEquip','buildEquip',
    'mineStart','mineTick','mineSettle','mineConf','compassDef','mineExpNeed','mineProgress',
    'gemRecipeFor','doGemRefine','doPotionRefine','itemCount','itemConsume','itemName','gemCount',
    'instEntries','instSpec','doInstanceExchange','buildExchangeEquip','perkMidValue',
    'achList','achValue','achDone','checkAchievements','grantAchievement',
    'summonDef','summonTier','summonAvailable','summonAttack',
    'addToBag','consolidateBag','equipItem','doForge','doRefine',
    # 宝石镶嵌（gems.json：系列限定部位）
    'doInlay','gemSeriesDef','gemSeriesName','gemSeriesLabel','gemCanInlay','inlayGemList',
    'inlayEquipList','inlayGemOpts','inlayEquipOpts','doInlaySelected','selGemForInlay',
    'renderTab','renderLife','renderInstance','renderAch','renderSkill','renderShenmo','renderMap',
    # 右列二级菜单（子菜单）
    'renderBag','renderShop','renderWuhun','renderQuest',
    # 启动登录（强制登录流程）
    'setAuthMsg','wireAuthUI','afterLogin','startAuthFlow','renderCloudResume',
    'subTabs','subKey','renderSubtabsHtml','bagSubOf','bagSubLabel',
    # 第二轮细化：按配置原生维度再拆一层
    'bagSlotType','equipSubOf','skillBand','achSubs','achSubOf','smNodeTiers','smTierDef','renderInstance','jobSkills',
    'smJoin','smAddPoint','smResetPoints','smAgg','smNodes','smNodeDef','smSpent','smActiveCast','smFmt',
    'crystalForTier','crystalName','crystalCount','addCrystalStone','crystalStartRefine',
    # 精炼（按原版口径还原）：档位取表 / 逐级增量 / 回退 / 隐藏词条 / 下拉
    'applyRefineLevels','refineFlatOf','refineStep','refineKeys','refineApplyOne',
    'refineRevert','refineAddHidden','refineEquipOpts',
    'courierRoutes','courierTravel','travelTo','rollPerks','buildEquip','PERK_CAP',
    'setIdle','startZone','save','load','gainExp','expToNext','monsterExp','typeExpMul','loop','maybeAutoZone','syncSkills',
    # 经验口径（按原版 battle/encounter.py:scale_monster_exp 还原）
    'expScale','zoneKeys','zoneYield',
    # 后端 / 云存档 / P0 自动挂机
    'powerScore','buildSavePayload','applySavePayload','sessBump','sessPerMin','reportStats',
    'autoPotion','autoZone','bestZone','zoneEval','zoneMonsterAvg','potionTier','itemPrice',
    'findPotion','buyPotion','loadAuto','saveAuto','persistCloud','restoreCloud','refreshSlots',
    'cloudRegister','cloudLogin','cloudLogout','cloudSave','cloudLoad','cloudDelete',
    'cloudRank','cloudRankList','cloudStatsSummary','apiProbe','apiCall','loadCloudUI','renderCloud',
    'HP_POTIONS','MP_POTIONS','playerDps',
    # 离线收益
    'idleRate','applyOfflineEarnings','OFFLINE_MAX_SEC','OFFLINE_EFF',
    # 大数字格式化
    'fmtNum',
    # 挂机自动分解白/绿装
    'autoExtractJunk', 'maybeAutoSalvage', 'AUTO_SALVAGE_AT', 'BAG_CAP',
    # 死亡惩罚
    'onPlayerDead', 'DEATH_EXP_PENALTY',
    # 探针/加成断言用
    'getMonster', 'BOSS_HP_MULT', 'BOSS_ATK_MULT',
    # 本地存档 导出/导入
    'localSaveStamp', 'validateSavePayload', 'exportFileName', 'exportSaveFile',
    'copySaveText', 'importSaveText', 'importSaveFile',
    # 图表（统计可视化）
    'svgTrend', 'svgBandBars', 'svgPower', 'svgDropBars', 'svgLevelTimeline',
    'sessLevelUp', 'sessSample', 'QUALITY_ORDER',
    # 副本系统（dungeon_bosses / 进入门槛 / 每日次数）
    'mapByKey', 'dungeonBosses', 'isDungeon', 'todayKey', 'dungeonBossKilled',
    'dungeonKilledCount', 'dungeonAllBossKilled', 'dungeonEntryLeft',
    'consumeDungeonEntry', 'noteDungeonBossKilled',
    # 称号系统
    'titleList','titleByKey','titleUnlocked','titleEffect','titleDmgMult','titleHeal','titleProgress','titleTarget','grantTitle','checkTitles','equipTitle',
    # 仙之境（shenmo.json#xianzhijing）
    'xzRatePerMin','xzCapMin','smXianzhiAddMinutes','smXianzhiTick','isXianzhiNow','curMapKey','renderXianzhi',
    # 修验任务（shenmo.json#quest，炼丹产线）
    'xyCfg','xyGrades','xyGradeDef','xyRecipeTypes','xyRecipeName','xyDailyCap','xyQuestState','xyYinziPool',
    'xyHasYinzi','xyHasMaterials','xyMatRequirement','xyAccept','xySubmitMaterials','xyRefine','xyHandIn','xyRefresh',
    'xyStrCap','xyStrengthen','xyTrialCap','xyTrialStart','xyTrialOnKill','xyRollGrade',
    'renderXrTask','renderXrStr','renderXrTrial',
    # 数值探针用
    'tierFromLevel', 'HERO_SLOTS', 'monsterDef',
    # 区域探索（explore_target）/ 首领区清剿（minion_target）
    'zoneTarget', 'zoneKillCount', 'zoneExplored', 'zoneExploredCount', 'mapExplorePct',
    'mapClearReward', 'mapCleared', 'rewardText',
    'bossMinionTarget', 'minionKillCount', 'bossZoneCleared', 'noteZoneKill', 'noteMinionKill',
]

hook = "\nglobal.__exp = {" + ", ".join("get %s(){return %s}" % (n, n) for n in EXPORTS) + "};\n"

# 在末尾 boot(); 之前插入导出，并去掉 boot 自动调用（测试自行引导）
idx = s.rfind('boot();')
assert idx > 0, 'boot() not found'
s = s[:idx] + hook + 'global.__boot = boot;\n' + s[idx:]
s = s.replace('boot();', '/* boot disabled in test */', 1)

io.open(DST, 'w', encoding='utf-8').write(s)
print('written', DST, len(s))
