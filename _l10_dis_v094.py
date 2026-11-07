# -*- coding: utf-8 -*-
"""L10: 从 v0.94 官方 exe 取证明文常量 / docstring（神秘商人装备生成口径）。

背景（重要，避免后人重走弯路）：
  v0.94 的 PyInstaller 包把 Python 3.14 code object 以**自定义紧凑 marshal**明文存放：
    'a' / 'u' = NUL 结尾 ASCII / UTF-8 字符串，'T' = tuple(n + n 个对象)，
    'l' = varint int，'C' = code object（flags varint + 子对象直到 NUL）。
  它既不是标准 3.14 marshal（marshal.dumps 首字节 0xe3），也不在 zlib 流里，
  所以 marshal.loads 与旧 _dis_dump.py 的 zlib 扫描对它都无效（实测 0 modules）。
  0.94 的规则文档以中文 docstring 明文写在常量池里，含用户拍板日期与概率，
  足以裁定生成口径；公式/函数体则交叉验证 v0.58/v0.91 的 _dis_all.txt（标准 marshal，可 dis）。

用法： python _l10_dis_v094.py
输出： _dis_v094_forensic.txt（.gitignore 覆盖），并校验关键证据串齐全。
只读，不修改 exe。
"""
import io
import os
import re

EXE = r'E:/放置归墟：梦回华夏 _v0.94/BACKHX_v0.94.exe'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '_dis_v094_forensic.txt')

# 关键常量池窗口（针对 BACKHX_v0.94.exe 75,149,312 B 版本）
WINDOWS = [
    (66642380, 66644000, 'generator.py#generate_mystic_equip 参数与常量池'),
    (66643600, 66646200, 'generate_mystic_equip docstring（普通 / 完美两档规则）'),
    (66682400, 66684200, 'perk_pool.py 四档概率分布 / 次完美段 docstring'),
    (69378000, 69378480, 'main.py#api_shop_mystic_exchange 常量池'),
]
CHECKS = [
    '神秘商人装备生成',
    'perfect=True',
    '首条强制取该档上限 hi',
    '词条数单条概率 10%',
    'perfect=False',
    '词条数值四档概率分布',
    '最低（区间下段，含 lo）：10%',
    '次完美段内均匀随机',
]


def strings_in(seg):
    out = []
    for part in re.split(rb'[\x00]+', seg):
        if len(part) < 2:
            continue
        try:
            t = part.decode('utf-8')
        except UnicodeDecodeError:
            continue
        if sum(c.isprintable() or c in '\n\r\t' for c in t) / len(t) > 0.8:
            out.append(t)
    return out


def main():
    d = open(EXE, 'rb').read()
    print('exe size', len(d))
    buf = io.StringIO()
    all_text = []
    for a, b, label in WINDOWS:
        ss = strings_in(d[a:b])
        buf.write('\n' + '=' * 90 + '\n### %s  [%d:%d]\n' % (label, a, b) + '=' * 90 + '\n')
        for s in ss:
            buf.write(repr(s) + '\n')
            all_text.append(s)
        print('%-64s %3d strings' % (label[:64], len(ss)))
    joined = '\n'.join(all_text)
    open(OUT, 'w', encoding='utf-8', newline='').write(buf.getvalue())
    print('\nwritten', OUT, os.path.getsize(OUT), 'bytes')
    missing = [k for k in CHECKS if k not in joined]
    for k in CHECKS:
        print('  [%s] %s' % ('OK' if k in joined else 'MISSING', k))
    assert not missing, 'evidence missing: %r' % missing
    print('\n全部关键证据命中。')


if __name__ == '__main__':
    main()
