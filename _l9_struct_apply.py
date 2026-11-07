#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""L9: 按 v0.94 补齐结构差异（神秘商人 40 条 + 3 个续命道具）。

数据源 : E:/放置归墟：梦回华夏 _v0.94/config_enc/{shops,items}.json.enc
范围   :
  1) data/items.json        末尾追加 3 个续命道具定义（yanshou_san / yanshou_dan /
                            jiuzhuan_yanshou_dan），字段逐字忠实 0.94
  2) data/shops.json        shenmi_shangren.items 3 条 -> 0.94 的 40 条（完整替换）
                            companion_grocery.items 19 条 -> 22 条（在 xianhun_dan 后
                            插入 3 条续命道具；原有 19 条一律不动，保留 L6 的战魂系文案）

原则   : bytes 直写 + 按 key 定位对象 + 括号配对确定数组区间，只替换目标数组内部；
         两个目标文件均为 CRLF，前缀/后缀字节零变化，回读校验非目标字段全等。

用法   : python _l9_struct_apply.py --dry-run
         python _l9_struct_apply.py --apply
"""
import argparse
import base64
import hashlib
import json
import os
import re
import subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
ENC94 = r"E:/放置归墟：梦回华夏 _v0.94/config_enc"
KEY_B64 = "kUmtE1a7/jQ7LdM04YhJYXKhRvwaQZ6vqY1YRyIbsr8="
SALT = b"MH_CONFIG_ENC_SALT_v1"
ITEMS = os.path.join(ROOT, "data", "items.json")
SHOPS = os.path.join(ROOT, "data", "shops.json")
EOL = b"\r\n"
LIFE_KEYS = ("yanshou_san", "yanshou_dan", "jiuzhuan_yanshou_dan")


def dec94(name):
    blob = open(os.path.join(ENC94, name + ".json.enc"), "rb").read()
    assert blob[:9] == b"CONFIGENC", name
    key = hashlib.pbkdf2_hmac("sha256", base64.b64decode(KEY_B64), SALT, 200000, 32)
    r = subprocess.run(
        ["openssl", "enc", "-d", "-aes-256-cbc", "-K", key.hex(), "-iv", blob[9:25].hex()],
        input=blob[25:], capture_output=True,
    )
    assert r.returncode == 0, (name, r.stderr[:200])
    return json.loads(r.stdout.decode("utf-8"))


def fmt_block(obj, indent):
    """json.dumps(indent=2) 后整体加 indent 空格前缀，返回 CRLF 的 bytes 块。"""
    s = json.dumps(obj, ensure_ascii=False, indent=2)
    return EOL.join((" " * indent + ln).encode("utf-8") for ln in s.split("\n"))


def find_items_span(raw, shop_key):
    """返回 (数组内容起点, 闭合 ] 的位置)：按 key 定位商店对象，再括号配对。"""
    m = re.search(rb'"key"\s*:\s*"' + shop_key.encode() + rb'"', raw)
    assert m, "找不到商店 " + shop_key
    im = re.search(rb'"items"\s*:\s*\[', raw[m.end():])
    assert im, "找不到 items 数组 " + shop_key
    start = m.end() + im.end()
    depth, i, in_str, esc = 1, start, False, False
    while i < len(raw):
        b = raw[i]
        if in_str:
            if esc:
                esc = False
            elif b == 0x5C:          # backslash
                esc = True
            elif b == 0x22:          # quote
                in_str = False
        else:
            if b == 0x22:
                in_str = True
            elif b == 0x5B:
                depth += 1
            elif b == 0x5D:
                depth -= 1
                if depth == 0:
                    return start, i
        i += 1
    raise AssertionError("items 数组未闭合 " + shop_key)


def render_array(items, obj_indent, close_indent):
    """生成数组内部 bytes：EOL + 对象块(逗号分隔) + EOL + 闭合 ] 的缩进。"""
    blocks = [fmt_block(o, obj_indent) for o in items]
    return EOL + (b"," + EOL).join(blocks) + EOL + b" " * close_indent


def replace_shop_items(raw, shop_key, new_items):
    start, end = find_items_span(raw, shop_key)
    replacement = render_array(new_items, 8, 6)
    out = raw[:start] + replacement + raw[end:]
    # 前缀与后缀零变化
    assert out[:start] == raw[:start]
    assert out.endswith(raw[end:])
    return out


def append_items(raw, new_defs):
    marker = EOL + b"  ]" + EOL + b"}"
    pos = raw.rfind(marker)
    assert pos > 0, "找不到 items.json 数组结尾"
    blocks = [fmt_block(o, 4) for o in new_defs]
    inserted = b"," + EOL + (b"," + EOL).join(blocks)
    out = raw[:pos] + inserted + marker
    assert out[:pos] == raw[:pos] and out.endswith(marker)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    if not (args.dry_run or args.apply):
        ap.error("需要 --dry-run 或 --apply")

    s94 = dec94("shops")["shops"]
    i94 = dec94("items")["items"]
    shop94 = {s["key"]: s for s in s94}
    new_defs = [x for x in i94 if x["key"] in LIFE_KEYS]
    assert len(new_defs) == 3
    mystic94 = shop94["shenmi_shangren"]["items"]
    grocery94 = shop94["companion_grocery"]["items"]
    life_entries = [e for e in grocery94 if e.get("item") in LIFE_KEYS]
    assert len(mystic94) == 40 and len(grocery94) == 22 and len(life_entries) == 3

    iraw = open(ITEMS, "rb").read()
    sraw = open(SHOPS, "rb").read()
    ij = json.loads(iraw.decode("utf-8"))
    sj = json.loads(sraw.decode("utf-8"))
    assert len(ij["items"]) == 354 and all(x["key"] not in {y["key"] for y in ij["items"]} for x in new_defs)
    wm = next(s for s in sj["shops"] if s["key"] == "shenmi_shangren")
    wg = next(s for s in sj["shops"] if s["key"] == "companion_grocery")
    assert len(wm["items"]) == 3 and len(wg["items"]) == 19

    # companion_grocery：在 xianhun_dan 之后插入 3 条，其余 19 条原样保留
    pos = next(i for i, e in enumerate(wg["items"]) if e.get("item") == "xianhun_dan") + 1
    new_grocery = wg["items"][:pos] + life_entries + wg["items"][pos:]
    assert len(new_grocery) == 22
    # 0.94 顺序校验（去掉新增 3 条后，item 序列必须与 web-idle 一致）
    assert [e.get("item") for e in new_grocery] == [e.get("item") for e in grocery94]

    new_iraw = append_items(iraw, new_defs)
    new_sraw = replace_shop_items(sraw, "shenmi_shangren", mystic94)
    new_sraw = replace_shop_items(new_sraw, "companion_grocery", new_grocery)

    # 回读校验
    ij2 = json.loads(new_iraw.decode("utf-8"))
    sj2 = json.loads(new_sraw.decode("utf-8"))
    assert len(ij2["items"]) == 357
    assert ij2["items"][:354] == ij["items"], "items.json 原 354 条被改动"
    assert [x for x in ij2["items"] if x["key"] in LIFE_KEYS] == new_defs
    m2 = next(s for s in sj2["shops"] if s["key"] == "shenmi_shangren")
    g2 = next(s for s in sj2["shops"] if s["key"] == "companion_grocery")
    assert m2["items"] == mystic94, "神秘商人条目与 0.94 不一致"
    assert len(g2["items"]) == 22 and [e for e in g2["items"] if e.get("item") not in LIFE_KEYS] == wg["items"]
    # 其它 12 个商店零变化
    for a, b in zip(sj["shops"], sj2["shops"]):
        if a["key"] in ("shenmi_shangren", "companion_grocery"):
            continue
        assert a == b, "非目标商店被改动: " + a["key"]
    for name, old, new in (("items.json", iraw, new_iraw), ("shops.json", sraw, new_sraw)):
        assert new.count(b"\r\n") >= old.count(b"\r\n") and new.count(b"\r\r\n") == old.count(b"\r\r\n")

    print("=== L9 结构对齐 ===")
    print("items.json  354 -> 357 条，新增:", [(x["key"], x["name"], x["price"]) for x in new_defs])
    print("shenmi_shangren  3 -> 40 条（完全按 0.94）")
    print("  kind 分布:", {k: sum(1 for e in mystic94 if e.get("kind") == k)
                          for k in sorted({e.get("kind") for e in mystic94})})
    print("  perfect 条目:", sum(1 for e in mystic94 if e.get("perfect") is True))
    print("companion_grocery  19 -> 22 条，插入位置 index=%d，新增:" % pos,
          [(e["item"], e["price"], e.get("group")) for e in life_entries])
    print("字节变化: items.json %d -> %d, shops.json %d -> %d"
          % (len(iraw), len(new_iraw), len(sraw), len(new_sraw)))

    if args.dry_run:
        print("\n[DRY-RUN] 未写任何文件")
        return
    open(ITEMS, "wb").write(new_iraw)
    open(SHOPS, "wb").write(new_sraw)
    print("[APPLY] 已写入；CRLF: items=%d, shops=%d"
          % (new_iraw.count(b"\r\n"), new_sraw.count(b"\r\n")))


if __name__ == "__main__":
    main()
