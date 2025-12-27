const { RNG } = require('./rng');

/**
 * Pattern Generator - v1.4
 * 
 * 核心原則：
 * - 生成 Minimal Anchors（僅必要的符號位置）
 * - 使用獨立的 Pattern RNG（不消耗 Math RNG）
 * - Deterministic（相同 context 產生相同結果）
 * - 不生成完整 grid（由 Resolver 處理）
 */
class PatternGenerator {
  constructor(gameRule, symbols) {
    this.gameRule = gameRule;
    this.symbols = symbols;
    
    // 驗證 gameRule
    if (!gameRule || !gameRule.grid || !gameRule.paylines) {
      throw new Error('gameRule 必須包含 grid 和 paylines');
    }
    
    this.rows = gameRule.grid.rows;
    this.cols = gameRule.grid.cols;
  }

  /**
   * 主要介面：生成 Pattern Anchors
   * 
   * @param {Object} winCondition - winCondition 物件
   * @param {Object} context - 必須包含 { spinIndex, mathSeed, outcomeId }
   * @returns {Object} { anchors, generatedWinLine, winConditionType, patternSource }
   * 
   * Critical Rules:
   * 1. 使用獨立的 Pattern RNG（不消耗 Math RNG）
   * 2. Deterministic（相同 context 產生相同結果）
   * 3. 只生成 Minimal Anchors（不生成完整 grid）
   */
  generate(winCondition, context) {
    // 驗證 context
    if (!context || context.spinIndex === undefined || context.outcomeId === undefined) {
      throw new Error('context 必須包含 spinIndex, outcomeId');
    }

    // v1.5.0 Follow-up: mathSeed 可以是 null（legacy mode）
    // 驗證 winCondition
    if (!winCondition || !winCondition.type) {
      throw new Error('winCondition 必須包含 type');
    }

    // v1.5.0 Follow-up: 如果 mathSeed 為 null（legacy mode），使用 null RNG
    // 否則推導 derived seed（deterministic mode）
    const derivedSeed = context.mathSeed !== null && context.mathSeed !== undefined
      ? this._derivePatternSeed(context)
      : null;
    const localRng = new RNG(derivedSeed);

    // 根據 winCondition 類型生成 anchors
    if (winCondition.type === 'LINE') {
      return this._generateLineAnchors(winCondition, localRng);
    } else if (winCondition.type === 'SCATTER') {
      return this._generateScatterAnchors(winCondition, localRng, context);
    } else if (winCondition.type === 'ANY_POSITION') {
      // v1.5.3: ANY_POSITION 不需要 anchors（由 any-position layer 處理）
      return this._generateAnyPositionAnchors(winCondition);
    } else {
      throw new Error(`不支援的 winCondition.type: ${winCondition.type}`);
    }
  }

  /**
   * 推導 Pattern RNG 的 seed
   * 
   * P0-7 Invariant: 使用 RNG.deriveSubSeed() 集中化推導
   * 
   * 規則：
   * - 必須是 deterministic
   * - 必須與 Math RNG 完全隔離
   * - 相同 context 產生相同 seed
   */
  _derivePatternSeed(context) {
    // P0-7: 使用集中化的 seed 推導 API（直接返回數字 seed）
    return RNG.deriveSubSeed('PATTERN', {
      mathSeed: context.mathSeed,
      spinIndex: context.spinIndex,
      outcomeId: context.outcomeId,
      patchVersion: 'v1.5.0'  // Pattern generator version
    });
  }

  /**
   * 生成 LINE 類型的 anchors
   * 
   * 規則：
   * - 選擇一條 payline（如果 eligiblePaylines 為 ANY，則隨機選擇）
   * - 在該 payline 的前 matchCount 個位置生成 anchors
   * - 不生成超過 matchCount 的 anchors（避免延長中獎）
   */
  _generateLineAnchors(winCondition, localRng) {
    // 驗證必要欄位
    if (!winCondition.symbolId || typeof winCondition.matchCount !== 'number') {
      throw new Error('LINE winCondition 必須包含 symbolId 和 matchCount');
    }

    const symbolId = winCondition.symbolId;
    const matchCount = winCondition.matchCount;
    const payDirection = winCondition.payDirection || 'LTR';  // 預設 Left-to-Right
    const eligiblePaylines = winCondition.eligiblePaylines || 'ANY';

    // 選擇 payline
    let selectedPaylineIndex;
    if (eligiblePaylines === 'ANY') {
      // 從所有 paylines 中隨機選擇
      selectedPaylineIndex = localRng.randomInt(this.gameRule.paylines.length);
    } else if (Array.isArray(eligiblePaylines)) {
      // 從指定的 paylines 中選擇
      if (eligiblePaylines.length === 0) {
        throw new Error('eligiblePaylines 陣列不能為空');
      }
      const randomIndex = localRng.randomInt(eligiblePaylines.length);
      selectedPaylineIndex = eligiblePaylines[randomIndex];
    } else {
      // 固定 payline
      selectedPaylineIndex = eligiblePaylines;
    }

    // 驗證 payline index
    if (selectedPaylineIndex < 0 || selectedPaylineIndex >= this.gameRule.paylines.length) {
      throw new Error(`無效的 payline index: ${selectedPaylineIndex}`);
    }

    const selectedPayline = this.gameRule.paylines[selectedPaylineIndex];

    // 生成 anchors（僅前 matchCount 個位置）
    const anchors = [];
    for (let i = 0; i < matchCount && i < selectedPayline.length; i++) {
      const [row, col] = selectedPayline[i];
      anchors.push({
        row: row,
        col: col,
        symbolId: symbolId
      });
    }

    return {
      anchors: anchors,
      generatedWinLine: selectedPaylineIndex,
      winConditionType: 'LINE',
      patternSource: 'GENERATED'
    };
  }

  /**
   * 生成 SCATTER 類型的 anchors
   * 
   * 規則：
   * - 選擇 minCount 個不重複的位置
   * - 所有位置都填入 scatterSymbol
   * - 防止 anchors 本身在單一 payline 上形成連續 3 個（輕量級檢查）
   */
  _generateScatterAnchors(winCondition, localRng, derivedSeed) {
    // 驗證必要欄位
    if (!winCondition.symbolId || typeof winCondition.minCount !== 'number') {
      throw new Error('SCATTER winCondition 必須包含 symbolId 和 minCount');
    }

    const symbolId = winCondition.symbolId;
    const minCount = winCondition.minCount;
    const anyPosition = winCondition.anyPosition !== false;  // 預設 true

    // 生成所有可能的位置
    const allPositions = [];
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        allPositions.push([row, col]);
      }
    }

    // 選擇 minCount 個不重複的位置（帶重試機制，防止 anchors-only 連續 3 個）
    const maxRetries = 10;
    let anchors = [];
    
    for (let retry = 0; retry < maxRetries; retry++) {
      // 隨機選擇位置
      const selectedPositions = [];
      const availablePositions = [...allPositions];
      
      for (let i = 0; i < minCount && availablePositions.length > 0; i++) {
        const randomIndex = localRng.randomInt(availablePositions.length);
        selectedPositions.push(availablePositions.splice(randomIndex, 1)[0]);
      }

      // 轉換為 anchors
      anchors = selectedPositions.map(([row, col]) => ({
        row: row,
        col: col,
        symbolId: symbolId
      }));

      // 輕量級檢查：anchors 本身是否在單一 payline 上形成連續 3 個
      if (!this._checkAnchorsOnlyAccidentalWin(anchors)) {
        // 通過檢查，返回結果
        return {
          anchors: anchors,
          generatedWinLine: null,
          winConditionType: 'SCATTER',
          patternSource: 'GENERATED'
        };
      }

      // 如果檢查失敗，重新推導 seed（加入 retry 計數）
      // 使用簡單的 retry seed（基於原始 seed + retry）
      const retrySeed = derivedSeed + retry + 1000;  // 加上較大的偏移避免衝突
      localRng = new RNG(retrySeed);
    }

    // 如果重試失敗，仍然返回結果（但記錄警告）
    console.warn(`[PatternGenerator] SCATTER anchors 無法通過輕量級檢查，使用最後一次嘗試的結果`);
    return {
      anchors: anchors,
      generatedWinLine: null,
      winConditionType: 'SCATTER',
      patternSource: 'GENERATED'
    };
  }

  /**
   * 輕量級檢查：anchors 本身是否在單一 payline 上形成連續 3 個
   * 
   * 規則：
   * - 僅檢查 anchors 本身，不檢查完整 grid
   * - 如果 anchors 在單一 payline 上形成連續 3 個，返回 true（表示有問題）
   */
  _checkAnchorsOnlyAccidentalWin(anchors) {
    // 建立 anchors 位置集合（快速查找）
    const anchorPositions = new Set();
    anchors.forEach(anchor => {
      anchorPositions.add(`${anchor.row},${anchor.col}`);
    });

    // 檢查每條 payline
    for (const payline of this.gameRule.paylines) {
      let consecutiveCount = 0;
      let lastWasAnchor = false;

      for (let i = 0; i < payline.length; i++) {
        const [row, col] = payline[i];
        const isAnchor = anchorPositions.has(`${row},${col}`);

        if (isAnchor) {
          if (lastWasAnchor) {
            consecutiveCount++;
          } else {
            consecutiveCount = 1;
          }
          lastWasAnchor = true;
        } else {
          consecutiveCount = 0;
          lastWasAnchor = false;
        }

        // 如果 anchors 本身形成連續 3 個，返回 true（表示有問題）
        if (consecutiveCount >= 3) {
          return true;
        }
      }
    }

    return false;  // 沒有問題
  }

  /**
   * v1.5.3: 生成 ANY_POSITION 類型的 anchors
   * 
   * 規則：
   * - ANY_POSITION 不需要 anchors（由 any-position layer 處理）
   * - 返回空的 anchors 陣列
   * - 設置 winConditionType 為 'ANY_POSITION'
   */
  _generateAnyPositionAnchors(winCondition) {
    // 驗證必要欄位
    if (!winCondition.symbolId || typeof winCondition.targetCount !== 'number') {
      throw new Error('ANY_POSITION winCondition 必須包含 symbolId 和 targetCount');
    }

    // ANY_POSITION 不需要 anchors（由 any-position layer 處理）
    return {
      anchors: [],  // 空 anchors
      generatedWinLine: null,  // 沒有 winLine
      winConditionType: 'ANY_POSITION',
      patternSource: 'GENERATED'
    };
  }
}

module.exports = { PatternGenerator };

