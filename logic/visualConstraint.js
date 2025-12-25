const { RNG } = require('./rng');

/**
 * Visual Constraint Engine - v1.4.x
 * 
 * 核心原則：
 * - 完全隔離 Math RNG（使用獨立的 Visual RNG）
 * - Stateless（不保存跨 Spin 狀態）
 * - 不修改 Outcome、不影響數學結果
 * - 僅改善視覺呈現（Near Miss、Tease、消除整列重複）
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
   * v1.4.x 執行順序（嚴格）：
   * 1. Feature patch (Near Miss / Tease)
   * 2. General visual optimization
   * 3. Mandatory safety scans + retry/fallback
   * 
   * @param {Array<Array<string>>} grid - 原始 grid（來自 Resolver）
   * @param {Object} outcome - Outcome 物件
   * @param {number|null} winLine - 中獎線索引（null 表示無中獎）
   * @param {Object} context - 必須包含 { spinIndex, mathSeed, outcomeId } 或 visualSeed
   * @returns {Array<Array<string>>} 處理後的 grid
   */
  applyConstraints(grid, outcome, winLine, context) {
    // 如果 Visual Layer 被關閉，直接返回原始 grid
    if (!this.visualConfig.enabled) {
      return grid;
    }

    // v1.4.x: 改進 context 處理（fallback + warning）
    const safeContext = this._ensureContext(context, outcome);
    if (!safeContext) {
      console.warn(`[VisualConstraint] context 不完整，使用預設值: ${outcome.id}`);
      return grid;  // 如果 context 完全無效，回退原始 grid
    }

    // 建立獨立的 Visual RNG（使用 derived visual seed）
    const visualSeed = this._deriveVisualSeed(safeContext);
    const visualRng = new RNG(visualSeed);

    // 深拷貝 grid（避免修改原始 grid）
    let processedGrid = grid.map(row => [...row]);
    const baseGrid = grid.map(row => [...row]);  // 保存原始 grid 作為 fallback

    // ========================================================================
    // Phase 1: Feature Patch (Near Miss / Tease)
    // ========================================================================
    if (this.shouldTease(outcome)) {
      processedGrid = this._applyTease(processedGrid, outcome, winLine, visualRng);
    } else if (this.isNearMiss(outcome)) {
      processedGrid = this._applyNearMiss(processedGrid, outcome, visualRng);
    }

    // ========================================================================
    // Phase 2: General Visual Optimization (v1.3 behaviors)
    // ========================================================================
    if (outcome.type === 'WIN') {
      processedGrid = this._applyWinGeneralOptimization(processedGrid, outcome, winLine, visualRng);
    } else if (outcome.type === 'LOSS' || this.isNearMiss(outcome)) {
      processedGrid = this._applyLossGeneralOptimization(processedGrid, outcome, visualRng);
    }

    // ========================================================================
    // Phase 3: Mandatory Safety Scans + Retry/Fallback
    // ========================================================================
    const maxRetries = this.visualConfig.maxRetries || 10;
    for (let retry = 0; retry < maxRetries; retry++) {
      // 驗證安全性
      const isSafe = this._validateSafety(processedGrid, outcome, winLine);
      if (isSafe) {
        return processedGrid;
      }

      // 如果驗證失敗，重新應用 Phase 2（保留 Phase 1 的結果）
      if (outcome.type === 'WIN') {
        processedGrid = this._applyWinGeneralOptimization(processedGrid, outcome, winLine, visualRng);
      } else {
        processedGrid = this._applyLossGeneralOptimization(processedGrid, outcome, visualRng);
      }
    }

    // 如果重試失敗，fallback 到 baseGrid
    console.warn(`[VisualConstraint] 無法通過安全檢查，fallback 到 baseGrid: ${outcome.id}`);
    return baseGrid;
  }

  /**
   * v1.4.x: 確保 context 完整性（fallback + warning）
   */
  _ensureContext(context, outcome) {
    if (!context) {
      return null;
    }

    // 如果已有 visualSeed，直接使用
    if (context.visualSeed !== undefined) {
      return context;
    }

    // 嘗試從 mathSeed + spinIndex + outcomeId 推導
    if (context.mathSeed !== undefined && context.spinIndex !== undefined && context.outcomeId !== undefined) {
      return context;
    }

    // 如果只有 spinIndex，使用預設值（但警告）
    if (context.spinIndex !== undefined) {
      return {
        spinIndex: context.spinIndex,
        mathSeed: context.mathSeed || 'default',
        outcomeId: context.outcomeId || outcome.id
      };
    }

    return null;
  }

  /**
   * v1.4.x: 推導 Visual Seed（deterministic）
   * 
   * visualSeed = hash(mathSeed + ':' + spinIndex + ':' + outcomeId + ':visual')
   */
  _deriveVisualSeed(context) {
    if (context.visualSeed !== undefined) {
      return context.visualSeed;
    }

    const seedString = `${context.mathSeed || 'default'}:${context.spinIndex || 0}:${context.outcomeId || 'unknown'}:visual`;
    
    // 簡單的 string hash（轉為數字）
    let hash = 0;
    for (let i = 0; i < seedString.length; i++) {
      const char = seedString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    
    return Math.abs(hash) || 1;
  }

  /**
   * v1.4.x: 判斷是否為 Near Miss
   * 
   * isNearMiss(outcome) = outcome.type === 'LOSS' && outcome.id.includes('NEAR_MISS')
   */
  isNearMiss(outcome) {
    return outcome.type === 'LOSS' && outcome.id && outcome.id.includes('NEAR_MISS');
  }

  /**
   * v1.4.x: 判斷是否應該應用 Tease
   * 
   * MVP: outcome.id includes 'SMALL_WIN'
   */
  shouldTease(outcome) {
    return outcome.type === 'WIN' && outcome.id && outcome.id.includes('SMALL_WIN');
  }

  /**
   * v1.4.x: 應用 Near Miss（Phase 1）
   * 
   * 支援：
   * - LINE-pay context (LTR left-to-right line pays)
   * - Any-position-pay context (scatter minCount) - 僅當配置存在時
   */
  _applyNearMiss(grid, outcome, visualRng) {
    // 檢查是否為 any-position count-based（例如 scatter minCount）
    // MVP: 預設使用 LINE-pay，除非明確配置為 any-position
    const isAnyPosition = false;  // v1.4.x MVP: 預設 LINE-pay

    if (isAnyPosition) {
      return this._applyNearMissAnyPosition(grid, outcome, visualRng);
    } else {
      return this._applyNearMissLinePay(grid, outcome, visualRng);
    }
  }

  /**
   * v1.4.x: Near Miss - LINE-pay strategy
   * 
   * - 隨機選擇一條 payline（deterministic via visualSeed RNG）
   * - 選擇一個目標符號（prefer HIGH，否則任何非特殊符號）
   * - 在選定的 payline 上：放置 N-1 個相同符號（default N=3，所以前 2 個位置）
   * - 強制第 N 個位置為明顯不同的符號（prefer LOW）
   */
  _applyNearMissLinePay(grid, outcome, visualRng) {
    const nearMissGrid = grid.map(row => [...row]);

    // 隨機選擇一條 payline（deterministic）
    const selectedPaylineIndex = visualRng.randomInt(this.gameRule.paylines.length);
    const selectedPayline = this.gameRule.paylines[selectedPaylineIndex];

    // 預設 N=3（Near Miss 通常是 "差一個"）
    const nearMissCount = 3;

    // 選擇目標符號（prefer HIGH，否則任何非特殊符號）
    const highSymbols = this.symbols.filter(s => s.type === 'HIGH');
    const nonSpecialSymbols = this.symbols.filter(s => s.type !== 'WILD' && s.type !== 'SCATTER');
    const targetSymbols = highSymbols.length > 0 ? highSymbols : nonSpecialSymbols;
    
    if (targetSymbols.length === 0) {
      return grid;  // 無法應用 Near Miss，回退
    }

    const targetSymbol = visualRng.selectFromArray(targetSymbols);

    // 在選定的 payline 上放置 N-1 個相同符號
    for (let i = 0; i < nearMissCount - 1 && i < selectedPayline.length; i++) {
      const [row, col] = selectedPayline[i];
      nearMissGrid[row][col] = targetSymbol.id;
    }

    // 強制第 N 個位置為明顯不同的符號（prefer LOW）
    if (nearMissCount - 1 < selectedPayline.length) {
      const [row, col] = selectedPayline[nearMissCount - 1];
      const lowSymbols = this.symbols.filter(s => s.type === 'LOW');
      const differentSymbols = lowSymbols.length > 0 ? lowSymbols : this.symbols.filter(s => s.id !== targetSymbol.id);
      
      if (differentSymbols.length > 0) {
        const breakSymbol = visualRng.selectFromArray(differentSymbols);
        nearMissGrid[row][col] = breakSymbol.id;
      }
    }

    return nearMissGrid;
  }

  /**
   * v1.4.x: Near Miss - Any-position strategy (Scatter/feature count-based)
   * 
   * - 放置 exactly minCount-1 個 scatters 在不重複的隨機位置
   * - 填充其餘位置時，明確排除 scatter 以防止意外觸發
   */
  _applyNearMissAnyPosition(grid, outcome, visualRng) {
    // v1.4.x MVP: 此功能需要明確配置，目前不實作
    // 如果未來需要，可以從 outcome 或 config 讀取 minCount
    return grid;
  }

  /**
   * v1.4.x: 應用 Tease（Phase 1）
   * 
   * Tease Red Lines (non-negotiable):
   * 1. WinLine protection: 對於 true winLine，前 matchCount 個符號 MUST NOT change
   * 2. Anti-Extend (MVP): 對於 winLine 上 matchCount 之後的位置，MUST NOT 等於 winSymbolId
   * 3. Tease placement: 優先應用 tease 到 1~2 條與 true winLine 不同的 payline
   */
  _applyTease(grid, outcome, winLine, visualRng) {
    if (winLine === null || winLine < 0 || winLine >= this.gameRule.paylines.length) {
      return grid;  // 無效的 winLine，不應用 tease
    }

    const teaseGrid = grid.map(row => [...row]);
    const truePayline = this.gameRule.paylines[winLine];
    const matchCount = outcome.winConfig ? outcome.winConfig.matchCount : 0;
    const winSymbolId = outcome.winConfig ? outcome.winConfig.symbolId : null;

    if (!winSymbolId || matchCount === 0) {
      return grid;  // 無法應用 tease
    }

    // 保護區域：true winLine 的前 matchCount 個符號
    const protectedCells = new Set();
    for (let i = 0; i < matchCount && i < truePayline.length; i++) {
      const [row, col] = truePayline[i];
      protectedCells.add(`${row},${col}`);
    }

    // Anti-Extend: true winLine 上 matchCount 之後的位置不得使用 winSymbolId
    const antiExtendCells = new Set();
    for (let i = matchCount; i < truePayline.length; i++) {
      const [row, col] = truePayline[i];
      antiExtendCells.add(`${row},${col}`);
    }

    // 選擇 1~2 條 tease payline（與 true winLine 不同）
    const availablePaylines = this.gameRule.paylines
      .map((pl, idx) => ({ payline: pl, index: idx }))
      .filter(({ index }) => index !== winLine);
    
    const numTeasePaylines = Math.min(visualRng.randomInt(2) + 1, availablePaylines.length);
    const selectedTeasePaylines = [];
    
    for (let i = 0; i < numTeasePaylines && availablePaylines.length > 0; i++) {
      const randomIndex = visualRng.randomInt(availablePaylines.length);
      selectedTeasePaylines.push(availablePaylines.splice(randomIndex, 1)[0]);
    }

    // 在選定的 tease payline 上應用 near-miss style
    selectedTeasePaylines.forEach(({ payline }) => {
      const highSymbols = this.symbols.filter(s => s.type === 'HIGH');
      const lowSymbols = this.symbols.filter(s => s.type === 'LOW');
      
      if (highSymbols.length > 0 && lowSymbols.length > 0) {
        const teaseSymbol = visualRng.selectFromArray(highSymbols);
        
        // 前 2 個位置使用相同 HIGH 符號
        for (let i = 0; i < 2 && i < payline.length; i++) {
          const [row, col] = payline[i];
          const cellKey = `${row},${col}`;
          if (!protectedCells.has(cellKey)) {
            teaseGrid[row][col] = teaseSymbol.id;
          }
        }
        
        // 第 3 個位置強制 LOW（break）
        if (2 < payline.length) {
          const [row, col] = payline[2];
          const cellKey = `${row},${col}`;
          if (!protectedCells.has(cellKey)) {
            const breakSymbol = visualRng.selectFromArray(lowSymbols);
            teaseGrid[row][col] = breakSymbol.id;
          }
        }
      }
    });

    // 確保 Anti-Extend: true winLine 上 matchCount 之後的位置不得使用 winSymbolId
    antiExtendCells.forEach(cellKey => {
      const [row, col] = cellKey.split(',').map(Number);
      if (teaseGrid[row][col] === winSymbolId) {
        // 替換為不同的符號
        const differentSymbols = this.symbols.filter(s => s.id !== winSymbolId);
        if (differentSymbols.length > 0) {
          teaseGrid[row][col] = visualRng.selectFromArray(differentSymbols).id;
        }
      }
    });

    return teaseGrid;
  }

  /**
   * v1.4.x: WIN General Optimization (Phase 2)
   */
  _applyWinGeneralOptimization(grid, outcome, winLine, visualRng) {
    if (winLine === null || winLine < 0 || winLine >= this.gameRule.paylines.length) {
      return grid;
    }

    const payline = this.gameRule.paylines[winLine];
    const matchCount = outcome.winConfig ? outcome.winConfig.matchCount : 0;
    const winSymbol = outcome.winConfig ? outcome.winConfig.symbolId : null;

    // 保護區域：winLine 上的前 matchCount 格
    const protectedCells = new Set();
    for (let i = 0; i < matchCount && i < payline.length; i++) {
      const [row, col] = payline[i];
      protectedCells.add(`${row},${col}`);
    }

    // 禁止符號：winLine 的後續位置不得填入會延長中獎的符號
    const forbiddenSymbols = new Set();
    if (winSymbol) {
      forbiddenSymbols.add(winSymbol);
      if (outcome.winConfig && outcome.winConfig.allowWild) {
        const wildSymbol = this.symbols.find(s => s.type === 'WILD');
        if (wildSymbol) {
          forbiddenSymbols.add(wildSymbol.id);
        }
      }
    }

    return this._improveVisualDistribution(grid, protectedCells, forbiddenSymbols, payline, matchCount, visualRng);
  }

  /**
   * v1.4.x: LOSS General Optimization (Phase 2)
   */
  _applyLossGeneralOptimization(grid, outcome, visualRng) {
    return this._improveVisualDistribution(
      grid,
      new Set(),  // 無保護區域
      new Set(),  // 無禁止符號
      null,       // 無特定 payline
      0,          // 無 matchCount
      visualRng
    );
  }

  /**
   * v1.4.x: 改善視覺分布（消除整列重複、改善符號分布自然度）
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
   * v1.4.x: 驗證安全性（Phase 3）
   * 
   * - Loss: accidental-win scan across all paylines
   * - Win: anti-extend check (MVP) + accidental-win scan if modified non-win areas
   */
  _validateSafety(grid, outcome, winLine) {
    if (outcome.type === 'WIN') {
      // WIN: 驗證 anti-extend + accidental win
      if (winLine !== null && winLine >= 0 && winLine < this.gameRule.paylines.length) {
        const payline = this.gameRule.paylines[winLine];
        const matchCount = outcome.winConfig ? outcome.winConfig.matchCount : 0;
        const winSymbolId = outcome.winConfig ? outcome.winConfig.symbolId : null;

        // Anti-Extend MVP: winLine 上 matchCount 之後的位置不得是 winSymbolId
        for (let i = matchCount; i < payline.length; i++) {
          const [row, col] = payline[i];
          if (grid[row][col] === winSymbolId) {
            return false;  // 違反 Anti-Extend
          }
        }
      }

      // Accidental win scan（除了預期的 winLine）
      return this._validateNoAccidentalWin(grid, winLine);
    } else {
      // LOSS: accidental-win scan across all paylines
      return this._validateNoAccidentalWin(grid, null);
    }
  }

  /**
   * v1.4.x: 驗證沒有創造 Accidental Win
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
   * v1.4.x: 獲取加權填充符號
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
}

module.exports = { VisualConstraintEngine };

