#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""L4 续：全量数值差异盘点——对比 web-idle/data 与 v0.91(放置归墟_v0.91_decrypted)
同名文件的同名条目，递归比对数值字段，按「字段路径」聚合比值分布，
用于识别系统性比例偏差（如 exp/gold ×0.1）与散点漂移。

用法：python3 _l4_diffscan.py [文件名前缀过滤]
"""
import io, json, os, sys
from collections import defaultdict

WI_DIR = 'data'
V0_DIR = os.path.join('..', '放置归墟_v0.91_decrypted')


def load(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return json.load(f)


def index_entries(d):
    """返回 {topkey: {entrykey: entry}} —— 顶层每个 list-of-dict 且含 key 的字段。"""
    out = {}
    if isinstance(d, dict):
        for tk, tv in d.items():
            if isinstance(tv, list) and tv and isinstance(tv[0], dict) and 'key' in tv[0]:
                out[tk] = {e['key']: e for e in tv if isinstance(e, dict) and 'key' in e}
    return out


def walk(a, b, path, sink, stats):
    """递归比较 a(web-idle) 与 b(v0.91) 的数值字段。"""
    if isinstance(a, dict) and isinstance(b, dict):
        for k in b:
            if k in a:
                walk(a[k], b[k], path + '.' + k if path else k, sink, stats)
    elif isinstance(a, list) and isinstance(b, list):
        n = min(len(a), len(b))
        stats['list_len_diff'] += (1 if len(a) != len(b) else 0)
        for i in range(n):
            walk(a[i], b[i], path + '[]', sink, stats)
    elif isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        if a != b:
            ratio = (b / a) if a else None
            sink[path].append((a, b, ratio))
    elif isinstance(a, str) and isinstance(b, str):
        if a != b and path.endswith(('desc', 'name')):
            sink[path + '(文本)'].append((a, b, None))


def main():
    flt = sys.argv[1] if len(sys.argv) > 1 else ''
    files = sorted(set(os.listdir(WI_DIR)) & set(os.listdir(V0_DIR)))
    agg = defaultdict(list)
    totals = {'entries': 0, 'matched': 0, 'list_len_diff': 0}
    per_file = {}
    for fn in files:
        if not fn.endswith('.json') or (flt and not fn.startswith(flt)):
            continue
        try:
            wi = index_entries(load(os.path.join(WI_DIR, fn)))
            v0 = index_entries(load(os.path.join(V0_DIR, fn)))
        except Exception as e:
            print('SKIP %s: %s' % (fn, e))
            continue
        for tk in set(wi) & set(v0):
            m = set(wi[tk]) & set(v0[tk])
            if not m:
                continue
            totals['entries'] += len(m)
            sink = defaultdict(list)
            st = {'list_len_diff': 0}
            for k in m:
                walk(wi[tk][k], v0[tk][k], '', sink, st)
            totals['list_len_diff'] += st['list_len_diff']
            totals['matched'] += len(m)
            for path, items in sink.items():
                agg[path].extend(items)
            if sink:
                per_file[fn] = (len(m), sum(len(v) for v in sink.values()))

    print('=== 覆盖 ===')
    print('共同文件 %d 个，共同条目 %d 个，列表长度不一致条目 %d 个'
          % (len(per_file), totals['matched'], totals['list_len_diff']))
    print('字段差异分布（前 40，按差异条目数降序）：')
    print('%-42s %7s %7s  %s' % ('字段路径', '差异数', '占比', 'v0/wi 比值分位'))
    rows = sorted(agg.items(), key=lambda kv: -len(kv[1]))
    for path, items in rows[:40]:
        rs = sorted(r for _, _, r in items if r is not None and r > 0)
        if rs:
            q = 'min=%.4g p25=%.4g p50=%.4g p75=%.4g max=%.4g' % (
                rs[0], rs[len(rs) // 4], rs[len(rs) // 2], rs[len(rs) * 3 // 4], rs[-1])
            uniq = len(set(round(r, 4) for r in rs))
            if uniq <= 3:
                q = '恒定比值 ' + ','.join('%.4g' % u for u in sorted(set(round(r, 4) for r in rs)))
        else:
            q = '（非数值）'
        print('%-42s %7d %6.1f%%  %s' % (path, len(items), 100.0 * len(items) / max(1, totals['matched']), q))


if __name__ == '__main__':
    main()
