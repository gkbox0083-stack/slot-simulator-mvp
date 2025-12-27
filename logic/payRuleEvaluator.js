/**
 * v1.5.0: Pay Rule Evaluator
 * v1.5.3: 支援 ANY_POSITION rule
 * 
 * 核心原則：
 * - Single Evaluation Point：由 simulate.js 統一呼叫
 * - Truth Source：Outcome 定義 expected payout，Evaluator 為 deterministic verifier
 * - 不修改 grid，只讀取並評估
 * - v1.5.0 僅支援 LINE rule（單事件）
 * - v1.5.3 新增 ANY_POSITION rule（單事件模式，與 LINE 互斥）
 */

/**
 * WinEvent 結構（v1.5.0 / v1.5.3）
 * 
 * @typedef {Object} WinEvent
 * @property {string} eventId - 事件 ID（唯一識別）
 * @property {string} ruleType - 規則類型（'LINE' | 'ANY_POSITION'）
 * @property {number} winAmount - 贏分（credit int）
 * @property {string} paidSymbolId - 支付符號 ID
 * @property {string} displaySymbolId - 顯示符號 ID（通常等於 paidSymbolId）
 * @property {Array<[number, number]>} positions - 中獎位置陣列 [[row, col], ...]
 * @property {number} [matchCount] - 連線數量（LINE）或符號數量（ANY_POSITION）
 * @property {number} [paylineIndex] - Payline 索引（僅 LINE）
 * @property {Object} [metadata] - 額外元資料
 */

class PayRuleEvaluator {
  /**
   * @param {Object} gameRule - Game rule 配置（包含 paylines）
   * @param {Array} symbols - Symbols 陣列
   */
  constructor(gameRule, symbols) {
    this.gameRule = gameRule;
    this.symbols = symbols;
    this.paylines = gameRule.paylines || [];
    
    // 建立 symbol ID 到 symbol 的映射
    this.symbolMap = new Map();
    symbols.forEach(s => {
      this.symbolMap.set(s.id, s);
    });
  }

  /**
   * 主要介面：評估 grid 並返回 WinEvent[]
   * 
   * @param {Array<Array<string>>} grid - 盤面（rows x cols）
   * @param {Object} ruleContext - 規則上下文（可選）
   * @returns {Array<WinEvent>} WinEvent 陣列（v1.5.0/v1.5.3 限制：0~1 個事件）
   */
  evaluate(grid, ruleContext = {}) {
    if (!grid || grid.length === 0) {
      return [];
    }

    // v1.5.0: 先評估 LINE rule
    const lineEvents = [];
    
    // 評估所有 paylines
    for (let paylineIndex = 0; paylineIndex < this.paylines.length; paylineIndex++) {
      const payline = this.paylines[paylineIndex];
      const lineEvent = this._evaluateLinePay(grid, payline, paylineIndex);
      
      if (lineEvent) {
        lineEvents.push(lineEvent);
        // v1.5.0 限制：只返回第一個匹配的事件（單事件模式）
        break;
      }
    }

    // v1.5.3: 如果 LINE 有事件，返回 LINE（單事件模式，互斥）
    if (lineEvents.length > 0) {
      return lineEvents.slice(0, 1);
    }

    // v1.5.3: 評估 ANY_POSITION rule
    const anyPosEvents = this._evaluateAnyPositionPay(grid);
    
    // v1.5.3 限制：確保最多 1 個事件
    return anyPosEvents.slice(0, 1);
  }

  /**
   * 評估 LINE pay（Left-to-Right）
   * 
   * @param {Array<Array<string>>} grid - 盤面
   * @param {Array<[number, number]>} payline - Payline 座標陣列
   * @param {number} paylineIndex - Payline 索引
   * @returns {WinEvent|null} WinEvent 或 null
   */
  _evaluateLinePay(grid, payline, paylineIndex) {
    if (!payline || payline.length === 0) {
      return null;
    }

    // 讀取 payline 上的符號
    const symbolsOnLine = [];
    for (let i = 0; i < payline.length; i++) {
      const [row, col] = payline[i];
      if (row >= 0 && row < grid.length && col >= 0 && col < grid[row].length) {
        symbolsOnLine.push({
          symbolId: grid[row][col],
          position: [row, col]
        });
      } else {
        return null; // 無效的 payline
      }
    }

    if (symbolsOnLine.length === 0) {
      return null;
    }

    // 計算連續相同符號的數量（從左到右）
    const firstSymbol = symbolsOnLine[0].symbolId;
    let matchCount = 1;
    const positions = [[symbolsOnLine[0].position[0], symbolsOnLine[0].position[1]]];

    for (let i = 1; i < symbolsOnLine.length; i++) {
      const currentSymbol = symbolsOnLine[i].symbolId;
      
      // v1.5.0: 不支援 Wild 替代（明確禁止）
      if (currentSymbol === firstSymbol) {
        matchCount++;
        positions.push([symbolsOnLine[i].position[0], symbolsOnLine[i].position[1]]);
      } else {
        break; // 中斷連續
      }
    }

    // 至少需要 3 個連續符號才算中獎
    if (matchCount < 3) {
      return null;
    }

    // 建立 WinEvent
    const symbol = this.symbolMap.get(firstSymbol);
    if (!symbol) {
      return null; // 無效的符號
    }

    // v1.5.0: winAmount 必須由 caller 提供（根據 outcome.payoutMultiplier * bet）
    // 這裡只返回結構，不計算 winAmount
    // 注意：實際的 winAmount 應該在 simulate.js 中根據 outcome 計算
    // 但為了完整性，我們需要知道如何計算，所以這裡先返回 0，由 simulate.js 覆蓋
    
    return {
      eventId: `LINE_${paylineIndex}_${firstSymbol}_${matchCount}`,
      ruleType: 'LINE',
      winAmount: 0, // 將由 simulate.js 根據 outcome 計算
      paidSymbolId: firstSymbol,
      displaySymbolId: firstSymbol,
      positions: positions,
      matchCount: matchCount,
      paylineIndex: paylineIndex,
      metadata: {}
    };
  }

  /**
   * v1.5.3: 評估 ANY_POSITION pay
   * 
   * 規則：
   * - 計算 grid 上 A1 符號的數量
   * - 如果 a1Count >= 3，產生 WinEvent
   * - 返回所有 A1 符號的位置
   * 
   * 注意：
   * - Evaluator 不應依賴 outcome，只負責檢測 grid 上的 A1 數量
   * - winAmount 由 simulate.js 根據 outcome.payoutMultiplier * bet 設定
   * 
   * @param {Array<Array<string>>} grid - 盤面
   * @returns {Array<WinEvent>} WinEvent 陣列（最多 1 個）
   */
  _evaluateAnyPositionPay(grid) {
    // 查找 ANY_POSITION 符號（A1）
    const anyPositionSymbol = this.symbols.find(s => s.type === 'ANY_POSITION');
    if (!anyPositionSymbol) {
      return [];  // 如果沒有 ANY_POSITION 符號，返回空陣列
    }
    
    const a1SymbolId = anyPositionSymbol.id;
    
    // 計算 A1 數量並收集位置
    const a1Positions = [];
    for (let row = 0; row < grid.length; row++) {
      for (let col = 0; col < grid[row].length; col++) {
        if (grid[row][col] === a1SymbolId) {
          a1Positions.push([row, col]);
        }
      }
    }
    
    const a1Count = a1Positions.length;
    
    // v1.5.3: 最小觸發門檻為 3（可配置，但目前固定為 3）
    if (a1Count >= 3) {
      return [{
        eventId: `ANY_POS_${a1SymbolId}_${a1Count}`,
        ruleType: 'ANY_POSITION',
        winAmount: 0, // 將由 simulate.js 根據 outcome 計算
        paidSymbolId: a1SymbolId,
        displaySymbolId: a1SymbolId,
        positions: a1Positions,
        matchCount: a1Count,
        metadata: {}
      }];
    }
    
    return [];
  }
}

module.exports = { PayRuleEvaluator };

