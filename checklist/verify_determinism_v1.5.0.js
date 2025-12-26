const fs = require('fs');

/**
 * v1.5.0 Determinism Verification Script
 * 
 * 驗證相同 seed 產生相同的 outcome 序列
 */

const args = process.argv.slice(2);
let spins = 2000;
let window = 2500;
let seed = null;

// 解析參數
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--spins' && i + 1 < args.length) {
    spins = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--window' && i + 1 < args.length) {
    window = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--seed' && i + 1 < args.length) {
    seed = parseInt(args[i + 1], 10);
    i++;
  }
}

if (seed === null) {
  console.error('❌ 錯誤: 必須指定 --seed 參數');
  console.error('使用方式: node checklist/verify_determinism_v1.5.0.js --spins 2000 --window 2500 --seed 12345');
  process.exit(1);
}

console.log('='.repeat(60));
console.log('v1.5.0 Determinism Verification');
console.log('='.repeat(60));
console.log(`Spins: ${spins}`);
console.log(`Window: ${window}`);
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
  if (lines.length < 2) return [];
  
  const header = lines[0].split(',');
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
const outcomeIdIdx1 = getIndex('outcomeId', csv1Data.header);
const outcomeIdIdx2 = getIndex('outcomeId', csv2Data.header);
const winAmountIdx1 = getIndex('winAmount', csv1Data.header);
const winAmountIdx2 = getIndex('winAmount', csv2Data.header);

if (outcomeIdIdx1 === -1 || outcomeIdIdx2 === -1) {
  console.error('❌ CSV 缺少 outcomeId 欄位');
  process.exit(1);
}

// 比較 outcomeId 序列
const compareWindow = Math.min(window, csv1Data.rows.length, csv2Data.rows.length);
let mismatchCount = 0;
const mismatches = [];

for (let i = 0; i < compareWindow; i++) {
  const outcomeId1 = csv1Data.rows[i][outcomeIdIdx1];
  const outcomeId2 = csv2Data.rows[i][outcomeIdIdx2];
  const winAmount1 = csv1Data.rows[i][winAmountIdx1];
  const winAmount2 = csv2Data.rows[i][winAmountIdx2];
  
  if (outcomeId1 !== outcomeId2 || winAmount1 !== winAmount2) {
    mismatchCount++;
    if (mismatches.length < 10) {
      mismatches.push({
        index: i + 1,
        outcomeId1,
        outcomeId2,
        winAmount1,
        winAmount2
      });
    }
  }
}

console.log('='.repeat(60));
console.log('比較結果');
console.log('='.repeat(60));
console.log(`比較範圍: 前 ${compareWindow} 筆資料`);
console.log(`不匹配數量: ${mismatchCount}`);

if (mismatchCount === 0) {
  console.log('✅ 完全匹配：相同 seed 產生相同的 outcome 序列');
} else {
  console.log(`❌ 有 ${mismatchCount} 個不匹配`);
  console.log('');
  console.log('前 10 個不匹配:');
  mismatches.forEach(m => {
    console.log(`  第 ${m.index} 筆: outcomeId ${m.outcomeId1} vs ${m.outcomeId2}, winAmount ${m.winAmount1} vs ${m.winAmount2}`);
  });
}

console.log('');

// 清理測試檔案
try {
  fs.unlinkSync(csv1);
  fs.unlinkSync(csv2);
} catch (e) {
  // 忽略清理錯誤
}

if (mismatchCount === 0) {
  console.log('✅ 確定性測試通過');
  process.exit(0);
} else {
  console.log('❌ 確定性測試失敗');
  process.exit(1);
}
