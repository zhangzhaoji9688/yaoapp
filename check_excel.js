const XLSX = require('xlsx');
const path = require('path');

// 读取Excel文件
const workbook = XLSX.readFile(path.join(__dirname, 'data', 'test.xlsx'));

// 打印每个sheet的前10行
workbook.SheetNames.forEach(sheetName => {
  console.log(`\n=== Sheet: ${sheetName} ===`);
  const worksheet = workbook.Sheets[sheetName];
  const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  
  jsonData.slice(0, 10).forEach((row, index) => {
    console.log(`Row ${index}:`, row);
  });
});
