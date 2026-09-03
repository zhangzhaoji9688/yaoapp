#!/bin/bash
# yaoapp 线上故障一键诊断脚本
# 用法：在服务器上执行  bash diag-yaoapp.sh  然后把全部输出发回分析
# 说明：本脚本只读，不会修改/重启任何服务，可放心执行

APP=/opt/yaoapp
NOW=$(date '+%Y-%m-%d %H:%M:%S')

echo "======== 诊断时间：$NOW ========"
echo

echo "===== [1] 系统运行时长 / 是否刚重启过 ====="
uptime
echo "(若时长只有几分钟，说明服务器刚被重启过，node 无开机自启就会挂)"
echo

echo "===== [2] 关键进程在不在（node / nginx / pm2） ====="
ps aux | grep -E "node server|nginx|pm2" | grep -v grep || echo "(node / nginx / pm2 都无进程在跑)"
echo

echo "===== [3] 3000 端口监听情况 ====="
ss -lntp 2>/dev/null | grep :3000 || echo "(3000 端口无监听 → 后端 node 没起来，502 根因)"
echo

echo "===== [4] ★★★★★ 崩溃现场：server.log 最后 100 行（最关键的证据） ====="
if [ -f "$APP/server.log" ]; then
  ls -la "$APP/server.log"
  echo "--- 文件末尾 100 行 ---"
  tail -n 100 "$APP/server.log"
  echo "--- 文件开头 5 行（看最后一次启动时间） ---"
  head -n 5 "$APP/server.log"
else
  echo "(找不到 $APP/server.log —— 说明服务可能从未成功启动过，或日志被重定向到别处)"
fi
echo

echo "===== [5] 崩溃现场补充：有没有任何异常堆栈痕迹 ====="
if [ -f "$APP/server.log" ]; then
  grep -nE "Error|error|Exception|exception|at |FATAL|fatal" "$APP/server.log" | tail -n 40 || echo "(日志里无 Error/堆栈字样)"
fi
echo

echo "===== [6] 是否被系统 OOM 杀过（内存不足杀进程） ====="
dmesg 2>/dev/null | grep -iE "killed process|out of memory|oom" | tail -n 20 || echo "(无 OOM 记录，或 dmesg 需要 root 权限)"
echo

echo "===== [7] 磁盘与内存余量 ====="
df -h / | tail -n 2
free -h
echo

echo "===== [8] 数据库文件状态（大小/时间，看有没有异常） ====="
ls -la "$APP/data/" 2>/dev/null || echo "(data 目录不存在!)"
echo

echo "===== [9] SQLite 完整性检查（只读，不修改数据） ====="
if [ -f "$APP/data/app.db" ]; then
  cd "$APP" && node -e "
    const D = require('better-sqlite3');
    const db = new D('$APP/data/app.db');
    console.log('integrity_check:', JSON.stringify(db.pragma('integrity_check')));
    console.log('journal_mode:', JSON.stringify(db.pragma('journal_mode')));
    const c = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    console.log('users 表行数:', c);
    db.close();
  " 2>&1 || echo "(完整性检查执行失败 —— better-sqlite3 可能没装好或数据库已损坏)"
else
  echo "(app.db 不存在!)"
fi
echo

echo "===== [10] Nginx 状态（502 是它报的，顺带看它日志） ====="
if command -v nginx >/dev/null 2>&1; then
  ps aux | grep nginx | grep -v grep | head -3
  nginx -t 2>&1
  echo "--- nginx error.log 最近 20 行 ---"
  tail -n 20 /var/log/nginx/error.log 2>/dev/null || echo "(读不到 nginx error.log)"
else
  echo "(服务器上没检测到 nginx 命令；502 可能来自其他网关，以 [4] 的日志为准)"
fi
echo

echo "===== 诊断结束：把以上全部输出原样发回即可 ====="
