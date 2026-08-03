// convert_dates.js
// 将 db.json 中所有记录的 date 字段升级为 dateRaw + dateISO 格式

const fs = require('fs');
const path = require('path');

const DB = path.join(__dirname, 'data', 'db.json');

function p2(s) { return s.length < 2 ? '0' + s : s; }

function parseDateStr(text) {
  if (!text) return null;
  text = text.trim();
  // 范围日期，取第一个
  let main = text.split(/[-~～]/)[0].trim();
  // 完整格式：2025.12.25
  let m = main.match(/^(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})$/);
  if (m) return `${m[1]}-${p2(m[2])}-${p2(m[3])}`;
  // 简短格式：6.1 或 12.25
  m = main.match(/^(\d{1,2})[.\-](\d{1,2})$/);
  if (m) {
    let mo = parseInt(m[1], 10);
    let yr = mo === 12 ? 2025 : 2026;
    return `${yr}-${p2(m[1])}-${p2(m[2])}`;
  }
  return null;
}

function isoToShort(iso) {
  if (!iso) return '';
  const parts = iso.split('-');
  return parseInt(parts[1], 10) + '.' + parseInt(parts[2], 10);
}

const db = JSON.parse(fs.readFileSync(DB, 'utf8'));
let count = 0;

for (const shop of Object.keys(db.records)) {
  for (const rec of db.records[shop]) {
    if (rec.dateISO) continue; // 已转换过
    const raw = rec.date || '';
    const iso = parseDateStr(raw);
    rec.dateRaw = raw;
    rec.dateISO = iso || '9999-12-31';
    rec.dateDisplay = iso ? isoToShort(iso) : raw;
    count++;
  }
}

fs.writeFileSync(DB, JSON.stringify(db, null, 2), 'utf8');
console.log(`✅ 已转换 ${count} 条记录的日期格式`);
console.log('完成后请刷新页面');
