# -*- coding: utf-8 -*-
"""L10: 把 companion_grocery 的展示文案统一到 v0.94 官方（灵兽系）。

背景：L6 按 v0.91 把该店文案对齐为「战魂」系；L9 按 0.94 补了 3 个续命道具，
其 group 是 0.94 的「延灵」，与店内「摄魂 / 逗魂粮」不自洽。
L8 起 0.94 已被确立为官方权威源，故本轮把该店 name/desc/14 个 group 一并回正 0.94。

用法： python _l10_apply.py --dry-run | --apply
目标值不硬编码：直接从 v0.94 config_enc/shops.json.enc 解密取得。
数据文件一律 bytes 直写，保留 CRLF；反向替换校验保证非目标字节零变化。
"""
import base64
import hashlib
import io
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SHOP = os.path.join(ROOT, 'data', 'shops.json')
ENC = r'E:/放置归墟：梦回华夏 _v0.94/config_enc'
SALT = b'MH_CONFIG_ENC_SALT_v1'
KEY_B64 = 'kUmtE1a7/jQ7LdM04YhJYXKhRvwaQZ6vqY1YRyIbsr8='


def decrypt(fn):
    d = open(os.path.join(ENC, fn + '.json.enc'), 'rb').read()
    assert d[:9] == b'CONFIGENC'
    key = hashlib.pbkdf2_hmac('sha256', base64.b64decode(KEY_B64), SALT, 200000, 32)
    r = subprocess.run(['openssl', 'enc', '-d', '-aes-256-cbc', '-K', key.hex(),
                        '-iv', d[9:25].hex()], input=d[25:], capture_output=True)
    assert r.returncode == 0, r.stderr[:200]
    return json.loads(r.stdout.decode('utf-8'))


def main():
    apply = '--apply' in sys.argv
    ref = [s for s in decrypt('shops')['shops'] if s['key'] == 'companion_grocery'][0]
    old_raw = open(SHOP, 'rb').read()
    old_txt = old_raw.decode('utf-8')
    before = json.loads(old_txt)
    cur = [s for s in before['shops'] if s['key'] == 'companion_grocery'][0]

    # 目标值全部取自 0.94 官方
    pairs = [
        ('"name": "' + cur['name'] + '"', '"name": "' + ref['name'] + '"', 1),
        ('"desc": "' + cur['desc'] + '"', '"desc": "' + ref['desc'] + '"', 1),
    ]
    # group：按 0.94 的 (item -> group) 映射推导需要替换的词对
    group94 = {e.get('item'): e.get('group') for e in ref['items']}
    changed = [(e.get('item'), e.get('group'), group94.get(e.get('item')))
               for e in cur['items'] if e.get('group') != group94.get(e.get('item'))]
    from collections import Counter
    for (og, ng), n in sorted(Counter((a, c) for _, a, c in changed).items()):
        pairs.append(('"group": "' + og + '"', '"group": "' + ng + '"', n))

    print('0.94 商店名/描述:', ref['name'], '|', ref['desc'])
    print('group 变更条目数:', len(changed))
    for old, new, cnt in pairs:
        real = old_raw.count(old.encode('utf-8'))
        print('  %-46s -> %-30s 预期 %2d 实际 %2d' % (old[:44], new[:28], cnt, real))
        assert real == cnt, 'unexpected occurrence count: ' + old[:40]

    new_raw = old_raw
    for old, new, _ in pairs:
        new_raw = new_raw.replace(old.encode('utf-8'), new.encode('utf-8'))

    # 反向替换必须逐字节还原，证明除上述 token 外零改动
    back = new_raw
    for old, new, _ in reversed(pairs):
        back = back.replace(new.encode('utf-8'), old.encode('utf-8'))
    assert back == old_raw, 'non-target bytes changed!'
    assert new_raw.count(b'\r\n') == old_raw.count(b'\r\n'), 'EOL changed'

    new_txt = new_raw.decode('utf-8')
    after = json.loads(new_txt)
    assert len(after['shops']) == len(before['shops'])
    # 结构校验：仅允许该店的 name/desc 与 14 个 group 变化
    for a, b in zip(before['shops'], after['shops']):
        if a['key'] != 'companion_grocery':
            assert a == b, 'other shop changed: ' + a['key']
        else:
            a2, b2 = json.loads(json.dumps(a)), json.loads(json.dumps(b))
            assert b2['name'] == ref['name'] and b2['desc'] == ref['desc']
            assert len(b2['items']) == len(ref['items'])
            for x, y, r in zip(a2['items'], b2['items'], ref['items']):
                assert x['item'] == y['item'] == r['item']
                assert y['group'] == r['group'], (y['item'], y['group'], r['group'])
                x.pop('group'); y.pop('group')
                assert x == y, 'non-group field changed: ' + y['item']
            a2.pop('name'); a2.pop('desc'); b2.pop('name'); b2.pop('desc')
            a2.pop('items'); b2.pop('items')
            assert a2 == b2, 'other shop-level field changed'

    print('\n校验通过：%d 处文案替换，CRLF %d 行不变，%d -> %d 字节' %
          (sum(c for _, _, c in pairs), new_raw.count(b'\r\n'), len(old_raw), len(new_raw)))
    if apply:
        open(SHOP, 'wb').write(new_raw)
        print('已写入', SHOP)
    else:
        print('（dry-run，未写盘）')


if __name__ == '__main__':
    main()
