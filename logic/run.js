const { simulate } = require('./simulate');
const path = require('path');

/**
 * 進入點：執行模擬並處理錯誤
 */
function main() {
  try {
    const configPath = path.join(__dirname, 'design.json');
    
    // 從命令列參數讀取設定（可選）
    const targetBaseSpins = parseInt(process.argv[2]) || 10000;
    // customBet: 如果提供則使用，否則使用 design.json 中的 betConfig.baseBet
    const customBet = process.argv[3] ? parseFloat(process.argv[3]) : null;
    
    // 執行模擬（符合 Core Spec v1.0）
    // 模擬直到 Base Game Spins 達到目標
    simulate(configPath, targetBaseSpins, customBet);
    
  } catch (error) {
    console.error('執行模擬時發生錯誤:');
    console.error(error.message);
    if (error.stack) {
      console.error('\n堆疊追蹤:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// 執行主程式
main();

