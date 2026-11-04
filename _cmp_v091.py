# -*- coding: utf-8 -*-
"""web-idle（网页挂机版）自带数据 vs v0.91 原版解密产物的逐字段对比"""
import json, os, sys

A = r"E:/华夏/逆向分析/menghuihuaxia-web-idle/data"        # web-idle 自带
B = r"E:/华夏/逆向分析/放置归墟_v0.91_decrypted"           # v0.91 原版

def jfiles(d):
    return {f[:-5] for f in os.listdir(d) if f.endswith('.json')}

fa, fb = jfiles(A), jfiles(B)
print("=" * 72)
print(f"web-idle/data  JSON: {len(fa)}    v0.91_decrypted  JSON: {len(fb)}")
print("=" * 72)
only_a = sorted(fa - fb)
only_b = sorted(fb - fa)
print(f"\n【仅 web-idle 有】({len(only_a)}):")
for x in only_a: print("   +", x)
print(f"\n【仅 v0.91 有】({len(only_b)}):")
for x in only_b: print("   -", x)

def flat(o, p=""):
    if isinstance(o, dict):
        for k, v in o.items():
            yield from flat(v, f"{p}.{k}" if p else str(k))
    elif isinstance(o, list):
        for i, v in enumerate(o):
            yield from flat(v, f"{p}[{i}]")
    else:
        yield p, o

print("\n" + "=" * 72)
print("共有文件的逐字段差异")
print("=" * 72)
rows = []
for name in sorted(fa & fb):
    try:
        ja = json.load(open(f"{A}/{name}.json", encoding="utf-8"))
        jb = json.load(open(f"{B}/{name}.json", encoding="utf-8"))
    except Exception as e:
        print(f"[{name}] 读取失败: {e}"); continue
    da, db = dict(flat(ja)), dict(flat(jb))
    keys = set(da) | set(db)
    diffs = []
    for k in sorted(keys):
        va, vb = da.get(k, "«缺失»"), db.get(k, "«缺失»")
        if va != vb:
            diffs.append((k, va, vb))
    rows.append((name, len(diffs), len(keys), diffs))

rows.sort(key=lambda r: -r[1])
same = [r for r in rows if r[1] == 0]
diffd = [r for r in rows if r[1] > 0]
print(f"\n完全一致: {len(same)} 个文件")
print(f"存在差异: {len(diffd)} 个文件")
for name, n, total, diffs in diffd:
    print(f"\n── [{name}]  差异 {n}/{total} 项")
    for k, va, vb in diffs[:12]:
        sa, sb = repr(va), repr(vb)
        if len(sa) > 70: sa = sa[:70] + "…"
        if len(sb) > 70: sb = sb[:70] + "…"
        print(f"     {k}")
        print(f"        web-idle: {sa}")
        print(f"        v0.91   : {sb}")
    if len(diffs) > 12:
        print(f"     ... 另有 {len(diffs)-12} 项差异")
