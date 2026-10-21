/* 梦回华夏 · 云函数 API（CloudBase HTTP 函数，监听 9000 端口）
 *
 * 由 web_idle/server/server.js 忠实移植：
 *   - 路由、方法、响应结构与本地版逐条一致，前端零改动；
 *   - 密码口径不变（PBKDF2-SHA256，12 万次迭代，16 字节盐）；
 *   - 令牌 30 天有效期、存档 3 槽位 / 单槽 4MB 上限不变；
 *   - 唯一变化：存储层从本地文件切换为 NoSQL 文档数据库集合。
 *   - IP 限流双层：① 实例内固定窗口（内存 Map，全路径）② auth 路径额外走 NoSQL
 *     全局窗口（ratelimit 集合，治 SCF 多实例下顺序爆破）。限额：auth 10/min ·
 *     save 30/min · stats 20/min · rank 120/min · health 300/min · 其余 120/min；
 *     命中返回 429 + Retry-After。OPTIONS 预检不计数。
 *
 * 集合：
 *   users        _id=用户名        {salt,hash,createdAt,lastLogin}
 *   tokens       _id=令牌          {user,createdAt}
 *   saves        _id=user__slot    {user,slot,payload(JSON字符串),savedAt,bytes}
 *   leaderboard  _id=key           {user,name,job,level,power,kills,updatedAt}
 *   stats        _id=global        总量计数（读-改-写）
 *   stats_byJob  _id=职业          分职业计数（读-改-写）
 *   stats_byBand _id=等级段        分等级段计数（读-改-写）
 *   stats_drops  _id=物品          掉落计数（读-改-写）
 *   ratelimit    _id=rl_<ip>_<rule> IP 限流全局窗口 {t0,n}（仅 auth 路径）
 *
 * 本地自测：不设置 CLOUDBASE_APIKEY 时自动切换内存存储（DEV_MEMORY），
 * 仅用于本机验证 HTTP 契约；云上运行时必须配置 CLOUDBASE_APIKEY + TCB_ENV。
 */
'use strict';
const http = require('node:http');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 9000);
const MAX_SLOTS = 3;
const MAX_SAVE_BYTES = 4 * 1024 * 1024;
const PBKDF2_ITER = 120000;
const TOKEN_MAX_AGE = 30 * 24 * 3600 * 1000;
const USER_RE = /^[\w一-龥]{2,16}$/;

// ---------- IP 限流 ----------
// 双层防护（背景：① /login /register 每次跑 PBKDF2 12 万迭代，无限流等于放任在线爆破；
//          ② /save /stats 走 NoSQL 读-改-写，脚本 hammer 会打爆配额）：
//   ① 实例内固定窗口（内存 Map）：全路径生效、零成本。但 SCF 多实例且内存不共享——
//      实测顺序请求多命中新实例（内存桶形同虚设），仅并发同实例时能拦住；
//   ② 全局窗口（NoSQL ratelimit 集合）：仅 auth 路径额外走这一层，花 2 次文档读写
//      换跨实例一致计数，专治顺序爆破（最常见攻击模式）。DB 异常时放行并打日志
//      （限流器不该因存储故障把正常用户锁在门外）。
// 口径：固定窗口计数（个人部署并发极低，边界 2 倍 burst 可接受）。
// 客户端正常节奏远低于限额：存档 30s/次、统计 60s/次、排行 3min/次、登录 1 次/会话。
const RATE_RULES = [
  { name: 'auth',  re: /^\/(register|login)$/, windowMs: 60000, max: 10, global: true  },
  { name: 'save',  re: /^\/save$/,             windowMs: 60000, max: 30, global: false },
  { name: 'stats', re: /^\/stats$/,            windowMs: 60000, max: 20, global: false },
  { name: 'rank',  re: /^\/rank$/,             windowMs: 60000, max: 120, global: false },
  { name: 'probe', re: /^\/health$/,           windowMs: 60000, max: 300, global: false },
];
const RATE_DEFAULT = { name: 'default', windowMs: 60000, max: 120, global: false };
const rateBuckets = new Map();   // ip|rule -> {t0, n}（实例内）
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'] || req.headers['x-real-ip'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}
function rateAllow(ip, rule) {
  const now = Date.now();
  const key = ip + '|' + rule.name;
  let b = rateBuckets.get(key);
  if (!b || now - b.t0 > rule.windowMs) { b = { t0: now, n: 0 }; rateBuckets.set(key, b); }
  b.n++;
  if (rateBuckets.size > 20000) rateBuckets.clear();   // 兜底防内存膨胀
  return b.n <= rule.max;
}
// 全局窗口：ratelimit 集合 _id=rl_<ip>_<rule>，文档 {t0,n}；过期窗口整体复用同一文档
// （桶数 = 见过的 IP 数 × 规则数，个人部署规模下可接受；不再需要额外清理任务）
async function rateAllowGlobal(ip, rule) {
  const id = 'rl_' + safeId(ip) + '_' + rule.name;
  const now = Date.now();
  const cur = await docGet('ratelimit', id);
  let b = (cur && typeof cur === 'object' && now - (cur.t0 || 0) <= rule.windowMs) ? cur : { t0: now, n: 0 };
  b.n = (Number(b.n) || 0) + 1;
  await docSet('ratelimit', id, { t0: b.t0, n: b.n });
  return b.n <= rule.max;
}

// ---------- 存储层 ----------
let db = null; // @cloudbase/node-sdk database()
const DEV = !process.env.CLOUDBASE_APIKEY;
// 内存键名与集合名严格一致
const mem = {
  users: {}, tokens: {}, saves: {}, leaderboard: {}, stats: {},
  stats_byJob: {}, stats_byBand: {}, stats_drops: {}, ratelimit: {}
};
if (!DEV) {
  const tcb = require('@cloudbase/node-sdk');
  const app = tcb.init({ env: process.env.TCB_ENV, accessKey: process.env.CLOUDBASE_APIKEY });
  db = app.database();
  // ratelimit 集合必须存在才能 doc().set()（NoSQL 不自动建集合）；
  // 幂等创建——已存在时报错即目标态，忽略。失败不影响主流程（全局限流会走放行分支）。
  Promise.resolve(db.createCollection('ratelimit')).then(() => {
    console.log('[api] ratelimit 集合就绪');
  }).catch(e => {
    const msg = String((e && e.message) || e);
    if (!/exist|已存在/i.test(msg)) console.error('[api] createCollection(ratelimit) 失败：', msg);
  });
}
if (DEV) console.warn('[api] DEV_MEMORY 模式：未检测到 CLOUDBASE_APIKEY，使用内存存储（仅限本地自测）');

function safeId(s) { return String(s).replace(/[^\w一-龥.-]/g, '_'); }
function saveId(user, slot) { return safeId(user) + '__' + Number(slot); }

// 注意：本 SDK 版本中 doc(id).get() 对不存在文档返回 {data: []} 形态（非 null），
// 且 update() 对不存在文档是静默无操作（不抛错也不落库）——
// 因此读路径必须把空数组归一化为 null，写路径统一走 set 读-改-写。
async function docGet(coll, id) {
  if (DEV) return mem[coll][id] || null;
  try {
    const r = await db.collection(coll).doc(id).get();
    let d = (r && r.data !== undefined) ? r.data : r;
    if (Array.isArray(d)) d = d.length ? d[0] : null;
    return (d && typeof d === 'object') ? d : null;
  } catch (e) { return null; }
}
async function docSet(coll, id, data) {
  if (DEV) { mem[coll][id] = Object.assign({}, data); return; }
  // docGet 读出的文档带 _id，回写前必须剥离（set 不允许更新 _id）
  const clean = Object.assign({}, data);
  delete clean._id;
  await db.collection(coll).doc(id).set(clean);
}
async function docRemove(coll, id) {
  if (DEV) { delete mem[coll][id]; return; }
  try { await db.collection(coll).doc(id).remove(); } catch (e) { /* 不存在即目标态 */ }
}
async function listWhere(coll, queryObj) {
  const keys = queryObj ? Object.keys(queryObj) : [];
  if (DEV) return Object.values(mem[coll]).filter(x => keys.every(k => x[k] === queryObj[k]));
  let q = db.collection(coll);
  if (keys.length) q = q.where(queryObj);
  const r = await q.limit(1000).get();
  return (r && r.data) || [];
}
async function listAll(coll) {
  if (DEV) return Object.values(mem[coll]);
  const r = await db.collection(coll).limit(1000).get();
  return (r && r.data) || [];
}

// ---------- 账号 / 令牌 ----------
async function getUser(u) { return docGet('users', u); }
async function putUser(u, rec) { return docSet('users', u, rec); }
async function getToken(t) { return docGet('tokens', t); }
async function putToken(t, rec) { return docSet('tokens', t, rec); }

// ---------- 存档 ----------
async function getSave(user, slot) {
  const d = await docGet('saves', saveId(user, slot));
  if (!d || !d.payload) return null;
  let payload;
  try { payload = JSON.parse(d.payload); } catch (e) { return null; }
  return { payload, savedAt: d.savedAt || 0, bytes: d.bytes || 0 };
}
async function putSave(user, slot, payloadObj) {
  const raw = JSON.stringify(payloadObj);
  await docSet('saves', saveId(user, slot), {
    user, slot: Number(slot), payload: raw,
    savedAt: payloadObj.savedAt || Date.now(), bytes: Buffer.byteLength(raw, 'utf-8')
  });
}
async function listSaves(user) {
  if (DEV) return Object.values(mem.saves).filter(x => x.user === user);
  const r = await db.collection('saves').where({ user }).limit(100).get();
  return (r && r.data) || [];
}

// ---------- 排行榜 ----------
async function upsertBoard(entry) { return docSet('leaderboard', safeId(entry.key), entry); }
async function listBoard(job) {
  const all = await listWhere('leaderboard', job ? { job } : {});
  all.sort((x, y) => (y.power || 0) - (x.power || 0));
  // 剥掉 _id，保持与原版 server.js 一致的响应结构
  return all.slice(0, 500).map(x => { const c = Object.assign({}, x); delete c._id; return c; });
}

// ---------- 挂机统计（读-改-写，与原版 server.js 文件口径一致） ----------
async function bumpStats(b) {
  const n = Number(b.samples) || 1;
  const kills = Number(b.kills || 0), exp = Number(b.exp || 0),
        gold = Number(b.gold || 0), seconds = Number(b.seconds || 0),
        deaths = Number(b.deaths || 0);
  const job = String(b.job || '?');
  const band = Math.floor(Number(b.level || 1) / 10) * 10;
  const bandKey = band + '-' + (band + 9);
  const drops = b.drops || {};

  const errors = [];
  // 个人部署并发极低，沿用原版的读-改-写语义（原版也是对 JSON 文件读-改-写）；
  // 不适用 update/inc：本 SDK 版本 update 对不存在文档是静默无操作。
  async function bump(coll, id, patch, base) {
    const cur = (await docGet(coll, id)) || Object.assign({}, base);
    for (const k in patch) cur[k] = (Number(cur[k]) || 0) + patch[k];
    try { await docSet(coll, id, cur); }
    catch (e) { errors.push(coll + '/' + id + ': ' + (e && e.message || e)); }
  }

  await bump('stats', 'global',
    { totalKills: kills, totalExp: exp, totalGold: gold, totalSeconds: seconds, deaths, samples: n },
    { totalKills: 0, totalExp: 0, totalGold: 0, totalSeconds: 0, deaths: 0, samples: 0 });
  await bump('stats_byJob', safeId(job),
    { kills, exp, gold, seconds, samples: n },
    { job, kills: 0, exp: 0, gold: 0, seconds: 0, samples: 0 });
  await bump('stats_byBand', safeId(bandKey),
    { kills, exp, gold, seconds, samples: n },
    { band: bandKey, kills: 0, exp: 0, gold: 0, seconds: 0, samples: 0 });
  for (const k in drops) {
    await bump('stats_drops', safeId(k), { count: Number(drops[k] || 0) }, { item: k, count: 0 });
  }
  if (errors.length) {
    console.error('[stats] 写入失败', errors);
    throw new Error('统计写入失败: ' + errors[0]);
  }
}
function perMin(o) {
  const sec = o.seconds || 0;
  return {
    kills: o.kills || 0,
    expPerMin: sec > 0 ? Math.round((o.exp || 0) / (sec / 60)) : 0,
    goldPerMin: sec > 0 ? Math.round((o.gold || 0) / (sec / 60)) : 0,
    killsPerMin: sec > 0 ? Math.round((o.kills || 0) / (sec / 60) * 10) / 10 : 0,
    samples: o.samples || 0
  };
}
async function statsSummary() {
  const g = (await docGet('stats', 'global')) || {};
  const byJob = {}, byBand = {}, drops = {};
  for (const d of await listAll('stats_byJob')) byJob[d.job || d._id] = perMin(d);
  for (const d of await listAll('stats_byBand')) byBand[d.band || d._id] = perMin(d);
  for (const d of await listAll('stats_drops')) drops[d.item || d._id] = d.count || 0;
  return {
    total: { kills: g.totalKills || 0, exp: g.totalExp || 0, gold: g.totalGold || 0,
             deaths: g.deaths || 0, seconds: g.totalSeconds || 0 },
    byJob, byBand, drops
  };
}

// ---------- 密码 ----------
function hashPassword(pw, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.pbkdf2Sync(pw, s, PBKDF2_ITER, 32, 'sha256').toString('hex');
  return { salt: s, hash: h };
}
function verifyPassword(pw, salt, hash) {
  const h = crypto.pbkdf2Sync(pw, salt, PBKDF2_ITER, 32, 'sha256').toString('hex');
  try { return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex')); }
  catch (e) { return false; }
}
function newToken() { return crypto.randomBytes(24).toString('hex'); }

// ---------- HTTP 工具 ----------
// CORS 说明：网关会把请求 Origin 追加到上游 ACAO 之后（函数设任何值都会翻倍成
// 非法值），因此这里不设 Access-Control-Allow-Origin，只保留网关的单值回显；
// allow-headers / allow-methods 网关不会自设，由函数提供。
function send(res, code, obj) {
  const body = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf-8');
  res.writeHead(code, {
    'Content-Type': typeof obj === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
  });
  res.end(body);
}
function readBody(req, limit) {
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
  const rec = await getToken(t);
  if (!rec) return null;
  if (Date.now() - (rec.createdAt || 0) > TOKEN_MAX_AGE) { await docRemove('tokens', t); return null; }
  return { token: t, user: rec.user };
}
function slotLabel(slot) { return '槽位 ' + slot; }

// ---------- API（与 server.js 逐条对齐） ----------
async function handleAPI(req, res, url) {
  let p = url.pathname;
  // 网关可能透传完整路径（/api/health）或剥掉触发前缀（/health），两种都兼容
  if (p === '/api') p = '/';
  else if (p.startsWith('/api/')) p = p.slice(4) || '/';
  if (req.method === 'OPTIONS') return send(res, 204, '');

  // IP 限流：① 实例内窗口（内存，全路径）② auth 路径全局窗口（NoSQL，治顺序爆破）
  const rule = RATE_RULES.find(r => r.re.test(p)) || RATE_DEFAULT;
  if (!rateAllow(clientIp(req), rule)) {
    res.setHeader('Retry-After', String(Math.ceil(rule.windowMs / 1000)));
    return send(res, 429, { ok: false, msg: '请求过于频繁，请稍后再试' });
  }
  if (rule.global) {
    let allow = true;
    try { allow = await rateAllowGlobal(clientIp(req), rule); }
    catch (e) { console.error('[ratelimit] 全局检查失败，本次放行', e && e.message || e); }
    if (!allow) {
      res.setHeader('Retry-After', String(Math.ceil(rule.windowMs / 1000)));
      return send(res, 429, { ok: false, msg: '请求过于频繁，请稍后再试' });
    }
  }

  if (p === '/health') return send(res, 200, { ok: true, version: 1, slots: MAX_SLOTS });

  if (p === '/register' && req.method === 'POST') {
    const b = await readBody(req, 8192);
    const u = String(b.username || '').trim(), pw = String(b.password || '');
    if (!USER_RE.test(u)) return send(res, 400, { ok: false, msg: '用户名需 2~16 位中英文/数字/下划线' });
    if (pw.length < 6) return send(res, 400, { ok: false, msg: '密码至少 6 位' });
    if (await getUser(u)) return send(res, 400, { ok: false, msg: '该账号已存在' });
    const h = hashPassword(pw);
    await putUser(u, { salt: h.salt, hash: h.hash, createdAt: Date.now(), lastLogin: Date.now() });
    const t = newToken();
    await putToken(t, { user: u, createdAt: Date.now() });
    return send(res, 200, { ok: true, token: t, user: u });
  }

  if (p === '/login' && req.method === 'POST') {
    const b = await readBody(req, 8192);
    const u = String(b.username || '').trim(), pw = String(b.password || '');
    const rec = await getUser(u);
    if (!rec || !verifyPassword(pw, rec.salt, rec.hash)) return send(res, 401, { ok: false, msg: '账号或密码错误' });
    rec.lastLogin = Date.now();
    await putUser(u, rec);   // 读-改-写（避免 update 对不存在文档的静默无操作）
    const t = newToken();
    await putToken(t, { user: u, createdAt: Date.now() });
    return send(res, 200, { ok: true, token: t, user: u });
  }

  if (p === '/logout' && req.method === 'POST') {
    const a = await auth(req);
    if (a) await docRemove('tokens', a.token);
    return send(res, 200, { ok: true });
  }

  if (p === '/me') {
    const a = await auth(req);
    if (!a) return send(res, 401, { ok: false, msg: '未登录' });
    const rec = (await getUser(a.user)) || {};
    return send(res, 200, { ok: true, user: a.user, createdAt: rec.createdAt, lastLogin: rec.lastLogin });
  }

  if (p === '/slots' && req.method === 'GET') {
    const a = await auth(req);
    if (!a) return send(res, 401, { ok: false, msg: '未登录' });
    const rows = await listSaves(a.user);
    const bySlot = {};
    for (const r of rows) bySlot[Number(r.slot)] = r;
    const out = [];
    for (let i = 1; i <= MAX_SLOTS; i++) {
      const r = bySlot[i];
      if (!r) { out.push({ slot: i, label: slotLabel(i), empty: true }); continue; }
      let d = {};
      try { d = JSON.parse(r.payload) || {}; } catch (e) {}
      out.push({ slot: i, label: slotLabel(i), name: d.name || '?', job: d.job || '?',
        level: d.level || 1, power: d.power || 0, updatedAt: r.savedAt || 0 });
    }
    return send(res, 200, { ok: true, slots: out });
  }

  if (p === '/save' && req.method === 'POST') {
    const a = await auth(req);
    if (!a) return send(res, 401, { ok: false, msg: '未登录' });
    const b = await readBody(req);
    const slot = Math.min(MAX_SLOTS, Math.max(1, Number(b.slot || 1)));
    if (!b.payload || typeof b.payload !== 'object') return send(res, 400, { ok: false, msg: '存档数据无效' });
    const raw = JSON.stringify(b.payload);
    if (Buffer.byteLength(raw, 'utf-8') > MAX_SAVE_BYTES) return send(res, 413, { ok: false, msg: '存档过大' });
    b.payload.savedAt = Date.now();
    await putSave(a.user, slot, b.payload);
    return send(res, 200, { ok: true, slot, savedAt: b.payload.savedAt, bytes: Buffer.byteLength(raw, 'utf-8') });
  }

  if (p === '/load' && req.method === 'GET') {
    const a = await auth(req);
    if (!a) return send(res, 401, { ok: false, msg: '未登录' });
    const slot = Math.min(MAX_SLOTS, Math.max(1, Number(url.searchParams.get('slot') || 1)));
    const s = await getSave(a.user, slot);
    if (!s) return send(res, 404, { ok: false, msg: '该槽位为空' });
    return send(res, 200, { ok: true, slot, payload: s.payload });
  }

  if (p === '/save' && req.method === 'DELETE') {
    const a = await auth(req);
    if (!a) return send(res, 401, { ok: false, msg: '未登录' });
    const slot = Math.min(MAX_SLOTS, Math.max(1, Number(url.searchParams.get('slot') || 1)));
    await docRemove('saves', saveId(a.user, slot));
    return send(res, 200, { ok: true, slot });
  }

  if (p === '/rank' && req.method === 'POST') {
    const b = await readBody(req, 65536);
    const a = await auth(req);
    const key = a ? a.user : ('guest:' + String(b.name || '游侠'));
    const entry = {
      key, user: a ? a.user : null, name: String(b.name || '游侠').slice(0, 16),
      job: String(b.job || '?'), level: Number(b.level || 1),
      power: Math.round(Number(b.power || 0)), kills: Number(b.kills || 0),
      updatedAt: Date.now()
    };
    await upsertBoard(entry);
    const lb = await listBoard(null);
    const rank = lb.findIndex(x => x.key === key) + 1;
    return send(res, 200, { ok: true, rank, total: lb.length });
  }

  if (p === '/rank' && req.method === 'GET') {
    const job = url.searchParams.get('job');
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 20)));
    const list = await listBoard(job);
    const me = url.searchParams.get('me');
    let myRank = 0;
    if (me) myRank = list.findIndex(x => x.key === me || x.name === me) + 1;
    return send(res, 200, { ok: true, list: list.slice(0, limit), myRank, total: list.length });
  }

  if (p === '/stats' && req.method === 'POST') {
    const b = await readBody(req, 65536);
    await bumpStats(b);
    return send(res, 200, { ok: true });
  }

  if (p === '/stats/summary' && req.method === 'GET') {
    const s = await statsSummary();
    return send(res, 200, { ok: true, total: s.total, byJob: s.byJob, byBand: s.byBand, drops: s.drops });
  }

  return send(res, 404, { ok: false, msg: 'no such api' });
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url || '/', 'http://' + (req.headers.host || '127.0.0.1')); }
  catch (e) { return send(res, 400, { ok: false, msg: 'bad url' }); }
  try { await handleAPI(req, res, url); }
  catch (e) { send(res, 500, { ok: false, msg: String(e && e.message || e) }); }
});

server.listen(PORT, () => {
  console.log('[梦回华夏·云函数] API 已监听 :' + PORT + (DEV ? '（DEV_MEMORY）' : '（CloudBase NoSQL）'));
});
