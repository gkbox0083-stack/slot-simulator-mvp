const fs = require('fs');

/**
 * JSON 設定檔驗證器
 * 在執行模擬前進行完整性檢查
 */

/**
 * 驗證結果
 */
class ValidationResult {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  hasErrors() {
    return this.errors.length > 0;
  }

  addError(message) {
    this.errors.push(message);
  }

  addWarning(message) {
    this.warnings.push(message);
  }
}

/**
 * 驗證 JSON 設定檔
 * @param {string} configPath - 設定檔路徑
 * @returns {ValidationResult} 驗證結果
 */
function validateConfig(configPath) {
  const result = new ValidationResult();

  // 讀取檔案
  let config;
  try {
    const configData = fs.readFileSync(configPath, 'utf8');
    config = JSON.parse(configData);
  } catch (error) {
    result.addError(`無法讀取或解析 JSON 檔案: ${error.message}`);
    return result;
  }

  // ========================================================================
  // [ERROR] Critical Structure: 檢查必要的 keys
  // ========================================================================
  if (!config.outcomeTables) {
    result.addError('缺少必要欄位: outcomeTables');
  } else {
    if (!config.outcomeTables.BASE) {
      result.addError('缺少必要欄位: outcomeTables.BASE');
    }
    if (!config.outcomeTables.FREE) {
      result.addError('缺少必要欄位: outcomeTables.FREE');
    }
  }

  if (!config.betConfig) {
    result.addError('缺少必要欄位: betConfig');
  } else {
    if (typeof config.betConfig.baseBet !== 'number') {
      result.addError('betConfig.baseBet 必須為數字');
    }
  }

  if (!config.featureConfig) {
    result.addError('缺少必要欄位: featureConfig');
  } else {
    if (typeof config.featureConfig.freeSpinCount !== 'number') {
      result.addError('featureConfig.freeSpinCount 必須為數字');
    }
    if (config.featureConfig.freeSpinCount <= 0) {
      result.addError('featureConfig.freeSpinCount 必須大於 0');
    }
  }

  // 如果結構錯誤，不繼續檢查
  if (result.hasErrors()) {
    return result;
  }

  // ========================================================================
  // [ERROR] Integrity: 檢查每個 Outcome ID 是否在 patterns 中有定義
  // ========================================================================
  const states = ['BASE', 'FREE'];
  for (const state of states) {
    const outcomeTable = config.outcomeTables[state];
    if (!outcomeTable.outcomes || !outcomeTable.patterns) {
      result.addError(`${state} 狀態缺少 outcomes 或 patterns`);
      continue;
    }

    for (const outcome of outcomeTable.outcomes) {
      if (!outcome.id) {
        result.addError(`${state} 狀態中存在缺少 id 的 Outcome`);
        continue;
      }

      if (!outcomeTable.patterns[outcome.id]) {
        result.addError(`${state} 狀態中的 Outcome "${outcome.id}" 在 patterns 中沒有對應的定義`);
      } else if (!Array.isArray(outcomeTable.patterns[outcome.id])) {
        result.addError(`${state} 狀態中的 Outcome "${outcome.id}" 的 patterns 必須為陣列`);
      } else if (outcomeTable.patterns[outcome.id].length === 0) {
        result.addError(`${state} 狀態中的 Outcome "${outcome.id}" 的 patterns 陣列為空`);
      }
    }
  }

  // ========================================================================
  // [ERROR] Zero Weight: 檢查總權重是否為 0
  // ========================================================================
  for (const state of states) {
    const outcomeTable = config.outcomeTables[state];
    if (!outcomeTable.outcomes) continue;

    const totalWeight = outcomeTable.outcomes.reduce((sum, outcome) => {
      if (typeof outcome.weight !== 'number' || outcome.weight < 0) {
        result.addError(`${state} 狀態中存在無效的 weight 值`);
        return sum;
      }
      return sum + outcome.weight;
    }, 0);

    if (totalWeight === 0) {
      result.addError(`${state} 狀態的總權重為 0，這會導致 RNG 錯誤`);
    }
  }

  // ========================================================================
  // [WARNING] Logic Check: 檢查 type: WIN 的 Outcome，其 Pattern 是否包含 isWin: true
  // ========================================================================
  for (const state of states) {
    const outcomeTable = config.outcomeTables[state];
    if (!outcomeTable.outcomes || !outcomeTable.patterns) continue;

    for (const outcome of outcomeTable.outcomes) {
      if (outcome.type === 'WIN') {
        const patterns = outcomeTable.patterns[outcome.id];
        if (patterns && Array.isArray(patterns)) {
          const hasWinPattern = patterns.some(p => p.isWin === true);
          if (!hasWinPattern) {
            result.addWarning(
              `${state} 狀態中的 Outcome "${outcome.id}" 類型為 WIN，但所有 Pattern 的 isWin 皆為 false。可能為 Near Miss 設定。`
            );
          }
        }
      }
    }
  }

  return result;
}

/**
 * 輸出驗證結果
 * @param {ValidationResult} result - 驗證結果
 */
function printValidationResult(result) {
  if (result.warnings.length > 0) {
    console.log('\n⚠️  警告訊息:');
    console.log('─'.repeat(60));
    result.warnings.forEach((warning, index) => {
      console.log(`  ${index + 1}. ${warning}`);
    });
    console.log('');
  }

  if (result.hasErrors()) {
    console.log('❌ 錯誤訊息:');
    console.log('─'.repeat(60));
    result.errors.forEach((error, index) => {
      console.log(`  ${index + 1}. ${error}`);
    });
    console.log('');
  }
}

module.exports = {
  validateConfig,
  printValidationResult,
  ValidationResult
};

