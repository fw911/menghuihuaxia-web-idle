# -*- coding: utf-8 -*-
"""把 renderLife 里 4 处「裸文本 + 下拉 + 按钮」包进 .craft-row。

起因：右列列表改成多列栅格后，`#tab-pane` 的直接子元素都成了栅格项，
而栅格项默认 `justify-self:stretch` —— 于是这 4 处的 `<select>` 和 `<button>`
被拉满整格、还各占一行（关掉栅格的对照截图里它们是自然宽度、同一行）。
`.craft-row` 本来就是为这种「一行控件」准备的（display:flex;align-items:center），
包一层即可，顺带消除栅格里的匿名文本项。
"""
import io, os, sys

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, 'game.js')
s = io.open(SRC, encoding='utf-8', newline='').read().replace('\r\n', '\n')
n0 = len(s)
if '\r' in s:
    sys.exit('发现裸 CR')
hits = []


def rep(old, new, tag):
    global s
    got = s.count(old)
    if got != 1:
        sys.exit('[%s] 期望 1 处，实际 %d 处\n%s' % (tag, got, old[:300]))
    hits.append(tag)
    s = s.replace(old, new)


rep("""    h+='装备：<select id="bail-equip">'+equipOpts(LS.bailEquip)+'</select> <button class="mini" data-act="bailian-use">百炼升阶</button>';""",
    """    h+='<div class="craft-row">装备：<select id="bail-equip">'+equipOpts(LS.bailEquip)+'</select> <button class="mini" data-act="bailian-use">百炼升阶</button></div>';""",
    'bailian-use')

rep("""    h+='装备：<select id="extract-equip">'+equipOpts(LS.extractEquip)+'</select> <button class="mini" data-act="extract">提取</button>';""",
    """    h+='<div class="craft-row">装备：<select id="extract-equip">'+equipOpts(LS.extractEquip)+'</select> <button class="mini" data-act="extract">提取</button></div>';""",
    'extract')

rep("""    h+='配方：<select id="ore-recipe">'+oreRecipeOpts()+'</select> <button class="mini" data-act="ore-refine">炼制</button>';""",
    """    h+='<div class="craft-row">配方：<select id="ore-recipe">'+oreRecipeOpts()+'</select> <button class="mini" data-act="ore-refine">炼制</button></div>';""",
    'ore-refine')

rep("""    h+='配方：<select id="furnace-recipe">'+furnaceOpts()+'</select> <button class="mini" data-act="furnace">合成</button>';""",
    """    h+='<div class="craft-row">配方：<select id="furnace-recipe">'+furnaceOpts()+'</select> <button class="mini" data-act="furnace">合成</button></div>';""",
    'furnace')

out = s.replace('\r\n', '\n').replace('\n', '\r\n')
io.open(SRC, 'w', encoding='utf-8', newline='').write(out)
print('written %s : %d -> %d bytes' % (SRC, n0, len(out.encode('utf-8'))))
for t in hits:
    print('   ok  ' + t)
