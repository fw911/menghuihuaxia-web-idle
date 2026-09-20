# -*- coding: utf-8 -*-
"""index.html：给右列加二级菜单（子菜单）栏的样式与容器。文件是 CRLF。"""
import io, os, sys

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, 'index.html')
s = io.open(SRC, encoding='utf-8', newline='').read().replace('\r\n', '\n')
n0 = len(s)


def rep(old, new, expect=1, tag=''):
    global s
    got = s.count(old)
    if got != expect:
        sys.exit('[%s] 期望 %d 处，实际 %d 处' % (tag, expect, got))
    s = s.replace(old, new)
    print('   ok  ' + tag)


# ---- 1) CSS：紧跟 .tabs 之后 ----
rep("""  .tabs button.active{background:var(--panel2);color:var(--gold);border-color:var(--accent);}
""",
    """  .tabs button.active{background:var(--panel2);color:var(--gold);border-color:var(--accent);}
  /* ===== 右列二级菜单（子菜单）：主页面内容过长时按功能再拆一层，避免长距离下拉 =====
     栏位独立于 #tab-pane（是它的兄弟节点），所以内容滚动时菜单不跟着跑；
     空内容时靠 :empty 自动隐藏，不需要 JS 额外管。 */
  .subtabs{display:flex;flex-wrap:wrap;gap:3px;padding:3px;
    border-bottom:1px solid var(--line2);background:#150f08;}
  .subtabs button{border:1px solid var(--line);border-radius:2px;background:#1e160d;
    color:var(--dim);padding:2px 8px;font-size:11.5px;white-space:nowrap;cursor:pointer;}
  .subtabs button:hover{color:var(--gold2);border-color:var(--line2);}
  .subtabs button.active{background:var(--panel3);color:var(--gold);border-color:var(--accent);font-weight:bold;}
  .subtabs:empty{display:none;}
""", 1, 'css:.subtabs')

# ---- 2) HTML：插到 .tabs 与 #tab-pane 之间 ----
rep("""      </div>
      <div class="pane" id="tab-pane"></div>
""",
    """      </div>
      <div class="subtabs" id="subtabs"></div>
      <div class="pane" id="tab-pane"></div>
""", 1, 'html:#subtabs')

io.open(SRC, 'w', encoding='utf-8', newline='').write(s.replace('\n', '\r\n'))
print('written %s : %d -> %d bytes' % (SRC, n0, len(s)))
