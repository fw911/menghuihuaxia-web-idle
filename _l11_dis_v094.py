# -*- coding: utf-8 -*-
"""L11: 取证 0.94 神秘商人「按职业×部位分选词条池」与四档取值的完整口径。

背景（承接 L10）：
  BACKHX_v0.94.exe 把 Python 3.14 code object 以**自定义紧凑 marshal 明文**存放，
  标准 marshal.loads / zlib 扫描都无效（L10 已实测 0 modules）。但常量池与
  docstring 是明文，足以取到池映射、四档权重、次完美段边界；函数体则用
  v0.58/v0.91 的标准反汇编 _dis_all.txt 交叉验证（旧版同函数族）。

本轮新增证据：
  1) 0.94 常量池 S\\x02 {'gloves','weapon'} = _WEAPON_SLOTS
     D\\x03 {ring1,ring2 -> ring_perk_pool, necklace -> necklace_perk_pool} = _JEWELRY_POOLS
  2) _pick_pool docstring「按 (职业, 部位) 选词条池」三条分支
  3) 四档权重 = L\\x04 + 4 个 double(0.1 / 0.7 / 0.1 / 0.1)
  4) _roll_subperfect_value docstring「段 = [lo+q3, hi-1]，n<=4 退化取 hi-1」
  5) 旧版 _dis_all.txt#generate_mystic_equip：seen 去重 + random.sample 不放回、
     values.get(str(tier), [1,3])、hand 规范化 single/double
  6) #get_quality 只读 perk_count；#count_attrs = 非隐藏词条数 + len(slots)
     → qualityFromPerks(词条数) 忠实，total_slots 参数未被使用
  7) 解密 0.94 perk_pool.json / quality.json，与 web-idle 逐键对比一致

用法： python _l11_dis_v094.py
输出： _dis_v094_l11.txt（.gitignore 的 _dis_*.txt 已覆盖）
只读，不修改任何 data/ 或 exe。
"""
import base64
import hashlib
import io
import json
import os
import re
import struct
import subprocess
import zipfile

EXE = r'E:/放置归墟：梦回华夏 _v0.94/BACKHX_v0.94.exe'
ENC = r'E:/放置归墟：梦回华夏 _v0.94/config_enc'
OLD_DIS = r'F:/梦回华夏/_archive/web_idle_disassembly_20261020.zip'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '_dis_v094_l11.txt')
DATA = os.path.join(HERE, 'data')

SALT = b'MH_CONFIG_ENC_SALT_v1'
K94_B64 = 'kUmtE1a7/jQ7LdM04YhJYXKhRvwaQZ6vqY1YRyIbsr8='

# 针对 75,149,312 B 版 BACKHX_v0.94.exe 的常量池窗口
WINDOWS = [
    (66682180, 66682360, '_pick_pool 常量池（_JEWELRY_POOLS / _WEAPON_SLOTS 引用）'),
    # docstring 是连续 UTF-8，窗口边界若落在多字节字符中间会整段解码失败，
    # 因此 _pick_pool / 四档 / 次完美三份 docstring 必须一次覆盖，不能拆窗。
    (66682300, 66683680, '_pick_pool / 四档 / 次完美 docstring 连续区'),
    (66682630, 66682790, '_roll_perk_value 常量（四档权重浮点）'),
    (66685780, 66685940, '_WEAPON_SLOTS 与 _JEWELRY_POOLS 值定义'),
]

CHECKS = [
    '按 (职业, 部位) 选词条池',
    '首饰(ring1/ring2/necklace) -> 跨职业通用池',
    '武器/护手(weapon/gloves) -> 该职业武器池',
    '其余防具 -> 该职业通用池',
    '词条数值四档概率分布',
    '最低（区间下段，含 lo）：10%',
    '中位数（中段，占比最大）：70%',
    '次完美（上段，接近但不到上限）：10%',
    '完美（取 hi）：10%',
    '次完美段内均匀随机',
    '宽区间段 = [lo+q3, hi-1]',
]

POOL_CONST_CHECKS = ['gloves', 'weapon', 'ring1', 'ring2', 'necklace',
                     'ring_perk_pool', 'necklace_perk_pool']


def printable_strings(seg):
    out = []
    for part in re.split(rb'[\x00]+', seg):
        if len(part) < 2:
            continue
        try:
            t = part.decode('utf-8')
        except UnicodeDecodeError:
            continue
        if sum(c.isprintable() or c in '\n\r\t' for c in t) / len(t) > 0.75:
            out.append(t)
    return out


def dec94(fn):
    key = hashlib.pbkdf2_hmac('sha256', base64.b64decode(K94_B64), SALT, 200000, 32)
    d = open(os.path.join(ENC, fn + '.json.enc'), 'rb').read()
    assert d[:9] == b'CONFIGENC'
    r = subprocess.run(['openssl', 'enc', '-d', '-aes-256-cbc',
                        '-K', key.hex(), '-iv', d[9:25].hex()],
                       input=d[25:], capture_output=True)
    assert r.returncode == 0, (fn, r.stderr[:200])
    return json.loads(r.stdout.decode('utf-8'))


def old_dis_blocks():
    z = zipfile.ZipFile(OLD_DIS)
    lines = z.read('_dis_all.txt').decode('utf-8', 'replace').split('\n')
    starts = [i for i, l in enumerate(lines) if l.startswith('Disassembly of')]
    blocks = {}
    for n, i in enumerate(starts):
        e = starts[n + 1] if n + 1 < len(starts) else len(lines)
        blocks[lines[i]] = '\n'.join(lines[i:e])
    return blocks


def main():
    d = open(EXE, 'rb').read()
    buf = io.StringIO()
    all_text = []
    print('exe size', len(d))
    for a, b, label in WINDOWS:
        ss = printable_strings(d[a:b])
        buf.write('\n' + '=' * 88 + '\n### %s  [%d:%d]\n' % (label, a, b) + '=' * 88 + '\n')
        for s in ss:
            buf.write(repr(s) + '\n')
            all_text.append(s)
        print('%-60s %3d strings' % (label[:60], len(ss)))
    joined = '\n'.join(all_text)

    # 四档权重：L\x04 后 4 个 (tag 'f' + double)
    i = d.find(b'L\x04', 66682600, 66682800)
    weights = []
    if i >= 0:
        p = i + 2
        for _ in range(4):
            if d[p:p + 1] != b'f':
                break
            weights.append(struct.unpack_from('<d', d, p + 1)[0])
            p += 9
    buf.write('\n### 四档权重解析 @%d: %r\n' % (i, weights))
    print('  四档权重 @%d -> %r' % (i, weights))
    assert [round(x, 6) for x in weights] == [0.1, 0.7, 0.1, 0.1], weights

    # 池常量值定义
    pool_seg = '\n'.join(printable_strings(d[66685780:66685940]))
    buf.write('\n### 池常量区可打印串\n' + repr(pool_seg) + '\n')
    for k in POOL_CONST_CHECKS:
        assert k in pool_seg or k in joined, 'missing pool const: ' + k
    print('  池常量键 %d 个全部命中' % len(POOL_CONST_CHECKS))

    # 旧版标准反汇编函数体
    blocks = old_dis_blocks()
    def block_of(name):
        for k, v in blocks.items():
            if ('code object ' + name) in k:
                return v
        return ''
    gm = block_of('generate_mystic_equip')
    gq = block_of('get_quality')
    ca = block_of('count_attrs')
    for label, body, kws in [
        ('generate_mystic_equip', gm, ['random', 'sample', 'seen', 'randint', 'is_hidden']),
        ('get_quality', gq, ['min_perks', 'quality', 'perk_count']),
        ('count_attrs', ca, ['is_hidden', 'slots']),
    ]:
        assert body, 'missing disassembly block: ' + label
        buf.write('\n' + '=' * 88 + '\n### v0.58/v0.91 标准反汇编 ' + label + '\n' + '=' * 88 + '\n')
        buf.write(body + '\n')
        missing = [k for k in kws if k not in body]
        print('  %-24s %6d B  关键串 %s' % (label, len(body), 'OK' if not missing else missing))
        assert not missing, (label, missing)

    # 解密 0.94 配置并与 web-idle 对比
    p94 = dec94('perk_pool')
    q94 = dec94('quality')
    pw = json.load(open(os.path.join(DATA, 'perk_pool.json'), encoding='utf-8'))
    qw = json.load(open(os.path.join(DATA, 'quality.json'), encoding='utf-8'))
    assert set(p94) == set(pw), (set(p94) ^ set(pw))
    assert q94['quality_thresholds'] == qw['quality_thresholds']
    buf.write('\n### 0.94 perk_pool 顶层键 %d 个，与 web-idle 完全一致\n' % len(p94))
    buf.write('### 0.94 quality_thresholds 与 web-idle 完全一致: %s\n' %
              json.dumps(q94['quality_thresholds'], ensure_ascii=False))
    print('  0.94 perk_pool %d 池 / quality_thresholds 与 web-idle 逐键一致' % len(p94))

    missing = [k for k in CHECKS if k not in joined]
    for k in CHECKS:
        print('  [%s] %s' % ('OK' if k in joined else 'MISSING', k))
    assert not missing, 'evidence missing: %r' % missing

    io.open(OUT, 'w', encoding='utf-8', newline='\n').write(buf.getvalue())
    print('\nwritten', OUT, os.path.getsize(OUT), 'bytes')
    print('全部关键证据命中。')


if __name__ == '__main__':
    main()
