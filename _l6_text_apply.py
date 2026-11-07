# -*- coding: utf-8 -*-
"""L6：展示文案回正 v0.91（bytes 定点补丁）

分两条路径：
  A. 可零差异重建的文件 → 内存按 key/下标改白名单字段 + 按原格式重建
  B. 无法重建（achievements/jobs，含单行压缩对象与历史畸形排版）→ 按 key 定位对象区间 + 字段级精确替换

排除：shenmo_*（自研 MOD 改编线）、loot_table 标签、引用/枚举标识、占位值、效果体系数值。
"""
import io, json, os, re, copy, collections

WI = 'data'
V0 = os.path.join('..', '放置归墟_v0.91_decrypted')

def L(p):
    return json.load(io.open(p, encoding='utf-8'))

TOP = ('name', 'desc', 'icon', 'flavor', 'fmt')
# 额外允许的展示类字段（用于结构校验白名单）
ALLOW_LEAF = set(TOP) | {'kill_keyword', 'keyword'}
SKIP_PREFIX = ('shenmo_',)
PATCH_BY_KEY = {'achievements.json', 'jobs.json'}

stats = collections.Counter()


def copy_fields(a, b, fields, tag):
    n = 0
    for f in fields:
        if (f in a and f in b and isinstance(a[f], str)
                and isinstance(b[f], str) and a[f] != b[f]):
            a[f] = b[f]
            n += 1
    if n:
        stats[tag] += n
    return n


def apply_entry(w, v):
    """把 v0.91 条目的展示文案应用到 web-idle 条目（就地改）"""
    copy_fields(w, v, TOP, '条目顶层展示字段')
    for holder, fields in (('boss_zone', ('name',)), ('safe_zone', ('name', 'desc'))):
        a, b = w.get(holder), v.get(holder)
        if isinstance(a, dict) and isinstance(b, dict):
            copy_fields(a, b, fields, holder)
    for arr, ident, fields in (('zones', 'key', ('name',)),
                               ('dungeon_bosses', 'key', ('name',))):
        a, b = w.get(arr), v.get(arr)
        if not (isinstance(a, list) and isinstance(b, list)):
            continue
        bm = {e.get(ident): e for e in b if isinstance(e, dict) and ident in e}
        for e in a:
            s = bm.get(e.get(ident)) if isinstance(e, dict) else None
            if s:
                copy_fields(e, s, fields, arr + '[].name')
    # 按下标对齐的嵌套数组：长度不一致则整组跳过（避免位移错写）
    for arr, fields in (('jubao_spots', ('name',)), ('levels', ('desc',)),
                        ('destinations', ('name',))):
        a, b = w.get(arr), v.get(arr)
        if not (isinstance(a, list) and isinstance(b, list)) or len(a) != len(b):
            continue
        for e, s in zip(a, b):
            if isinstance(e, dict) and isinstance(s, dict):
                copy_fields(e, s, fields, arr + '[].字段')
    ae, be = w.get('effect'), v.get('effect')
    if isinstance(ae, dict) and isinstance(be, dict):
        aa, bb = ae.get('destinations'), be.get('destinations')
        if isinstance(aa, list) and isinstance(bb, list) and len(aa) == len(bb):
            for e, s in zip(aa, bb):
                if isinstance(e, dict) and isinstance(s, dict):
                    copy_fields(e, s, ('name',), 'effect.destinations[].name')


def diff_paths(a, b, p=''):
    out = []
    if isinstance(a, dict) and isinstance(b, dict):
        for k in set(a) | set(b):
            if k not in a or k not in b:
                out.append(p + '.' + k + ' (缺失)')
            else:
                out += diff_paths(a[k], b[k], p + '.' + k)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            out.append(p + ' (长度)')
        else:
            for i, (x, y) in enumerate(zip(a, b)):
                out += diff_paths(x, y, p + '[]')
    elif a != b:
        out.append(p or '<root>')
    return out


def detect_fmt(wb, d):
    for en, eol in (('CRCRLF', '\r\r\n'), ('CRLF', '\r\n'), ('LF', '\n')):
        for ind in (1, 2, 4):
            for tail in ('', '\n'):
                c = json.dumps(d, indent=ind, ensure_ascii=False) + tail
                if eol != '\n':
                    c = c.replace('\n', eol)
                if c.encode('utf-8') == wb:
                    return (en, eol, ind, tail)
    return None


def rebuild(d, fmt):
    _, eol, ind, tail = fmt
    c = json.dumps(d, indent=ind, ensure_ascii=False) + tail
    if eol != '\n':
        c = c.replace('\n', eol)
    return c.encode('utf-8')


# ---------- 路径 B：按 key 定位对象区间 + 字段级精确替换 ----------
def find_array_span(s, field):
    m = re.search(r'"' + re.escape(field) + r'"\s*:\s*\[', s)
    if not m:
        return None
    lo = m.end() - 1
    depth = 0
    instr = esc = False
    for i in range(lo, len(s)):
        c = s[i]
        if instr:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == '"':
                instr = False
        else:
            if c == '"':
                instr = True
            elif c == '[':
                depth += 1
            elif c == ']':
                depth -= 1
                if depth == 0:
                    return (lo, i + 1)
    return None


def split_obj_elements(s, lo, hi):
    out = []
    i, depth, start = lo + 1, 0, None
    instr = esc = False
    while i < hi:
        c = s[i]
        if instr:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == '"':
                instr = False
        else:
            if c == '"':
                instr = True
            elif c == '{':
                if depth == 0:
                    start = i
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0 and start is not None:
                    out.append((start, i + 1))
                    start = None
        i += 1
    return out


def field_changes(w, v):
    """返回该 entry 需要做的 [(field, old, new, expect)]"""
    ch = []
    for f in TOP + ('kill_keyword', 'keyword'):
        if f == 'keyword':
            # effect.keyword 与 unlock.keyword 同名，统一替换
            olds = []
            news = []
            for holder in ('effect', 'unlock'):
                a, b = w.get(holder), v.get(holder)
                if isinstance(a, dict) and isinstance(b, dict):
                    if 'keyword' in a and 'keyword' in b and a['keyword'] != b['keyword']:
                        olds.append(a['keyword'])
                        news.append(b['keyword'])
            if olds and len(set(olds)) == 1 and len(set(news)) == 1:
                ch.append((f, olds[0], news[0], len(olds)))
        else:
            if (f in w and f in v and isinstance(w[f], str)
                    and isinstance(v[f], str) and w[f] != v[f]):
                ch.append((f, w[f], v[f], 1))
    # effect.destinations[].name / 嵌套对象展示字段（定点法只处理顶层扁平字段）
    return ch


def patch_by_key(raw, before, v, fn):
    s = raw
    edits = []
    for tk, tv in before.items():
        sv = v.get(tk)
        if not (isinstance(tv, list) and isinstance(sv, list) and tv
                and isinstance(tv[0], dict) and 'key' in tv[0]):
            continue
        span = find_array_span(s, tk)
        if not span:
            continue
        elems = split_obj_elements(s, span[0], span[1])
        vm = {e['key']: e for e in sv if isinstance(e, dict) and 'key' in e}
        for lo, hi in elems:
            elem = s[lo:hi]
            m = re.search(r'"key"\s*:\s*"((?:\\.|[^"\\])*)"', elem)
            if not m:
                continue
            key = json.loads('"' + m.group(1) + '"')
            src = vm.get(key)
            if not src:
                continue
            w = next((e for e in tv if e.get('key') == key), None)
            if not w:
                continue
            ch = field_changes(w, src)
            if not ch:
                continue
            new_elem = elem
            for f, old, new, expect in ch:
                oldlit = json.dumps(old, ensure_ascii=False)[1:-1]
                newlit = json.dumps(new, ensure_ascii=False)[1:-1]
                pat = re.compile(r'("' + re.escape(f) + r'"\s*:\s*)"'
                                 + re.escape(oldlit) + r'"')
                new_elem, n = pat.subn(
                    lambda mm: mm.group(1) + '"' + newlit + '"', new_elem)
                if n != expect:
                    raise RuntimeError('%s %s.%s 期望 %d 处替换，实得 %d'
                                       % (fn, key, f, expect, n))
                stats['定点.' + f] += n
            if new_elem != elem:
                edits.append((lo, hi, new_elem))
    for lo, hi, text in sorted(edits, reverse=True):
        s = s[:lo] + text + s[hi:]
    return s.encode('utf-8')


def main():
    files = sorted(f for f in set(os.listdir(WI)) & set(os.listdir(V0))
                   if f.endswith('.json'))
    touched = []
    for fn in files:
        if fn.startswith(SKIP_PREFIX):
            continue
        p, q = WI + '/' + fn, V0 + '/' + fn
        wb = open(p, 'rb').read()
        raw = wb.decode('utf-8')
        before = json.loads(raw)
        v = L(q)
        if not (isinstance(before, dict) and isinstance(v, dict)):
            continue

        if fn in PATCH_BY_KEY:
            nwb = patch_by_key(raw, before, v, fn)
        else:
            fmt = detect_fmt(wb, before)
            if fmt is None:
                print('  !! 无法零差异重建，跳过: %s' % fn)
                continue
            after = copy.deepcopy(before)
            for tk, tv in after.items():
                sv = v.get(tk)
                if not (isinstance(tv, list) and isinstance(sv, list) and tv
                        and isinstance(tv[0], dict) and 'key' in tv[0]):
                    continue
                vm = {e['key']: e for e in sv if isinstance(e, dict) and 'key' in e}
                for e in tv:
                    s = vm.get(e.get('key'))
                    if s:
                        apply_entry(e, s)
            if after == before:
                continue
            nwb = rebuild(after, fmt)

        if nwb == wb:
            continue
        # 回读 + 结构校验：只允许展示类叶子字段变化
        na = json.loads(nwb.decode('utf-8'))
        dp = diff_paths(before, na)
        bad = [x for x in dp if x.split('.')[-1].replace('[]', '').split(' ')[0]
               not in ALLOW_LEAF]
        if bad:
            raise RuntimeError('%s 出现非白名单变更: %s' % (fn, bad[:8]))
        # 行尾污染校验
        if fn not in PATCH_BY_KEY:
            if nwb.count(b'\r\r\n') != wb.count(b'\r\r\n'):
                raise RuntimeError('%s 行尾双重回车数量变化' % fn)
        open(p, 'wb').write(nwb)
        touched.append((fn, len(dp), len(wb), len(nwb)))

    print('=== 已修改 %d 个文件 ===' % len(touched))
    for fn, n, a, b in touched:
        print('  %-38s 变更 %-5d 处  bytes %d -> %d (%+d)' % (fn, n, a, b, b - a))
    print('\n=== 变更统计 ===')
    for k, n in stats.most_common():
        print('  %-34s %d' % (k, n))
    print('  合计 %d 处' % sum(stats.values()))


if __name__ == '__main__':
    main()
