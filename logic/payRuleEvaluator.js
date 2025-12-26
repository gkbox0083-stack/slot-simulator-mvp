/**
 * v1.5.0: Pay Rule Evaluator
 * 
 * 核心原則：
 * - Single Evaluation Point：由 simulate.js 統一呼叫
 * - Truth Source：Outcome 定義 expected payout，Evaluator 為 deterministic verifier
 * - 不修改 grid，只讀取並評估
 * - v1.5.0 僅支援 LINE rule（單事件）
 */

/**
 * WinEvent 結構（v1.5.0）
 * 
 * @typedef {Object} WinEvent
 * @property {string} eventId - 事件 ID（唯一識別）
 * @property {string} ruleType - 規則類型（'LINE'）
 * @property {number} winAmount - 贏分（credit int）
 * @property {string} paidSymbolId - 支付符號 ID
 * @property {string} displaySymbolId - 顯示符號 ID（通常等於 paidSymbolId）
 * @property {Array<[number, number]>} positions - 中獎位置陣列 [[row, col], ...]
 * @property {number} [matchCount] - 連線數量
 * @property {number} [paylineIndex] - Payline 索引
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
   * @returns {Array<WinEvent>} WinEvent 陣列（v1.5.0 限制：0~1 個事件）
   */
  evaluate(grid, ruleContext = {}) {
    if (!grid || grid.length === 0) {
      return [];
    }

    // v1.5.0: 僅支援 LINE rule
    const winEvents = [];
    
    // 評估所有 paylines
    for (let paylineIndex = 0; paylineIndex < this.paylines.length; paylineIndex++) {
      const payline = this.paylines[paylineIndex];
      const lineEvent = this._evaluateLinePay(grid, payline, paylineIndex);
      
      if (lineEvent) {
        winEvents.push(lineEvent);
        // v1.5.0 限制：只返回第一個匹配的事件（單事件模式）
        break;
      }
    }

    // v1.5.0 限制：確保最多 1 個事件
    return winEvents.slice(0, 1);
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
}

module.exports = { PayRuleEvaluator };

