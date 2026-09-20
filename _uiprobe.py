# -*- coding: utf-8 -*-
"""UI 布局比例探针生成器（项目常驻工具）

用法：
    python _uiprobe.py            # 生成 _uiprobe.html
    然后用无头 Chrome 量（必须后台运行，且不要传 --user-data-dir）：
    CH="/c/Users/Administrator/.agent-browser/browsers/chrome-152.0.7977.75/chrome.exe"
    taskkill //F //IM chrome.exe
    "$CH" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
          --force-device-scale-factor=1 --window-size=1920,1000 --virtual-time-budget=2500 \
          --dump-dom "http://127.0.0.1:8013/_uiprobe.html" > out.txt
    结果在 out.txt 的 <title> 里（MEASURED_BEGIN ... MEASURED_END）。

原理：复制 index.html 的布局与 CSS，但**删掉 game.js**——留着挂机 rAF 主循环会让
      --virtual-time-budget 卡死、--dump-dom 永不返回。再用 stub 内容把各 pane 填到
      真实量级（空 pane 会塌成 padding 的 16px，量出来的高度没意义）。
"""
import io, sys

SRC = 'index.html'
OUT = '_uiprobe.html'

STUB = r"""
<script>
(function(){
  function rep(n, f){ var s=''; for(var i=0;i<n;i++) s+=f(i); return s; }
  var el = function(id){ return document.getElementById(id); };

  el('hero-pane').innerHTML =
    '<div class="char-card"><div class="hero-head"><span class="hero-name">测试游侠</span><span class="pill">Lv.18 武士</span></div>'
    + '<div class="bar hp"><i style="width:62%"></i></div><div class="bar-label">生命 1224 / 1980</div>'
    + '<div class="bar mp"><i style="width:48%"></i></div><div class="bar-label">法力 306 / 640</div>'
    + '<div class="bar exp"><i style="width:30%"></i></div><div class="bar-label">经验 6200 / 20640（30%）</div></div>'
    + '<h3>战斗属性</h3><div class="stat-grid">'
    + rep(8, function(i){ return '<div class="st"><span>物理攻击</span><b>'+(200+i*37)+'</b></div>'; }) + '</div>'
    + '<h3>基础属性</h3><div class="stat-grid">'
    + rep(6, function(i){ return '<div class="st"><span>根骨</span><b>'+(20+i*9)+'</b></div>'; }) + '</div>'
    + '<h3>装备（点击卸下）</h3>'
    + rep(6, function(){ return '<div class="item equipped q-gold">[传说] 武器·游龙战甲 <span class="pill">+8</span></div>'
        + '<div class="muted">物理攻击:186  暴击率+3%(命中时附加灼烧)</div>'; })
    // 本命日志已合并到中间战斗日志，左侧面板不再重复渲染
    ;

  el('map-pane').innerHTML =
    '<div class="map-name">北部郡 · 平原村</div><div class="zone-wrap">'
    + ['农田·流寇场','北部平原中央','招魂谷','渔村·村口','幽狼林','黑风寨·深处'].map(function(n,i){
        return '<span class="zone'+(i===1?' active':'')+'">'+n+' <span class="zlv">Lv.5</span></span>'; }).join('')
    + '</div><h3>邻接地图</h3><div>'
    + ['稻香村','落霞谷','青石镇','白水涧'].map(function(n){ return '<span class="neighbor">'+n+'</span>'; }).join('')
    + '</div><h3>信使传送</h3><div class="zone-wrap">'
    + ['天蚕察（0金）','藏原城（1300金）','翔桑（300金）'].map(function(n){ return '<span class="zone">'+n+'</span>'; }).join('')
    + '</div>';

  el('battle-pane').innerHTML =
    '<div class="battle-card"><div><span class="bname">北部驯狼</span><span class="blv">Lv.14</span>'
    + '<span class="btag tag-elite">精英</span></div>'
    + '<div class="bar hp"><i style="width:55%"></i></div><div class="bar-label">怪物 HP 2999 / 5466</div>'
    + '<div class="bar mp"><i style="width:70%"></i></div>'
    + '<div class="bar-label">我的 HP 1175 / 1889 · MP 1004 / 2000</div></div>';

  el('log').innerHTML = rep(10, function(i){
    return '<div><span class="ev-t">20:41</span> 你对 北部驯狼 造成 '+(180+i*33)+' 伤害（剩余 '+(3885-i*120)+'/5466）</div>'; });

  el('tab-pane').innerHTML =
    '<div class="bag-tools"><button class="mini">整理背包</button><button class="mini">分解白/绿装</button>'
    + '<span class="muted">共 62 件（装备 38 件·逐件显示；消耗品/宝石/矿石/武魂自动叠加）</span></div>'
    + rep(10, function(i){ return '<div class="item">物品名称示例'+(i+1)+' <span class="stack-n">×'+(12+i*7)+'</span></div>'; })
    + '<h3 class="sec">装备（38 件 · 词条各不相同，逐件显示）</h3>'
    + rep(6, function(){ return '<div class="item q-gold">[传说] 护甲·游龙战甲 <span class="pill">百炼+8</span>'
        + '<br><span class="muted">需求 42 级 · 物理防御 +186 · 生命 +1240</span></div>'; });

  document.getElementById('overlay').style.display = 'none';

  function run(){
    var q = function(s){ return document.querySelector(s); };
    var r = function(x){ var b = x.getBoundingClientRect(); return Math.round(b.width) + 'x' + Math.round(b.height); };
    var VW = window.innerWidth, VH = window.innerHeight;
    var pc = function(n){ return (n / VW * 100).toFixed(1) + '%'; };
    var pw = function(s){ s = String(s); while(s.length < 16) s += ' '; return s; };
    var L = [];
    var hero=q('.col.hero'), center=q('.col.center'), right=q('.col.right');
    var tabs=q('#tabs'), main=q('.main'), hd=q('header'), ft=q('footer');
    var wrap = getComputedStyle(main).flexDirection === 'column';
    L.push('== 视口 ' + VW + ' x ' + VH + ' ==');
    L.push(pw('body 横向溢出') + (document.body.scrollWidth > VW + 1) + ' (scrollW=' + document.body.scrollWidth + ')');
    L.push(pw('main 横向溢出') + (main.scrollWidth > main.clientWidth + 1) + ' (scrollW=' + main.scrollWidth + ' clientW=' + main.clientWidth + ')');
    L.push(pw('布局') + (wrap ? '堆叠（纵向）' : '三列（横向）'));
    var colw = function(name, e){
      var w = e.getBoundingClientRect().width;
      L.push(pw(name) + 'w=' + Math.round(w) + (wrap ? '' : ' (' + pc(w) + ')'));
    };
    colw('左·角色', hero); colw('中·地图战斗日志', center); colw('右·功能页签', right);
    L.push(pw('header') + 'h=' + r(hd) + ' 横向溢出=' + (hd.scrollWidth > hd.clientWidth + 1));
    L.push(pw('footer') + 'h=' + r(ft));
    L.push(pw('tabs') + 'clientW=' + tabs.clientWidth + ' scrollW=' + tabs.scrollWidth
           + ' 高=' + Math.round(tabs.getBoundingClientRect().height) + ' 需滚动=' + (tabs.scrollWidth > tabs.clientWidth + 1));
    L.push(pw('tab-pane') + r(q('#tab-pane')));
    L.push(pw('log 区') + r(q('#log')));
    L.push(pw('map-pane') + r(q('#map-pane')));
    L.push(pw('battle-pane') + r(q('#battle-pane')));
    var scan = function(sel){
      var out = [];
      document.querySelectorAll(sel + ' *').forEach(function(e){
        if(e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 2) out.push(e.className || e.tagName);
      });
      return out.length ? out.slice(0,6).join(', ') : '无';
    };
    L.push(pw('右列内溢出元素') + scan('#tab-pane'));
    L.push(pw('中列内溢出元素') + scan('.col.center'));
    L.push(pw('左列内溢出元素') + scan('#hero-pane'));
    L.push(pw('header 内溢出') + scan('header'));
    document.title = 'MEASURED_BEGIN\n' + L.join('\n') + '\nMEASURED_END';
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
</script>
"""

html = io.open(SRC, encoding='utf-8').read()
if '<script src="game.js"></script>' not in html:
    sys.exit('未找到 game.js 引用，探针生成失败')
out = html.replace('<script src="game.js"></script>', '')
out = out.replace('</body>', STUB + '</body>')

io.open(OUT, 'w', encoding='utf-8', newline='\n').write(out)
print('written', OUT, len(out), 'bytes')
