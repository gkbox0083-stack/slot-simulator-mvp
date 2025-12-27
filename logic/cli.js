#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { simulate } = require('./simulate');
const { validateConfig, printValidationResult } = require('./validator');
const { printReport } = require('./reporter');

/**
 * Slot Math Simulator MVP v1.0 - CLI 工具
 * 
 * 使用方式:
 *   node cli.js [options]
 * 
 * 選項:
 *   -n, --spins <number>    設定模擬 Base Spin 次數 (預設 10000)
 *   -f, --file <path>       指定 JSON 設定檔路徑 (預設 logic/design.json)
 *   -h, --help              顯示幫助訊息
 */

/**
 * 解析命令列參數
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    spins: 10000,
    file: path.join(__dirname, 'design.json'),
    csv: {
      enabled: false,
      path: null
    },
    noVisual: false,  // v1.3: 支援 --no-visual 參數
    seed: null  // Determinism: 支援 --seed 參數
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-h' || arg === '--help') {
      console.log(`
Slot Math Simulator v1.1

使用方式:
  node cli.js [options]

選項:
  -n, --spins <number>    設定模擬 Base Spin 次數 (預設 10000)
  -f, --file <path>       指定 JSON 設定檔路徑 (預設 logic/design.json)
  --csv [filename]        匯出逐 Spin 詳細記錄到 CSV 檔案 (可選檔案名，預設 result.csv)
  --seed <int>            設定 RNG seed 以確保可重現性 (非負整數，>= 0)
  --no-visual             關閉 Visual Constraint Layer (v1.3)
  -h, --help              顯示幫助訊息

範例:
  node cli.js -n 50000 -f logic/design.json
  node cli.js --spins 10000 --csv result.csv
  node cli.js --csv output/data.csv
  node cli.js -n 2000 --csv --seed 12345
  node cli.js --csv --seed 12345
      `);
      process.exit(0);
    }

    if (arg === '-n' || arg === '--spins') {
      if (i + 1 >= args.length) {
        console.error('❌ 錯誤: --spins 參數需要一個數值');
        process.exit(1);
      }
      const spins = parseInt(args[i + 1], 10);
      if (isNaN(spins) || spins <= 0 || !Number.isInteger(spins)) {
        console.error('❌ 錯誤: --spins 必須為正整數');
        process.exit(1);
      }
      options.spins = spins;
      i++;
    } else if (arg === '-f' || arg === '--file') {
      if (i + 1 >= args.length) {
        console.error('❌ 錯誤: --file 參數需要一個路徑');
        process.exit(1);
      }
      options.file = args[i + 1];
      i++;
    } else if (arg === '--csv') {
      // Determinism Fix: --csv 作為可選的 boolean flag
      // 如果下一個參數存在且不是以 '-' 開頭，則作為檔案路徑
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        options.csv.enabled = true;
        options.csv.path = args[i + 1];
        i++;
      } else {
        // 沒有提供檔案名，使用預設值
        options.csv.enabled = true;
        options.csv.path = 'result.csv';
      }
    } else if (arg === '--seed') {
      // Determinism: 支援 --seed 參數
      if (i + 1 >= args.length) {
        console.error('❌ 錯誤: --seed 參數需要一個整數值');
        process.exit(1);
      }
      const seedValue = args[i + 1];
      // 檢查是否為整數（允許 0 或正整數）
      const seedInt = parseInt(seedValue, 10);
      if (isNaN(seedInt) || seedInt < 0 || !Number.isInteger(seedInt)) {
        console.error('❌ 錯誤: --seed 必須為非負整數 (>= 0)');
        process.exit(1);
      }
      options.seed = seedInt;
      i++;
    } else if (arg === '--no-visual') {
      // v1.3: 關閉 Visual Constraint Layer
      options.noVisual = true;
    }
  }

  return options;
}

/**
 * 主程式
 */
function main() {
  try {
    // 解析參數
    const options = parseArgs();

    // 檢查檔案是否存在
    if (!fs.existsSync(options.file)) {
      console.error(`❌ 錯誤: 找不到設定檔: ${options.file}`);
      process.exit(1);
    }

    // 將相對路徑轉換為絕對路徑
    const configPath = path.isAbsolute(options.file) 
      ? options.file 
      : path.resolve(process.cwd(), options.file);

    console.log('🔍 正在驗證設定檔...');
    console.log('');

    // 驗證設定檔
    const validationResult = validateConfig(configPath);
    printValidationResult(validationResult);

    // 如果有錯誤，終止執行
    if (validationResult.hasErrors()) {
      console.error('❌ 設定檔驗證失敗，請修正錯誤後重試');
      process.exit(1);
    }

    // 讀取設定檔
    const configData = fs.readFileSync(configPath, 'utf8');
    let config = JSON.parse(configData);  // 改為 let，因為可能需要修改

    // v1.3: 如果指定 --no-visual，覆蓋 visualConfig.enabled
    if (options.noVisual) {
      if (!config.visualConfig) {
        config.visualConfig = {};
      }
      config.visualConfig.enabled = false;
      console.log('⚠️  Visual Constraint Layer 已關閉 (--no-visual)');
      console.log('');
    }

    // Determinism: 如果指定了 seed，設定到 config 中（用於 RNG 初始化）
    if (options.seed !== null) {
      // 確保 config 是可修改的（深拷貝）
      config = JSON.parse(JSON.stringify(config));
      config.seed = options.seed;
      console.log(`🌱 使用固定 seed: ${options.seed} (deterministic mode)`);
      console.log('');
    }

    console.log('✅ 設定檔驗證通過');
    console.log('');
    console.log('🚀 開始模擬...');
    console.log('');

    // v1.3: 如果修改了 config（如 --no-visual 或 --seed），傳遞修改後的 config
    const overrideConfig = (options.noVisual || options.seed !== null) ? config : null;
    
    // 執行模擬（不傳入 customBet，使用 JSON 中的 baseBet；不輸出，使用 reporter；啟用 CSV）
    // Determinism: 傳遞 seed 參數（如果指定）
    const simulationData = simulate(configPath, options.spins, null, true, options.csv.enabled, overrideConfig, options.seed);

    // 使用 reporter 輸出優化後的報表
    printReport(
      simulationData.result,
      simulationData.config,
      simulationData.spinDetails,
      simulationData.stateTransitions,
      simulationData.targetBaseSpins,
      configPath
    );

    // v1.1: CSV 匯出
    if (options.csv.enabled && simulationData.spinLog) {
      try {
        exportCSV(simulationData.spinLog, options.csv.path);
        const resolvedPath = path.isAbsolute(options.csv.path) 
          ? options.csv.path 
          : path.resolve(process.cwd(), options.csv.path);
        console.log(`✅ CSV 匯出成功: ${resolvedPath}`);
      } catch (error) {
        console.error('❌ CSV 匯出失敗');
        console.error(`   原因: ${error.message}`);
        process.exit(1);
      }
    }
  } catch (error) {
    console.error('❌ 執行時發生錯誤:');
    console.error(`   ${error.message}`);
    if (error.stack) {
      console.error('\n堆疊追蹤:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * v1.1: 匯出 CSV
 * @param {Array} spinLog - Spin 記錄陣列
 * @param {string} csvPath - CSV 檔案路徑
 */
function exportCSV(spinLog, csvPath) {
  // 1. 解析路徑（支援相對/絕對）
  const resolvedPath = path.isAbsolute(csvPath) 
    ? csvPath 
    : path.resolve(process.cwd(), csvPath);
  
  // 2. 自動建立目錄
  const dirname = path.dirname(resolvedPath);
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, { recursive: true });
  }
  
  // 3. 生成 CSV 內容
  const csvContent = generateCSV(spinLog);
  
  // 4. 寫入檔案
  fs.writeFileSync(resolvedPath, csvContent, 'utf8');
}

/**
 * v1.1: 生成 CSV 內容
 * @param {Array} spinLog - Spin 記錄陣列
 * @returns {string} CSV 內容
 */
/**
 * v1.4.patch_tease_diag_fix: CSV 欄位 quoting（標準 CSV 格式）
 * 
 * 處理包含逗號、引號、換行的欄位
 */
function csvEscape(field) {
  if (field === null || field === undefined) {
    return '';
  }
  
  const str = String(field);
  
  // 如果包含逗號、引號或換行，需要 quoting
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    // 將內部引號轉義為雙引號
    const escaped = str.replace(/"/g, '""');
    return `"${escaped}"`;
  }
  
  return str;
}

function generateCSV(spinLog) {
  // v1.5.2: CSV Header（包含所有 telemetry 欄位 + shadow mode 欄位 + FSM/Scatter 欄位）
  // v1.5.3: 新增 Any-Position 欄位
  const header = 'globalSpinIndex,baseSpinIndex,state,outcomeId,type,winAmount,triggeredFeatureId,patternSource,winConditionType,generatedWinLine,anchorsCount,visualRequestedType,visualAppliedType,visualApplied,visualPaylinesChosen,visualAttemptsUsed,visualGuardFailReason,visualSeed,teaseEligible,teaseChanceUsed,teaseRoll,teaseBlockedBy,visualGuardFailDetail,visualAttemptReasons,expectedWinAmount,evaluatedWinAmount,evaluationMatch,evaluatedEventCount,evaluatedRuleTypes,eventsJson,stateBefore,stateAfter,freeRemainingAfter,scatterCount,scatterGuardApplied,scatterAttemptsUsed,scatterFallbackUsed,anyPosSymbolId,anyPosTargetCount,anyPosActualCount,anyPosGuardApplied,anyPosAttemptsUsed,anyPosFallbackUsed';
  
  // CSV Rows
  const rows = spinLog.map(log => {
    // v1.4.patch_tease_diag_fix: visualPaylinesChosen 轉為 pipe-joined string（避免逗號問題）
    const visualPaylinesChosen = Array.isArray(log.visualPaylinesChosen) 
      ? log.visualPaylinesChosen.join('|')
      : (log.visualPaylinesChosen || '');
    
    // v1.4.patch_tease_diag_fix: visualAttemptReasons 已經是字串（在 finalization 中處理）
    const visualAttemptReasons = typeof log.visualAttemptReasons === 'string'
      ? log.visualAttemptReasons
      : (Array.isArray(log.visualAttemptReasons) ? log.visualAttemptReasons.join(';') : '');
    
    const row = [
      csvEscape(log.globalSpinIndex),
      csvEscape(log.baseSpinIndex),
      csvEscape(log.state),
      csvEscape(log.outcomeId),
      csvEscape(log.type),
      csvEscape(log.winAmount),
      csvEscape(log.triggeredFeatureId || ''),  // null 值輸出為空字串
      csvEscape(log.patternSource || 'NONE'),  // v1.4
      csvEscape(log.winConditionType || ''),    // v1.4
      csvEscape(log.generatedWinLine !== null && log.generatedWinLine !== undefined ? log.generatedWinLine : ''),  // v1.4
      csvEscape(log.anchorsCount || 0),  // v1.4
      // Phase A3: Visual Telemetry
      csvEscape(log.visualRequestedType || 'NONE'),
      csvEscape(log.visualAppliedType || 'NONE'),
      csvEscape(log.visualApplied ? 'true' : 'false'),
      csvEscape(visualPaylinesChosen),  // v1.4.patch_tease_diag_fix: pipe-joined
      csvEscape(log.visualAttemptsUsed || 0),
      csvEscape(log.visualGuardFailReason || ''),  // v1.4.patch_tease_diag_fix: 已清理成功案例
      csvEscape(log.visualSeed || ''),
      // v1.4.patch: Tease Probability fields
      csvEscape(log.teaseEligible ? 'true' : 'false'),
      csvEscape(log.teaseChanceUsed !== null && log.teaseChanceUsed !== undefined ? log.teaseChanceUsed : ''),
      csvEscape(log.teaseRoll !== null && log.teaseRoll !== undefined ? log.teaseRoll : ''),
      csvEscape(log.teaseBlockedBy || 'NONE'),
      // v1.4.patch: Guard Diagnostics fields（JSON 字串，需要 quoting）
      csvEscape(log.visualGuardFailDetail || ''),  // v1.4.patch_tease_diag_fix: 已清理成功案例
      csvEscape(visualAttemptReasons),  // v1.4.patch_tease_diag_fix: 已經是字串
      // v1.5.0: Shadow Mode fields
      csvEscape(log.expectedWinAmount !== undefined ? log.expectedWinAmount : ''),
      csvEscape(log.evaluatedWinAmount !== undefined ? log.evaluatedWinAmount : ''),
      csvEscape(log.evaluationMatch !== undefined ? (log.evaluationMatch ? 'true' : 'false') : ''),
      csvEscape(log.evaluatedEventCount !== undefined ? log.evaluatedEventCount : 0),
      csvEscape(log.evaluatedRuleTypes || ''),
      csvEscape(log.eventsJson || ''),  // JSON 字串，需要 quoting
      // v1.5.2: FSM State Telemetry
      csvEscape(log.stateBefore || ''),
      csvEscape(log.stateAfter || ''),
      csvEscape(log.freeRemainingAfter !== undefined ? log.freeRemainingAfter : ''),
      // v1.5.2: Scatter Telemetry
      csvEscape(log.scatterCount !== undefined ? log.scatterCount : 0),
      csvEscape(log.scatterGuardApplied !== undefined ? (log.scatterGuardApplied ? 'true' : 'false') : 'false'),
      csvEscape(log.scatterAttemptsUsed !== undefined ? log.scatterAttemptsUsed : 0),
      csvEscape(log.scatterFallbackUsed !== undefined ? (log.scatterFallbackUsed ? 'true' : 'false') : 'false'),
      // v1.5.3: Any-Position Telemetry
      csvEscape(log.anyPosSymbolId || ''),
      csvEscape(log.anyPosTargetCount !== undefined && log.anyPosTargetCount !== '' ? log.anyPosTargetCount : ''),
      csvEscape(log.anyPosActualCount !== undefined ? log.anyPosActualCount : 0),
      csvEscape(log.anyPosGuardApplied !== undefined ? (log.anyPosGuardApplied ? 'true' : 'false') : 'false'),
      csvEscape(log.anyPosAttemptsUsed !== undefined ? log.anyPosAttemptsUsed : 0),
      csvEscape(log.anyPosFallbackUsed !== undefined ? (log.anyPosFallbackUsed ? 'true' : 'false') : 'false')
    ];
    
    return row.join(',');
  });
  
  return [header, ...rows].join('\n');
}

// 執行主程式
main();

