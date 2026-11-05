# -*- coding: utf-8 -*-
"""L3 全量补齐：把 v0.91 缺失的条目按 key 无损追加进 web-idle。
- 列表型文件：追加到数组末尾（保持原顺序）。
- 字典型文件：追加缺失顶层 key（排除元字段）。
输出保持 ensure_ascii=False + CRLF，使 git diff 只显示新增行。
"""
import json, sys, os

sys.stdout.reconfigure(encoding='utf-8')
O = '放置归墟_v0.91_decrypted/'
W = 'menghuihuaxia-web-idle/data/'

# (文件名, 类型, 列表wrapper键 或 None, 元字段集合)
CONF = [
    ('monsters.json',           'list', 'monsters', set()),
    ('items.json',              'list', 'items',    set()),
    ('maps.json',               'list', 'maps',     set()),
    ('shops.json',              'list', 'shops',    set()),
    ('slots.json',              'list', 'slots',    set()),
    ('skills_active_summon.json','list', 'active_skills', set()),
    ('quests.json',             'obj', None,        set()),
    ('wuhun.json',              'obj', None,        {'version', 'comment'}),
    ('character.json',          'obj', None,        set()),
    ('bailian_recipes.json',    'obj', None,        {'_meta'}),
    ('instance_exchange.json',  'obj', None,        {'_instance_exchange_meta', '_exchange_spec'}),
    ('mining.json',             'obj', None,        set()),
]

def load(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)

def key_of(entry):
    return entry.get('key') or entry.get('id') or entry.get('name')

def merge_list(web_doc, v091_doc, ent):
    arr_w = web_doc[ent]
    arr_o = v091_doc[ent]
    exist = {key_of(e) for e in arr_w if key_of(e) is not None}
    added = []
    for e in arr_o:
        k = key_of(e)
        if k is not None and k not in exist:
            arr_w.append(e)
            exist.add(k)
            added.append(k)
    return added

def merge_obj(web_doc, v091_doc, meta):
    exist = {k for k in web_doc if k not in meta}
    added = []
    for k, v in v091_doc.items():
        if k in meta:
            continue
        if k not in exist:
            web_doc[k] = v
            exist.add(k)
            added.append(k)
    return added

def dump_crlf(doc):
    s = json.dumps(doc, ensure_ascii=False, indent=2)
    return s.replace('\r\n', '\n').replace('\n', '\r\n')

total_added = 0
report = []
for fname, mode, ent, meta in CONF:
    wp = W + fname
    op = O + fname
    web = load(wp)
    v091 = load(op)
    if mode == 'list':
        before = len(web[ent])
        added = merge_list(web, v091, ent)
        after = len(web[ent])
    else:
        before = len({k for k in web if k not in meta})
        added = merge_obj(web, v091, meta)
        after = len({k for k in web if k not in meta})
    with open(wp, 'w', encoding='utf-8', newline='') as f:
        f.write(dump_crlf(web))
    total_added += len(added)
    report.append((fname, before, after, len(added), added))
    print('%-24s before=%d after=%d +%d' % (fname, before, after, len(added)))

print('\n=== 合计新增 %d 条 ===' % total_added)
print('\n=== 各文件新增 key 列表 ===')
for fname, before, after, n, added in report:
    if not added:
        continue
    sample = added if len(added) <= 12 else (added[:12] + ['...'])
    print('%s (%d): %s' % (fname, n, ', '.join(str(a) for a in sample)))
