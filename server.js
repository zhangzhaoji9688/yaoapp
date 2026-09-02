const http = require('http');
const fs = require('fs');
const url = require('url');
const path = require('path');
const store = require('./db');

const PORT = 3000;

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon', '.png': 'image/png', '.svg': 'image/svg+xml'
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function getToken(req) {
  const auth = req.headers['authorization'] || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

async function parseJSON(req) {
  try { return JSON.parse(await readBody(req)); }
  catch (e) { return null; }
}

const server = http.createServer(async (req, res) => {
  corsHeaders(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // ========== 注册（开放自助注册） ==========
  if (pathname === '/api/register' && req.method === 'POST') {
    const body = await parseJSON(req);
    if (!body || !body.username || !body.password || body.password.length < 4) {
      return sendJSON(res, 400, { error: '用户名和密码（至少4位）必填' });
    }
    if (store.findUserByUsername(body.username)) {
      return sendJSON(res, 409, { error: '用户名已存在' });
    }
    const uid = store.createUser(body.username, body.password);
    const token = store.createSession(uid);
    return sendJSON(res, 200, { ok: true, token, username: body.username });
  }

  // ========== 登录 ==========
  if (pathname === '/api/login' && req.method === 'POST') {
    const body = await parseJSON(req);
    const user = body && store.verifyUser(body.username, body.password);
    if (!user) return sendJSON(res, 401, { error: '账号或密码错误' });
    const token = store.createSession(user.id);
    return sendJSON(res, 200, { ok: true, token, username: user.username });
  }

  // ========== 当前用户 ==========
  if (pathname === '/api/me' && req.method === 'GET') {
    const user = store.getSessionUser(getToken(req));
    if (!user) return sendJSON(res, 401, { error: '未登录' });
    return sendJSON(res, 200, { ok: true, username: user.username });
  }

  // ========== 退出 ==========
  if (pathname === '/api/logout' && req.method === 'POST') {
    store.deleteSession(getToken(req));
    return sendJSON(res, 200, { ok: true });
  }

  // ========== 修改密码（必须验证旧密码；未登录时需提供账号，用于登录页改密） ==========
  if (pathname === '/api/change-password' && req.method === 'POST') {
    const body = await parseJSON(req);
    if (!body || !body.oldPassword || !body.password) {
      return sendJSON(res, 400, { error: '旧密码和新密码必填' });
    }
    if (body.password.length < 4) {
      return sendJSON(res, 400, { error: '新密码至少4位' });
    }
    let user = store.getSessionUser(getToken(req));
    if (!user) {
      // 未登录（登录页改密）：校验账号 + 旧密码
      if (!body.username) return sendJSON(res, 401, { error: '未登录，请提供账号' });
      user = store.verifyUser(body.username, body.oldPassword);
      if (!user) return sendJSON(res, 403, { error: '账号或旧密码不正确' });
    } else if (!store.verifyPasswordById(user.id, body.oldPassword)) {
      return sendJSON(res, 403, { error: '旧密码不正确' });
    }
    store.changePassword(user.id, body.password);
    return sendJSON(res, 200, { ok: true });
  }

  // ========== 数据接口（需登录，按用户隔离） ==========
  if (pathname === '/api/data' && (req.method === 'GET' || req.method === 'POST')) {
    const user = store.getSessionUser(getToken(req));
    if (!user) return sendJSON(res, 401, { error: '未登录' });
    if (req.method === 'GET') {
      return sendJSON(res, 200, store.getRecords(user.id));
    }
    const body = await parseJSON(req);
    if (!body) return sendJSON(res, 400, { error: '数据格式错误' });
    store.saveRecords(user.id, body);
    return sendJSON(res, 200, { ok: true });
  }

  // ========== 静态文件 ==========
  let filePath;
  if (pathname === '/' || pathname === '/index.html') {
    filePath = path.join(__dirname, 'www', 'index.html');
  } else {
    filePath = path.join(__dirname, 'www', pathname);
  }
  // 防路径穿越
  const resolved = path.resolve(filePath);
  const wwwRoot = path.resolve(__dirname, 'www');
  if (!resolved.startsWith(wwwRoot)) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('Not Found');
    return;
  }
  const ext = filePath.substring(filePath.lastIndexOf('.'));
  const contentType = mime[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
});

store.ensureSeeded();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 邀评录入系统运行在 http://0.0.0.0:${PORT}`);
});
