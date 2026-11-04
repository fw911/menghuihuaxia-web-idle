# -*- coding: utf-8 -*-
"""web-idle ← v0.91 升级可行性探测：结构对应 / 字段映射 / 差异性质分类"""
import json, os, re, statistics
from collections import Counter

W = r"E:/华夏/逆向分析/menghuihuaxia-web-idle/data"
V = r"E:/华夏/逆向分析/放置归墟_v0.91_decrypted"
JS = r"E:/华夏/逆向分析/menghuihuaxia-web-idle/js"

def jf(d): return {f[:-5] for f in os.listdir(d) if f.endswith('.json')}
fw, fv = jf(W), jf(V)

# 读 web-idle 的 js/ 源码，统计它实际消费了哪些数据字段
js_text = ""
for f in os.listdir(JS):
    if f.endswith('.js'):
        js_text += open(f"{JS}/{f}", encoding='utf-8', errors='ignore').read()
used = set(re.findall(r"[.\[\'\"]([a-z][a-z0-9_]{2,24})['\"\]]?\s*[,)\];]", js_text))
print("=" * 84)
print("① web-idle 前端 js/ 实际消费的数据字段（出现在源码中的标识符，共 %d 个）" % len(used))
print("=" * 84)
key_fields = ['exp','gold_min','gold_max','hp','min_phys_atk','max_phys_atk','min_phys_def',
              'max_phys_def','min_magic_atk','max_magic_atk','magic_def','phys_def','dodge','cd',
              'cd_ms','duration','duration_ms','skill_type','type','target_rule','aoe','effects',
              'level_stats','levels','loot_table','name','desc','mp','level','quality','slot']
for kf in key_fields:
    if kf in used:
        print(f"   ✔ {kf}")

def top(d, name):
    o = json.load(open(f"{d}/{name}.json", encoding='utf-8'))
    if isinstance(o, dict) and len(o) == 1:
        k = list(o.keys())[0]
        return k, o[k]
    return None, o

print("\n" + "=" * 84)
print("② 共有文件的结构对应关系（顶层容器 → 条目数 web-idle / v0.91）")
print("=" * 84)
struct_map = {}
for name in sorted(fw & fv):
    ka, va = top(W, name)
    kb, vb = top(V, name)
    na = len(va) if isinstance(va, (list, dict)) else 1
    nb = len(vb) if isinstance(vb, (list, dict)) else 1
    same_shape = (ka == kb)
    struct_map[name] = (ka, kb, na, nb, same_shape)
    flag = "✅同构" if same_shape else "⚠️异构"
    cnt = "" if na == nb else f"  条目 {na} vs {nb}"
    print(f"   {name:<26}{flag:<8} 容器 {str(ka):<16}/{str(kb):<16}{cnt}")

# ---- 字段名映射：v0.91 字段 → web-idle 字段（对 list[dict] 的文件）----
print("\n" + "=" * 84)
print("③ 字段名映射（取首个含 dict 条目的文件做样本，逐字段找对应）")
print("=" * 84)
def entries(name):
    ka, va = top(W, name)
    kb, vb = top(V, name)
    if isinstance(va, list) and va and isinstance(va[0], dict):
        return va, vb if isinstance(vb, list) and vb and isinstance(vb[0], dict) else None
    if isinstance(va, dict) and va:
        fk = next(iter(va))
        if isinstance(va[fk], list) and va[fk] and isinstance(va[fk][0], dict):
            return va[fk], (vb[fk] if isinstance(vb, dict) and isinstance(vb.get(fk), list) else None)
    return None, None

rename_hint = {}
for name in sorted(fw & fv):
    ea, eb = entries(name)
    if not ea or not eb:
        continue
    fa_keys, fb_keys = set(ea[0].keys()), set(eb[0].keys())
    only_a, only_b = sorted(fa_keys - fb_keys), sorted(fb_keys - fa_keys)
    if not only_a and not only_b:
        continue
    print(f"\n   [{name}]")
    print(f"      web-idle 独有字段: {only_a}")
    print(f"      v0.91 独有字段   : {only_b}")
    for k in only_a:
        rename_hint.setdefault(k, []).append(name)

print("\n" + "=" * 84)
print("④ 汇总：web-idle 独有字段（= v0.91 侧被删/改名的字段）出现频次")
print("=" * 84)
for k, v in sorted(rename_hint.items(), key=lambda x: -len(x[1])):
    print(f"   {k:<26} 出现于 {len(v):>2} 个文件: {', '.join(v[:6])}{' ...' if len(v)>6 else ''}")
