const { RNG } = require('./rng');

/**
 * Visual Constraint Engine - v1.3
 * 
 * 核心原則：
 * - 完全隔離 Math RNG（使用獨立的 Visual RNG）
 * - Stateless（不保存跨 Spin 狀態）
 * - 不修改 Outcome、不影響數學結果
 * - 僅改善視覺呈現（消除整列重複、Near Miss 視覺特徵）
 * - 絕對禁止 Accidental Win / 延長中獎
 */
class VisualConstraintEngine {
  constructor(gameRule, symbols, visualConfig) {
    this.gameRule = gameRule;
    this.symbols = symbols;
    this.visualConfig = visualConfig || { enabled: true, safeFiller: 'L1', maxRetries: 10 };
    
    // 驗證 symbols 結構
    if (!symbols || !Array.isArray(symbols)) {
      throw new Error('symbols 必須為陣列');
    }
    
    // 驗證 gameRule
    if (!gameRule || !gameRule.grid || !gameRule.paylines) {
      throw new Error('gameRule 必須包含 grid 和 paylines');
    }
    
    this.rows = gameRule.grid.rows;
    this.cols = gameRule.grid.cols;
  }

  /**
   * 主要介面：應用視覺約束
   * 
   * @param {Array<Array<string>>} grid - 原始 grid（來自 Resolver）
   * @param {Object} outcome - Outcome 物件
   * @param {number|null} winLine - 中獎線索引（null 表示無中獎）
   * @param {Object} context - 必須包含 visualSeed 或 spinIndex
   * @returns {Array<Array<string>>} 處理後的 grid
   * 
   * Critical Rules:
   * 1. 不得修改 winLine 上的中獎符號（WIN Outcome）
   * 2. 不得創造或延長中獎
   * 3. 必須使用獨立的 Visual RNG
   * 4. 必須是 Stateless（每次呼叫都建立新的 RNG）
   */
  applyConstraints(grid, outcome, winLine, context) {
    // 如果 Visual Layer 被關閉，直接返回原始 grid
    if (!this.visualConfig.enabled) {
      return grid;
    }

    // 驗證 context
    if (!context || (context.visualSeed === undefined && context.spinIndex === undefined)) {
      throw new Error('context 必須包含 visualSeed 或 spinIndex');
    }

    // 建立獨立的 Visual RNG（Stateless）
    const visualSeed = context.visualSeed !== undefined 
      ? context.visualSeed 
      : this._deriveVisualSeed(context.spinIndex);
    const visualRng = new RNG(visualSeed);

    // 深拷貝 grid（避免修改原始 grid）
    const processedGrid = grid.map(row => [...row]);

    // 根據 Outcome 類型應用不同的視覺策略
    if (outcome.type === 'WIN') {
      return this._applyWinConstraints(processedGrid, outcome, winLine, visualRng);
    } else if (outcome.type === 'LOSS') {
      return this._applyLossConstraints(processedGrid, outcome, visualRng);
    } else if (outcome.type === 'NEAR_MISS') {
      return this._applyNearMissConstraints(processedGrid, outcome, visualRng);
    } else if (outcome.type === 'FEATURE') {
      // FEATURE 類型暫時不處理（v1.3 MVP）
      return processedGrid;
    }

    return processedGrid;
  }

  /**
   * 處理 WIN Outcome 的視覺約束
   * 
   * 規則：
   * 1. 不得修改 winLine 上的中獎符號（前 matchCount 格）
   * 2. 不得在 winLine 的後續位置填入會延長中獎的符號
   * 3. 消除整列重複（改善視覺自然度）
   */
  _applyWinConstraints(grid, outcome, winLine, visualRng) {
    if (winLine === null || winLine < 0 || winLine >= this.gameRule.paylines.length) {
      return grid;  // 無效的 winLine，不處理
    }

    const payline = this.gameRule.paylines[winLine];
    const matchCount = outcome.winConfig ? outcome.winConfig.matchCount : 0;
    const winSymbol = outcome.winConfig ? outcome.winConfig.symbolId : null;

    // 保護區域：winLine 上的前 matchCount 格不得修改
    const protectedCells = new Set();
    for (let i = 0; i < matchCount && i < payline.length; i++) {
      const [row, col] = payline[i];
      protectedCells.add(`${row},${col}`);
    }

    // 禁止區域：winLine 的後續位置不得填入會延長中獎的符號
    const forbiddenSymbols = new Set();
    if (winSymbol) {
      forbiddenSymbols.add(winSymbol);
      // 如果允許 Wild，也要禁止 Wild
      if (outcome.winConfig.allowWild) {
        const wildSymbol = this.symbols.find(s => s.type === 'WILD');
        if (wildSymbol) {
          forbiddenSymbols.add(wildSymbol.id);
        }
      }
    }

    // 應用視覺改善（消除整列重複、改善符號分布）
    const maxRetries = this.visualConfig.maxRetries || 10;
    for (let retry = 0; retry < maxRetries; retry++) {
      const improvedGrid = this._improveVisualDistribution(
        grid, 
        protectedCells, 
        forbiddenSymbols, 
        payline, 
        matchCount,
        visualRng
      );

      // 驗證：確保沒有創造 Accidental Win
      if (this._validateNoAccidentalWin(improvedGrid, winLine)) {
        return improvedGrid;
      }
    }

    // 如果重試失敗，回退原始 grid
    console.warn(`[VisualConstraint] 無法改善 WIN grid，回退原始 grid: ${outcome.id}`);
    return grid;
  }

  /**
   * 處理 LOSS Outcome 的視覺約束
   * 
   * 規則：
   * 1. 消除整列重複
   * 2. 改善符號分布自然度
   * 3. 絕對不得形成任何中獎
   */
  _applyLossConstraints(grid, outcome, visualRng) {
    const maxRetries = this.visualConfig.maxRetries || 10;

    for (let retry = 0; retry < maxRetries; retry++) {
      const improvedGrid = this._improveVisualDistribution(
        grid,
        new Set(),  // 無保護區域
        new Set(),  // 無禁止符號
        null,       // 無特定 payline
        0,          // 無 matchCount
        visualRng
      );

      // 驗證：確保沒有創造 Accidental Win
      if (this._validateNoAccidentalWin(improvedGrid, null)) {
        return improvedGrid;
      }
    }

    // 如果重試失敗，回退原始 grid
    console.warn(`[VisualConstraint] 無法改善 LOSS grid，回退原始 grid: ${outcome.id}`);
    return grid;
  }

  /**
   * 處理 NEAR_MISS Outcome 的視覺約束
   * 
   * MVP Strategy：
   * 1. 在 Active Payline 前 N-1 格填入高價值符號
   * 2. 在第 N 格強制填入視覺差異明顯的低價值符號
   * 3. 其餘位置使用加權隨機填充
   * 4. 絕對不得形成合法中獎
   */
  _applyNearMissConstraints(grid, outcome, visualRng) {
    // 隨機選擇一條 payline 作為 "Active Payline"
    const activePaylineIndex = visualRng.randomInt(this.gameRule.paylines.length);
    const activePayline = this.gameRule.paylines[activePaylineIndex];

    // 假設 matchCount = 3（Near Miss 通常是 "差一個"）
    const nearMissCount = 3;  // 可以從 outcome 中讀取，目前先固定為 3

    // 獲取高價值符號（HIGH 類型）
    const highValueSymbols = this.symbols.filter(s => s.type === 'HIGH');
    const lowValueSymbols = this.symbols.filter(s => s.type === 'LOW');

    if (highValueSymbols.length === 0 || lowValueSymbols.length === 0) {
      // 如果沒有足夠的符號類型，回退到 LOSS 處理
      return this._applyLossConstraints(grid, outcome, visualRng);
    }

    // 建立新的 grid（深拷貝）
    const nearMissGrid = grid.map(row => [...row]);

    // 在 Active Payline 前 N-1 格填入高價值符號
    for (let i = 0; i < nearMissCount - 1 && i < activePayline.length; i++) {
      const [row, col] = activePayline[i];
      const selectedHighSymbol = visualRng.selectFromArray(highValueSymbols);
      nearMissGrid[row][col] = selectedHighSymbol.id;
    }

    // 在第 N 格強制填入視覺差異明顯的低價值符號
    if (nearMissCount - 1 < activePayline.length) {
      const [row, col] = activePayline[nearMissCount - 1];
      const selectedLowSymbol = visualRng.selectFromArray(lowValueSymbols);
      nearMissGrid[row][col] = selectedLowSymbol.id;
    }

    // 填充剩餘位置（使用加權隨機填充）
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        // 跳過已經填入的位置
        if (nearMissGrid[row][col] !== null && nearMissGrid[row][col] !== undefined) {
          continue;
        }

        // 使用加權隨機選擇填充符號
        const fillerSymbol = this._getWeightedFillerSymbol(visualRng);
        nearMissGrid[row][col] = fillerSymbol;
      }
    }

    // 驗證：確保沒有創造 Accidental Win
    const maxRetries = this.visualConfig.maxRetries || 10;
    for (let retry = 0; retry < maxRetries; retry++) {
      if (this._validateNoAccidentalWin(nearMissGrid, null)) {
        return nearMissGrid;
      }

      // 如果驗證失敗，重新填充非關鍵位置
      for (let row = 0; row < this.rows; row++) {
        for (let col = 0; col < this.cols; col++) {
          // 跳過 Active Payline 的前 N 格（這些是 Near Miss 的視覺特徵）
          let isProtected = false;
          for (let i = 0; i < nearMissCount && i < activePayline.length; i++) {
            const [pRow, pCol] = activePayline[i];
            if (row === pRow && col === pCol) {
              isProtected = true;
              break;
            }
          }
          if (!isProtected) {
            nearMissGrid[row][col] = this._getWeightedFillerSymbol(visualRng);
          }
        }
      }
    }

    // 如果重試失敗，回退原始 grid
    console.warn(`[VisualConstraint] 無法改善 NEAR_MISS grid，回退原始 grid: ${outcome.id}`);
    return grid;
  }

  /**
   * 改善視覺分布（消除整列重複、改善符號分布自然度）
   */
  _improveVisualDistribution(grid, protectedCells, forbiddenSymbols, payline, matchCount, visualRng) {
    const improvedGrid = grid.map(row => [...row]);

    // 策略：隨機化非保護區域的符號，避免整列重複
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const cellKey = `${row},${col}`;
        
        // 跳過保護區域
        if (protectedCells.has(cellKey)) {
          continue;
        }

        // 如果是 winLine 的後續位置，避免使用禁止符號
        let candidateSymbols = this.symbols;
        if (forbiddenSymbols.size > 0) {
          candidateSymbols = this.symbols.filter(s => !forbiddenSymbols.has(s.id));
        }

        if (candidateSymbols.length === 0) {
          candidateSymbols = this.symbols;  // 備用
        }

        // 使用加權隨機選擇
        const selectedSymbol = this._getWeightedFillerSymbol(visualRng, candidateSymbols);
        improvedGrid[row][col] = selectedSymbol;
      }
    }

    return improvedGrid;
  }

  /**
   * 驗證沒有創造 Accidental Win
   * 
   * 規則：
   * - 如果 expectedWinLine !== null：僅該條 payline 可以形成連線
   * - 如果 expectedWinLine === null：所有 paylines 都不得形成 ≥3 個連續相同符號
   */
  _validateNoAccidentalWin(grid, expectedWinLine) {
    for (let paylineIndex = 0; paylineIndex < this.gameRule.paylines.length; paylineIndex++) {
      const payline = this.gameRule.paylines[paylineIndex];
      let consecutiveCount = 1;
      let lastSymbol = null;

      for (let i = 0; i < payline.length; i++) {
        const [row, col] = payline[i];
        const currentSymbol = grid[row][col];

        if (currentSymbol === lastSymbol && lastSymbol !== null) {
          consecutiveCount++;
        } else {
          consecutiveCount = 1;
        }

        // 檢查是否形成 ≥3 個連續相同符號
        if (consecutiveCount >= 3) {
          // 如果是預期的中獎線，允許
          if (expectedWinLine === paylineIndex) {
            // 允許，這是預期的中獎線
          } else {
            // 非預期的中獎線，視為 Accidental Win
            return false;
          }
        }

        lastSymbol = currentSymbol;
      }
    }

    return true;
  }

  /**
   * 獲取加權填充符號
   */
  _getWeightedFillerSymbol(visualRng, candidateSymbols = null) {
    const symbols = candidateSymbols || this.symbols;
    
    // 優先使用 LOW 和 MID 類型的符號
    const lowMidSymbols = symbols.filter(s => s.type === 'LOW' || s.type === 'MID');
    
    if (lowMidSymbols.length > 0 && visualRng.random() < 0.7) {
      return visualRng.selectFromArray(lowMidSymbols).id;
    }

    // 30% 機率使用其他符號（根據權重）
    const weights = {
      'LOW': 50,
      'MID': 30,
      'HIGH': 15,
      'WILD': 4,
      'SCATTER': 1
    };

    const weightedSymbols = [];
    symbols.forEach(symbol => {
      const weight = weights[symbol.type] || 1;
      for (let i = 0; i < weight; i++) {
        weightedSymbols.push(symbol);
      }
    });

    if (weightedSymbols.length > 0) {
      return visualRng.selectFromArray(weightedSymbols).id;
    }

    // 備用：如果沒有符號，返回第一個符號
    return symbols[0].id;
  }

  /**
   * 從 spinIndex 推導 visualSeed
   * 
   * 規則：
   * - 不得使用 Date.now()
   * - 必須是可重現的
   */
  _deriveVisualSeed(spinIndex) {
    // 使用簡單的 hash 函數從 spinIndex 推導 seed
    // 確保與 Math RNG 完全隔離
    return spinIndex * 7919 + 1000000;  // 使用質數確保分布均勻
  }
}

module.exports = { VisualConstraintEngine };

