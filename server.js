const http = require('http');
const fs = require('fs');
const url = require('url');
const path = require('path');
const store = require('./db');

const PORT = 3000;
const MAX_BODY = 1024 * 1024; // 请求体上限 1MB

// 同源应用，不加 CORS 跨域头；统一补安全响应头
function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
}

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon', '.png': 'image/png', '.svg': 'image/svg+xml'
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    req.on('data', c => {
      body += c;
      if (body.length > MAX_BODY) { tooLarge = true; req.destroy(); }
    });
    req.on('end', () => tooLarge ? reject(new Error('body too large')) : resolve(body));
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
  securityHeaders(res);

  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // ========== 注册（已关闭：账号由管理员创建） ==========
  if (pathname === '/api/register' && req.method === 'POST') {
    return sendJSON(res, 403, { error: '系统不开放注册，请联系管理员创建账号' });
  }

  // ========== 登录（连续失败 5 次锁定 15 分钟） ==========
  if (pathname === '/api/login' && req.method === 'POST') {
    const body = await parseJSON(req);
    if (!body || !body.username || !body.password) {
      return sendJSON(res, 400, { error: '账号和密码必填' });
    }
    const lock = store.isUserLocked(body.username);
    if (lock.locked) {
      const mins = Math.max(1, Math.ceil(lock.remainingMs / 60000));
      return sendJSON(res, 429, { error: `失败次数过多，账号已锁定，请 ${mins} 分钟后再试` });
    }
    const user = store.verifyUser(body.username, body.password);
    if (!user) {
      const fr = store.recordLoginFail(body.username);
      if (fr.locked) {
        return sendJSON(res, 429, { error: '失败次数过多，账号已锁定 15 分钟' });
      }
      return sendJSON(res, 401, { error: `账号或密码错误（连续失败 ${5 - fr.failCount} 次后将锁定）` });
    }
    store.clearLoginFail(user.id);
    store.touchLogin(user.id);
    const token = store.createSession(user.id);
    return sendJSON(res, 200, { ok: true, token, username: user.username });
  }

  // ========== 管理员：创建账号（仅 admin，替代开放注册） ==========
  if (pathname === '/api/admin/create-user' && req.method === 'POST') {
    const user = store.getSessionUser(getToken(req));
    if (!user) return sendJSON(res, 401, { error: '未登录' });
    if (user.username !== 'admin') return sendJSON(res, 403, { error: '无权限' });
    const body = await parseJSON(req);
    if (!body || !body.username || !body.password || body.password.length < 6) {
      return sendJSON(res, 400, { error: '用户名和新密码（至少6位）必填' });
    }
    if (store.findUserByUsername(body.username)) {
      return sendJSON(res, 409, { error: '用户名已存在' });
    }
    store.createUser(body.username, body.password);
    return sendJSON(res, 200, { ok: true, username: body.username });
  }

  // ========== 管理员：全部账号信息（仅 admin） ==========
  if (pathname === '/api/admin/users' && req.method === 'GET') {
    const user = store.getSessionUser(getToken(req));
    if (!user) return sendJSON(res, 401, { error: '未登录' });
    if (user.username !== 'admin') return sendJSON(res, 403, { error: '无权限' });
    return sendJSON(res, 200, { ok: true, users: store.listUsers() });
  }

  // ========== 管理员：重置他人密码（仅 admin，无需旧密码） ==========
  if (pathname === '/api/admin/reset-password' && req.method === 'POST') {
    const user = store.getSessionUser(getToken(req));
    if (!user) return sendJSON(res, 401, { error: '未登录' });
    if (user.username !== 'admin') return sendJSON(res, 403, { error: '无权限' });
    const body = await parseJSON(req);
    if (!body || !body.username || !body.newPassword || body.newPassword.length < 6) {
      return sendJSON(res, 400, { error: '用户名和新密码（至少6位）必填' });
    }
    const target = store.findUserByUsername(body.username);
    if (!target) return sendJSON(res, 404, { error: '用户不存在' });
    store.changePassword(target.id, body.newPassword);
    store.deleteUserSessions(target.id); // 踢下线，强制重新登录
    return sendJSON(res, 200, { ok: true, username: body.username });
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
    if (body.password.length < 6) {
      return sendJSON(res, 400, { error: '新密码至少6位' });
    }
    let user = store.getSessionUser(getToken(req));
    if (!user) {
      // 未登录（登录页改密）：校验账号 + 旧密码（同样防暴力试探）
      if (!body.username) return sendJSON(res, 401, { error: '未登录，请提供账号' });
      const lock = store.isUserLocked(body.username);
      if (lock.locked) {
        const mins = Math.max(1, Math.ceil(lock.remainingMs / 60000));
        return sendJSON(res, 429, { error: `失败次数过多，请 ${mins} 分钟后再试` });
      }
      user = store.verifyUser(body.username, body.oldPassword);
      if (!user) {
        const fr = store.recordLoginFail(body.username);
        if (fr.locked) {
          return sendJSON(res, 429, { error: '失败次数过多，账号已锁定 15 分钟' });
        }
        return sendJSON(res, 403, { error: `账号或旧密码不正确（连续失败 ${5 - fr.failCount} 次后将锁定）` });
      }
      store.clearLoginFail(user.id);
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
