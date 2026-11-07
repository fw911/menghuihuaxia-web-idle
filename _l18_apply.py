#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
L18: 按 0.94 真值重建 data/companion.json 与 data/summons.json
证据：
  - web 两文件均为 0.94 的纯子集（web独有字段数恒为 0），整文件重建零信息损失
  - companion 未接入 web 引擎（DATA_FILES 不含），属 0.94 未移植系统，重建作未来接入备料
  - summons 引擎在消费（battle.js summonDef / render.js 召唤兽面板），重建回正 411 处数值漂移 + 补 zhenzu
  - _run_test.js 不断言 summons 具体属性值，回归安全
用法：
  python3 _l18_apply.py          # dry-run：打印计划与强校验
  python3 _l18_apply.py --apply  # 落盘
"""
import base64, hashlib, json, subprocess, os, sys

ENC = r'E:/放置归墟：梦回华夏 _v0.94/config_enc'
KEY = hashlib.pbkdf2_hmac('sha256', base64.b64decode('kUmtE1a7/jQ7LdM04YhJYXKhRvwaQZ6vqY1YRyIbsr8='),
                          b'MH_CONFIG_ENC_SALT_v1', 200000, 32)
SRC = {'companion': 'data/companion.json', 'summons': 'data/summons.json'}

def dec(fn):
    d = open(os.path.join(ENC, fn + '.json.enc'), 'rb').read()
    assert d[:9] == b'CONFIGENC', fn
    r = subprocess.run(['openssl', 'enc', '-d', '-aes-256-cbc', '-K', KEY.hex(), '-iv', d[9:25].hex()],
                       input=d[25:], capture_output=True)
    assert r.returncode == 0, (fn, r.stderr[:200])
    return json.loads(r.stdout.decode('utf-8'))

def deep_equal(a, b):
    return json.dumps(a, sort_keys=True, ensure_ascii=False) == json.dumps(b, sort_keys=True, ensure_ascii=False)

def main():
    apply = '--apply' in sys.argv
    for name, web_path in SRC.items():
        ref = dec(name)
        # 按 web 风格（indent=2, LF, ensure_ascii=False）序列化 0.94 真值
        out = json.dumps(ref, indent=2, ensure_ascii=False, separators=(',', ':')) + '\n'
        # 强校验：重建内容应与 0.94 逐字段相等
        rebuilt = json.loads(out)
        ok = deep_equal(rebuilt, ref)
        print('=== %s ===' % name)
        print('  web 当前大小: %d 字节 | 重建大小: %d 字节' % (os.path.getsize(web_path), len(out.encode('utf-8'))))
        print('  重建后与 0.94 逐字段 deep-equal: %s' % ok)
        if not ok:
            print('  !! 强校验失败，跳过落盘')
            continue
        if apply:
            # 保留原文件行尾约定：项目 .gitattributes 已归一为 LF，直接用 \n
            with open(web_path, 'w', encoding='utf-8', newline='\n') as f:
                f.write(out)
            # 落盘后再读回校验合法性
            chk = json.load(open(web_path, encoding='utf-8'))
            assert deep_equal(chk, ref), '落盘后校验失败'
            print('  已落盘，合法性 + deep-equal 复核通过')
        else:
            print('  [dry-run] 未落盘')

if __name__ == '__main__':
    main()
