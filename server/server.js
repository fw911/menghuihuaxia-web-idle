/*
 * 梦回华夏 · 网页挂机版 后端
 * 零依赖（node:http + node:crypto + fs），同时提供静态托管与 REST API。
 *
 * 启动： node server/server.js  （默认端口 8014，可用环境变量 PORT 覆盖）
 *
 * 数据目录： server/data/
 *   users.json       账号（PBKDF2-SHA256 加盐哈希）
 *   tokens.json      登录令牌
 *   saves/*.json     云存档（每账号最多 3 个槽位）
 *   leaderboard.json 战力排行榜
 *   stats.json       挂机统计聚合（用于数值体检）
 */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 8014);
const ROOT = path.resolve(__dirname, '..');          // web_idle 目录（静态根）
const DATA_DIR = path.join(__dirname, 'data');
const SAVE_DIR = path.join(DATA_DIR, 'saves');
const MAX_SLOTS = 3;
const MAX_SAVE_BYTES = 4 * 1024 * 1024;             // 单槽位存档上限 4MB

for (const d of [DATA_DIR, SAVE_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ---------- 存储工具 ----------
function dataFile(name) { return path.join(DATA_DIR, name); }

async function readJSON(name, fallback) {
  try {
    const buf = await fsp.readFile(dataFile(name), 'utf-8');
    return JSON.parse(buf);
  } catch (e) {
    return fallback;
  }
}
async function writeJSON(name, obj) {
  const p = dataFile(name);
  const tmp = p + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(obj), 'utf-8');
  await fsp.rename(tmp, p);
}

const cache = {
  users: null,       // {user: {salt, hash, createdAt, lastLogin}}
  tokens: null,      // {token: {user, createdAt}}
  leaderboard: null, // [{user, name, job, level, power, kills, updatedAt}]
  stats: null        // 聚合统计
};
async function users() { if (!cache.users) cache.users = await readJSON('users.json', {}); return cache.users; }
async function tokens() { if (!cache.tokens) cache.tokens = await readJSON('tokens.json', {}); return cache.tokens; }
async function board() { if (!cache.leaderboard) cache.leaderboard = await readJSON('leaderboard.json', []); return cache.leaderboard; }
async function stats() {
  if (!cache.stats) {
    cache.stats = await readJSON('stats.json', { totalKills: 0, totalExp: 0, totalGold: 0, totalSeconds: 0,
      byJob: {}, byBand: {}, drops: {}, deaths: 0 });
  }
  return cache.stats;
}
async function persist(name) {
  if (name === 'users') await writeJSON('users.json', cache.users);
  else if (name === 'tokens') await writeJSON('tokens.json', cache.tokens);
  else if (name === 'leaderboard') await writeJSON('leaderboard.json', cache.leaderboard);
  else if (name === 'stats') await writeJSON('stats.json', cache.stats);
}

// ---------- 密码 ----------
function hashPassword(pw, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.pbkdf2Sync(pw, s, 120000, 32, 'sha256').toString('hex');
  return { salt: s, hash: h };
}
function verifyPassword(pw, salt, hash) {
  const h = crypto.pbkdf2Sync(pw, salt, 120000, 32, 'sha256').toString('hex');
  try { return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex')); }
  catch (e) { return false; }
}
function newToken() { return crypto.randomBytes(24).toString('hex'); }
const USER_RE = /^[\w一-龥]{2,16}$/;

// ---------- HTTP 工具 ----------
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon' };

function send(res, code, obj, headers) {
  const body = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf-8');
  res.writeHead(code, Object.assign({
    'Content-Type': typeof obj === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
  }, headers || {}));
  res.end(body);
}
async function readBody(req, limit) {
  limit = limit || MAX_SAVE_BYTES + 65536;
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => {
      n += c.length;
      if (n > limit) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}
async function auth(req) {
  const h = req.headers['authorization'] || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : (req.headers['x-token'] || '');
  const tk = await tokens();
  const rec = tk[t];
  if (!rec) return null;
  const maxAge = 30 * 24 * 3600 * 1000;
  if (Date.now() - rec.createdAt > maxAge) { delete tk[t]; await persist('tokens'); return null; }
  return { token: t, user: rec.user };
}
function saveFile(user, slot) {
  const safe = String(user).replace(/[^\w一-龥.-]/g, '_');
  return path.join(SAVE_DIR, safe + '__' + Number(slot) + '.json');
}
function slotLabel(slot) { return '槽位 ' + slot; }

// ---------- API ----------
async function handleAPI(req, res, url) {
  const p = url.pathname;
  if (req.method === 'OPTIONS') return send(res, 204, '');

  // 健康检查
  if (p === '/api/health') return send(res, 200, { ok: true, version: 1, slots: MAX_SLOTS });

  // 注册
  if (p === '/api/register' && req.method === 'POST') {
    const b = await readBody(req, 8192);
    const u = String(b.username || '').trim(), pw = String(b.password || '');
    if (!USER_RE.test(u)) return send(res, 400, { ok: false, msg: '用户名需 2~16 位中英文/数字/下划线' });
    if (pw.length < 6) return send(res, 400, { ok: false, msg: '密码至少 6 位' });
    const us = await users();
    if (us[u]) return send(res, 400, { ok: false, msg: '该账号已存在' });
    const h = hashPassword(pw);
    us[u] = { salt: h.salt, hash: h.hash, createdAt: Date.now(), lastLogin: Date.now() };
    await persist('users');
    const tk = await tokens(); const t = newToken();
    tk[t] = { user: u, createdAt: Date.now() };
    await persist('tokens');
    return send(res, 200, { ok: true, token: t, user: u });
  }

  // 登录
  if (p === '/api/login' && req.method === 'POST') {
    const b = await readBody(req, 8192);
    const u = String(b.username || '').trim(), pw = String(b.password || '');
    const us = await users();
    const rec = us[u];
    if (!rec || !verifyPassword(pw, rec.salt, rec.hash)) return send(res, 401, { ok: false, msg: '账号或密码错误' });
    rec.lastLogin = Date.now(); await persist('users');
    const tk = await tokens(); const t = newToken();
    tk[t] = { user: u, createdAt: Date.now() };
    await persist('tokens');
    return send(res, 200, { ok: true, token: t, user: u });
  }

  // 登出
  if (p === '/api/logout' && req.method === 'POST') {
    const a = await auth(req);
    if (a) { const tk = await tokens(); delete tk[a.token]; await persist('tokens'); }
    return send(res, 200, { ok: true });
  }

  // 当前账号
  if (p === '/api/me') {
    const a = await auth(req);
    if (!a) return send(res, 401, { ok: false, msg: '未登录' });
    const us = await users();
    const rec = us[a.user] || {};
    return send(res, 200, { ok: true, user: a.user, createdAt: rec.createdAt, lastLogin: rec.lastLogin });
  }

  // 存档槽位列表
  if (p === '/api/slots' && req.method === 'GET') {
    const a = await auth(req);
    if (!a) return send(res, 401, { ok: false, msg: '未登录' });
    const out = [];
    for (let i = 1; i <= MAX_SLOTS; i++) {
      const f = saveFile(a.user, i);
      try {
        const st = await fsp.stat(f);
        const d = JSON.parse(await fsp.readFile(f, 'utf-8'));
        out.push({ slot: i, label: slotLabel(i), name: d.name || '?', job: d.job || '?',
          level: d.level || 1, power: d.power || 0, updatedAt: st.mtimeMs });
      } catch (e) { out.push({ slot: i, label: slotLabel(i), empty: true }); }
    }
    return send(res, 200, { ok: true, slots: out });
  }

  // 保存存档
  if (p === '/api/save' && req.method === 'POST') {
    const a = await auth(req);
    if (!a) return send(res, 401, { ok: false, msg: '未登录' });
    const b = await readBody(req);
    const slot = Math.min(MAX_SLOTS, Math.max(1, Number(b.slot || 1)));
    if (!b.payload || typeof b.payload !== 'object') return send(res, 400, { ok: false, msg: '存档数据无效' });
    const raw = JSON.stringify(b.payload);
    if (Buffer.byteLength(raw, 'utf-8') > MAX_SAVE_BYTES) return send(res, 413, { ok: false, msg: '存档过大' });
    b.payload.savedAt = Date.now();
    const f = saveFile(a.user, slot);
    const tmp = f + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(b.payload), 'utf-8');
    await fsp.rename(tmp, f);
    return send(res, 200, { ok: true, slot, savedAt: b.payload.savedAt, bytes: Buffer.byteLength(raw, 'utf-8') });
  }

  // 读取存档
  if (p === '/api/load' && req.method === 'GET') {
    const a = await auth(req);
    if (!a) return send(res, 401, { ok: false, msg: '未登录' });
    const slot = Math.min(MAX_SLOTS, Math.max(1, Number(url.searchParams.get('slot') || 1)));
    try {
      const d = JSON.parse(await fsp.readFile(saveFile(a.user, slot), 'utf-8'));
      return send(res, 200, { ok: true, slot, payload: d });
    } catch (e) { return send(res, 404, { ok: false, msg: '该槽位为空' }); }
  }

  // 删除存档
  if (p === '/api/save' && req.method === 'DELETE') {
    const a = await auth(req);
    if (!a) return send(res, 401, { ok: false, msg: '未登录' });
    const slot = Math.min(MAX_SLOTS, Math.max(1, Number(url.searchParams.get('slot') || 1)));
    const df = saveFile(a.user, slot);
    try { await fsp.unlink(df); }
    catch (e) {
      if (e && e.code !== 'ENOENT') {
        console.error('[delete] unlink 失败', df, e && e.code, e && e.message);
        return send(res, 500, { ok: false, slot, msg: '删除失败：' + (e.code || e.message), file: df });
      }
    }
    return send(res, 200, { ok: true, slot });
  }

  // 排行榜：上传快照
  if (p === '/api/rank' && req.method === 'POST') {
    const b = await readBody(req, 65536);
    const a = await auth(req);
    const lb = await board();
    const key = a ? a.user : ('guest:' + String(b.name || '游侠'));
    const entry = {
      key, user: a ? a.user : null, name: String(b.name || '游侠').slice(0, 16),
      job: String(b.job || '?'), level: Number(b.level || 1),
      power: Math.round(Number(b.power || 0)), kills: Number(b.kills || 0),
      updatedAt: Date.now()
    };
    const i = lb.findIndex(x => x.key === key);
    if (i >= 0) lb[i] = entry; else lb.push(entry);
    lb.sort((x, y) => y.power - x.power);
    cache.leaderboard = lb.slice(0, 500);
    await persist('leaderboard');
    const rank = cache.leaderboard.findIndex(x => x.key === key) + 1;
    return send(res, 200, { ok: true, rank, total: cache.leaderboard.length });
  }

  // 排行榜：查询
  if (p === '/api/rank' && req.method === 'GET') {
    const lb = await board();
    const job = url.searchParams.get('job');
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 20)));
    let list = job ? lb.filter(x => x.job === job) : lb.slice();
    list.sort((x, y) => y.power - x.power);
    const me = url.searchParams.get('me');
    let myRank = 0;
    if (me) myRank = list.findIndex(x => x.key === me || x.name === me) + 1;
    return send(res, 200, { ok: true, list: list.slice(0, limit), myRank, total: list.length });
  }

  // 挂机统计上报
  if (p === '/api/stats' && req.method === 'POST') {
    const b = await readBody(req, 65536);
    const s = await stats();
    const n = Number(b.samples) || 1;
    s.totalKills += Number(b.kills || 0);
    s.totalExp += Number(b.exp || 0);
    s.totalGold += Number(b.gold || 0);
    s.totalSeconds += Number(b.seconds || 0);
    s.deaths += Number(b.deaths || 0);
    const job = String(b.job || '?'), band = Math.floor(Number(b.level || 1) / 10) * 10;
    s.byJob[job] = s.byJob[job] || { kills: 0, exp: 0, gold: 0, seconds: 0, samples: 0 };
    s.byJob[job].kills += Number(b.kills || 0);
    s.byJob[job].exp += Number(b.exp || 0);
    s.byJob[job].gold += Number(b.gold || 0);
    s.byJob[job].seconds += Number(b.seconds || 0);
    s.byJob[job].samples += n;
    const bk = band + '-' + (band + 9);
    s.byBand[bk] = s.byBand[bk] || { kills: 0, exp: 0, gold: 0, seconds: 0, samples: 0 };
    s.byBand[bk].kills += Number(b.kills || 0);
    s.byBand[bk].exp += Number(b.exp || 0);
    s.byBand[bk].gold += Number(b.gold || 0);
    s.byBand[bk].seconds += Number(b.seconds || 0);
    s.byBand[bk].samples += n;
    const drops = b.drops || {};
    for (const k in drops) s.drops[k] = (s.drops[k] || 0) + Number(drops[k] || 0);
    await persist('stats');
    return send(res, 200, { ok: true });
  }

  // 统计摘要
  if (p === '/api/stats/summary' && req.method === 'GET') {
    const s = await stats();
    const per = o => ({
      kills: o.kills || 0,
      expPerMin: o.seconds > 0 ? Math.round((o.exp || 0) / (o.seconds / 60)) : 0,
      goldPerMin: o.seconds > 0 ? Math.round((o.gold || 0) / (o.seconds / 60)) : 0,
      killsPerMin: o.seconds > 0 ? Math.round((o.kills || 0) / (o.seconds / 60) * 10) / 10 : 0,
      samples: o.samples || 0
    });
    const byJob = {}, byBand = {};
    for (const k in s.byJob) byJob[k] = per(s.byJob[k]);
    for (const k in s.byBand) byBand[k] = per(s.byBand[k]);
    return send(res, 200, { ok: true,
      total: { kills: s.totalKills, exp: s.totalExp, gold: s.totalGold, deaths: s.deaths, seconds: s.totalSeconds },
      byJob, byBand, drops: s.drops });
  }

  return send(res, 404, { ok: false, msg: 'no such api' });
}

// ---------- 静态文件 ----------
async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.join(ROOT, rel);
  if (!full.startsWith(ROOT)) return send(res, 403, 'forbidden');
  try {
    const st = await fsp.stat(full);
    if (st.isDirectory()) return send(res, 403, 'forbidden');
    const ext = path.extname(full).toLowerCase();
    const body = await fsp.readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': body.length, 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch (e) {
    send(res, 404, 'not found');
  }
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://' + (req.headers.host || 'localhost')); }
  catch (e) { return send(res, 400, 'bad url'); }
  try {
    if (url.pathname.startsWith('/api/')) await handleAPI(req, res, url);
    else await serveStatic(req, res, url);
  } catch (e) {
    send(res, 500, { ok: false, msg: String(e && e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log('[梦回华夏] 后端已启动： http://localhost:' + PORT + '/');
  console.log('[梦回华夏] 静态根：' + ROOT);
  console.log('[梦回华夏] 数据目录：' + DATA_DIR);
});
