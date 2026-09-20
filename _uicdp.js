'use strict';
/*
 * UI 布局量化工具（CDP 版，零依赖：用 Node 22 内置的全局 WebSocket 直连 Chrome DevTools Protocol）
 *
 * 相比 chrome --dump-dom 探针的好处：
 *   ① 可精确设任意视口（--window-size 会被钳到最小 500px，手机宽度测不了）
 *   ② 可直接量真实页面（不需要造静态探针页），并顺带截图
 *
 * 用法：
 *   node _uicdp.js <chrome路径> <页面URL> '<尺寸JSON>' <输出目录> [是否先开局] [要切换的页签key] [开局后再等N秒]
 * 例：
 *   node _uicdp.js "C:/.../chrome.exe" "http://127.0.0.1:8013/index.html" \
 *        '[[390,844],[430,932],[768,1024],[1440,900],[1920,1080]]' . boot cloud 75
 *   （等 N 秒是为了让 30 秒一帧的趋势采样攒够 ≥2 帧，图表才有内容）
 *
 * 注意：必须后台运行（前台会被沙箱 SIGTERM）。chrome 路径要给 Windows 形式（C:/...），
 *       给 Git Bash 的 /c/... 会 ENOENT。
 *
 * 环境变量：
 *   UICDP_SCROLL='本次挂机'   截图前按标题文字滚到该段（长面板靠下内容否则拍不到）
 *   UICDP_SPEED=3             开局后点 3 次速度按钮提速（快速攒曲线/掉落数据）
 *   UICDP_SAVE='{...}'        预置 localStorage 存档后重载，直达指定地图/等级（拍副本用；
 *                             给存档时不再自动建号）
 *   UICDP_CLICK='[data-dboss]' 开局后点击第一个匹配元素（切页签之后再点）
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = process.argv[2];
const PAGE_URL = process.argv[3];
const SIZES = JSON.parse(process.argv[4] || '[]');
const OUTDIR = process.argv[5] || '.';
const BOOT = process.argv[6] === 'boot';
const TAB = process.argv[7] || '';
const WAIT = parseInt(process.argv[8] || '0', 10);
const PORT = 9333 + (process.pid % 500);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function httpGetJson(p) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'GET' }, res => {
      let b = '';
      res.on('data', d => (b += d));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.end();
  });
}

// ---- 极简 CDP 客户端 ----
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.waiters = new Map(); this.events = [];
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.waiters.has(msg.id)) {
        const { resolve, reject } = this.waiters.get(msg.id);
        this.waiters.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg.method);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.waiters.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.waiters.has(id)) { this.waiters.delete(id); reject(new Error('timeout: ' + method)); }
      }, 30000);
    });
  }
  async eval(expr, awaitPromise = true) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr, awaitPromise, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error('eval error: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result && r.result.value;
  }
}

// ---- 页面内测量表达式（返回多行文本） ----
const MEASURE = `(function(){
  var q = function(s){ return document.querySelector(s); };
  var r = function(x){ var b = x.getBoundingClientRect(); return Math.round(b.width)+'x'+Math.round(b.height); };
  var VW = window.innerWidth, VH = window.innerHeight;
  var pc = function(n){ return (n/VW*100).toFixed(1)+'%'; };
  var pw = function(s){ s=String(s); while(s.length<16) s+=' '; return s; };
  var L = [];
  var hero=q('.col.hero'), center=q('.col.center'), right=q('.col.right');
  var tabs=q('#tabs'), main=q('.main'), hd=q('header');
  if(!hero){ return 'FAIL_NO_LAYOUT'; }
  var wrap = getComputedStyle(main).flexDirection === 'column';
  L.push('== 视口 ' + VW + ' x ' + VH + ' ==');
  L.push(pw('body 横向溢出') + (document.body.scrollWidth > VW+1) + ' (scrollW='+document.body.scrollWidth+')');
  L.push(pw('main 横向溢出') + (main.scrollWidth > main.clientWidth+1) + ' (scrollW='+main.scrollWidth+' clientW='+main.clientWidth+')');
  L.push(pw('布局') + (wrap ? '堆叠（纵向）' : '三列（横向）'));
  var colw = function(name, e){
    var w = e.getBoundingClientRect().width;
    L.push(pw(name) + 'w=' + Math.round(w) + (wrap ? '' : ' ('+pc(w)+')'));
  };
  colw('左·角色', hero); colw('中·地图战斗日志', center); colw('右·功能页签', right);
  L.push(pw('header') + 'h=' + r(hd) + ' 横向溢出=' + (hd.scrollWidth > hd.clientWidth+1));
  L.push(pw('tabs') + 'clientW=' + tabs.clientWidth + ' scrollW=' + tabs.scrollWidth
         + ' 高=' + Math.round(tabs.getBoundingClientRect().height)
         + ' 需滚动=' + (tabs.scrollWidth > tabs.clientWidth+1));
  L.push(pw('tab-pane') + r(q('#tab-pane')));
  L.push(pw('log 区') + r(q('#log')));
  L.push(pw('map-pane') + r(q('#map-pane')));
  L.push(pw('battle-pane') + r(q('#battle-pane')));
  var scan = function(sel){
    var out = [];
    document.querySelectorAll(sel+' *').forEach(function(e){
      if(e.clientWidth > 0 && e.scrollWidth > e.clientWidth+2) out.push(e.className || e.tagName);
    });
    return out.length ? out.slice(0,6).join(', ') : '无';
  };
  L.push(pw('右列内溢出') + scan('#tab-pane'));
  L.push(pw('中列内溢出') + scan('.col.center'));
  L.push(pw('左列内溢出') + scan('#hero-pane'));
  L.push(pw('header 内溢出') + scan('header'));
  return L.join('\\n');
})()`;

const BOOT_EXPR = `(function(){
  function waitFor(fn, t){ return new Promise(function(res){
    var t0 = Date.now();
    (function p(){ var v=null; try{v=fn();}catch(e){}
      if(v) return res(v);
      if(Date.now()-t0 > t) return res(null);
      setTimeout(p, 50); })();
  }); }
  return (async function(){
    var job = await waitFor(function(){ return document.querySelector('.job'); }, 6000);
    if(job) job.click();
    await new Promise(function(r){ setTimeout(r, 400); });
    var b = document.getElementById('btn-toggle');
    if(b && b.textContent.indexOf('开始') >= 0) b.click();
    await new Promise(function(r){ setTimeout(r, 400); });
    var z = document.querySelectorAll('.zone:not(.boss)');
    if(z.length) z[1].click();
    await new Promise(function(r){ setTimeout(r, 1200); });
    if(__TAB__){
      var tb = document.querySelector('.tabs button[data-tab="'+__TAB__+'"]');
      if(tb){ tb.click(); await new Promise(function(r){ setTimeout(r, 900); }); }
    }
    return 'booted';
  })();
})()`;

// 自动注册/登录（游戏启动强制登录，截图工具必须先过这一关）
async function ensureLogin(cdp) {
  const user = process.env.UICDP_USER || 'uicdp';
  const pass = process.env.UICDP_PASS || 'uicdp12345';
  const expr = `(async function(){
    try {
      try { await fetch('/api/register', {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({username: __U__, password: __P__})}); } catch(e) {}
      const r = await fetch('/api/login', {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({username: __U__, password: __P__})});
      const j = await r.json();
      if(!j.ok) return 'login-fail:' + (j.msg||'?');
      localStorage.setItem('menghuihuaxia_cloud_v1', JSON.stringify({user:j.user, token:j.token, slot:1, base:''}));
      return 'ok';
    } catch(e) { return 'login-err:' + (e && e.message || e); }
  })()`.replace(/__U__/g, JSON.stringify(user)).replace(/__P__/g, JSON.stringify(pass));
  try {
    const r = await cdp.eval(expr);
    if (String(r).indexOf('ok') !== 0) { console.error('自动登录失败:', r); return; }
    await cdp.send('Page.reload', { ignoreCache: false });
    await sleep(2500);
  } catch (e) { console.error('自动登录异常:', e.message); }
}

(async () => {
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--disable-dev-shm-usage', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--force-device-scale-factor=1',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(require('os').tmpdir(), 'uicdp_' + process.pid),
    'about:blank',
  ];
  const proc = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'ignore'] });

  // 等 CDP 端口就绪
  let list = null;
  for (let i = 0; i < 100; i++) {
    await sleep(300);
    try {
      list = await httpGetJson('/json/list');
      if (list && list.length) break;
    } catch (e) { /* retry */ }
  }
  if (!list || !list.length) { console.error('CDP 未就绪'); proc.kill(); process.exit(1); }

  const page = list.find(t => t.type === 'page') || list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', e => rej(new Error('WS error: ' + (e.message || 'unknown'))));
  });

  const cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: SIZES[0][0], height: SIZES[0][1], deviceScaleFactor: 1, mobile: SIZES[0][0] < 700,
  });
  await cdp.send('Page.navigate', { url: PAGE_URL });
  await sleep(2500);

  // 游戏已改为「启动强制登录」：先自动注册/登录并把令牌写进 localStorage，再重载，
  // 否则遮罩停在账号页，点 .job 会弹 alert 把 Runtime.evaluate 卡死（30s timeout）。
  await ensureLogin(cdp);

  // UICDP_SAVE='{...存档 JSON...}' → 预置 localStorage 后重载，可直达指定地图/等级
  //   （用于拍副本等需要先旅行过去的页面，免得靠点邻居绕路）
  //   预置存档时不再自动建号（否则会覆盖存档）
  const SAVE = process.env.UICDP_SAVE || '';
  if (SAVE) {
    try {
      await cdp.eval(`(function(){ localStorage.setItem('menghuihuaxia_idle_save_v1', ${JSON.stringify(SAVE)}); return 'seeded'; })()`);
      await cdp.send('Page.reload', { ignoreCache: false });
      // 不能固定 sleep：boot() 要 await loadData() 拉 57 个 JSON，3 秒往往不够，
      // 页面会停在开局遮罩上、面板全空（截出来的图上什么都没有）。
      // 改为轮询「遮罩已隐藏 且 地图面板已有内容」。
      let ready = false, t0 = Date.now();
      for (let i = 0; i < 60; i++) {
        await sleep(500);
        try {
          const st = await cdp.eval(`(function(){
            var ov=document.getElementById('overlay'), mp=document.getElementById('map-pane');
            return JSON.stringify({ ov: ov? String(ov.style.display||'') : 'na', len: mp? mp.innerHTML.length : -1 });
          })()`);
          const o = JSON.parse(st || '{}');
          if (o.ov === 'none' && o.len > 100) { ready = true; break; }
        } catch (e) {}
      }
      if (ready) console.error('已预置存档并重载（游戏就绪，用了 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's）');
      else console.error('WARN 已预置存档，但等 30s 游戏仍未就绪 —— 存档可能没被读取（查 SAVE_KEY / payload 结构）');
      // 存档的 ts 距现在超过 60s 就会弹「欢迎回来」离线收益弹窗，直接糊在面板上（截图全废）—— 关掉
      try {
        await cdp.eval(`(function(){ var m=document.getElementById('offline-modal'); if(m) m.style.display='none'; return 'ok'; })()`);
      } catch (e) {}
      await sleep(800);
    } catch (e) { console.error('预置存档失败:', e.message); }
  }

  if (BOOT && !SAVE) {
    try { await cdp.eval(BOOT_EXPR.replace(/__TAB__/g, JSON.stringify(TAB))); }
    catch (e) { console.error('boot 失败:', e.message); }
    await sleep(800);
  }
  // UICDP_CLICK='[data-dboss]' → 开局后点击第一个匹配元素（切页签之后再点，故放在 TAB 处理之后）
  const CLICK = process.env.UICDP_CLICK || '';
  if (CLICK) {
    try {
      const r = await cdp.eval(`(function(){ var e=document.querySelector(${JSON.stringify(CLICK)}); if(!e) return 'not-found'; e.click(); return 'clicked:'+e.textContent.trim(); })()`);
      console.error('点击 ' + CLICK + ' -> ' + r);
    } catch (e) { console.error('点击失败:', e.message); }
    await sleep(800);
  }
  // UICDP_SPEED=2 → 点两次「速度」按钮提速，让等待时间里积累更多数据（掉落/升级）
  const SPD = parseInt(process.env.UICDP_SPEED || '0', 10);
  if (SPD > 0) {
    try {
      await cdp.eval(`(function(){var b=document.getElementById('btn-speed');`
        + `for(var i=0;i<${SPD};i++){ if(b) b.click(); } return b? b.textContent : 'no-btn';})()`);
      console.error('已提速 ' + SPD + ' 档');
    } catch (e) { console.error('提速失败:', e.message); }
    await sleep(300);
  }
  if (WAIT > 0) { console.error('等待 ' + WAIT + ' 秒让采样/掉落/升级积累…'); await sleep(WAIT * 1000); }

  const reports = [];
  // 截图前可滚到某段（环境变量 UICDP_SCROLL='本次挂机'，按标题文字匹配；不设则滚到底），
  // 否则长面板里靠下的内容拍不到
  const SCROLL = process.env.UICDP_SCROLL || '';
  for (const [w, h] of SIZES) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: w, height: h, deviceScaleFactor: 1, mobile: w < 700,
    });
    await sleep(700);
    let txt;
    try { txt = await cdp.eval(MEASURE); } catch (e) { txt = 'EVAL_FAIL: ' + e.message; }
    reports.push(txt);
    if (SCROLL) {
      // UICDP_SCROLL 给标题文字（如「本次挂机」）则滚到该段；给空串/其它则滚到底
      try {
        await cdp.eval(`(function(){
          var t = ${JSON.stringify(SCROLL)};
          var pane = document.querySelector('#tab-pane');
          if(!pane) pane = document.scrollingElement;
          var pr = pane.getBoundingClientRect();
          var nodes = document.querySelectorAll('#tab-pane h3, #tab-pane .pane-head');
          for(var i=0;i<nodes.length;i++){
            if((nodes[i].textContent||'').indexOf(t) >= 0){
              pane.scrollTop = nodes[i].getBoundingClientRect().top - pr.top + pane.scrollTop - 30;
              return pane.scrollTop;
            }
          }
          pane.scrollTop = pane.scrollHeight;
          return -1;
        })()`);
      } catch (e) { console.error('scroll 失败:', e.message); }
      await sleep(400);
    }
    try {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUTDIR, `ui_${w}x${h}.png`), Buffer.from(shot.data, 'base64'));
    } catch (e) { /* 截图失败不影响测量 */ }
  }

  fs.writeFileSync(path.join(OUTDIR, 'ui_report.txt'),
    reports.join('\n\n') + '\n', 'utf8');
  console.log(reports.join('\n\n'));

  ws.close();
  try { proc.kill(); } catch (e) {}
  await sleep(300);
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
