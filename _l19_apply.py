"""L19 apply：按 0.94 对齐 items.json + 修正 L17 过度替换

背景（本轮全库 key 感知盘点后确定）：
  1) L17 做了「战魂 → 灵兽」全站替换，但 0.94 自身在部分字段保留「战魂」
     （BOSS 战魂珠 / 战魂殿 / 九黎战魂 / 战魂淬炼的战斧 / 战魂培养料）。
     git 验证 web 原版这 12 处本就与 0.94 一致，是 L17 误改 → 本轮回正。
  2) items.json 条目集合与 0.94 完全一致（357=357，仅web 0 / 仅ref 0），
     按 key 逐字段差异仅：
        icon 148（0.94 图标 web 缺失 → 保留 web 路径）
        desc 134 / name 33 / flavor 11（web「魂能/魂技/驭魂者」术语 → 0.94「灵能/灵技/驭灵者」）
        coupon_price 92（web 全部压平为 1，0.94 为 5~6000 真实值）
        effect.hp_per_tick / mp_per_tick 12（web = 0.94 的 1/4）
        duration_ticks / cd_ticks 24（web 自增字段，0.94 无）
        effect.exp 3 / effect.intimacy 1（web 经济标度 ×100，与 monsters.exp ×10 同源 → 保留）
  3) 药效口径（_dis_battle.txt 563-573 原版字节码）：
        per_tick_key = 'hp_per_tick' if is_hp else 'mp_per_tick'
        fixed_tick = int(effect.get(per_tick_key, 0))
        total = fixed_tick * duration        # total = per_tick × duration
        文案「每回合{per_tick}点」
     web 引擎同构：js/shop.js#useItem  total = per * (duration_ticks || 1)
     → web 回正为 per_tick=80(0.94) × duration_ticks=10(=duration_ms/1000) = 800，
       与 0.94（80/秒 × 10 秒 = 800）及 web 自身 desc「每秒回复 80 点生命，持续 10秒」三方一致。
     佐证：monsters.hp 1536 个全部相同 → web 与 0.94 血量标度一致，
       故 ÷4 不是配套缩放，是纯漂移。

用法：python3 _l19_apply.py [--apply]
"""
import base64, hashlib, json, subprocess, os, sys, copy, re

ROOT = os.path.dirname(os.path.abspath(__file__))
ENC = r'E:/放置归墟：梦回华夏 _v0.94/config_enc'
KEY_B64 = 'kUmtE1a7/jQ7LdM04YhJYXKhRvwaQZ6vqY1YRyIbsr8='
K = hashlib.pbkdf2_hmac('sha256', base64.b64decode(KEY_B64), b'MH_CONFIG_ENC_SALT_v1', 200000, 32)
DATA = os.path.join(ROOT, 'data')


def dec(fn):
    d = open(os.path.join(ENC, fn + '.json.enc'), 'rb').read()
    r = subprocess.run(['openssl', 'enc', '-d', '-aes-256-cbc', '-K', K.hex(), '-iv', d[9:25].hex()],
                       input=d[25:], capture_output=True)
    assert r.returncode == 0, (fn, r.stderr[:200])
    return json.loads(r.stdout.decode('utf-8'))


# ============ Part A：L17 过度替换回正（字节级子串替换，保留行尾） ============
REPL_A = [
    ('data/achievements.json',       '九黎灵兽',                 '九黎战魂', 1),
    ('data/bases_warrior.json',      '以殒铁混合灵兽淬炼的战斧', '以殒铁混合战魂淬炼的战斧', 1),
    ('data/loot_pools.json',         'BOSS 灵兽珠 · 20%（2026-10-15 拍板）', 'BOSS 战魂珠 · 20%（2026-10-15 拍板）', 4),
    ('data/monster_loot_built.json', 'BOSS 灵兽珠 · 20%（2026-10-15 拍板）', 'BOSS 战魂珠 · 20%（2026-10-15 拍板）', 4),
    ('data/maps.json',               '"name": "灵兽殿"',         '"name": "战魂殿"', 1),
    ('data/shops.json',              '灵兽培养料',               '战魂培养料', 1),
]

# ============ Part B/C/D：items.json 按 key 字段级合并 ============
# web 独有字段（0.94 无）→ 保留存在性，值按 0.94 语义换算
TICK_FROM_MS = {'duration_ticks': 'duration_ms', 'cd_ticks': 'cd_ms'}
# 保留 web（web 经济标度 ×100，与 monsters.exp ×10 同源）
KEEP_WEB = {'effect.exp', 'effect.intimacy'}


def keymap(o, out=None):
    if out is None:
        out = {}
    if isinstance(o, dict):
        if isinstance(o.get('key'), str):
            out[o['key']] = o
            return out
        for v in o.values():
            keymap(v, out)
    elif isinstance(o, list):
        for v in o:
            keymap(v, out)
    return out


def leaves(x, p=''):
    o = {}
    if isinstance(x, dict):
        for k, v in x.items():
            o.update(leaves(v, (p + '.' + str(k)) if p else str(k)))
    elif isinstance(x, list):
        for i, v in enumerate(x):
            o.update(leaves(v, p + '[%d]' % i))
    else:
        o[p or '/'] = x
    return o


def merge_items(web, ref):
    """按 key 合并：0.94 真值覆盖 web（icon 除外），web 独有 tick 字段按 ms 换算。"""
    kw, kr = keymap(web), keymap(ref)
    stats = {'desc': 0, 'name': 0, 'flavor': 0, 'coupon_price': 0,
             'effect.hp_per_tick': 0, 'effect.mp_per_tick': 0,
             'duration_ticks': 0, 'cd_ticks': 0, 'kept': 0}
    out = copy.deepcopy(web)
    ko = keymap(out)
    for k in set(kw) & set(kr):
        a, b = ko[k], kr[k]
        for f in ('desc', 'name', 'flavor', 'coupon_price'):
            if f in b and a.get(f) != b[f]:
                a[f] = b[f]
                stats[f] += 1
        # effect.*_per_tick → 0.94 真值
        ea, eb = a.get('effect') or {}, b.get('effect') or {}
        for f in ('hp_per_tick', 'mp_per_tick'):
            if f in eb and ea.get(f) != eb[f]:
                ea[f] = eb[f]
                stats['effect.' + f] += 1
        if ea:
            a['effect'] = ea
        # web 独有 tick 字段：值 = 对应 ms / 1000（0.94 的 duration 语义=秒数）
        for tf, mf in TICK_FROM_MS.items():
            if tf in a and mf in a and isinstance(a[mf], (int, float)):
                nv = int(round(a[mf] / 1000.0))
                if nv != a[tf]:
                    a[tf] = nv
                    stats[tf] += 1
        # effect.exp / effect.intimacy 保留 web
        for f in ('exp', 'intimacy'):
            if f in (a.get('effect') or {}) and f in eb and a['effect'][f] != eb[f]:
                stats['kept'] += 1
    return out, stats


def dump_like(path, obj):
    """按原文件格式序列化（indent=2 + 原行尾）。

    ⚠ 注意：必须先读原始字节再写，否则 `open(p,'wb')` 会先截断文件，
    读到空内容导致行尾判定错误（LF/CRLF 误判）。故本函数只算字节，
    写入由调用方在拿到结果后再执行。
    """
    raw = open(path, 'rb').read()
    nl = '\r\n' if b'\r\n' in raw else '\n'
    text = json.dumps(obj, ensure_ascii=False, indent=2)
    return (text + '\n').replace('\n', nl).encode('utf-8')


def main():
    apply = '--apply' in sys.argv
    print('=== L19 dry-run ===' if not apply else '=== L19 APPLY ===')

    # ---------- Part A ----------
    print('\n-- Part A：修正 L17 过度替换（战魂 ↔ 灵兽），共 %d 处 --' % sum(r[3] for r in REPL_A))
    a_bytes = {}
    for rel, old, new, expect in REPL_A:
        p = os.path.join(ROOT, rel)
        raw = open(p, 'rb').read()
        n = raw.count(old.encode('utf-8'))
        status = 'OK' if n == expect else 'MISMATCH(期望%d)' % expect
        print('  %-34s %-28s x%d  %s' % (os.path.basename(rel), old[:26], n, status))
        if n != expect:
            print('    !! 计数不符，中止'); return 1
        a_bytes[rel] = raw.replace(old.encode('utf-8'), new.encode('utf-8'))

    # ---------- Part B/C/D ----------
    print('\n-- Part B/C/D：items.json 按 key 字段级合并 --')
    ref = dec('items')
    web = json.load(open(os.path.join(DATA, 'items.json'), encoding='utf-8'))
    kw, kr = keymap(web), keymap(ref)
    if set(kw) != set(kr):
        print('  !! 条目集合不一致：仅web %d / 仅ref %d' % (len(set(kw) - set(kr)), len(set(kr) - set(kw))))
        return 1
    print('  条目集合一致：%d = %d' % (len(kw), len(kr)))
    merged, stats = merge_items(web, ref)
    for f, c in stats.items():
        print('    %-22s %d' % (f, c))

    # ---------- 强校验 ----------
    print('\n-- 强校验 --')
    # A：替换后目标串与 0.94 逐字一致
    okA = True
    for rel, old, new, expect in REPL_A:
        if old.encode('utf-8') in a_bytes[rel]:
            print('  !! %s 仍含旧串 %s' % (rel, old)); okA = False
    print('  Part A 旧串清零: %s' % ('OK' if okA else 'FAIL'))

    # B/C/D：合并后按 key 差异应仅剩 icon / effect.exp / effect.intimacy / tick 字段
    mm, mr = keymap(merged), keymap(ref)
    resid = {}
    for k in set(mm) & set(mr):
        la, lb = leaves(mm[k]), leaves(mr[k])
        for p in set(la) | set(lb):
            if la.get(p, '<NA>') != lb.get(p, '<NA>'):
                head = p.split('[')[0]
                resid[head] = resid.get(head, 0) + 1
    print('  合并后残余差异路径: %s' % dict(sorted(resid.items(), key=lambda x: -x[1])))
    allowed = {'icon', 'effect.exp', 'effect.intimacy', 'duration_ticks', 'cd_ticks'}
    bad = {k: v for k, v in resid.items() if k not in allowed}
    print('  非预期残余差异: %s' % (bad if bad else '无'))
    # tick 字段语义校验
    tickbad = []
    for k in set(mm):
        e = mm[k]
        for tf, mf in TICK_FROM_MS.items():
            if tf in e and mf in e:
                if e[tf] != int(round(e[mf] / 1000.0)):
                    tickbad.append((k, tf, e[tf], e[mf]))
    print('  tick 字段换算校验: %s' % ('OK' if not tickbad else 'FAIL %s' % tickbad[:3]))
    # 药效总量与 0.94 desc 一致性（回春丹应为 80×10=800）
    md = mm.get('xumingdan', {})
    tot = (md.get('effect', {}).get('hp_per_tick') or 0) * (md.get('duration_ticks') or 0)
    print('  回春丹总回复量: %d (期望 800 = 0.94 每秒80 × 10秒) %s' % (tot, 'OK' if tot == 800 else 'FAIL'))

    if not apply:
        print('\n[dry-run] 未落盘。加 --apply 执行。')
        return 0

    # ---------- 落盘 ----------
    for rel in a_bytes:
        p = os.path.join(ROOT, rel)
        open(p, 'wb').write(a_bytes[rel])
        json.load(open(p, encoding='utf-8'))
        print('  写入 %s' % rel)
    p = os.path.join(DATA, 'items.json')
    payload = dump_like(p, merged)      # 先算字节，再写（避免 wb 截断导致行尾误判）
    open(p, 'wb').write(payload)
    json.load(open(p, encoding='utf-8'))
    print('  写入 data/items.json')
    print('\nL19 落盘完成。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
