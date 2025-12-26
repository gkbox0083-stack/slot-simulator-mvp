/**
 * 集中化隨機數生成器（RNG）
 * v1.2.1: 獨立模組（解決循環依賴）
 * v1.5.0 Determinism Fix: 實作 Dual-Mode RNG
 * 
 * 原則：所有隨機行為必須通過此模組，禁止在業務邏輯中直接使用 Math.random()
 * 
 * Dual-Mode:
 * - Legacy mode (seed === null): 使用 Math.random() 保持向後相容
 * - Seeded mode (seed provided): 使用 Linear Congruential Generator (LCG)
 *   公式: seed = (a * seed + c) % m
 *   參數: a = 1664525, c = 1013904223, m = 2^32
 */
class RNG {
  constructor(seed = null) {
    // v1.5.0 Follow-up: Dual-Mode RNG
    if (seed === null || seed === undefined) {
      // Legacy mode: 使用 Math.random() 保持向後相容
      this._mode = 'legacy';
      this._seed = null; // 不需要 seed
    } else {
      // Seeded mode: 使用 LCG
      this._mode = 'seeded';
      // 將 seed 轉為整數（支援字串和數字）
      const seedNum = typeof seed === 'string' ? this._hashString(seed) : Number(seed);
      this._seed = Math.floor(Math.abs(seedNum)) % 2147483647;
      if (this._seed === 0) this._seed = 1; // 避免 seed = 0
      
      // LCG 參數（Numerical Recipes 推薦值）
      this._a = 1664525;
      this._c = 1013904223;
      this._m = 0x100000000; // 2^32
    }
  }

  /**
   * 將字串轉為數字 hash（用於 derived seeds）
   * @param {string} str - 輸入字串
   * @returns {number} Hash 值
   */
  _hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash) || 1;
  }

  /**
   * P0-7 Invariant: Canonical sub-seed derivation
   * 
   * All sub-RNGs MUST use this method.
   * No other seed construction is allowed.
   * 
   * @param {string} kind - 'PATTERN' | 'VISUAL' | future extensions
   * @param {Object} context - Context object
   * @param {string|null} context.mathSeed - Math seed (null for legacy mode)
   * @param {number} context.spinIndex - Spin index
   * @param {string} context.outcomeId - Outcome ID
   * @param {string} [context.patchVersion='v1.5.0'] - Patch version (default: 'v1.5.0')
   * @returns {number} Numeric seed value (for RNG constructor)
   * 
   * @static
   */
  static deriveSubSeed(kind, context) {
    const baseSeed =
      context.mathSeed !== null && context.mathSeed !== undefined
        ? String(context.mathSeed)
        : 'LEGACY';

    const spin = context.spinIndex ?? 0;
    const outcome = context.outcomeId ?? 'UNKNOWN';
    const patch = context.patchVersion ?? 'v1.5.0';

    // DO NOT change format ordering without bumping patchVersion
    const seedString = `${kind}|${baseSeed}|${spin}|${outcome}|${patch}`;
    
    // Convert seed string to numeric hash (centralized hash logic)
    let hash = 0;
    for (let i = 0; i < seedString.length; i++) {
      const char = seedString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    
    // Ensure positive number
    return Math.abs(hash) || 1;
  }

  /**
   * 產生 0 ~ 1 之間的隨機數（[0, 1)，不包含 1）
   * @returns {number} 0 ~ 1 之間的隨機數
   */
  random() {
    if (this._mode === 'legacy') {
      // Legacy mode: 使用 Math.random() 保持向後相容
      return Math.random();
    } else {
      // Seeded mode: 使用 LCG
      // LCG: seed = (a * seed + c) % m
      this._seed = (this._a * this._seed + this._c) % this._m;
      // 轉為 [0, 1) 範圍
      return this._seed / this._m;
    }
  }

  /**
   * 產生 0 ~ max 之間的隨機整數
   * @param {number} max - 最大值（不包含）
   * @returns {number} 0 ~ max-1 之間的隨機整數
   */
  randomInt(max) {
    return Math.floor(this.random() * max);
  }

  /**
   * 從陣列中隨機選擇一個元素
   * @param {Array} array - 陣列
   * @returns {*} 隨機選中的元素
   */
  selectFromArray(array) {
    if (!array || array.length === 0) {
      throw new Error('Cannot select from empty array');
    }
    return array[this.randomInt(array.length)];
  }

  /**
   * 加權隨機選擇：根據權重選擇一個 Outcome
   * @param {Array} outcomes - Outcome 陣列（必須包含 weight 屬性）
   * @returns {Object} 選中的 Outcome
   */
  weightedSelect(outcomes) {
    if (!outcomes || outcomes.length === 0) {
      throw new Error('Cannot select from empty outcomes array');
    }

    // 計算總權重
    const totalWeight = outcomes.reduce((sum, outcome) => {
      if (typeof outcome.weight !== 'number' || outcome.weight < 0) {
        throw new Error(`Invalid weight for outcome: ${outcome.id || 'unknown'}`);
      }
      return sum + outcome.weight;
    }, 0);

    if (totalWeight === 0) {
      throw new Error('Total weight is zero');
    }

    // 產生 0 ~ totalWeight 之間的隨機數
    const random = this.random() * totalWeight;

    // 累加權重，找到落點
    let accumulatedWeight = 0;
    for (const outcome of outcomes) {
      accumulatedWeight += outcome.weight;
      if (random < accumulatedWeight) {
        return outcome;
      }
    }

    // 理論上不會執行到這裡，但為了安全起見返回最後一個
    return outcomes[outcomes.length - 1];
  }
}

module.exports = { RNG };

