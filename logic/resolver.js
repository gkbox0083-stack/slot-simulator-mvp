const { RNG } = require('./rng');  // v1.2.1: 從獨立模組導入 RNG（解決循環依賴）
const { VisualConstraintEngine } = require('./visualConstraint');  // v1.3: Visual Constraint Layer
const { PatternGenerator } = require('./patternGenerator');  // v1.4: Pattern Auto Generation

/**
 * Pattern Resolver - 將 Outcome 轉換為 Grid
 * v1.2: Pattern Resolver Layer
 * v1.3: 整合 Visual Constraint Layer
 * v1.4: 整合 Pattern Auto Generation
 * 
 * 核心原則：
 * - 只做視覺映射，不計算賠率、不判斷中獎、不做數學運算
 * - matchCount 從起點連續（Left-to-Right）
 * - LOSS 防撞門檻 = 3（任一 payline 連續 ≥3 個相同符號視為非法）
 * - winLine 只有一條（v1.2 保證單線模式）
 */
class PatternResolver {
  constructor(gameRule, symbols, rng, visualConfig = null) {
    this.gameRule = gameRule;
    this.symbols = symbols;  // 引用自 design.json 的 symbols 陣列
    this.rng = rng;
    
    // v1.4: 初始化 Pattern Generator
    this.patternGenerator = new PatternGenerator(gameRule, symbols);
    
    // v1.3: 初始化 Visual Constraint Engine（如果啟用）
    this.visualEngine = null;
    if (visualConfig && visualConfig.enabled !== false) {
      this.visualEngine = new VisualConstraintEngine(gameRule, symbols, visualConfig);
    }
    
    // 驗證 symbols 結構（必須包含 type 欄位）
    if (!symbols || !Array.isArray(symbols)) {
      throw new Error('symbols 必須為陣列');
    }
    symbols.forEach(s => {
      if (!s.id || !s.type) {
        throw new Error('symbols 陣列中的每個元素必須包含 id 和 type 欄位');
      }
    });
    
    // 驗證 gameRule
    if (!gameRule || !gameRule.grid || !gameRule.paylines) {
      throw new Error('gameRule 必須包含 grid 和 paylines');
    }
    
    this.maxMatchCount = gameRule.grid.cols;
    this.rows = gameRule.grid.rows;
    this.cols = gameRule.grid.cols;
    
    // 背景填充權重（優先 LOW, MID）
    this.fillerWeights = {
      'LOW': 50,
      'MID': 30,
      'HIGH': 15,
      'WILD': 4,
      'SCATTER': 1
    };
  }

  /**
   * 主要介面：解析 Outcome 並生成盤面
   * @param {Object} outcome - Outcome 物件
   * @param {Object} context - v1.3/v1.4: context（包含 visualSeed/spinIndex, mathSeed, outcomeId）
   * @returns {Object} { grid: Array<Array<string>>, winLine: number|null, patternSource: string, ... }
   * 
   * winLine 定義：
   * - 型別：number | null
   * - 語義：paylines 陣列的 index（0-based）
   * - null：表示 LOSS/FEATURE，無中獎線
   * - number：表示主要中獎線的索引
   * - v1.2 保證：最多只有一條中獎線（單線模式）
   * 
   * patternSource 定義（v1.4）：
   * - "GENERATED": 使用 winCondition 自動生成
   * - "LEGACY": 使用舊的 pattern/patterns
   * - "NONE": 無 pattern 定義（錯誤）
   */
  resolve(outcome, context = null) {
    // v1.4: 決定 pattern source（GENERATED/LEGACY/NONE）
    // 必修補點 2：決策順序固定，更清晰
    let patternSource = 'NONE';
    let generatedInfo = null;

    if (outcome.type === 'WIN') {
      // WIN 類型：必須有 pattern 定義
      if (outcome.winCondition) {
        // 有 winCondition → GENERATED
        patternSource = 'GENERATED';
        
        // 檢查是否同時存在 legacy patterns（警告）
        if (outcome.pattern || outcome.patterns) {
          console.warn(`[PatternResolver] Outcome "${outcome.id}" 同時包含 winCondition 和 legacy patterns，將使用 winCondition`);
        }

        // 驗證 context（GENERATED 需要 context）
        if (!context || context.spinIndex === undefined || !context.mathSeed || !context.outcomeId) {
          // 使用安全預設值
          context = context || {};
          context.spinIndex = context.spinIndex || 0;
          context.mathSeed = context.mathSeed || 'default';
          context.outcomeId = context.outcomeId || outcome.id;
          console.warn(`[PatternResolver] Outcome "${outcome.id}" 使用 winCondition 但 context 不完整，使用預設值`);
        }

        // 生成 anchors
        try {
          generatedInfo = this.patternGenerator.generate(outcome.winCondition, {
            spinIndex: context.spinIndex,
            mathSeed: context.mathSeed || 'default',
            outcomeId: context.outcomeId || outcome.id
          });
        } catch (error) {
          throw new Error(`PatternGenerator 生成失敗 (${outcome.id}): ${error.message}`);
        }
      } else if (outcome.pattern || outcome.patterns) {
        // 有 legacy pattern(s) → LEGACY
        patternSource = 'LEGACY';
      } else {
        // WIN 類型缺定義 → throw
        throw new Error(`WIN 類型 Outcome "${outcome.id}" 缺少 pattern 定義（需要 winCondition 或 legacy pattern/patterns）`);
      }
    } else {
      // LOSS/FEATURE/其他非 WIN：直接走原本 _resolveLoss()（不要求 pattern）
      patternSource = 'NONE';
    }

    // 驗證 matchCount 邊界（僅 WIN 類型）
    if (outcome.type === 'WIN' && outcome.winConfig) {
      const matchCount = outcome.winConfig.matchCount;
      if (matchCount > this.maxMatchCount) {
        throw new Error(
          `matchCount (${matchCount}) exceeds grid width (${this.maxMatchCount})`
        );
      }
      if (matchCount < 2) {
        throw new Error(`matchCount (${matchCount}) must be at least 2`);
      }
    }

    // v1.2/v1.4: 生成基礎 grid
    let patternResult;
    if (patternSource === 'GENERATED') {
      // v1.4: 使用生成的 anchors 建立 grid
      patternResult = this._resolveFromAnchors(outcome, generatedInfo);
    } else if (patternSource === 'LEGACY') {
      // v1.2: 使用 legacy 邏輯（WIN 類型使用 legacy pattern）
      patternResult = this._resolveWin(outcome);
    } else if (patternSource === 'NONE') {
      // LOSS/FEATURE：直接走原本 _resolveLoss()（不要求 pattern）
      patternResult = this._resolveLoss(outcome);
    } else {
      throw new Error(`無效的 patternSource: ${patternSource}`);
    }

    // 加入 v1.4 的 metadata
    patternResult.patternSource = patternSource;
    if (generatedInfo) {
      patternResult.winConditionType = generatedInfo.winConditionType;
      patternResult.anchorsCount = generatedInfo.anchors ? generatedInfo.anchors.length : 0;
    }

    // v1.3/v1.4.x: 應用 Visual Constraint（如果啟用）
    if (this.visualEngine) {
      // v1.4.x: 確保 context 存在（fallback + warning）
      const safeContext = context || {
        spinIndex: 0,
        mathSeed: 'default',
        outcomeId: outcome.id
      };
      
      if (!context) {
        console.warn(`[PatternResolver] Outcome "${outcome.id}" 缺少 context，使用預設值`);
      }
      
      // Phase A2: applyConstraints 現在返回 { grid, telemetry }
      const visualResult = this.visualEngine.applyConstraints(
        patternResult.grid,
        outcome,
        patternResult.winLine,
        safeContext
      );
      
      // Phase A3: 傳遞 telemetry（不影響邏輯）
      patternResult.grid = visualResult.grid;
      patternResult.visualTelemetry = visualResult.telemetry;
    }

    return patternResult;
  }

  /**
   * v1.4: 從生成的 anchors 建立 grid
   * 
   * @param {Object} outcome - Outcome 物件
   * @param {Object} generatedInfo - PatternGenerator 生成的資訊
   * @returns {Object} { grid, winLine, ... }
   */
  _resolveFromAnchors(outcome, generatedInfo) {
    const { anchors, generatedWinLine, winConditionType } = generatedInfo;

    // 初始化空 grid
    const grid = Array(this.rows).fill(null).map(() => Array(this.cols).fill(null));

    // 放置 anchors
    anchors.forEach(anchor => {
      grid[anchor.row][anchor.col] = anchor.symbolId;
    });

    // 填充剩餘位置
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        if (grid[row][col] === null) {
          grid[row][col] = this._getFillerSymbol(null, row, col);
        }
      }
    }

    // 驗證 grid 合法性
    const expectedWinLine = winConditionType === 'LINE' ? generatedWinLine : null;
    if (!this._validateGrid(grid, expectedWinLine)) {
      // 如果驗證失敗，重試（最多 10 次）
      for (let retry = 0; retry < 10; retry++) {
        // 重新填充非 anchor 位置
        for (let row = 0; row < this.rows; row++) {
          for (let col = 0; col < this.cols; col++) {
            // 檢查是否為 anchor 位置
            const isAnchor = anchors.some(a => a.row === row && a.col === col);
            if (!isAnchor) {
              grid[row][col] = this._getFillerSymbol(null, row, col);
            }
          }
        }
        if (this._validateGrid(grid, expectedWinLine)) {
          break;
        }
      }
    }

    return {
      grid: grid,
      winLine: generatedWinLine,
      patternSource: 'GENERATED',
      winConditionType: winConditionType,
      anchorsCount: anchors.length
    };
  }

  /**
   * 處理 WIN 類型
   * 
   * Win 連線規則（Left-to-Right Consecutive）：
   * 1. matchCount 個符號必須從 payline 的第一個位置（index 0）開始
   * 2. 連續填入，不允許跳格或中斷
   * 3. 後續位置可以是任意符號
   */
  _resolveWin(outcome) {
    const { symbolId, matchCount } = outcome.winConfig;
    
    // 1. 從 paylines 中隨機選一條線
    const selectedPaylineIndex = this.rng.randomInt(this.gameRule.paylines.length);
    const selectedPayline = this.gameRule.paylines[selectedPaylineIndex];
    
    // 2. 初始化空盤面
    const grid = Array(this.rows).fill(null).map(() => Array(this.cols).fill(null));
    
    // 3. 在選定的 payline 上放置 matchCount 個符號（從起點連續）
    for (let i = 0; i < matchCount && i < selectedPayline.length; i++) {
      const [row, col] = selectedPayline[i];
      grid[row][col] = symbolId;
    }
    
    // 4. 填充剩餘位置（使用低價值符號，避免產生額外連線）
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        if (grid[row][col] === null) {
          grid[row][col] = this._getFillerSymbol(selectedPayline, row, col);
        }
      }
    }
    
    // 5. 驗證盤面合法性
    if (!this._validateGrid(grid, selectedPaylineIndex)) {
      // 如果驗證失敗，重試（最多 10 次）
      for (let retry = 0; retry < 10; retry++) {
        const retryResult = this._resolveWin(outcome);
        if (this._validateGrid(retryResult.grid, retryResult.winLine)) {
          return retryResult;
        }
      }
      throw new Error(`無法生成合法的 WIN 盤面: ${outcome.id}`);
    }
    
    return {
      grid: grid,
      winLine: selectedPaylineIndex
    };
  }

  /**
   * 處理 LOSS/FEATURE 類型
   * 
   * LOSS 防撞規則：
   * - 檢查每條 payline，從起點開始
   * - 若任一符號連續出現 ≥3 次，視為意外連線（非法）
   * - 必須檢查所有符號類型
   */
  _resolveLoss(outcome) {
    const maxRetries = 10;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // 策略：交替填充法（主動避免連線）
      const grid = this._generateLossGrid();
      
      // 驗證：確保沒有任何 payline 形成連線
      if (this._validateGrid(grid, null)) {
        return {
          grid: grid,
          winLine: null
        };
      }
    }
    
    // 如果重試失敗，強制修改衝突格子
    const grid = this._generateLossGrid();
    this._fixCollisions(grid);
    
    return {
      grid: grid,
      winLine: null
    };
  }

  /**
   * 生成 LOSS 盤面（使用交替填充策略）
   */
  _generateLossGrid() {
    const grid = Array(this.rows).fill(null).map(() => Array(this.cols).fill(null));
    
    // 優先使用低價值符號填充
    const lowMidSymbols = this.symbols.filter(s => 
      s.type === 'LOW' || s.type === 'MID'
    );
    
    // 交替填充策略：在每條 payline 上交替使用不同符號
    for (const payline of this.gameRule.paylines) {
      for (let i = 0; i < payline.length; i++) {
        const [row, col] = payline[i];
        if (grid[row][col] === null) {
          // 交替選擇符號（避免連續相同）
          const symbolIndex = i % lowMidSymbols.length;
          grid[row][col] = lowMidSymbols[symbolIndex].id;
        }
      }
    }
    
    // 填充剩餘位置
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        if (grid[row][col] === null) {
          grid[row][col] = this._getFillerSymbol(null, row, col);
        }
      }
    }
    
    return grid;
  }

  /**
   * 修復碰撞（強制修改衝突格子）
   */
  _fixCollisions(grid) {
    for (const payline of this.gameRule.paylines) {
      let consecutiveCount = 1;
      let lastSymbol = null;
      
      for (let i = 0; i < payline.length; i++) {
        const [row, col] = payline[i];
        const currentSymbol = grid[row][col];
        
        if (currentSymbol === lastSymbol) {
          consecutiveCount++;
          if (consecutiveCount >= 3) {
            // 修改當前位置，使用不同的符號
            const lowMidSymbols = this.symbols.filter(s => 
              (s.type === 'LOW' || s.type === 'MID') && s.id !== currentSymbol
            );
            if (lowMidSymbols.length > 0) {
              grid[row][col] = this.rng.selectFromArray(lowMidSymbols).id;
              consecutiveCount = 1;
              lastSymbol = grid[row][col];
            }
          }
        } else {
          consecutiveCount = 1;
          lastSymbol = currentSymbol;
        }
      }
    }
  }

  /**
   * 獲取填充符號（使用權重策略）
   * 背景填充權重：優先 LOW (50%), MID (30%)
   */
  _getFillerSymbol(payline, row, col) {
    // 優先使用 LOW 和 MID 類型的符號（70% 機率）
    const lowMidSymbols = this.symbols.filter(s => 
      s.type === 'LOW' || s.type === 'MID'
    );
    
    if (lowMidSymbols.length > 0 && this.rng.random() < 0.7) {
      return this.rng.selectFromArray(lowMidSymbols).id;
    }
    
    // 30% 機率使用其他符號（根據權重）
    const weightedSymbols = [];
    this.symbols.forEach(symbol => {
      const weight = this.fillerWeights[symbol.type] || 1;
      for (let i = 0; i < weight; i++) {
        weightedSymbols.push(symbol);
      }
    });
    
    if (weightedSymbols.length > 0) {
      return this.rng.selectFromArray(weightedSymbols).id;
    }
    
    // 備用：如果沒有符號，返回第一個符號
    return this.symbols[0].id;
  }

  /**
   * 驗證盤面是否合法（防止誤判）
   * 
   * 驗證範圍（僅檢查以下三項）：
   * 1. 若 expectedWinLine !== null：
   *    - 僅該條 payline 可以形成連線（允許）
   *    - 其他 paylines 不得形成 ≥3 個連續相同符號
   * 2. 若 expectedWinLine === null：
   *    - 所有 paylines 都不得形成 ≥3 個連續相同符號
   * 3. 不檢查 payout、RTP、權重（非 Resolver 責任）
   */
  _validateGrid(grid, expectedWinLine) {
    // 檢查所有 paylines
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
          // 如果是預期的中獎線，允許（這是合法的 WIN 盤面）
          if (expectedWinLine === paylineIndex) {
            // 允許，這是預期的中獎線
          } else {
            // 非預期的中獎線，視為非法
            return false;
          }
        }
        
        lastSymbol = currentSymbol;
      }
    }
    
    return true;
  }
}

module.exports = { PatternResolver };

