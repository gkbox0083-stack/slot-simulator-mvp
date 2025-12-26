#!/usr/bin/env node
/**
 * Branch A P0 Gate - 總入口驗證腳本
 * 
 * 整合所有 P0 級別的驗證，確保進入 v1.5.1+ 開發前的架構完整性
 * 
 * 驗證項目：
 * 1. Acceptance verifier（結構/欄位/單點評估等）
 * 2. Determinism Gate（seed=12345 與 seed=0）
 * 3. Legacy Random Gate（不帶 seed 連跑兩次，hash 必須不同）
 * 4. No Stray Math.random Gate
 * 5. Single Evaluation Point Gate
 * 6. Seed Derivation Centralization Gate（P0-7）
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

// 解析參數
const args = process.argv.slice(2);
let spins = 2000;
let seed1 = 12345;
let seed2 = 0;
let workdir = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--spins' && i + 1 < args.length) {
    spins = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--seed1' && i + 1 < args.length) {
    seed1 = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--seed2' && i + 1 < args.length) {
    seed2 = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--workdir' && i + 1 < args.length) {
    workdir = args[i + 1];
    i++;
  }
}

// 設定工作目錄（用於臨時 CSV）
if (!workdir) {
  workdir = path.join(require('os').tmpdir(), 'branch_a_gate');
}
if (!fs.existsSync(workdir)) {
  fs.mkdirSync(workdir, { recursive: true });
}

const projectRoot = path.resolve(__dirname, '../..');
const logicPath = path.join(projectRoot, 'logic');

console.log('='.repeat(60));
console.log('Branch A P0 Gate - 總入口驗證');
console.log('='.repeat(60));
console.log(`Spins: ${spins}`);
console.log(`Seed1: ${seed1}, Seed2: ${seed2}`);
console.log(`Workdir: ${workdir}`);
console.log('');

let allPassed = true;
const results = [];

// ========================================================================
// Gate 1: Acceptance Verifier
// ========================================================================
function gate1_acceptance() {
  console.log('[Gate 1] Acceptance Verifier...');
  try {
    const acceptanceScript = path.join(projectRoot, 'checklist', 'acceptance', 'verify_v1.5.0_v2.js');
    if (!fs.existsSync(acceptanceScript)) {
      throw new Error(`Acceptance verifier not found: ${acceptanceScript}`);
    }
    
    // 先執行一次模擬生成 CSV（acceptance verifier 需要）
    const csvPath = path.join(projectRoot, 'result_v1.5.0_checklist.csv');
    console.log('  生成 CSV 檔案...');
    execSync(`node ${path.join(logicPath, 'cli.js')} -n ${spins} --csv ${csvPath} --seed ${seed1}`, {
      cwd: projectRoot,
      stdio: 'pipe'
    });
    
    // 執行 acceptance verifier（它會讀取 result_v1.5.0_checklist.csv）
    execSync(`node ${acceptanceScript}`, {
      cwd: projectRoot,
      stdio: 'inherit'
    });
    
    results.push({ gate: 'Gate 1: Acceptance Verifier', status: 'PASS' });
    console.log('✅ Gate 1: PASS\n');
    return true;
  } catch (error) {
    results.push({ gate: 'Gate 1: Acceptance Verifier', status: 'FAIL', error: error.message });
    console.log('❌ Gate 1: FAIL');
    console.log(`   原因: ${error.message}\n`);
    return false;
  }
}

// ========================================================================
// Gate 2: Determinism Gate
// ========================================================================
function gate2_determinism() {
  console.log('[Gate 2] Determinism Gate...');
  try {
    const determinismScript = path.join(projectRoot, 'checklist', 'determinism', 'verify_determinism_v1.5.0.js');
    if (!fs.existsSync(determinismScript)) {
      throw new Error(`Determinism verifier not found: ${determinismScript}`);
    }
    
    // Test seed1
    console.log(`  測試 seed=${seed1}...`);
    execSync(`node ${determinismScript} --spins ${spins} --seed ${seed1}`, {
      cwd: projectRoot,
      stdio: 'pipe'
    });
    
    // Test seed2
    console.log(`  測試 seed=${seed2}...`);
    execSync(`node ${determinismScript} --spins ${spins} --seed ${seed2}`, {
      cwd: projectRoot,
      stdio: 'pipe'
    });
    
    results.push({ gate: 'Gate 2: Determinism Gate', status: 'PASS' });
    console.log('✅ Gate 2: PASS\n');
    return true;
  } catch (error) {
    results.push({ gate: 'Gate 2: Determinism Gate', status: 'FAIL', error: error.message });
    console.log('❌ Gate 2: FAIL');
    console.log(`   原因: ${error.message}\n`);
    return false;
  }
}

// ========================================================================
// Gate 3: Legacy Random Gate
// ========================================================================
function gate3_legacyRandom() {
  console.log('[Gate 3] Legacy Random Gate...');
  try {
    const csv1 = path.join(workdir, 'legacy_run1.csv');
    const csv2 = path.join(workdir, 'legacy_run2.csv');
    
    // Run 1 (no seed)
    console.log('  執行第一次（無 seed）...');
    execSync(`node ${path.join(logicPath, 'cli.js')} -n ${spins} --csv ${csv1}`, {
      cwd: projectRoot,
      stdio: 'pipe'
    });
    
    // Run 2 (no seed)
    console.log('  執行第二次（無 seed）...');
    execSync(`node ${path.join(logicPath, 'cli.js')} -n ${spins} --csv ${csv2}`, {
      cwd: projectRoot,
      stdio: 'pipe'
    });
    
    // Compare hashes
    const hash1 = crypto.createHash('sha256').update(fs.readFileSync(csv1, 'utf8')).digest('hex');
    const hash2 = crypto.createHash('sha256').update(fs.readFileSync(csv2, 'utf8')).digest('hex');
    
    if (hash1 === hash2) {
      throw new Error('Legacy mode 兩次執行產生相同的 CSV hash（應該不同）');
    }
    
    results.push({ gate: 'Gate 3: Legacy Random Gate', status: 'PASS' });
    console.log('✅ Gate 3: PASS\n');
    return true;
  } catch (error) {
    results.push({ gate: 'Gate 3: Legacy Random Gate', status: 'FAIL', error: error.message });
    console.log('❌ Gate 3: FAIL');
    console.log(`   原因: ${error.message}\n`);
    return false;
  }
}

// ========================================================================
// Gate 4: No Stray Math.random Gate
// ========================================================================
function gate4_noStrayMathRandom() {
  console.log('[Gate 4] No Stray Math.random Gate...');
  try {
    const excludeDirs = ['node_modules', 'dist', 'build', '.git', 'checklist'];
    const matches = [];
    
    function scanDir(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(projectRoot, fullPath);
        
        if (entry.isDirectory()) {
          const dirName = entry.name;
          if (!excludeDirs.includes(dirName) && !dirName.startsWith('.')) {
            scanDir(fullPath);
          }
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
          const content = fs.readFileSync(fullPath, 'utf8');
          const lines = content.split('\n');
          
          lines.forEach((line, index) => {
            const trimmedLine = line.trim();
            // 跳過註解行
            if (trimmedLine.startsWith('//') || trimmedLine.startsWith('*') || trimmedLine.startsWith('/**')) {
              return;
            }
            
            if (line.includes('Math.random(')) {
              // 檢查是否在 rng.js 的 legacy 分支（實際程式碼）
              const isRngLegacy = relPath.includes('rng.js') && 
                                  (line.includes('return Math.random()') || 
                                   (line.includes('Math.random()') && line.includes('legacy')));
              
              if (!isRngLegacy) {
                matches.push({
                  file: relPath,
                  line: index + 1,
                  content: line.trim()
                });
              }
            }
          });
        }
      }
    }
    
    scanDir(projectRoot);
    
    if (matches.length > 0) {
      console.log('  發現 stray Math.random() 使用：');
      matches.forEach(m => {
        console.log(`    ${m.file}:${m.line} - ${m.content.substring(0, 60)}...`);
      });
      throw new Error(`發現 ${matches.length} 個 stray Math.random() 使用（只允許在 logic/rng.js 的 legacy 分支）`);
    }
    
    results.push({ gate: 'Gate 4: No Stray Math.random Gate', status: 'PASS' });
    console.log('✅ Gate 4: PASS\n');
    return true;
  } catch (error) {
    results.push({ gate: 'Gate 4: No Stray Math.random Gate', status: 'FAIL', error: error.message });
    console.log('❌ Gate 4: FAIL');
    console.log(`   原因: ${error.message}\n`);
    return false;
  }
}

// ========================================================================
// Gate 5: Single Evaluation Point Gate
// ========================================================================
function gate5_singleEvaluationPoint() {
  console.log('[Gate 5] Single Evaluation Point Gate...');
  try {
    const excludeDirs = ['node_modules', 'dist', 'build', '.git', 'checklist'];
    const matches = [];
    
    function scanDir(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(projectRoot, fullPath);
        
        if (entry.isDirectory()) {
          const dirName = entry.name;
          if (!excludeDirs.includes(dirName) && !dirName.startsWith('.')) {
            scanDir(fullPath);
          }
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
          const content = fs.readFileSync(fullPath, 'utf8');
          const lines = content.split('\n');
          
          lines.forEach((line, index) => {
            // 檢查 .evaluate( 或 payRuleEvaluator
            if (line.includes('.evaluate(') || line.includes('payRuleEvaluator')) {
              const isSimulate = relPath.includes('simulate.js');
              const isComment = line.trim().startsWith('//') || line.trim().startsWith('*');
              
              if (!isSimulate && !isComment) {
                matches.push({
                  file: relPath,
                  line: index + 1,
                  content: line.trim()
                });
              }
            }
          });
        }
      }
    }
    
    scanDir(projectRoot);
    
    // 檢查 simulate.js 是否有 evaluate 調用
    const simulatePath = path.join(logicPath, 'simulate.js');
    if (fs.existsSync(simulatePath)) {
      const simulateContent = fs.readFileSync(simulatePath, 'utf8');
      if (!simulateContent.includes('.evaluate(')) {
        throw new Error('simulate.js 中未找到 .evaluate() 調用（Single Evaluation Point 要求）');
      }
    }
    
    if (matches.length > 0) {
      console.log('  發現非 simulate.js 的 evaluator 調用：');
      matches.forEach(m => {
        console.log(`    ${m.file}:${m.line} - ${m.content.substring(0, 60)}...`);
      });
      throw new Error(`發現 ${matches.length} 個非 simulate.js 的 evaluator 調用（只允許在 logic/simulate.js）`);
    }
    
    results.push({ gate: 'Gate 5: Single Evaluation Point Gate', status: 'PASS' });
    console.log('✅ Gate 5: PASS\n');
    return true;
  } catch (error) {
    results.push({ gate: 'Gate 5: Single Evaluation Point Gate', status: 'FAIL', error: error.message });
    console.log('❌ Gate 5: FAIL');
    console.log(`   原因: ${error.message}\n`);
    return false;
  }
}

// ========================================================================
// Gate 6: Seed Derivation Centralization Gate (P0-7)
// ========================================================================
function gate6_seedDerivation() {
  console.log('[Gate 6] Seed Derivation Centralization Gate (P0-7)...');
  try {
    const requiredFiles = {
      'logic/patternGenerator.js': { kind: 'PATTERN', method: '_derivePatternSeed' },
      'logic/visualConstraint.js': { kind: 'VISUAL', method: '_deriveVisualSeed' }
    };
    
    // 禁止的模式：自定義 hash 邏輯（但不包括方法調用，只檢查實際的 hash 計算）
    const forbiddenPatterns = [
      /let\s+hash\s*=\s*0/,           // let hash = 0
      /const\s+hash\s*=\s*0/,         // const hash = 0
      /var\s+hash\s*=\s*0/,           // var hash = 0
      /hash\s*<<\s*5/,                // hash << 5
      /hash\s*=\s*\(\(hash\s*<<\s*5\)/, // hash = ((hash << 5)
      /hash\s*&\s*hash/,              // hash & hash
      /Math\.abs\(hash\)/             // Math.abs(hash) (在非 rng.js 中)
    ];
    
    // 檢查必要檔案是否使用 RNG.deriveSubSeed
    for (const [filePath, config] of Object.entries(requiredFiles)) {
      const fullPath = path.join(projectRoot, filePath);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`必要檔案不存在: ${filePath}`);
      }
      
      const content = fs.readFileSync(fullPath, 'utf8');
      
      // 檢查是否使用 RNG.deriveSubSeed
      if (!content.includes(`RNG.deriveSubSeed('${config.kind}'`)) {
        throw new Error(`${filePath} 未使用 RNG.deriveSubSeed('${config.kind}', ...)`);
      }
      
      // 檢查是否有自定義 hash 邏輯（除了在 rng.js 中）
      if (filePath !== 'logic/rng.js') {
        const lines = content.split('\n');
        lines.forEach((line, index) => {
          const trimmedLine = line.trim();
          // 跳過註解行
          if (trimmedLine.startsWith('//') || trimmedLine.startsWith('*') || trimmedLine.startsWith('/**')) {
            return;
          }
          
          // 檢查是否使用 RNG.deriveSubSeed（如果使用則允許，因為這是集中化 API）
          if (line.includes('RNG.deriveSubSeed')) {
            return;
          }
          
          // 檢查是否有自定義 hash 邏輯（實際的 hash 計算，不是方法調用）
          for (const pattern of forbiddenPatterns) {
            if (pattern.test(line)) {
              // 如果這行包含 RNG.deriveSubSeed，則允許（因為是調用集中化 API）
              if (line.includes('RNG.deriveSubSeed')) {
                continue;
              }
              throw new Error(`${filePath}:${index + 1} 發現自定義 seed/hash 推導邏輯（應使用 RNG.deriveSubSeed）\n    內容: ${line.trim()}`);
            }
          }
        });
      }
    }
    
    results.push({ gate: 'Gate 6: Seed Derivation Centralization Gate', status: 'PASS' });
    console.log('✅ Gate 6: PASS\n');
    return true;
  } catch (error) {
    results.push({ gate: 'Gate 6: Seed Derivation Centralization Gate', status: 'FAIL', error: error.message });
    console.log('❌ Gate 6: FAIL');
    console.log(`   原因: ${error.message}\n`);
    return false;
  }
}

// ========================================================================
// 主執行流程
// ========================================================================
console.log('開始執行 Branch A P0 Gate 驗證...\n');

allPassed = allPassed && gate1_acceptance();
allPassed = allPassed && gate2_determinism();
allPassed = allPassed && gate3_legacyRandom();
allPassed = allPassed && gate4_noStrayMathRandom();
allPassed = allPassed && gate5_singleEvaluationPoint();
allPassed = allPassed && gate6_seedDerivation();

// ========================================================================
// 總結
// ========================================================================
console.log('='.repeat(60));
console.log('Branch A P0 Gate - 驗證結果');
console.log('='.repeat(60));

results.forEach(r => {
  if (r.status === 'PASS') {
    console.log(`✅ ${r.gate}`);
  } else {
    console.log(`❌ ${r.gate}`);
    if (r.error) {
      console.log(`   錯誤: ${r.error}`);
    }
  }
});

console.log('');

if (allPassed) {
  console.log('✅ ALL PASS - 可以進入 Branch A 開發');
  process.exit(0);
} else {
  console.log('❌ SOME GATES FAILED - 必須先修復問題才能進入 Branch A 開發');
  process.exit(1);
}

