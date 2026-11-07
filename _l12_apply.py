#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""L12：0.94 apply_refine_levels / spec 口径取证 + refine.json 定点补丁。

取证源（三路交叉）：
  A. F:/梦回华夏/_archive/web_idle_disassembly_20261020.zip 里的 _dis_quality.txt
     （v0.58/v0.91 标准 Python 3.14 dis 输出，含完整函数体）
  B. E:/放置归墟：梦回华夏 _v0.94/BACKHX_v0.94.exe 明文紧凑 marshal 常量池
     （0.94 保留了同名函数与 docstring，证明口径未变）
  C. E:/放置归墟：梦回华夏 _v0.94/config_enc/*.enc 解密
     （instance_exchange.json._exchange_spec / refine.json / perk_pool.json）

用法：python _l12_apply.py --check   （只取证校验，不写文件）
      python _l12_apply.py --apply   （落地 refine.json 的 8 档 flat）
"""
import os, sys, json, base64, hashlib, subprocess, zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
DIS_ZIP = r'F:/梦回华夏/_archive/web_idle_disassembly_20261020.zip'
EXE = r'E:/放置归墟：梦回华夏 _v0.94/BACKHX_v0.94.exe'
ENC = r'E:/放置归墟：梦回华夏 _v0.94/config_enc'
B64_KEY = 'kUmtE1a7/jQ7LdM04YhJYXKhRvwaQZ6vqY1YRyIbsr8='
SALT = b'MH_CONFIG_ENC_SALT_v1'
K = hashlib.pbkdf2_hmac('sha256', base64.b64decode(B64_KEY), SALT, 200000, 32)


def dec(name):
    d = open(os.path.join(ENC, name + '.json.enc'), 'rb').read()
    assert d[:9] == b'CONFIGENC'
    r = subprocess.run(['openssl', 'enc', '-d', '-aes-256-cbc',
                        '-K', K.hex(), '-iv', d[9:25].hex()],
                       input=d[25:], capture_output=True)
    assert r.returncode == 0, (name, r.stderr[:200])
    return json.loads(r.stdout.decode('utf-8'))


def dis_lines():
    return zipfile.ZipFile(DIS_ZIP).read('_dis_quality.txt').decode('utf-8', 'replace').split('\n')


def slice_of(lines, a, b):
    return '\n'.join(lines[a - 1:b])


# ---- A. 标准反汇编函数体的硬证据（按行号切片 + 关键指令断言） ----
DIS_CHECKS = [
    # (label, 起, 止, [必须出现的片段...])
    ('apply_refine_levels', 46464, 47100, [
        'Disassembly of <code object apply_refine_levels',
        'max', 'int', 'levels', 'range', 'REFINE_MAX',
        '_apply_refine_one_level', 'add_refine_hidden_perk', 'is_hidden',
        'LOAD_ATTR                6 (refine_level)', 'RETURN_VALUE',
    ]),
    ('_apply_refine_one_level', 46092, 46358, [
        'Disassembly of <code object _apply_refine_one_level',
        'refine_flat_per_level', 'phys_atk', 'magic_atk', 'phys_def', 'magic_def',
        'REFINE_DURABILITY_PCT', 'refine_bonus',
    ]),
    ('add_refine_hidden_perk', 46358, 46464, [
        'Disassembly of <code object add_refine_hidden_perk',
        'REFINE_HIDDEN_PERKS', 'ring2', 'weapon', 'ring1', 'is_hidden',
    ]),
    ('generate_instance_equip_spec', 11950, 12460, [
        "'spec'", "'perks_by_pool_job'", "'weapon'", "'general'",
        '_find_perk_template', 'sockets', "'refine'",
        'apply_refine_levels', 'get_quality', 'count_attrs',
    ]),
    ('_find_perk_template', 11898, 11950, [
        'Disassembly of <code object _find_perk_template',
        "'name'", "'suffix'", 'BUILD_STRING', 'COMPARE_OP',
    ]),
    ('_roll_perk_value', 44792, 45390, [
        'Disassembly of <code object _roll_perk_value',
        '(0.1, 0.7, 0.1, 0.1)', 'q1', 'q3', 'random', 'choices', 'choice',
        '(0.1, 0.7, 0.1, 0.1)',
    ]),
    ('get_quality', 6662, 6760, [
        'Disassembly of <code object get_quality',
        'min_perks', 'perk_count', 'white',
    ]),
    ('REFINE_CONSTANTS', 5300, 5470, [
        "'refine'", "'refine_max'", "'refine_per_level_flat'",
        "'refine_durability_pct'", "'refine_hidden_perks'",
    ]),
]


def check_dis(lines):
    for label, a, b, needles in DIS_CHECKS:
        s = slice_of(lines, a, b)
        missing = [n for n in needles if n not in s]
        assert not missing, '%s 缺少 %s' % (label, missing)
        print('  [DIS] %-32s OK  (%d 行)' % (label, b - a + 1))


# ---- B. 0.94 exe 明文常量池：同名符号与中文 docstring 仍在 ----
EXE_CHECKS = [
    b'apply_refine_levels', b'generate_instance_equip', b'perks_by_pool_job',
    b'_apply_refine_one_level', b'add_refine_hidden_perk',
    '兑换配置'.encode(), '职业词条表'.encode(),
    '赠送已精炼装备时不该结算'.encode(),
    b'_roll_perk_value', b'_roll_subperfect_value',
]


def check_exe():
    d = open(EXE, 'rb').read()
    for kw in EXE_CHECKS:
        assert kw in d, '0.94 exe 缺少 %r' % kw
        print('  [EXE] %-38s x%d' % (kw.decode('utf-8', 'replace'), d.count(kw)))


# ---- C. 0.94 配置真值 ----
def check_config():
    rf = dec('refine')
    ie = dec('instance_exchange')
    pp = dec('perk_pool')
    spec = ie['_exchange_spec']
    assert rf['refine_max'] == 7
    assert rf['refine_per_level_flat']['8'] == [15, 20]
    assert rf['refine_durability_pct'] == 0.04
    assert spec['sockets'] == 3 and spec['refine'] == 5 and spec['perk_value'] == 'mid'
    assert set(spec['perks_by_pool_job']) == {'weapon', 'general'}
    for kind in ('weapon', 'general'):
        assert set(spec['perks_by_pool_job'][kind]) == {
            'warrior', 'mage', 'darkwitch', 'shaman'}
        for j, names in spec['perks_by_pool_job'][kind].items():
            assert len(names) == 2
    # 16 个词条显示名必须能在「池×职业」内按 name+suffix 找到
    jobs = ['warrior', 'mage', 'darkwitch', 'shaman']
    cats = ['stat_fixed', 'stat_percent', 'atk_fixed', 'atk_percent', 'elemental']
    hits = 0
    for kind in ('weapon', 'general'):
        for j in jobs:
            key = (j + '_weapon_perk_pool') if kind == 'weapon' else (j + '_general_pool')
            pool = pp[key]
            display = [(c, t['name'] + (t.get('suffix') or ''), t)
                       for c in cats for t in pool.get(c, [])]
            for want in spec['perks_by_pool_job'][kind][j]:
                f = next((x for x in display if x[1] == want), None)
                assert f is not None, 'spec 词条 %s/%s/%s 不在 %s' % (kind, j, want, key)
                hits += 1
    print('  [CFG] spec 16/16 词条按 name+suffix 在对应池命中；refine_max=7 / refine=5 / sockets=3')
    # web-idle 的 10 个池键与 0.94 相同；但内容并非全等（L11 只核对了键名）：
    #   · 0.94 每个模板带 values['8']（8 档）与 stat_key，web-idle 是 7 档体系且无 stat_key
    #   · ring_perk_pool 被 web-idle 自研扩充（stat_percent 5 vs 2、atk_fixed 15 vs 8）
    # 这里只校验 spec 实际消费的 8 个「职业 general / 职业 weapon」池。
    wp = json.load(open(os.path.join(ROOT, 'data/perk_pool.json'), encoding='utf-8'))
    assert set(wp) == set(pp), '池键集合不一致'
    used = [j + '_general_pool' for j in ('warrior', 'mage', 'darkwitch', 'shaman')] + \
           [j + '_weapon_perk_pool' for j in ('warrior', 'mage', 'darkwitch', 'shaman')]
    checked = 0
    for key in used:
        pool, wpool = pp[key], wp[key]
        assert set(wpool) == set(pool), '%s 分组不一致' % key
        for c in cats:
            a, b = pool.get(c, []), wpool.get(c, [])
            assert len(a) == len(b), '%s/%s 模板数不一致' % (key, c)
            for x, y in zip(a, b):
                assert x['name'] == y['name'] and (x.get('suffix') or '') == (y.get('suffix') or '')
                for t in map(str, range(1, 8)):
                    assert x['values'].get(t) == y['values'].get(t), \
                        '%s/%s/%s 档位 %s 数值不一致' % (key, c, x['name'], t)
                checked += 1
    has8 = any('8' in t['values'] for p in pp.values() for c in cats for t in p.get(c, []))
    hasStatKey = any('stat_key' in t for p in pp.values() for c in cats for t in p.get(c, []))
    assert has8 and hasStatKey, '0.94 的 8 档 / stat_key 特征未检出'
    print('  [CFG] spec 所用 8 池的显示名 + 1..7 档数值与 0.94 逐条一致（%d 模板）' % checked)
    print('  [CFG] 结构差异：0.94 另有 values.8 / stat_key；ring_perk_pool 被 web-idle 自研扩充（本轮不动）')
    return spec


# ---- D. refine.json 定点补丁（保留 \r\r\n，绝不全量重写） ----
OLD = b'    "7": [11, 15]\r\r\n  },\r\r\n  "refine_durability_pct"'
NEW = b'    "7": [11, 15],\r\r\n    "8": [15, 20]\r\r\n  },\r\r\n  "refine_durability_pct"'


def apply_refine():
    p = os.path.join(ROOT, 'data/refine.json')
    d = open(p, 'rb').read()
    if b'"8": [15, 20]' in d:
        print('  [PATCH] 已含 8 档，跳过')
        return
    assert d.count(OLD) == 1, 'refine.json 锚点不唯一，拒绝改写'
    out = d.replace(OLD, NEW)
    # 强校验：仅新增一行，其余字节完全不变；JSON 可解析；行尾统计不变
    assert len(out) == len(d) + len(b',\r\r\n    "8": [15, 20]')
    assert out.count(b'\r\r\n') == d.count(b'\r\r\n') + 1
    j = json.loads(out.decode('utf-8').replace('\r', ''))
    assert j['refine_per_level_flat']['8'] == [15, 20]
    before = json.loads(d.decode('utf-8').replace('\r', ''))
    j['refine_per_level_flat'].pop('8')
    assert j == before, '除 8 档外出现非目标变化'
    open(p, 'wb').write(out)
    print('  [PATCH] data/refine.json 补 8 档 flat [15,20]，%d → %d B，\r\r\n %d → %d'
          % (len(d), len(out), d.count(b'\r\r\n'), out.count(b'\r\r\n')))


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else '--check'
    print('=== L12 取证：apply_refine_levels / spec ===')
    lines = dis_lines()
    check_dis(lines)
    check_exe()
    check_config()
    if mode == '--apply':
        apply_refine()
    elif mode == '--check':
        print('  [CHECK] 未写任何文件')
    else:
        raise SystemExit('用法：--check | --apply')
    print('=== ALL OK ===')


if __name__ == '__main__':
    main()
