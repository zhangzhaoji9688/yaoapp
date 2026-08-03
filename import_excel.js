const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// 读取Excel文件
const workbook = XLSX.readFile(path.join(__dirname, 'data', 'test.xlsx'));

// 初始化数据结构
const data = {
  records: {
    '哈德逊': [],
    '辰润': [],
    '多恩': [],
    '伯克纳': [],
    '阿达姆': []
  }
};

// 读取每个sheet
workbook.SheetNames.forEach(sheetName => {
  const shop = sheetName; // sheet名就是店铺名
  if (!data.records[shop]) {
    console.log(`未知的sheet: ${sheetName}，跳过`);
    return;
  }

  const worksheet = workbook.Sheets[sheetName];
  const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  
  let currentSKU = '';
  
  jsonData.forEach((row, index) => {
    if (!row || row.length === 0) return;
    
    // 判断是否是SKU行（只有一个单元格有值）
    if (row.length === 1 && row[0] && String(row[0]).includes('-')) {
      currentSKU = String(row[0]).trim();
      return;
    }
    
    // 判断是否是数据行（至少有订单号和日期）
    if (row.length >= 2 && row[0]) {
      const orderId = String(row[0]).trim();
      const date = row[1] ? String(row[1]).trim() : '';
      const reason = row[2] ? String(row[2]).trim() : '';
      
      // 跳过表头行
      if (orderId === '订单号' || orderId === '订单') return;
      
      const record = {
        id: Date.now() + Math.random(),
        orderId: orderId,
        date: date,
        reason: reason,
        shop: shop,
        sku: currentSKU || sheetName
      };
      
      data.records[shop].push(record);
    }
  });

  console.log(`导入 ${shop}: ${data.records[shop].length} 条记录`);
});

// 保存为JSON文件
fs.writeFileSync(path.join(__dirname, 'data', 'db.json'), JSON.stringify(data, null, 2), 'utf8');
console.log('数据导入完成！');
const total = Object.values(data.records).reduce((sum, arr) => sum + arr.length, 0);
console.log(`总记录数: ${total}`);
