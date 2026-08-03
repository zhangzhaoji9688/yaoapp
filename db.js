// db.js —— SQLite 数据层（better-sqlite3）
// 数据按用户隔离：users / sessions / records(user_id, data)
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'app.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
  user_id INTEGER PRIMARY KEY,
  data TEXT NOT NULL
);
`);

// ===== 密码哈希（crypto.scrypt，加盐，不存明文） =====
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function makeSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function createUser(username, password) {
  const salt = makeSalt();
  const hash = hashPassword(password, salt);
  const info = db.prepare(
    'INSERT INTO users (username, password_hash, salt, created_at) VALUES (?, ?, ?, ?)'
  ).run(username, hash, salt, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

function verifyUser(username, password) {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row) return null;
  const hash = hashPassword(password, row.salt);
  if (hash !== row.password_hash) return null;
  return { id: row.id, username: row.username };
}

function getUser(id) {
  return db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(id) || null;
}

function findUserByUsername(username) {
  return db.prepare('SELECT id FROM users WHERE username = ?').get(username) || null;
}

// ===== 会话（记住我 / 自动登录） =====
function createSession(userId, ttlDays = 30) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + ttlDays * 86400000).toISOString();
  db.prepare('INSERT OR REPLACE INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, expires);
  return token;
}

function getSessionUser(token) {
  if (!token) return null;
  const row = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?').get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return getUser(row.user_id);
}

function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function changePassword(userId, newPassword) {
  const salt = makeSalt();
  const hash = hashPassword(newPassword, salt);
  db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').run(hash, salt, userId);
}

// ===== 记录（每个用户一份 JSON） =====
function getRecords(userId) {
  const row = db.prepare('SELECT data FROM records WHERE user_id = ?').get(userId);
  if (row) {
    try { return JSON.parse(row.data); } catch (e) { return { records: {}, skuList: {} }; }
  }
  return { records: {}, skuList: {} };
}

function saveRecords(userId, data) {
  db.prepare('INSERT OR REPLACE INTO records (user_id, data) VALUES (?, ?)')
    .run(userId, JSON.stringify(data));
}

// ===== 首次启动播种：admin 账号 + 迁移旧 db.json =====
function ensureSeeded() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) return;

  const defaultPw = crypto.randomBytes(6).toString('hex'); // 12 位十六进制
  const adminId = createUser('admin', defaultPw);
  console.log('================================================');
  console.log(' 初始管理员账号已创建（请尽快修改密码）');
  console.log('   用户名: admin');
  console.log('   初始密码: ' + defaultPw);
  console.log('================================================');

  const jsonPath = path.join(DATA_DIR, 'db.json');
  if (fs.existsSync(jsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      saveRecords(adminId, data);
      console.log(' 已把原有 db.json 数据迁移到 admin 账号');
    } catch (e) {
      console.log(' 迁移 db.json 失败：', e.message);
    }
  }
}

module.exports = {
  db, createUser, verifyUser, getUser, findUserByUsername,
  createSession, getSessionUser, deleteSession, changePassword,
  getRecords, saveRecords, ensureSeeded
};
