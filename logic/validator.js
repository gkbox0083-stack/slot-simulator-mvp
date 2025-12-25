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
  // v1.2: [ERROR] 檢查 gameRules 結構
  // ========================================================================
  if (!config.gameRules) {
    result.addError('缺少必要欄位: gameRules');
  } else {
    if (!config.gameRules.BASE) {
      result.addError('缺少必要欄位: gameRules.BASE');
    } else {
      const baseGameRule = config.gameRules.BASE;
      
      // 檢查 grid 定義
      if (!baseGameRule.grid || typeof baseGameRule.grid.rows !== 'number' || typeof baseGameRule.grid.cols !== 'number') {
        result.addError('gameRules.BASE.grid 必須包含 rows 和 cols（數字）');
      }
      
      // 檢查 paylines 定義
      if (!Array.isArray(baseGameRule.paylines) || baseGameRule.paylines.length === 0) {
        result.addError('gameRules.BASE.paylines 必須為非空陣列');
      } else {
        // 驗證 paylines 格式
        baseGameRule.paylines.forEach((payline, index) => {
          if (!Array.isArray(payline)) {
            result.addError(`gameRules.BASE.paylines[${index}] 必須為陣列`);
          } else {
            payline.forEach((pos, posIndex) => {
              if (!Array.isArray(pos) || pos.length !== 2) {
                result.addError(`gameRules.BASE.paylines[${index}][${posIndex}] 必須為 [row, col] 格式`);
              }
            });
          }
        });
      }
    }
  }

  // ========================================================================
  // v1.2: [ERROR] 檢查 WIN 類型的 Outcome 是否包含 winConfig
  // v1.4: [ERROR/WARNING] 檢查 winCondition 結構
  // ========================================================================
  const states = ['BASE', 'FREE'];
  for (const state of states) {
    const outcomeTable = config.outcomeTables[state];
    if (!outcomeTable || !outcomeTable.outcomes) {
      result.addError(`${state} 狀態缺少 outcomes`);
      continue;
    }

    for (const outcome of outcomeTable.outcomes) {
      if (!outcome.id) {
        result.addError(`${state} 狀態中存在缺少 id 的 Outcome`);
        continue;
      }

      // v1.4: 檢查 winCondition 和 legacy patterns 的共存
      const hasWinCondition = !!outcome.winCondition;
      const hasLegacyPattern = !!(outcome.pattern || outcome.patterns);
      
      if (hasWinCondition && hasLegacyPattern) {
        result.addWarning(`${state} 狀態中的 Outcome "${outcome.id}" 同時包含 winCondition 和 legacy patterns，將使用 winCondition`);
      }
      
      // 必修補點 1：只對 WIN 類型要求 pattern 定義
      // LOSS/FEATURE 類型不需要 pattern（由 resolver 自動生成）
      if (outcome.type === 'WIN') {
        if (!hasWinCondition && !hasLegacyPattern) {
          result.addError(`${state} 狀態中的 WIN 類型 Outcome "${outcome.id}" 缺少 pattern 定義（需要 winCondition 或 legacy pattern/patterns）`);
        }
      }
      // LOSS/FEATURE 類型不需要 pattern，不檢查

      // v1.4: 驗證 winCondition 結構
      if (hasWinCondition) {
        if (!outcome.winCondition.type) {
          result.addError(`${state} 狀態中的 Outcome "${outcome.id}" 的 winCondition 缺少 type`);
        } else {
          const wcType = outcome.winCondition.type;
          
          if (wcType === 'LINE') {
            // LINE 類型必須包含 symbolId 和 matchCount
            if (!outcome.winCondition.symbolId) {
              result.addError(`${state} 狀態中的 Outcome "${outcome.id}" 的 winCondition (LINE) 缺少 symbolId`);
            }
            if (typeof outcome.winCondition.matchCount !== 'number') {
              result.addError(`${state} 狀態中的 Outcome "${outcome.id}" 的 winCondition (LINE) 的 matchCount 必須為數字`);
            } else {
              // 檢查 matchCount 是否超過盤面寬度
              if (config.gameRules && config.gameRules.BASE && config.gameRules.BASE.grid) {
                const maxCols = config.gameRules.BASE.grid.cols;
                if (outcome.winCondition.matchCount > maxCols) {
                  result.addError(
                    `${state} 狀態中的 Outcome "${outcome.id}" 的 winCondition.matchCount (${outcome.winCondition.matchCount}) 超過盤面寬度 (${maxCols})`
                  );
                }
                if (outcome.winCondition.matchCount < 2) {
                  result.addWarning(
                    `${state} 狀態中的 Outcome "${outcome.id}" 的 winCondition.matchCount (${outcome.winCondition.matchCount}) 小於 2，可能不合理`
                  );
                }
              }
            }
          } else if (wcType === 'SCATTER') {
            // SCATTER 類型必須包含 symbolId 和 minCount
            if (!outcome.winCondition.symbolId) {
              result.addError(`${state} 狀態中的 Outcome "${outcome.id}" 的 winCondition (SCATTER) 缺少 symbolId`);
            }
            if (typeof outcome.winCondition.minCount !== 'number') {
              result.addError(`${state} 狀態中的 Outcome "${outcome.id}" 的 winCondition (SCATTER) 的 minCount 必須為數字`);
            } else {
              // 檢查 minCount 是否合理
              if (outcome.winCondition.minCount < 2) {
                result.addWarning(
                  `${state} 狀態中的 Outcome "${outcome.id}" 的 winCondition.minCount (${outcome.winCondition.minCount}) 小於 2，可能不合理`
                );
              }
              const gridSize = config.gameRules && config.gameRules.BASE && config.gameRules.BASE.grid
                ? config.gameRules.BASE.grid.rows * config.gameRules.BASE.grid.cols
                : 15;  // 預設 5x3
              if (outcome.winCondition.minCount > gridSize) {
                result.addError(
                  `${state} 狀態中的 Outcome "${outcome.id}" 的 winCondition.minCount (${outcome.winCondition.minCount}) 超過盤面大小 (${gridSize})`
                );
              }
            }
          } else {
            result.addError(`${state} 狀態中的 Outcome "${outcome.id}" 的 winCondition.type 不支援: ${wcType} (僅支援 LINE, SCATTER)`);
          }
        }
      }

      // 檢查 WIN 類型必須包含 winConfig（v1.2 邏輯，保留向後相容）
      if (outcome.type === 'WIN') {
        if (!outcome.winConfig && !hasWinCondition) {
          result.addError(`${state} 狀態中的 WIN 類型 Outcome "${outcome.id}" 缺少 winConfig（且無 winCondition）`);
        } else if (outcome.winConfig) {
          // 檢查 winConfig 結構（僅當存在時）
          if (!outcome.winConfig.symbolId) {
            result.addError(`${state} 狀態中的 Outcome "${outcome.id}" 的 winConfig 缺少 symbolId`);
          }
          if (typeof outcome.winConfig.matchCount !== 'number') {
            result.addError(`${state} 狀態中的 Outcome "${outcome.id}" 的 winConfig.matchCount 必須為數字`);
          } else {
            // 檢查 matchCount 是否超過盤面寬度
            if (config.gameRules && config.gameRules.BASE && config.gameRules.BASE.grid) {
              const maxCols = config.gameRules.BASE.grid.cols;
              if (outcome.winConfig.matchCount > maxCols) {
                result.addError(
                  `${state} 狀態中的 Outcome "${outcome.id}" 的 matchCount (${outcome.winConfig.matchCount}) 超過盤面寬度 (${maxCols})`
                );
              }
              if (outcome.winConfig.matchCount < 2) {
                result.addWarning(
                  `${state} 狀態中的 Outcome "${outcome.id}" 的 matchCount (${outcome.winConfig.matchCount}) 小於 2，可能不合理`
                );
              }
            }
          }
        }
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

  // v1.2: 移除舊的 patterns 檢查（已改用 winConfig）

  // ========================================================================
  // v1.3: [WARNING] 檢查 visualConfig 結構（可選）
  // ========================================================================
  if (config.visualConfig) {
    if (typeof config.visualConfig.enabled !== 'boolean' && config.visualConfig.enabled !== undefined) {
      result.addWarning('visualConfig.enabled 必須為布林值，將使用預設值 true');
    }
    if (config.visualConfig.safeFiller && typeof config.visualConfig.safeFiller !== 'string') {
      result.addWarning('visualConfig.safeFiller 必須為字串，將使用預設值 "L1"');
    }
    if (config.visualConfig.maxRetries !== undefined) {
      if (typeof config.visualConfig.maxRetries !== 'number' || config.visualConfig.maxRetries < 1) {
        result.addWarning('visualConfig.maxRetries 必須為正整數，將使用預設值 10');
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

