# -*- coding: utf-8 -*-
"""web-idle vs v0.91：关键数值倍率 + 系统功能覆盖度三方对照"""
import json, os, statistics

W = r"E:/华夏/逆向分析/menghuihuaxia-web-idle/data"      # web-idle
V = r"E:/华夏/逆向分析/放置归墟_v0.91_decrypted"          # v0.91 原版
S = r"E:/华夏/逆向分析/game_server/systems"              # 我们 FastAPI 版的系统实现

def jfiles(d, ext='.json'):
    return {f[:-len(ext)] for f in os.listdir(d) if f.endswith(ext)}
fw, fv = jfiles(W), jfiles(V)
sysmods = {f[:-3] for f in os.listdir(S) if f.endswith('.py') and f != '__init__.py'}

print("=" * 80)
print("① 关键数值字段倍率：web-idle ÷ v0.91（>1 = web-idle 数值更大）")
print("=" * 80)

def rows_of(name):
    a = json.load(open(f"{W}/{name}.json", encoding='utf-8'))
    b = json.load(open(f"{V}/{name}.json", encoding='utf-8'))
    if isinstance(a, dict) and isinstance(b, dict):
        keys = [k for k in a if k in b]
        return [(k, a[k], b[k]) for k in keys], (len(a), len(b), 'dict')
    if isinstance(a, list) and isinstance(b, list):
        n = min(len(a), len(b))
        return [(i, a[i], b[i]) for i in range(n)], (len(a), len(b), 'list')
    return [], (len(a), len(b), type(a).__name__)

def ratio(name, field):
    rr, meta = rows_of(name)
    rs, eq, miss = [], 0, 0
    for _, va, vb in rr:
        if isinstance(va, dict) and isinstance(vb, dict):
            va, vb = va.get(field), vb.get(field)
        if isinstance(va, (int, float)) and isinstance(vb, (int, float)) and vb:
            rs.append(va / vb)
            if va == vb: eq += 1
        else:
            miss += 1
    if not rs: return
    print(f"   {name+'.'+field:<28} n={len(rs):<5} 中位={statistics.median(rs):<8.3f} "
          f"min={min(rs):<7.3f} max={max(rs):<8.3f} 相等={eq/len(rs)*100:>3.0f}% 无可比={miss}")

for fld in ['exp', 'gold_min', 'gold_max', 'hp', 'min_phys_atk', 'max_phys_atk',
            'phys_def', 'min_magic_atk', 'level']:
    ratio('monsters', fld)

print("\n" + "=" * 80)
print("② 系统/功能覆盖度三方对照")
print("=" * 80)
only_v = sorted(fv - fw)
only_w = sorted(fw - fv)
print(f"\n【A】v0.91 有、web-idle 没有的配置文件（{len(only_v)} 个）—— web-idle 缺失的功能域")
for x in only_v:
    print(f"     · {x}")
print(f"\n【B】web-idle 独有（{len(only_w)} 个）—— 它自己拆/增的结构")
for x in only_w:
    print(f"     · {x}")
print(f"\n【C】我们 FastAPI 版 game_server/systems/ 的实现模块（{len(sysmods)} 个）")
print("     " + ", ".join(sorted(sysmods)))

print("\n" + "=" * 80)
print("③ v0.91 缺失的 21 个功能域，在 FastAPI 版里是否有对应实现")
print("=" * 80)
alias = {
    'companion': ['companion'], 'crystal_refine': ['crystal'], 'difficulty': ['difficulty'],
    'farm': ['farm'], 'fuling': ['fuling'], 'guide': ['guide'], 'qiling': ['qiling'],
    'ring_quest': ['ring'], 'shenmo_active_skills_mage': ['shenmo_active'],
    'shenmo_skills_mage': ['shenmo'], 'shenmo_transform': ['shenmo'],
    'smith': ['forge'], 'suits': ['suit'], 'world_layout': ['world'],
    'paperdoll': ['equip'], 'job_forms': ['form'], 'loot_pools': ['loot'],
    'loot_rules': ['loot'], 'monster_loot_built': ['loot'], 'effects_manifest': [],
    'taptap_achievements': ['achievement'],
}
for x in only_v:
    cand = alias.get(x, [])
    hit = [c for c in cand if any(c in m for m in sysmods)]
    mark = "✅ 有" if hit else ("—" if not cand else "❌ 无")
    print(f"   {mark:<6} {x:<28} → {', '.join(hit) if hit else ('（FastAPI 版未单列模块）' if not cand else '')}")
