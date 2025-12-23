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
    file: path.join(__dirname, 'design.json')
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-h' || arg === '--help') {
      console.log(`
Slot Math Simulator MVP v1.0

使用方式:
  node cli.js [options]

選項:
  -n, --spins <number>    設定模擬 Base Spin 次數 (預設 10000)
  -f, --file <path>       指定 JSON 設定檔路徑 (預設 logic/design.json)
  -h, --help              顯示幫助訊息

範例:
  node cli.js -n 50000 -f logic/design.json
  node cli.js --spins 10000
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
    const config = JSON.parse(configData);

    console.log('✅ 設定檔驗證通過');
    console.log('');
    console.log('🚀 開始模擬...');
    console.log('');

    // 執行模擬（不傳入 customBet，使用 JSON 中的 baseBet；不輸出，使用 reporter）
    const simulationData = simulate(configPath, options.spins, null, true);

    // 使用 reporter 輸出優化後的報表
    printReport(
      simulationData.result,
      simulationData.config,
      simulationData.spinDetails,
      simulationData.stateTransitions,
      simulationData.targetBaseSpins,
      configPath
    );
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

// 執行主程式
main();

