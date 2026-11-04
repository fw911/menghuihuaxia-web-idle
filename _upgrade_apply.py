# -*- coding: utf-8 -*-
"""
web-idle ← v0.91 无损叠加升级（v1：字段级还原）

原则：
  1. 只写入「v0.91 有、web-idle 没有」的字段，原样搬运（单位/语义不变）
  2. 绝不修改 web-idle 已有字段的值（作者的重平衡与取舍全部保留）
  3. 不增删条目（条目补齐属独立决策项，见报告）
  4. 按主键 key/id/name 匹配；匹配不上的条目跳过并记录
"""
import json, os, shutil, datetime

W = r"E:/华夏/逆向分析/menghuihuaxia-web-idle/data"
V = r"E:/华夏/逆向分析/放置归墟_v0.91_decrypted"
BK = r"E:/华夏/逆向分析/menghuihuaxia-web-idle/_data_backup_before_upgrade"

def jf(d): return {f[:-5] for f in os.listdir(d) if f.endswith('.json')}
fw, fv = jf(W), jf(V)

def container(o):
    """返回 (容器键, 条目列表)；顶层就是 list 时容器键为 None"""
    if isinstance(o, dict) and len(o) == 1:
        k = list(o.keys())[0]
        if isinstance(o[k], list):
            return k, o[k]
    return None, (o if isinstance(o, list) else [])

def keyof(d):
    for k in ('key', 'id', 'name', 'uid'):
        if isinstance(d, dict) and k in d and isinstance(d[k], (str, int)):
            return k
    return None

# 备份
if not os.path.isdir(BK):
    shutil.copytree(W, BK)
    print(f"已备份原数据到 {BK}\n")

report = {"files": [], "skipped": []}
added_total = 0

for name in sorted(fw & fv):
    wpath, vpath = f"{W}/{name}.json", f"{V}/{name}.json"
    wo = json.load(open(wpath, encoding='utf-8'))
    vo = json.load(open(vpath, encoding='utf-8'))
    wkey, wlist = container(wo)
    vkey, vlist = container(vo)
    if not wlist or not vlist:
        continue
    if not (isinstance(wlist[0], dict) and isinstance(vlist[0], dict)):
        continue

    wk, vk = keyof(wlist[0]), keyof(vlist[0])
    if not wk or not vk or wk != vk:
        report["skipped"].append((name, f"主键不可用 w={wk} v={vk}"))
        continue

    vmap = {}
    for e in vlist:
        vmap[e.get(vk)] = e

    added_fields = {}
    matched = 0
    unmatched_keys = []
    for e in wlist:
        k = e.get(wk)
        src = vmap.get(k)
        if src is None:
            unmatched_keys.append(k)
            continue
        matched += 1
        for fk, fv_val in src.items():
            if fk not in e:                       # ← 只补缺失字段
                e[fk] = fv_val
                added_fields[fk] = added_fields.get(fk, 0) + 1

    n_added = sum(added_fields.values())
    added_total += n_added
    with open(wpath, 'w', encoding='utf-8') as f:
        json.dump(wo, f, ensure_ascii=False, indent=1)
    report["files"].append({
        "file": name, "items": len(wlist), "matched": matched,
        "unmatched": len(unmatched_keys), "added": n_added,
        "fields": {k: v for k, v in sorted(added_fields.items(), key=lambda x: -x[1])},
        "unmatched_sample": unmatched_keys[:5],
    })

print("=" * 84)
print("① 无损叠加升级结果")
print("=" * 84)
print(f"{'文件':<30}{'条目':>6}{'匹配':>6}{'未匹配':>8}{'新增字段数':>12}")
for r in report["files"]:
    print(f"{r['file']:<30}{r['items']:>6}{r['matched']:>6}{r['unmatched']:>8}{r['added']:>12}")
print(f"\n合计新增字段值: {added_total}")

print("\n" + "=" * 84)
print("② 各文件补入的原版字段（TOP）")
print("=" * 84)
allf = {}
for r in report["files"]:
    for k, v in r["fields"].items():
        allf.setdefault(k, []).append((r["file"], v))
for k, lst in sorted(allf.items(), key=lambda x: -sum(v for _, v in x[1])):
    files = ", ".join(f"{f}({v})" for f, v in lst[:4])
    print(f"   {k:<24} 共 {sum(v for _, v in lst):>6} 处   {files}")

if report["skipped"]:
    print("\n③ 跳过的文件（需人工处理）")
    for n, why in report["skipped"]:
        print(f"   {n}: {why}")

# 校验：JSON 合法性 + 条目数未变
print("\n" + "=" * 84)
print("④ 校验：JSON 合法性与条目数不变")
print("=" * 84)
bad = 0
for name in sorted(fw & fv):
    p = f"{W}/{name}.json"
    try:
        a = json.load(open(p, encoding='utf-8'))
        b = json.load(open(f"{BK}/{name}.json", encoding='utf-8'))
        _, la = container(a); _, lb = container(b)
        if len(la) != len(lb):
            print(f"   ⚠️ {name} 条目数变化 {len(lb)} → {len(la)}"); bad += 1
    except Exception as e:
        print(f"   ❌ {name} 解析失败: {e}"); bad += 1
print(f"   校验完成，异常文件数: {bad}")

json.dump(report, open(r"E:/华夏/逆向分析/menghuihuaxia-web-idle/_upgrade_report_data.json", 'w',
                       encoding='utf-8'), ensure_ascii=False, indent=1)
print("\n报告数据已存 _upgrade_report_data.json")
print(f"时间: {datetime.datetime.now():%Y-%m-%d %H:%M:%S}")
