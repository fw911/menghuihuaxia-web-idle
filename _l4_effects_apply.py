#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""L4 续五：技能「效果数值 + 效果时长」回正 v0.91（A 阶段，只改已有等级）。

依据（原版字节码取证，F:\\梦回华夏\\_archive\\web_idle_disassembly_20261020.zip → _dis_battle.txt）：
  · `battle/engine.py:256` 的效果内部结构为 ('effect_type','value','duration','source','icon')
    —— 原版内部即用 **duration（回合）**；全字节码从未出现 'duration_ms'。
  · 故解密配置里的 `duration_ms` / `cd_ms` 是「回合数 × 1000」的打包形式
    → 换算 **回合 = ms / 1000**（cd_ms 恒为 1000 倍数可交叉验证）。

对齐规则：
  · 仅对**两侧同一等级都存在**的效果类型生效（否则无参照）
  · `value` 直接取 v0.91 原值（同量纲：治疗量/固定点数/百分比）
  · `duration` = round(v0.91 duration_ms / 1000)；`stun` = round(stun_ms / 1000)
  · 仅 web-idle 独有的效果类型（hot/taunt/reflect/…）保持原样
  · 技能须同 key 且同 skill_type

格式：技能文件 indent=1 + LF；回读校验。
"""
import io, json, os, sys

WI_DIR = 'data'
V0_DIR = os.path.join('..', '放置归墟_v0.91_decrypted')
PROFS = ['warrior', 'mage', 'darkwitch', 'shaman']


def ms2turn(v):
    """毫秒 → 回合（原版 1 回合 = 1000ms）。"""
    return int(round(v / 1000.0))


def process(prof):
    wf = os.path.join(WI_DIR, 'skills_active_%s.json' % prof)
    vf = os.path.join(V0_DIR, 'skills_active_%s.json' % prof)
    with io.open(wf, 'r', encoding='utf-8') as f:
        wi = json.load(f)
    with io.open(vf, 'r', encoding='utf-8') as f:
        v0 = json.load(f)
    vmap = {s['key']: s for s in v0['active_skills']}
    st = {'value': 0, 'duration': 0, 'stun': 0, 'only_wi': 0, 'only_v0': 0, 'skills': []}
    for s in wi['active_skills']:
        t = vmap.get(s['key'])
        if not t or s.get('skill_type') != t.get('skill_type'):
            continue
        wl = s.get('levels', [])
        vl = t.get('levels', [])
        sk = 0
        for i in range(min(len(wl), len(vl))):
            we = {e.get('type'): e for e in (wl[i].get('effects') or [])}
            ve = {e.get('type'): e for e in (vl[i].get('effects') or [])}
            for tp in set(we) & set(ve):
                a, b = we[tp], ve[tp]
                if 'value' in a and 'value' in b and a['value'] != b['value']:
                    a['value'] = b['value']
                    st['value'] += 1
                    sk += 1
                if 'duration_ms' in b and 'duration' in a:
                    d = ms2turn(b['duration_ms'])
                    if a['duration'] != d:
                        a['duration'] = d
                        st['duration'] += 1
                        sk += 1
                if 'stun_ms' in b and 'stun' in a:
                    d = ms2turn(b['stun_ms'])
                    if a['stun'] != d:
                        a['stun'] = d
                        st['stun'] += 1
                        sk += 1
            st['only_wi'] += len(set(we) - set(ve))
            st['only_v0'] += len(set(ve) - set(we))
        if sk:
            st['skills'].append('%s(%d)' % (s.get('name'), sk))
    out = json.dumps(wi, indent=1, ensure_ascii=False)
    crlf = b'\r\n' in open(wf, 'rb').read()
    with io.open(wf, 'wb') as f:
        f.write((out.replace('\n', '\r\n') if crlf else out).encode('utf-8'))

    # 回读校验：共有类型的 value / duration / stun 必须一致
    with io.open(wf, 'r', encoding='utf-8') as f:
        back = json.load(f)
    vmap2 = {s['key']: s for s in json.load(io.open(vf, encoding='utf-8'))['active_skills']}
    bad = []
    for s in back['active_skills']:
        t = vmap2.get(s['key'])
        if not t or s.get('skill_type') != t.get('skill_type'):
            continue
        for i in range(min(len(s.get('levels', [])), len(t.get('levels', [])))):
            we = {e.get('type'): e for e in (s['levels'][i].get('effects') or [])}
            ve = {e.get('type'): e for e in (t['levels'][i].get('effects') or [])}
            for tp in set(we) & set(ve):
                a, b = we[tp], ve[tp]
                if 'value' in a and 'value' in b and a['value'] != b['value']:
                    bad.append('%s L%d %s.value' % (s['key'], i + 1, tp))
                if 'duration_ms' in b and 'duration' in a and a['duration'] != ms2turn(b['duration_ms']):
                    bad.append('%s L%d %s.duration' % (s['key'], i + 1, tp))
                if 'stun_ms' in b and 'stun' in a and a['stun'] != ms2turn(b['stun_ms']):
                    bad.append('%s L%d %s.stun' % (s['key'], i + 1, tp))
    print('%-9s 改动技能=%-3d value=%-4d duration=%-4d stun=%-3d | 仅WI效果=%-4d 仅V0效果=%-4d 回读不一致=%d'
          % (prof, len(st['skills']), st['value'], st['duration'], st['stun'],
             st['only_wi'], st['only_v0'], len(bad)))
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
    print('OK: 效果数值/时长已回正 v0.91（回合 = ms/1000）')


if __name__ == '__main__':
    main()
