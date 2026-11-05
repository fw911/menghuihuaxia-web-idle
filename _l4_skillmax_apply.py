#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""L4 续五 B 阶段：技能「冷却 cd」+「等级上限 max_level」回正 v0.91。

依据：
  · 原版字节码（_dis_all.txt / _dis_battle.txt）中 `duration_ms` / `cd_ms` **从不出现**，
    原版内部效果结构用 `duration`（回合）→ 解密配置里的 ms 字段是「回合 × 1000」的打包形式
    → 换算 **回合 = ms / 1000**（cd_ms 恒为 1000 倍数可交叉验证）
  · `梦回华夏_v0.58_decrypted` 原版用 `cd`（回合），凛光斩 cd=1、max_level=24 —— 与 web-idle 完全一致，
    证明 web-idle 数值基线 = v0.58；v0.91 把冷却重做为「多数技能无冷却 + 大招 60/180 回合」

本阶段做两件事：
  1. 已有等级的 `cd` = round(v0.91 cd_ms / 1000)（此前脚本用 `cd` 比 `cd_ms` 导致从未真正对齐）
  2. `max_level` 补齐：追加 v0.91 的更高等级（cd/duration 由 ms 折算回合；desc 归一化为 web-idle 的
     「数字两侧留空格」排版；effects 的 duration_ms→duration、stun_ms→stun），
     并同步追加 `requirements`（索引与等级对齐），max_level 取 v0.91 值

格式：技能文件 indent=1 + LF；回读校验。
"""
import io, json, os, re, sys

WI_DIR = 'data'
V0_DIR = os.path.join('..', '放置归墟_v0.91_decrypted')
PROFS = ['warrior', 'mage', 'darkwitch', 'shaman']
CJK = r'[一-鿿]'


def ms2turn(v):
    return int(round((v or 0) / 1000.0))


def norm_desc(s):
    """把数字与中文相邻处补空格，贴合 web-idle 的 desc 排版（数字两侧留空格）。"""
    if not isinstance(s, str):
        return s
    s = re.sub(r'(?<=%s)(?=\d)' % CJK, ' ', s)
    s = re.sub(r'(?<=\d)(?=%s)' % CJK, ' ', s)
    return s


def conv_effect(e):
    """v0.91 效果对象 → web-idle 效果对象（ms 折算回合，字段名对齐）。"""
    out = {}
    for k, v in e.items():
        if k == 'duration_ms':
            out['duration'] = ms2turn(v)
        elif k == 'stun_ms':
            out['stun'] = ms2turn(v)
        else:
            out[k] = v
    return out


def process(prof):
    wf = os.path.join(WI_DIR, 'skills_active_%s.json' % prof)
    vf = os.path.join(V0_DIR, 'skills_active_%s.json' % prof)
    with io.open(wf, 'r', encoding='utf-8') as f:
        wi = json.load(f)
    with io.open(vf, 'r', encoding='utf-8') as f:
        v0 = json.load(f)
    vmap = {s['key']: s for s in v0['active_skills']}
    st = {'cd': 0, 'ext_skill': 0, 'ext_level': 0, 'ext_req': 0, 'skip': 0}
    for s in wi['active_skills']:
        t = vmap.get(s['key'])
        if not t:
            continue
        if s.get('skill_type') != t.get('skill_type'):
            st['skip'] += 1
            continue
        wl = s.get('levels', [])
        vl = t.get('levels', [])
        # ① 已有等级冷却对齐
        for i in range(min(len(wl), len(vl))):
            if 'cd_ms' in vl[i] and 'cd' in wl[i]:
                d = ms2turn(vl[i]['cd_ms'])
                if wl[i]['cd'] != d:
                    wl[i]['cd'] = d
                    st['cd'] += 1
        # ② 等级上限补齐
        if len(vl) > len(wl):
            for i in range(len(wl), len(vl)):
                src = vl[i]
                lv = {}
                if 'damage' in src:
                    lv['damage'] = src['damage']
                if 'mp' in src:
                    lv['mp'] = src['mp']
                lv['cd'] = ms2turn(src.get('cd_ms'))
                lv['desc'] = norm_desc(src.get('desc'))
                if src.get('effects'):
                    lv['effects'] = [conv_effect(e) for e in src['effects']]
                wl.append(lv)
                st['ext_level'] += 1
            # requirements 与等级索引对齐，需同步追加
            ra = s.get('requirements')
            rb = t.get('requirements')
            if isinstance(ra, list) and isinstance(rb, list) and len(rb) > len(ra):
                for i in range(len(ra), len(rb)):
                    ra.append(rb[i])
                    st['ext_req'] += 1
            s['max_level'] = t.get('max_level')
            st['ext_skill'] += 1
    out = json.dumps(wi, indent=1, ensure_ascii=False)
    crlf = b'\r\n' in open(wf, 'rb').read()
    with io.open(wf, 'wb') as f:
        f.write((out.replace('\n', '\r\n') if crlf else out).encode('utf-8'))

    # 回读校验
    with io.open(wf, 'r', encoding='utf-8') as f:
        back = json.load(f)
    vmap2 = {s['key']: s for s in json.load(io.open(vf, encoding='utf-8'))['active_skills']}
    bad = []
    for s in back['active_skills']:
        t = vmap2.get(s['key'])
        if not t or s.get('skill_type') != t.get('skill_type'):
            continue
        wl = s.get('levels', [])
        vl = t.get('levels', [])
        for i in range(min(len(wl), len(vl))):
            if 'cd_ms' in vl[i] and 'cd' in wl[i] and wl[i]['cd'] != ms2turn(vl[i]['cd_ms']):
                bad.append('%s L%d.cd' % (s['key'], i + 1))
        if len(vl) > len(wl):
            if len(wl) != len(vl):
                bad.append('%s levels=%d≠%d' % (s['key'], len(wl), len(vl)))
            if s.get('max_level') != t.get('max_level'):
                bad.append('%s max_level' % s['key'])
    print('%-9s cd对齐=%-4d 补齐技能=%-3d 追加等级=%-4d 追加requirements=%-4d | 类型不同跳过=%-2d 回读不一致=%d'
          % (prof, st['cd'], st['ext_skill'], st['ext_level'], st['ext_req'], st['skip'], len(bad)))
    if bad:
        print('    ', bad[:6])
    return len(bad)


def main():
    total = 0
    for p in PROFS:
        total += process(p)
    if total:
        print('ERROR: 存在未对齐项 %d' % total)
        sys.exit(1)
    print('OK: 技能冷却与等级上限已回正 v0.91（回合 = ms/1000）')


if __name__ == '__main__':
    main()
