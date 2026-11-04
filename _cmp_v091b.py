# -*- coding: utf-8 -*-
"""web-idle vs v0.91：文件级差异率 + 关键数值字段倍率分布 + 字段名差异 TOP"""
import json, os, statistics
from collections import Counter

A = r"E:/华夏/逆向分析/menghuihuaxia-web-idle/data"
B = r"E:/华夏/逆向分析/放置归墟_v0.91_decrypted"
C = r"E:/华夏/逆向分析/game_server/config"          # 我们的 FastAPI 版（内置 v0.91 数据）

def jfiles(d):
    return {f[:-5] for f in os.listdir(d) if f.endswith('.json')}
fa, fb = jfiles(A), jfiles(B)
fc = jfiles(C)
print("FastAPI 版内置 config/ 与 v0.91 是否一致：", "完全相同" if fc == fb else f"差异 {len(fc ^ fb)} 个")

def load(d, n):
    return json.load(open(f"{d}/{n}.json", encoding='utf-8'))

def flat(o, p=""):
    if isinstance(o, dict):
        for k, v in o.items():
            yield from flat(v, f"{p}.{k}" if p else str(k))
    elif isinstance(o, list):
        for i, v in enumerate(o):
            yield from flat(v, f"{p}[{i}]")
    else:
        yield p, o

# ---------- 1) 文件级差异率 ----------
print("\n" + "=" * 78)
print("① 文件级差异率（web-idle 相对 v0.91），按差异率降序")
print("=" * 78)
print(f"{'文件':<28}{'差异/总字段':>16}{'差异率':>9}")
rows = []
for name in sorted(fa & fb):
    da, db = dict(flat(load(A, name))), dict(flat(load(B, name)))
    keys = set(da) | set(db)
    n = sum(1 for k in keys if da.get(k, "«»") != db.get(k, "«»"))
    rows.append((name, n, len(keys), n / max(1, len(keys))))
rows.sort(key=lambda r: -r[3])
for name, n, tot, rate in rows:
    bar = "█" * int(rate * 24)
    print(f"{name:<28}{n:>9}/{tot:<6}{rate*100:>7.1f}%  {bar}")
ident = [n for n, c, t, r in rows if c == 0]
print(f"\n✅ 逐字段完全一致的文件（{len(ident)} 个）：{', '.join(ident)}")

# ---------- 2) 差异最频繁的字段名（叶子字段） ----------
print("\n" + "=" * 78)
print("② 差异最集中的叶子字段名 TOP 20")
print("=" * 78)
cnt = Counter()
for name in sorted(fa & fb):
    da, db = dict(flat(load(A, name))), dict(flat(load(B, name)))
    for k in set(da) | set(db):
        if da.get(k, "«»") != db.get(k, "«»"):
            leaf = k.split('.')[-1].split('[')[0]
            cnt[leaf] += 1
for k, v in cnt.most_common(20):
    print(f"   {k:<34}{v:>8} 处")

# ---------- 3) 关键数值字段的倍率分布 ----------
print("\n" + "=" * 78)
print("③ 关键数值字段：web-idle 值 ÷ v0.91 值 的倍率中位数（>1 表示 web-idle 更大）")
print("=" * 78)
def ratio_stats(fname, field, label=None):
    la, lb = load(A, fname), load(B, fname)
    if not isinstance(la, list) or not isinstance(lb, list):
        return
    n = min(len(la), len(lb))
    rs = []
    for i in range(n):
        a, b = la[i], lb[i]
        if isinstance(a, dict) and isinstance(b, dict):
            va, vb = a.get(field), b.get(field)
            if isinstance(va, (int, float)) and isinstance(vb, (int, float)) and vb:
                rs.append(va / vb)
    if rs:
        print(f"   {label or (fname+'.'+field):<26} n={len(rs):<6} 中位倍率={statistics.median(rs):.3f}  "
              f"min={min(rs):.3f} max={max(rs):.3f}  等值比例={sum(1 for r in rs if r==1)/len(rs)*100:.0f}%")
for f, fld in [("monsters", "exp"), ("monsters", "gold_min"), ("monsters", "gold_max"),
               ("monsters", "hp"), ("monsters", "phys_atk"), ("monsters", "phys_def"),
               ("monsters", "level")]:
    ratio_stats(f, fld)
