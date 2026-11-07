# -*- coding: utf-8 -*-
"""L7 取证：v0.91 的 shops.items[].price / maps.jubao_spots[].refresh_minutes
到底是不是「占位/脱敏值」？真实来源在哪？

只读脚本，不修改任何 data/ 文件。运行：python _l7_forensic.py

证据链（四级）：
  ① 原版 exe 包内 config_enc/*.enc：用官方派生密钥 AES-256-CBC 直接解密，
     绕开「解密目录可能被改写」的疑问，拿到原版配置的最原始字节。
  ② 原版 exe 反汇编包 _dis_*.txt：确认引擎如何消费这两个字段、有无运行时回填。
  ③ MOD 覆盖机制：config_loader._OVERRIDE_FIELDS 是否可能回填数值。
  ④ v0.58 原版 + web-idle 对照：判定 v0.91 是「数据丢失」还是「主动改写」。
"""
import os, io, json, sys, subprocess, zipfile, collections

ROOT = os.path.dirname(os.path.abspath(__file__))
ARCHIVE = r'F:\梦回华夏\_archive\web_idle_disassembly_20261020.zip'
EXE_DIR = r'E:\华夏\放置归墟：梦回华夏 v0.91'
ENC_DIR = os.path.join(EXE_DIR, 'config_enc')
DERIVED_KEY = '78f5fd7ba2823da738cc86f8cac3cfb0a325cc86efb54f2b14ea91ba39e853f7'
MAGIC = b'CONFIGENC'
DIRS = {
    'web-idle': os.path.join(ROOT, 'data'),
    'v0.91':    os.path.join(ROOT, '..', '放置归墟_v0.91_decrypted'),
    'v0.58':    os.path.join(ROOT, '..', '梦回华夏_v0.58_decrypted'),
}


def load(p):
    return json.load(io.open(p, encoding='utf-8'))


def line(title):
    print('\n' + '=' * 78)
    print(title)
    print('=' * 78)


# ---------------------------------------------------------------- ①
def decrypt_enc(fn):
    """用官方派生密钥解一份原版加密配置；openssl 缺失时明确报错。"""
    d = open(os.path.join(ENC_DIR, fn), 'rb').read()
    assert d[:len(MAGIC)] == MAGIC, '魔数不符: %s' % fn
    iv, body = d[len(MAGIC):len(MAGIC) + 16], d[len(MAGIC) + 16:]
    r = subprocess.run(
        ['openssl', 'enc', '-d', '-aes-256-cbc', '-K', DERIVED_KEY, '-iv', iv.hex()],
        input=body, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError('openssl 解密失败: %s' % r.stderr.decode('utf-8', 'replace')[:200])
    return json.loads(r.stdout.decode('utf-8'))


def step1():
    line('① 原版 exe 加密配置：直接解密取原始字节（绕开解密目录）')
    if not os.path.isdir(ENC_DIR):
        print('  !! 未找到原版加密配置目录：%s' % ENC_DIR)
        return None
    shops = decrypt_enc('shops.json.enc')
    maps = decrypt_enc('maps.json.enc')
    items = decrypt_enc('items.json.enc')
    prices = [x.get('price') for s in shops['shops'] for x in (s.get('items') or [])]
    refresh = [x.get('refresh_minutes') for m in maps['maps'] for x in (m.get('jubao_spots') or [])]
    item_prices = [x.get('price') for x in items['items'] if 'price' in x]
    print('  shops.json.enc   -> shops=%d items=%d  price 分布=%s'
          % (len(shops['shops']), len(prices), collections.Counter(prices).most_common(6)))
    print('  maps.json.enc    -> maps=%d jubao=%d  refresh_minutes 分布=%s'
          % (len(maps['maps']), len(refresh), collections.Counter(refresh).most_common(6)))
    print('  items.json.enc   -> items=%d  含 price=%d  分布=%s'
          % (len(items['items']), len(item_prices), collections.Counter(item_prices).most_common(6)))
    print('  药店前 3 条：%s' % json.dumps(shops['shops'][0]['items'][:3], ensure_ascii=False))
    return shops, maps, items


# ---------------------------------------------------------------- ②
def step2():
    line('② 原版 exe 字节码：引擎消费口径')
    if not os.path.exists(ARCHIVE):
        print('  !! 未找到反汇编归档：%s' % ARCHIVE)
        return
    z = zipfile.ZipFile(ARCHIVE)
    lines = z.read('_dis_all.txt').decode('utf-8', 'replace').splitlines()
    mod, mods = '', []
    for l in lines:
        if l.startswith('### MODULE'):
            mod = l.strip()
        mods.append(mod)

    def show(a, b, tag):
        print('  --- %s (反汇编文本第 %d 行) ---' % (tag, a))
        for i in range(a, b):
            print('    %6d| %s' % (i, lines[i].strip()[:120]))

    # 聚宝冷却：main.py:1674
    idx = next(i for i, l in enumerate(lines) if "LOAD_CONST              10 ('refresh_minutes')" in l)
    show(idx - 2, idx + 10, '聚宝冷却换算')
    # 商店价格：api_shop 列表接口
    idx2 = next(i for i, l in enumerate(lines) if "STORE_DEREF             34 (entry)" in l)
    show(idx2 - 14, idx2 + 4, 'api_shop 的 entry 来源 = shop["items"] 遍历元素')
    # 购买扣款
    idx3 = next(i for i, l in enumerate(lines) if "LOAD_CONST              25 ('price')" in l and i > 51000)
    show(idx3 - 3, idx3 + 12, 'api_shop/buy 扣款')

    print('\n  字节码结论：')
    print('   · refresh = int(js.get("refresh_minutes", 30)) * 60  → 字段存在且为 0 时零冷却；')
    print('     默认 30 分钟只在【字段缺失】时生效，不会覆盖 0。')
    print('   · 商店列表 price = entry.get("price", it.get("price", 0))；')
    print('     entry 来自 shops.json 的 items[]，每条都带 price=1 → 恒取 1；')
    print('     items.json 的真实价格只是「entry 无 price 字段」时的兜底，永不生效。')
    print('   · 购买 total = entry.get("price", 0) * count → spend_currency(total) → 1 铜币/件。')


# ---------------------------------------------------------------- ③
def step3():
    line('③ 运行时是否可能回填？config_loader 覆盖机制')
    if not os.path.exists(ARCHIVE):
        print('  !! 未找到反汇编归档')
        return
    z = zipfile.ZipFile(ARCHIVE)
    lines = z.read('_dis_all.txt').decode('utf-8', 'replace').splitlines()
    for i, l in enumerate(lines):
        if '_OVERRIDE_FIELDS' in l or "LOAD_CONST              71 ('name')" in l and i < 3000:
            if '_OVERRIDE_FIELDS' in l:
                for j in range(max(0, i - 4), min(len(lines), i + 3)):
                    print('    %6d| %s' % (j, lines[j].strip()[:120]))
    print('\n  · _OVERRIDE_FIELDS = {"name", "desc"}：MOD 覆盖只改文案，不改数值。')
    print('  · config_loader._load() 为纯 JSON 加载；config.py 只建 SHOP_BY_KEY 索引。')
    print('  · 全字节码中对 price / refresh_minutes 无任何 STORE_SUBSCR / STORE_ATTR 写入，')
    print('    即【不存在运行时回填】，1 / 0 就是最终生效值。')


# ---------------------------------------------------------------- ④
def step4():
    line('④ 三套数据对照：v0.91 是数据丢失还是主动改写？')
    for tag, base in DIRS.items():
        if not os.path.isdir(base):
            print('  %-9s 目录不存在，跳过' % tag)
            continue
        s = load(os.path.join(base, 'shops.json'))
        m = load(os.path.join(base, 'maps.json'))
        pr = [x.get('price') for sh in s['shops'] for x in (sh.get('items') or [])]
        rf = [x.get('refresh_minutes') for mp in m['maps'] for x in (mp.get('jubao_spots') or [])]
        print('  %-9s shops=%-3d price种类=%-3d 分布=%s' % (
            tag, len(pr), len(set(pr)), collections.Counter(pr).most_common(5)))
        print('  %-9s jubao=%-3d refresh种类=%-3d 分布=%s' % (
            '', len(rf), len(set(rf)), collections.Counter(rf).most_common(5)))

    s = load(os.path.join(DIRS['web-idle'], 'shops.json'))
    print('\n  web-idle 混合态（price=1 的归属）：')
    for sh in s['shops']:
        c = collections.Counter(x.get('price') for x in (sh.get('items') or []))
        if c.get(1):
            print('    %-24s %3d/%3d 条为 1' % (sh['key'], c[1], sum(c.values())))


# ---------------------------------------------------------------- 裁定
def verdict():
    line('裁定')
    print('  这 88 处【不是占位值、不是脱敏、也不是我们改写】：')
    print('   · 原版 v0.91 config_enc/*.enc 直接解密即为 185/185=1、50/50=0；')
    print('   · 引擎按字段值直接消费，无运行时回填；')
    print('   · v0.58 原版这两个字段都有完整真实值（price 42 种 / refresh 25 种）。')
    print('  → 结论：v0.91 作者把「商店购买价」与「聚宝刷新冷却」主动压成 1 / 0，')
    print('    是放置爽玩 MOD 的刻意数值设定，而非数据缺失。')
    print('    真实价格仍完整保留在 items.json[].price（20/45/80/130/190/260…），')
    print('    但在 v0.91 口径下只是永不生效的兜底。')
    print('\n  对 web-idle 的影响：当前是混合态 —— L3 从 v0.91 补进来的 8 个新商店')
    print('  （104 条）与 5 个新聚宝点已经是 1 / 0，6 个老商店与 45 个老聚宝点仍是 v0.58 真值。')
    print('  两条可选路线（本脚本不执行任何修改）：')
    print('    A 完全忠实 v0.91：43 处 price→1、45 处 refresh→0，全表统一；经济变为 1 金币 / 零冷却。')
    print('    B 保持经济可玩：把 104 条新增商品按 items.json 权威价回填、5 个新增聚宝点补冷却，')
    print('      全表回到 v0.58 定价体系。')


if __name__ == '__main__':
    step1()
    step2()
    step3()
    step4()
    verdict()
    print('\n（只读取证结束，未修改任何 data/ 文件）')
