// ============================================================
// 密码后门 · 救援工具
// 用途：忘记账号密码（尤其是 admin 自己）时的最后手段
// 安全：必须能登录服务器、能访问 app.db 文件才能使用，
//       不暴露任何 Web 接口，比任何界面级后门都安全。
// ============================================================
// 用法：
//   node reset-password.js --list
//       列出所有账号（用户名/注册时间/最后登录）
//   node reset-password.js <用户名> <新密码>
//       重置指定账号密码，并踢掉该账号所有已登录会话
//   示例：
//   node reset-password.js admin MyNewPass2026
// ============================================================
const db = require('./db.js');

const [,, arg1, arg2] = process.argv;

function printUsage() {
  console.log('============================================================');
  console.log(' yaoapp 密码后门工具');
  console.log('------------------------------------------------------------');
  console.log(' 用法1: node reset-password.js --list');
  console.log('        列出所有账号信息');
  console.log(' 用法2: node reset-password.js <用户名> <新密码>');
  console.log('        重置该账号密码（同时踢掉已登录会话）');
  console.log(' 示例:  node reset-password.js admin MyNewPass2026');
  console.log('============================================================');
}

if (arg1 === '--list' || arg1 === '-l') {
  const users = db.listUsers();
  if (!users.length) {
    console.log('（暂无账号）');
  } else {
    console.log('账号列表：');
    console.log('ID\t用户名\t注册时间\t最后登录\t记录数');
    for (const u of users) {
      console.log(`${u.id}\t${u.username}\t${(u.created_at || '').slice(0, 10)}\t${(u.last_login_at || '-').slice(0, 10)}\t${u.recordCount}`);
    }
  }
  process.exit(0);
}

if (arg1 && arg2) {
  const user = db.findUserByUsername(arg1);
  if (!user) {
    console.error(`✗ 账号不存在: ${arg1}（可用 node reset-password.js --list 查看）`);
    process.exit(1);
  }
  if (String(arg2).length < 6) {
    console.error('✗ 新密码太短，至少 6 位');
    process.exit(1);
  }
  db.changePassword(user.id, String(arg2));
  db.deleteUserSessions(user.id); // 踢下线，强制重新登录
  console.log(`✔ 密码已重置: ${arg1}`);
  console.log(`  新密码: ${arg2}（该账号已登录的会话全部失效，需重新登录）`);
  process.exit(0);
}

printUsage();
process.exit(1);
