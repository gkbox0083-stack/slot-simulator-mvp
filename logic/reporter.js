/**
 * v1.2: 格式化 Grid 顯示（支援 5x3 格式）
 * 
 * ⚠️ 重要：Reporter 僅負責顯示，不得重新判斷中獎與否
 * - 不檢查連線
 * - 不計算賠率
 * - 不驗證盤面合法性
 * - 僅將 grid 資料格式化為視覺輸出
 */
function formatGrid(grid) {
  if (!grid || grid.length === 0) {
    return '[Empty Grid]';
  }
  
  // 5x3 格式範例：
  // [H1] [H1] [H1] [L1] [M2]
  // [M1] [L2] [H2] [M1] [L1]
  // [L1] [M2] [L1] [H1] [M1]
  
  return grid.map(row => 
    row.map(sym => `[${sym}]`).join(' ')
  ).join('\n');
}

// 保留 formatReel 以向後相容（用於舊格式）
function formatReel(symbols) {
  return symbols.map(s => `[${s}]`).join('');
}

/**
 * 報表輸出器
 * 將模擬結果格式化為專業報表
 */

/**
 * 輸出模擬報表
 * @param {Object} result - SimulationResult 物件
 * @param {Object} config - 設定檔物件
 * @param {Array} spinDetails - 前 N 次 Spin 詳細資料
 * @param {Array} stateTransitions - 狀態切換記錄
 * @param {number} targetBaseSpins - 目標 Base Spin 次數
 * @param {string} configPath - 設定檔路徑
 */
function printReport(result, config, spinDetails, stateTransitions, targetBaseSpins, configPath) {
  const baseBet = config.betConfig.baseBet;
  const freeSpinCount = config.featureConfig.freeSpinCount;

  // ========================================================================
  // Header: 模擬參數
  // ========================================================================
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║           Slot Math Simulator v1.2 - 模擬報表                 ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('📋 模擬參數');
  console.log('─'.repeat(60));
  console.log(`  設定檔路徑: ${configPath}`);
  console.log(`  模擬目標: ${targetBaseSpins.toLocaleString()} 次 Base Game Spins`);
  console.log(`  Base Bet: ${baseBet} (讀自 betConfig.baseBet)`);
  console.log(`  Free Spin 次數: ${freeSpinCount}`);
  console.log('');

  // ========================================================================
  // RTP Definition Block
  // ========================================================================
  console.log('📊 RTP 定義');
  console.log('─'.repeat(60));
  console.log('  RTP = Total Win / Total Base Bet (不含 Free Game Spins)');
  console.log('  說明: Free Game 的 Win 計入分子，但 Free Game Spins 不計入分母');
  console.log('');

  // ========================================================================
  // Summary: 關鍵指標
  // ========================================================================
  console.log('📈 關鍵指標');
  console.log('─'.repeat(60));
  console.log(`  RTP: ${result.rtp.toFixed(2)}%`);
  console.log(`  Hit Rate: ${result.hitRate.toFixed(2)}% (僅計算 Base Game 中 Win > 0)`);
  
  // 計算 Max Win
  const maxBaseWin = result.baseGameWin > 0 
    ? Math.max(...Object.values(result.baseOutcomeDistribution)
        .filter(d => d.count > 0)
        .map(d => {
          const outcome = config.outcomeTables.BASE.outcomes.find(o => 
            result.baseOutcomeDistribution[o.id] === d
          );
          return outcome ? outcome.payoutMultiplier * baseBet : 0;
        }))
    : 0;
  const maxFeatureWin = result.featureWin > 0
    ? Math.max(...Object.values(result.freeOutcomeDistribution)
        .filter(d => d.count > 0)
        .map(d => {
          const outcome = config.outcomeTables.FREE.outcomes.find(o => 
            result.freeOutcomeDistribution[o.id] === d
          );
          return outcome ? outcome.payoutMultiplier * baseBet : 0;
        }))
    : 0;
  const maxWin = Math.max(maxBaseWin, maxFeatureWin);
  console.log(`  Max Win: ${maxWin.toFixed(2)}`);

  const triggerRate = result.triggerFrequency;
  console.log(`  Feature Trigger Rate: ${triggerRate.toFixed(2)}% (每 ${(100 / triggerRate).toFixed(1)} 次 Base Spin 觸發一次)`);
  console.log('');

  // ========================================================================
  // Spin Statistics
  // ========================================================================
  console.log('🎰 Spin 統計');
  console.log('─'.repeat(60));
  console.log(`  Base Game Spins: ${result.baseGameSpins.toLocaleString()} (必須等於 ${targetBaseSpins.toLocaleString()})`);
  console.log(`  Free Game Spins: ${result.freeGameSpins.toLocaleString()} (必須等於 ${result.triggerCount} × ${freeSpinCount} = ${result.triggerCount * freeSpinCount})`);
  console.log(`  Total Base Bet: ${result.totalBaseBet.toLocaleString()} (等於 ${result.baseGameSpins.toLocaleString()} × ${baseBet})`);
  console.log(`  Total Win: ${result.totalWin.toLocaleString()}`);
  console.log(`    - Base Game Win: ${result.baseGameWin.toLocaleString()}`);
  console.log(`    - Feature Win: ${result.featureWin.toLocaleString()}`);
  console.log('');

  // ========================================================================
  // Feature Stats
  // ========================================================================
  console.log('🎁 Feature 統計');
  console.log('─'.repeat(60));
  console.log(`  Trigger Count: ${result.triggerCount.toLocaleString()}`);
  const avgFeatureWin = result.freeGameSpins > 0 
    ? result.featureWin / result.freeGameSpins 
    : 0;
  console.log(`  Avg Feature Win per Spin: ${avgFeatureWin.toFixed(2)}`);
  console.log('');

  // ========================================================================
  // Distribution Tables
  // ========================================================================
  
  // BASE Game Distribution (v1.1: 加入 Gap 統計)
  console.log('📊 BASE Game Outcome 分布');
  console.log('─'.repeat(100));
  console.log('  ' + [
    'Name'.padEnd(20),
    'Type'.padEnd(10),
    'Weight'.padStart(8),
    'Count'.padStart(10),
    'Freq%'.padStart(10),
    'Avg Gap'.padStart(10),
    'Med Gap'.padStart(10),
    'Max Gap'.padStart(10),
    'RTP Contrib.%'.padStart(15)
  ].join(' | '));
  console.log('  ' + '─'.repeat(100));

  const baseTotalWeight = config.outcomeTables.BASE.outcomes.reduce(
    (sum, outcome) => sum + outcome.weight, 0
  );

  config.outcomeTables.BASE.outcomes.forEach(outcome => {
    const dist = result.baseOutcomeDistribution[outcome.id];
    const rtpContrib = result.totalBaseBet > 0
      ? ((outcome.payoutMultiplier * baseBet * dist.count) / result.totalBaseBet) * 100
      : 0;

    // v1.1: Gap 統計格式化
    const avgGapDisplay = dist.avgGap !== null 
      ? dist.avgGap.toFixed(2).padStart(10) 
      : 'N/A'.padStart(10);
    const medianGapDisplay = dist.medianGap !== null 
      ? dist.medianGap.toFixed(2).padStart(10) 
      : 'N/A'.padStart(10);
    const maxGapDisplay = dist.maxGap !== null 
      ? String(dist.maxGap).padStart(10) 
      : 'N/A'.padStart(10);

    console.log('  ' + [
      outcome.id.padEnd(20),
      outcome.type.padEnd(10),
      String(outcome.weight).padStart(8),
      dist.count.toLocaleString().padStart(10),
      dist.percentage.toFixed(2).padStart(10),
      avgGapDisplay,
      medianGapDisplay,
      maxGapDisplay,
      rtpContrib.toFixed(2).padStart(15)
    ].join(' | '));
  });
  console.log('');

  // FREE Game Distribution (v1.1: Gap 永遠為 N/A)
  console.log('📊 FREE Game Outcome 分布');
  console.log('─'.repeat(100));
  console.log('  ' + [
    'Name'.padEnd(20),
    'Type'.padEnd(10),
    'Weight'.padStart(8),
    'Count'.padStart(10),
    'Freq%'.padStart(10),
    'Avg Gap'.padStart(10),
    'Med Gap'.padStart(10),
    'Max Gap'.padStart(10),
    'RTP Contrib.%'.padStart(15)
  ].join(' | '));
  console.log('  ' + '─'.repeat(100));

  const freeTotalWeight = config.outcomeTables.FREE.outcomes.reduce(
    (sum, outcome) => sum + outcome.weight, 0
  );

  config.outcomeTables.FREE.outcomes.forEach(outcome => {
    const dist = result.freeOutcomeDistribution[outcome.id];
    const rtpContrib = result.totalBaseBet > 0
      ? ((outcome.payoutMultiplier * baseBet * dist.count) / result.totalBaseBet) * 100
      : 0;

    // v1.1: FREE 狀態的 Gap 永遠顯示 N/A
    console.log('  ' + [
      outcome.id.padEnd(20),
      outcome.type.padEnd(10),
      String(outcome.weight).padStart(8),
      dist.count.toLocaleString().padStart(10),
      dist.percentage.toFixed(2).padStart(10),
      'N/A'.padStart(10),
      'N/A'.padStart(10),
      'N/A'.padStart(10),
      rtpContrib.toFixed(2).padStart(15)
    ].join(' | '));
  });
  console.log('');

  // ========================================================================
  // 前 20 次詳細結果（可選）
  // ========================================================================
  if (spinDetails.length > 0) {
    console.log('📝 前 20 次模擬 Spin 詳細結果');
    console.log('─'.repeat(60));
    spinDetails.forEach((detail, index) => {
      // v1.2 Update: 使用 patternResult 而非 pattern
      const gridDisplay = detail.patternResult 
        ? formatGrid(detail.patternResult.grid) 
        : '[No Grid Data]';

      const winLineInfo = (detail.patternResult && detail.patternResult.winLine !== null)
        ? ` | Win Line: ${detail.patternResult.winLine + 1}`
        : '';

      const stateLabel = detail.state === 'BASE' ? 'BASE' : 'FREE';
      const baseSpinLabel = detail.baseSpin !== null 
        ? `[Base #${detail.baseSpin}]` 
        : '[Free]';
      const outcomeInfo = `${detail.outcome.id} (${detail.outcome.type})`;
      const winInfo = detail.winAmount > 0 
        ? `Win: ${detail.winAmount}` 
        : 'Win: 0';
      const freeSpinsInfo = detail.stateAfter === 'FREE' 
        ? ` | Free Spins: ${detail.freeSpinsRemaining}` 
        : '';
      const transitionInfo = detail.stateChanged
        ? (detail.state === 'BASE' && detail.stateAfter === 'FREE' 
            ? ' >>> Enter Free Game' 
            : ' <<< Back to Base')
        : '';

      // 輸出格式：Header → Grid → Info
      console.log(`  #${String(index + 1).padStart(2)} ${baseSpinLabel} [${stateLabel}]:`);
      console.log(`  ${gridDisplay.split('\n').join('\n  ')}`);
      console.log(`  → ${outcomeInfo} - ${winInfo}${winLineInfo}${freeSpinsInfo}${transitionInfo}`);
      console.log('');
    });
    console.log('');
  }

  // ========================================================================
  // Footer
  // ========================================================================
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                      模擬完成                                  ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
}

module.exports = {
  printReport
};

