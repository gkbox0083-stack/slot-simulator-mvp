const fs = require('fs');

/**
 * v1.5.0 Determinism Verification Script (Upgraded)
 * 
 * 驗證相同 seed 產生完全相同的結果
 * 
 * 使用 hash 比較關鍵欄位，確保完全匹配
 */

const crypto = require('crypto');

const args = process.argv.slice(2);
let spins = 2000;
let seed = null;

// 解析參數
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--spins' && i + 1 < args.length) {
    spins = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--seed' && i + 1 < args.length) {
    seed = parseInt(args[i + 1], 10);
    i++;
  }
}

if (seed === null) {
  console.error('❌ 錯誤: 必須指定 --seed 參數');
  console.error('使用方式: node checklist/verify_determinism_v1.5.0.js --spins 2000 --seed 12345');
  process.exit(1);
}

console.log('='.repeat(60));
console.log('v1.5.0 Determinism Verification (Hash-based)');
console.log('='.repeat(60));
console.log(`Spins: ${spins}`);
console.log(`Seed: ${seed}`);
console.log('');

// 執行兩次模擬
const csv1 = `test_deterministic_1_${seed}.csv`;
const csv2 = `test_deterministic_2_${seed}.csv`;

console.log('執行第一次模擬...');
const { execSync } = require('child_process');
try {
  execSync(`node logic/cli.js -n ${spins} --csv ${csv1} --seed ${seed}`, { stdio: 'ignore' });
} catch (e) {
  console.error(`❌ 第一次模擬失敗: ${e.message}`);
  process.exit(1);
}

console.log('執行第二次模擬...');
try {
  execSync(`node logic/cli.js -n ${spins} --csv ${csv2} --seed ${seed}`, { stdio: 'ignore' });
} catch (e) {
  console.error(`❌ 第二次模擬失敗: ${e.message}`);
  process.exit(1);
}

// 讀取並比較 CSV
function parseCSVLine(line) {
  const fields = [];
  let currentField = '';
  let inQuotes = false;
  
  for (let j = 0; j < line.length; j++) {
    const char = line[j];
    if (char === '"') {
      if (inQuotes && line[j + 1] === '"') {
        currentField += '"';
        j++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(currentField);
      currentField = '';
    } else {
      currentField += char;
    }
  }
  fields.push(currentField);
  return fields;
}

function readCSV(filename) {
  const content = fs.readFileSync(filename, 'utf8');
  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length < 2) return { header: [], rows: [] };
  
  const header = parseCSVLine(lines[0]);
  const rows = [];
  
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length >= header.length) {
      rows.push(fields);
    }
  }
  
  return { header, rows };
}

const csv1Data = readCSV(csv1);
const csv2Data = readCSV(csv2);

if (csv1Data.rows.length === 0 || csv2Data.rows.length === 0) {
  console.error('❌ CSV 檔案為空或格式錯誤');
  process.exit(1);
}

// 找到關鍵欄位索引
const getIndex = (name, header) => header.indexOf(name);
const criticalFields = ['outcomeId', 'winAmount', 'state', 'eventsJson'];
const indices1 = {};
const indices2 = {};

for (const field of criticalFields) {
  indices1[field] = getIndex(field, csv1Data.header);
  indices2[field] = getIndex(field, csv2Data.header);
  if (indices1[field] === -1 || indices2[field] === -1) {
    console.error(`❌ CSV 缺少關鍵欄位: ${field}`);
    process.exit(1);
  }
}

// 方法 1: 比較完整 CSV 內容 hash
const content1 = fs.readFileSync(csv1, 'utf8');
const content2 = fs.readFileSync(csv2, 'utf8');
const hash1 = crypto.createHash('sha256').update(content1).digest('hex');
const hash2 = crypto.createHash('sha256').update(content2).digest('hex');

// 方法 2: 比較關鍵欄位 hash（更精確的診斷）
function buildCriticalHash(rows, indices) {
  const criticalData = rows.map(row => {
    const parts = criticalFields.map(field => {
      const idx = indices[field];
      return idx !== -1 ? (row[idx] || '') : '';
    });
    return parts.join('|');
  });
  return crypto.createHash('sha256').update(criticalData.join('\n')).digest('hex');
}

const criticalHash1 = buildCriticalHash(csv1Data.rows, indices1);
const criticalHash2 = buildCriticalHash(csv2Data.rows, indices2);

// 方法 3: 逐行比較（用於診斷）
let mismatchCount = 0;
const mismatches = [];
const minRows = Math.min(csv1Data.rows.length, csv2Data.rows.length);

for (let i = 0; i < minRows; i++) {
  let rowMismatch = false;
  const rowDetails = {};
  
  for (const field of criticalFields) {
    const val1 = csv1Data.rows[i][indices1[field]];
    const val2 = csv2Data.rows[i][indices2[field]];
    if (val1 !== val2) {
      rowMismatch = true;
      rowDetails[field] = { val1, val2 };
    }
  }
  
  if (rowMismatch) {
    mismatchCount++;
    if (mismatches.length < 10) {
      mismatches.push({
        index: i + 1,
        details: rowDetails
      });
    }
  }
}

console.log('='.repeat(60));
console.log('比較結果');
console.log('='.repeat(60));
console.log(`總行數: CSV1=${csv1Data.rows.length}, CSV2=${csv2Data.rows.length}`);
console.log('');
console.log('完整 CSV 內容 Hash:');
console.log(`  CSV1: ${hash1.substring(0, 16)}...`);
console.log(`  CSV2: ${hash2.substring(0, 16)}...`);
console.log('');
console.log('關鍵欄位 Hash (outcomeId, winAmount, state, eventsJson):');
console.log(`  CSV1: ${criticalHash1.substring(0, 16)}...`);
console.log(`  CSV2: ${criticalHash2.substring(0, 16)}...`);
console.log('');

const fullMatch = (hash1 === hash2);
const criticalMatch = (criticalHash1 === criticalHash2);

if (fullMatch) {
  console.log('✅ 完整 CSV 內容完全匹配');
} else {
  console.log('❌ 完整 CSV 內容不匹配');
}

if (criticalMatch) {
  console.log('✅ 關鍵欄位完全匹配');
} else {
  console.log('❌ 關鍵欄位不匹配');
  console.log(`   不匹配行數: ${mismatchCount} / ${minRows}`);
  
  if (mismatches.length > 0) {
    console.log('');
    console.log('前 10 個不匹配行:');
    mismatches.forEach(m => {
      console.log(`  第 ${m.index} 行:`);
      for (const [field, { val1, val2 }] of Object.entries(m.details)) {
        console.log(`    ${field}: "${val1}" vs "${val2}"`);
      }
    });
  }
}

console.log('');

// 清理測試檔案
try {
  fs.unlinkSync(csv1);
  fs.unlinkSync(csv2);
} catch (e) {
  // 忽略清理錯誤
}

if (fullMatch && criticalMatch) {
  console.log('✅ 確定性測試通過：完全匹配');
  process.exit(0);
} else {
  console.log('❌ 確定性測試失敗：存在不匹配');
  process.exit(1);
}
