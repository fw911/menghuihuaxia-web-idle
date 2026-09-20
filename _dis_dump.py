# -*- coding: utf-8 -*-
"""把 PyInstaller exe 里的所有 Python 模块反汇编导出成一个大文本，便于 grep 常量/公式。

只做索引 + dis，不改动 exe，也不写回任何东西。
用法： python _dis_dump.py                     # 导出全部模块到 _dis_all.txt
      python _dis_dump.py refine              # 只导出「反汇编文本里含 refine 的模块」
      python _dis_dump.py refine,mining      # 逗号分隔 = 多关键字 OR
      python _dis_dump.py refine _r.txt       # 第二个参数可指定输出文件名
"""
import io, os, re, sys, zlib, marshal, struct, dis, time

EXE = r"F:\梦回华夏\梦回华夏_v0.58\梦回华夏_v0.58.exe"
_HERE = os.path.dirname(os.path.abspath(__file__))
FILTERS = [s.strip().lower() for s in sys.argv[1].split(',') if s.strip()] if len(sys.argv) > 1 else []
OUT = os.path.join(_HERE, sys.argv[2] if len(sys.argv) > 2 else '_dis_all.txt')

t0 = time.time()
d = open(EXE, 'rb').read()
print('exe size', len(d))

magic, pkg_len, toc_off, x, pyvers, pylib = struct.unpack('!8sIIII64s', d[-88:])
print('cookie magic', magic, 'pyvers', pyvers, 'pkg_len', pkg_len, 'toc_off', toc_off)

cands = [i for i in range(len(d) - 2) if d[i] == 0x78 and d[i + 1] in (0x01, 0x5E, 0x9C, 0xDA)]
print('zlib candidates', len(cands), '(%.1fs)' % (time.time() - t0))

mods = {}
for i in cands:
    try:
        code = marshal.loads(zlib.decompressobj().decompress(d[i:i + 8_000_000], 32_000_000))
    except Exception:
        continue
    if hasattr(code, 'co_filename'):
        mods.setdefault(code.co_filename, []).append((i, code))
print('modules found', len(mods), '(%.1fs)' % (time.time() - t0))


def walk(co, path=''):
    yield co, path
    for c in co.co_consts:
        if hasattr(c, 'co_code'):
            yield from walk(c, path + '/' + co.co_name)


buf = io.StringIO()
kept = []
for fn in sorted(mods):
    for pos, code in mods[fn]:
        blk = io.StringIO()
        try:
            dis.dis(code, file=blk)
        except Exception as e:
            blk.write('# dis failed: %s\n' % e)
        text = blk.getvalue()
        low_fn = fn.lower()
        if FILTERS and not any(f in text.lower() or f in low_fn for f in FILTERS):
            continue
        kept.append((fn, pos, len(text)))
        buf.write('\n' + '=' * 100 + '\n')
        buf.write('### MODULE %s  (pos=%d, bytes=%d)\n' % (fn, pos, len(text)))
        buf.write('=' * 100 + '\n')
        buf.write(text)

with io.open(OUT, 'w', encoding='utf-8', newline='') as f:
    f.write(buf.getvalue())

print('kept modules', len(kept), '/ total', sum(len(v) for v in mods.values()))
print('written %s  %.1f MB  (%.1fs)' % (OUT, os.path.getsize(OUT) / 1e6, time.time() - t0))
for fn, pos, n in sorted(kept, key=lambda r: -r[2])[:25]:
    print('   %8d B  %s' % (n, fn))
