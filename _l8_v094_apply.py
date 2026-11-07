#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""L8: 以 v0.94 官方发行版真值回填 web-idle 商店价格与聚宝点冷却。

证据源 : E:/放置归墟：梦回华夏 _v0.94/config_enc/*.enc (CONFIGENC + AES-256-CBC)
密钥   : BACKHX_v0.94.exe 内 k_bootstrap 段 4 对 seg/mask 逐对 XOR 重组出的 base64；
         PBKDF2-HMAC-SHA256(salt=MH_CONFIG_ENC_SALT_v1, iter=200000, dkLen=32) 派生。

原则   : 只回填「v0.91 压平」留下的 price=1 / refresh_minutes=0；
         已有真值的老条目仅做一致性校验，不改动。
         bytes 直写 + 按出现顺序定点替换数字 token，保留 CRLF / LF 原行尾。

用法   : python _l8_v094_apply.py --dry-run
         python _l8_v094_apply.py --apply
"""
import argparse
import base64
import collections
import hashlib
import json
import os
import re
import subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
ENC94 = r"E:/放置归墟：梦回华夏 _v0.94/config_enc"
KEY_B64 = "kUmtE1a7/jQ7LdM04YhJYXKhRvwaQZ6vqY1YRyIbsr8="
SALT = b"MH_CONFIG_ENC_SALT_v1"
SHOPS = os.path.join(ROOT, "data", "shops.json")
MAPS = os.path.join(ROOT, "data", "maps.json")

PAT_PRICE = re.compile(rb'("price"\s*:\s*)(\d+)')
PAT_REFRESH = re.compile(rb'("refresh_minutes"\s*:\s*)(\d+)')


def dec94(name):
    """内存解密 v0.94 的一份 .enc 配置。"""
    blob = open(os.path.join(ENC94, name + ".json.enc"), "rb").read()
    assert blob[:9] == b"CONFIGENC", name
    key = hashlib.pbkdf2_hmac("sha256", base64.b64decode(KEY_B64), SALT, 200000, 32)
    r = subprocess.run(
        ["openssl", "enc", "-d", "-aes-256-cbc", "-K", key.hex(), "-iv", blob[9:25].hex()],
        input=blob[25:], capture_output=True,
    )
    assert r.returncode == 0, (name, r.stderr[:200])
    return json.loads(r.stdout.decode("utf-8"))


def build_index(shops94):
    """按 (商店, item) / (商店, base_key) / (商店, name, tier, kind) 建多重索引。"""
    idx = {"item": collections.defaultdict(list),
           "base": collections.defaultdict(list),
           "name": collections.defaultdict(list)}
    for s in shops94:
        sk = s["key"]
        for e in s.get("items", []):
            if e.get("item") is not None:
                idx["item"][(sk, e["item"])].append(e)
            if e.get("base_key"):
                idx["base"][(sk, e["base_key"])].append(e)
            if e.get("name") is not None:
                idx["name"][(sk, e["name"], e.get("tier"), e.get("kind"))].append(e)
    return idx


def narrow(cands, entry):
    """候选多条时，用 web-idle 条目的辅助字段收窄。"""
    for field in ("name", "tier", "kind", "group", "slot"):
        if entry.get(field) is None:
            continue
        sub = [c for c in cands if c.get(field) == entry.get(field)]
        if sub:
            cands = sub
    return cands


def resolve(shop_key, entry, idx):
    """返回 (price, 命中方式, 候选数)；找不到返回 (None, 原因, 0)。"""
    for label, key in (
        ("name", (shop_key, entry.get("name"), entry.get("tier"), entry.get("kind"))),
        ("item", (shop_key, entry.get("item"))),
        ("base", (shop_key, entry.get("base_key"))),
    ):
        if label == "name" and entry.get("name") is None:
            continue
        if label == "item" and entry.get("item") is None:
            continue
        if label == "base" and not entry.get("base_key"):
            continue
        cands = idx[label].get(key)
        if not cands:
            continue
        cands = narrow(cands, entry)
        prices = {c.get("price") for c in cands}
        if len(prices) == 1:
            return next(iter(prices), None), label, len(cands)
        # 价格不唯一：若条目自身带 tier，再按 tier 收窄
        if len(prices) > 1:
            return None, "AMBIGUOUS:%s:%s" % (label, sorted(map(str, prices))), len(cands)
    return None, "NO_MATCH", 0


def flat_shops(obj):
    return [(s["key"], e) for s in obj["shops"] for e in s.get("items", [])]


def flat_spots(obj):
    return [(m["key"], j) for m in obj["maps"] for j in m.get("jubao_spots", [])]


def skeleton(raw, pat):
    return pat.sub(lambda m: m.group(1) + b"#", raw)


def nums(raw, pat):
    return [int(m.group(2)) for m in pat.finditer(raw)]


def patch(raw, pat, old_values, new_values, label):
    """从后往前只替换数字 token；返回 (新 bytes, 改动数)。"""
    ms = list(pat.finditer(raw))
    assert len(ms) == len(old_values) == len(new_values), (label, len(ms))
    assert nums(raw, pat) == old_values, label + " 值序列不符"
    out = raw
    changed = 0
    for m, nv in sorted(zip(ms, new_values), key=lambda x: -x[0].start()):
        if nv is None or nv == int(m.group(2)):
            continue
        out = out[:m.start(2)] + str(nv).encode("ascii") + out[m.end(2):]
        changed += 1
    # 非目标字节零变化：把数字抹成 # 后两串必须完全相同
    assert skeleton(raw, pat) == skeleton(out, pat), label + " 非目标字节发生变化"
    assert nums(out, pat) == [nv if nv is not None else ov
                              for ov, nv in zip(old_values, new_values)], label + " 回读值不符"
    assert out.count(b"\r\n") == raw.count(b"\r\n"), label + " CRLF 计数变化"
    assert out.count(b"\n") == raw.count(b"\n"), label + " 行数变化"
    return out, changed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    if not (args.dry_run or args.apply):
        ap.error("需要 --dry-run 或 --apply")

    s94 = dec94("shops")["shops"]
    m94 = dec94("maps")["maps"]
    idx = build_index(s94)

    sraw = open(SHOPS, "rb").read()
    mraw = open(MAPS, "rb").read()
    sj = json.loads(sraw.decode("utf-8"))
    mj = json.loads(mraw.decode("utf-8"))
    sentries = flat_shops(sj)
    sspots = flat_spots(mj)
    assert len(sentries) == len(PAT_PRICE.findall(sraw))
    assert len(sspots) == len(PAT_REFRESH.findall(mraw))

    # --- 商店价格 ---
    idx94_global_base = collections.defaultdict(set)
    for s in s94:
        for e in s.get("items", []):
            if e.get("base_key"):
                idx94_global_base[e["base_key"]].add(e.get("price"))
    new_prices, unresolved, touched, kept_diff, kept_unknown = [], [], [], [], []
    for (sk, e) in sentries:
        if e["price"] != 1:
            # 老条目：按同一套多重键校验与 0.94 的一致性，不改动
            ref, how, _nc = resolve(sk, e, idx)
            if ref is None and e.get("base_key"):
                cand = idx94_global_base.get(e["base_key"], set())
                if len(cand) == 1:
                    ref, how = next(iter(cand)), "global_base"
            if ref is None:
                kept_unknown.append((sk, e.get("item") or e.get("base_key"), e["price"], how))
            elif ref != e["price"]:
                kept_diff.append((sk, e.get("item") or e.get("base_key"), e["price"], ref, how))
            new_prices.append(None)
            continue
        price, how, nc = resolve(sk, e, idx)
        if price is None:
            unresolved.append((sk, e.get("item") or e.get("base_key"), how))
            new_prices.append(None)
        else:
            new_prices.append(price)
            touched.append((sk, e.get("item") or e.get("base_key"), price, how, nc))

    # --- 聚宝点冷却（按地图 + 下标同序） ---
    v94 = [j.get("refresh_minutes") for m in m94 for j in m.get("jubao_spots", [])]
    assert len(v94) == len(sspots) == 50, (len(v94), len(sspots))
    keys94 = [(m["key"], j.get("key")) for m in m94 for j in m.get("jubao_spots", [])]
    keys_w = [(mk, j.get("key")) for mk, j in sspots]
    assert keys94 == keys_w, "聚宝点 key 顺序不一致"
    new_refresh, spot_touched, spot_kept_diff = [], [], []
    for (mk, j), ref in zip(sspots, v94):
        if j["refresh_minutes"] == 0:
            new_refresh.append(ref)
            spot_touched.append((mk, j.get("name"), ref))
        else:
            if j["refresh_minutes"] != ref:
                spot_kept_diff.append((mk, j.get("name"), j["refresh_minutes"], ref))
            new_refresh.append(None)

    print("=== v0.94 回填映射 ===")
    print("商店条目 %d，price=1 待回填 %d，命中 %d，未决 %d"
          % (len(sentries), sum(1 for _, e in sentries if e["price"] == 1),
             len(touched), len(unresolved)))
    print("命中方式:", collections.Counter(t[3] for t in touched))
    print("候选数>1 的条目:", sum(1 for t in touched if t[4] > 1))
    if unresolved:
        print("!! 未决:", unresolved)
    print("聚宝点 50，refresh=0 待回填 %d，命中 %d" % (len(spot_touched), len(spot_touched)))
    print("老商店条目与 0.94 不一致（保留不改）: %d" % len(kept_diff))
    for d in kept_diff[:15]:
        print("   ", d)
    print("老商店条目在 0.94 无唯一对应（结构差异，保留不改）: %d" % len(kept_unknown))
    for d in kept_unknown[:15]:
        print("   ", d)
    print("老聚宝点与 0.94 不一致（保留不改）: %d" % len(spot_kept_diff))
    for d in spot_kept_diff[:15]:
        print("   ", d)
    print("回填价样例:", touched[:8])
    print("聚宝点样例:", spot_touched)

    assert not unresolved, "存在未决条目，禁止落地"
    assert len(touched) == 104, len(touched)
    assert len(spot_touched) == 5, len(spot_touched)

    if args.dry_run:
        print("\n[DRY-RUN] 未写任何文件")
        return

    new_sraw, n1 = patch(sraw, PAT_PRICE, [e["price"] for _, e in sentries], new_prices, "shops.json")
    new_mraw, n2 = patch(mraw, PAT_REFRESH, [j["refresh_minutes"] for _, j in sspots],
                         new_refresh, "maps.json")
    assert n1 == 104 and n2 == 5, (n1, n2)
    # 回读 JSON：条目数、非 price 字段全等
    sj2 = json.loads(new_sraw.decode("utf-8"))
    mj2 = json.loads(new_mraw.decode("utf-8"))
    assert len(flat_shops(sj2)) == len(sentries)
    assert len(flat_spots(mj2)) == len(sspots)
    assert [e["price"] for _, e in flat_shops(sj2)] == [
        nv if nv is not None else e["price"] for (_, e), nv in zip(sentries, new_prices)]
    assert [j["refresh_minutes"] for _, j in flat_spots(mj2)] == [
        nv if nv is not None else j["refresh_minutes"] for (_, j), nv in zip(sspots, new_refresh)]
    # skeleton 已保证除 price / refresh_minutes 数字 token 外零字节变化，此处只复核结构可解析

    open(SHOPS, "wb").write(new_sraw)
    open(MAPS, "wb").write(new_mraw)
    print("\n[APPLY] shops.json 改 %d 处 (%d→%d bytes)，maps.json 改 %d 处 (%d→%d bytes)"
          % (n1, len(sraw), len(new_sraw), n2, len(mraw), len(new_mraw)))
    print("[APPLY] 行尾: shops CRLF=%d, maps CRLF=%d"
          % (new_sraw.count(b"\r\n"), new_mraw.count(b"\r\n")))


if __name__ == "__main__":
    main()
