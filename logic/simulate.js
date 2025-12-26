const fs = require('fs');
const path = require('path');
const { PatternResolver } = require('./resolver');
const { RNG } = require('./rng');  // v1.2.1: 從獨立模組導入 RNG（解決循環依賴）
const { PayRuleEvaluator } = require('./payRuleEvaluator');  // v1.5.0: Pay Rule Engine

// ============================================================================
// Core Spec v1.0: State Constants
// ============================================================================

/**
 * 遊戲狀態常數定義（Finite State Machine）
 * v1.0 僅支援 BASE <-> FREE 狀態轉換
 */
const STATE = {
  BASE: 'BASE',
  FREE: 'FREE'
};

// ============================================================================
// Core Spec v1.0: Simulation Result Structure
// ============================================================================

/**
 * 模擬結果物件（SimulationResult）
 * 符合 Core Spec v1.0.1 的輸出契約
 */
class SimulationResult {
  constructor() {
    // Metrics
    this.baseGameSpins = 0;        // 模擬的目標次數 (Target)
    this.freeGameSpins = 0;         // 實際執行的 Free Spin 總次數（必須等於 Triggers * freeSpinCount）
                                     // Core Spec v1.0.1: 禁止使用推算，必須由 freeGameSpinsCount 顯式累加
    this.totalBaseBet = 0;          // baseGameSpins * baseBet
    this.baseGameWin = 0;           // Base Game 產生的總贏分
    this.featureWin = 0;             // Free Game 產生的總贏分
    this.totalWin = 0;               // baseGameWin + featureWin
    this.rtp = 0;                    // totalWin / totalBaseBet
    this.hitRate = 0;                // Count(Base Win > 0) / baseGameSpins (Feature Trigger 不計入)

    // Distribution
    this.baseOutcomeDistribution = {};  // BASE 狀態的 Outcome 分布
    this.freeOutcomeDistribution = {};   // FREE 狀態的 Outcome 分布

    // Additional Metrics
    this.triggerCount = 0;           // Free Game 觸發次數
    this.triggerFrequency = 0;       // triggerCount / baseGameSpins
  }

  /**
   * 計算衍生指標
   */
  calculateDerivedMetrics() {
    this.totalWin = this.baseGameWin + this.featureWin;
    this.rtp = this.totalBaseBet > 0 ? (this.totalWin / this.totalBaseBet) * 100 : 0;
    this.triggerFrequency = this.baseGameSpins > 0 
      ? (this.triggerCount / this.baseGameSpins) * 100 
      : 0;
  }
}

// ============================================================================
// Core Spec v1.0: Engine Core Functions
// ============================================================================

/**
 * v1.5.0: Strict Validation
 * 
 * 驗證 expectedWinAmount 與 evaluatedWinAmount 是否一致
 * 
 * @param {Object} outcome - Outcome 物件
 * @param {number} bet - 下注金額（credit）
 * @param {Array} winEvents - WinEvent 陣列
 * @param {boolean} STRICT_MODE - 是否啟用嚴格模式
 * @returns {Object} { expectedWinAmount, evaluatedWinAmount, evaluationMatch }
 */
function validateStrict(outcome, bet, winEvents, STRICT_MODE = true) {
  const expectedWinAmount = Math.round(outcome.payoutMultiplier * bet); // credit int
  const evaluatedWinAmount = winEvents.reduce((sum, e) => sum + (e.winAmount || 0), 0);
  const evaluationMatch = (expectedWinAmount === evaluatedWinAmount);

  if (STRICT_MODE && !evaluationMatch) {
    throw new Error(
      `Validation mismatch: expected=${expectedWinAmount}, evaluated=${evaluatedWinAmount}, ` +
      `outcome=${outcome.id}, events=${JSON.stringify(winEvents)}`
    );
  }

  return { expectedWinAmount, evaluatedWinAmount, evaluationMatch };
}

/**
 * 格式化盤面顯示（ASCII 格式）
 * @param {Array} symbols - 符號陣列
 * @returns {string} 格式化字串
 */
function formatReel(symbols) {
  return symbols.map(s => `[${s}]`).join('');
}

/**
 * 選擇 Outcome（通過集中化 RNG）
 * @param {RNG} rng - 隨機數生成器
 * @param {Object} outcomeTable - Outcome Table（包含 outcomes 陣列）
 * @param {string} state - 當前狀態
 * @returns {Object} 選中的 Outcome
 */
function selectOutcome(rng, outcomeTable, state) {
  if (!outcomeTable || !outcomeTable.outcomes) {
    throw new Error(`Invalid outcome table for state: ${state}`);
  }
  return rng.weightedSelect(outcomeTable.outcomes);
}

// v1.2: selectPattern 函式已移除，改用 PatternResolver

/**
 * v1.1: 計算 Gap 統計指標
 * @param {Array<number>} gaps - Gap 數值陣列
 * @returns {Object} Gap 統計指標
 */
function calculateGapMetrics(gaps) {
  if (gaps.length === 0) {
    return { avgGap: null, medianGap: null, maxGap: null };
  }

  const avgGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  const maxGap = Math.max(...gaps);

  const sorted = [...gaps].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianGap = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];

  return { avgGap, medianGap, maxGap };
}

// ============================================================================
// Core Spec v1.0: Main Simulation Engine
// ============================================================================

/**
 * 執行模擬（符合 Core Spec v1.0）
 * 
 * @param {string} configPath - 設定檔路徑
 * @param {number} targetBaseSpins - 目標 Base Game Spin 次數（預設 10000）
 * @param {number} customBet - 自訂下注金額（可選，預設使用 betConfig.baseBet）
 * @returns {SimulationResult} 模擬結果物件
 */
function simulate(configPath, targetBaseSpins = 10000, customBet = null, customReporter = undefined, csvEnabled = false, overrideConfig = null, customSeed = null) {
  // ========================================================================
  // 1. 讀取並驗證設定檔（Read-Only）
  // v1.3: 支援 overrideConfig（用於 --no-visual 等 CLI 參數）
  // ========================================================================
  let config;
  if (overrideConfig) {
    config = overrideConfig;
  } else {
    try {
      const configData = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(configData);
    } catch (error) {
      console.error('讀取設定檔失敗:', error.message);
      process.exit(1);
    }
  }

  // 驗證設定檔結構
  if (!config.outcomeTables || !config.outcomeTables[STATE.BASE] || !config.outcomeTables[STATE.FREE]) {
    console.error('設定檔格式錯誤：缺少 outcomeTables.BASE 或 outcomeTables.FREE');
    process.exit(1);
  }

  if (!config.featureConfig || typeof config.featureConfig.freeSpinCount !== 'number') {
    console.error('設定檔格式錯誤：缺少 featureConfig.freeSpinCount');
    process.exit(1);
  }

  if (!config.betConfig || typeof config.betConfig.baseBet !== 'number') {
    console.error('設定檔格式錯誤：缺少 betConfig.baseBet');
    process.exit(1);
  }

  // ========================================================================
  // 2. 初始化 RNG（集中化隨機數生成）
  // v1.4: 追蹤 mathSeed 用於 Pattern Generator
  // Determinism: 支援 customSeed 參數（優先於 config.seed）
  // ========================================================================
  // Determinism: 優先使用 customSeed（來自 CLI），否則使用 config.seed，最後使用 'default'
  const mathSeed = customSeed !== null ? String(customSeed) : (config.seed || 'default');
  const rng = new RNG(mathSeed);  // Determinism: 使用 seed 初始化 RNG

  // ========================================================================
  // v1.2: 初始化 Pattern Resolver (僅 BASE 狀態)
  // v1.3: 整合 Visual Constraint Layer
  // v1.5.0: 初始化 Pay Rule Evaluator
  // ========================================================================
  let baseResolver = null;
  let baseEvaluator = null;
  if (config.gameRules && config.gameRules.BASE) {
    const visualConfig = config.visualConfig || { enabled: true, safeFiller: 'L1', maxRetries: 10 };
    baseResolver = new PatternResolver(
      config.gameRules.BASE,
      config.symbols,
      rng,
      visualConfig  // v1.3: 傳遞 visualConfig
    );
    // v1.5.0: 初始化 Pay Rule Evaluator
    baseEvaluator = new PayRuleEvaluator(
      config.gameRules.BASE,
      config.symbols
    );
  }

  // ========================================================================
  // 3. 初始化狀態機
  // ========================================================================
  let currentState = STATE.BASE;
  let freeSpinsRemaining = 0;

  // ========================================================================
  // 4. 初始化 Bet Reference（P3: Bet-centric）
  // ========================================================================
  // 確保使用 betConfig.baseBet 作為參考（Virtual Bet Reference）
  const baseBet = customBet !== null ? customBet : config.betConfig.baseBet;

  // ========================================================================
  // 5. 初始化統計與結果物件
  // ========================================================================
  const result = new SimulationResult();
  result.baseGameSpins = targetBaseSpins;

  // 初始化 Outcome 計數器（v1.1: 加入 Gap 統計）
  config.outcomeTables[STATE.BASE].outcomes.forEach(outcome => {
    result.baseOutcomeDistribution[outcome.id] = { 
      count: 0, 
      percentage: 0,
      avgGap: null,
      medianGap: null,
      maxGap: null
    };
  });

  config.outcomeTables[STATE.FREE].outcomes.forEach(outcome => {
    result.freeOutcomeDistribution[outcome.id] = { 
      count: 0, 
      percentage: 0,
      avgGap: null,      // FREE 狀態永遠為 null
      medianGap: null,   // FREE 狀態永遠為 null
      maxGap: null       // FREE 狀態永遠為 null
    };
  });

  // ========================================================================
  // v1.1: Gap Tracking (僅 BASE 狀態)
  // ========================================================================
  const gapTrackers = {};
  config.outcomeTables[STATE.BASE].outcomes.forEach(outcome => {
    gapTrackers[outcome.id] = {
      gaps: [],
      lastOccurredBaseIndex: null
    };
  });

  // ========================================================================
  // v1.1: Spin Logging (CSV Data Source)
  // ========================================================================
  const spinLog = csvEnabled ? [] : null;
  let globalSpinIndex = 0;
  let currentParentBaseSpin = null;  // 追蹤觸發 Free Game 的 Base Spin

  // v1.4.patch: Visual State (caller-owned, for cooldown/rate limiting)
  const visualState = {
    lastTeaseSpinIndex: undefined,
    teaseWindow: undefined
  };

  // 用於詳細輸出的資料
  const spinDetails = [];
  const stateTransitions = [];
  let baseHitCount = 0;  // 僅計算 Base Game 中 Win > 0 的次數

  console.log('='.repeat(60));
  console.log('Slot Game Core Spec v1.2 - 模擬開始 (Pattern Resolver Layer)');
  console.log('='.repeat(60));
  console.log(`模擬目標: ${targetBaseSpins} 次 Base Game Spins`);
  console.log(`Base Bet: ${baseBet} (來自 betConfig.baseBet)`);
  console.log(`Free Spin 次數: ${config.featureConfig.freeSpinCount}`);
  console.log('說明: Free Game 為 Base Game 的延伸結果，不佔用模擬次數額度');
  console.log('='.repeat(60));
  console.log('');

  // ========================================================================
  // 6. 模擬生命週期迴圈（The Loop）
  // ========================================================================
  // Core Spec v1.0.1: 顯式計數器（禁止使用推算）
  let baseSpins = 0;  // Base Game Spin 計數器
  let freeGameSpinsCount = 0;  // Free Game Spin 顯式計數器（必須等於 Triggers * freeSpinCount）

  while (baseSpins < targetBaseSpins) {
    globalSpinIndex++;
    
    // --------------------------------------------------------------------
    // 6.1 Bet Logic & Counter Updates (The "Check-In" Phase)
    // Core Spec v1.0.1: 必須在狀態切換邏輯發生「之前」進行計數
    // 確保最後一次 Spin 被正確記錄
    // --------------------------------------------------------------------
    if (currentState === STATE.BASE) {
      baseSpins++;
      result.totalBaseBet += baseBet;
      currentParentBaseSpin = baseSpins;  // v1.1: 更新 Parent Base Spin
    } else if (currentState === STATE.FREE) {
      freeGameSpinsCount++;  // 顯式累加 Free Game Spins
    }
    // Free Game 不扣除 Bet（No Deduction in Free）

    // --------------------------------------------------------------------
    // 6.2 Outcome Selection (P1: Outcome-based, via Centralized RNG)
    // --------------------------------------------------------------------
    const outcomeTable = config.outcomeTables[currentState];
    const outcome = selectOutcome(rng, outcomeTable, currentState);

    // --------------------------------------------------------------------
    // 6.3 Pattern Resolution (v1.2: 使用 Pattern Resolver)
    // v1.3: 傳遞 context 給 Visual Constraint Layer
    // v1.4: 傳遞 context 給 Pattern Generator（包含 mathSeed）
    // v1.5.0: Resolver 只生成 grid，不評估中獎
    // v1.5.0 Route A: Free Game 也使用 BASE resolver（fallback to BASE rules）
    // --------------------------------------------------------------------
    let patternResult;
    
    // v1.5.0 Route A: 確定有效的 game rule（FREE 使用 BASE 作為 fallback）
    const effectiveGameRule = config.gameRules[currentState] || config.gameRules.BASE;
    
    // v1.5.0 Route A: 所有狀態都使用 baseResolver（如果存在）
    if (baseResolver && effectiveGameRule) {
      // v1.3/v1.4: 建立 context（包含 spinIndex, mathSeed, outcomeId）
      // v1.4.patch: 加入 visualState（caller-owned，用於 cooldown/rate limiting）
      // Phase C: visualSeed 由 visualConstraint.js 統一推導（不在此處設定）
      const context = {
        spinIndex: globalSpinIndex,
        mathSeed: mathSeed,  // v1.4: 用於 Pattern Generator 和 Visual Seed 推導
        outcomeId: outcome.id,  // v1.4: 用於 Pattern Generator 和 Visual Seed 推導
        visualState: visualState,  // v1.4.patch: caller-owned state for visual layer
        state: currentState  // v1.5.0 Route A: 傳遞狀態資訊（雖然 resolver 使用 BASE rules）
      };
      patternResult = baseResolver.resolve(outcome, context);
      
      // v1.5.0 Route A: 驗證 grid 必須有效（禁止 placeholder）
      if (!patternResult.grid || patternResult.grid.length === 0) {
        throw new Error(
          `${currentState} game must produce a valid grid (outcome=${outcome.id})`
        );
      }
    } else {
      throw new Error(
        `Resolver not available for state=${currentState}, outcome=${outcome.id}`
      );
    }

    // --------------------------------------------------------------------
    // v1.5.0: Pay Rule Evaluation (Single Evaluation Point)
    // v1.5.0 Route A: 所有狀態都必須評估（包括 FREE）
    // --------------------------------------------------------------------
    let winEvents = [];
    if (baseEvaluator && patternResult.grid && patternResult.grid.length > 0) {
      winEvents = baseEvaluator.evaluate(patternResult.grid, {});
      
      // v1.5.0: 設定 winAmount（根據 outcome.payoutMultiplier * bet）
      // 注意：只有 WIN 類型的 outcome 才會有 winEvents
      if (outcome.type === 'WIN' && winEvents.length > 0) {
        const expectedWinAmount = Math.round(outcome.payoutMultiplier * baseBet); // credit int
        winEvents[0].winAmount = expectedWinAmount;
      }
    } else {
      // v1.5.0 Route A: 如果 evaluator 或 grid 無效，這是嚴重錯誤
      throw new Error(
        `Evaluator or grid invalid for state=${currentState}, outcome=${outcome.id}`
      );
    }

    // --------------------------------------------------------------------
    // v1.5.0: Strict Validation
    // --------------------------------------------------------------------
    const STRICT_MODE = true;
    const validationResult = validateStrict(outcome, baseBet, winEvents, STRICT_MODE);
    
    // v1.5.0: 使用 evaluatedWinAmount（如果存在），否則使用 expectedWinAmount
    const evaluatedWinAmount = validationResult.evaluatedWinAmount;
    const winAmount = evaluatedWinAmount !== undefined ? evaluatedWinAmount : validationResult.expectedWinAmount;

    // --------------------------------------------------------------------
    // v1.5.0: Visual Constraint（在 evaluator 之後，使用 winEvents）
    // v1.5.0 Route A: 所有狀態都必須應用 visual constraint（包括 FREE）
    // --------------------------------------------------------------------
    if (baseResolver && baseResolver.visualEngine && patternResult.grid && patternResult.grid.length > 0) {
      const context = {
        spinIndex: globalSpinIndex,
        mathSeed: mathSeed,
        outcomeId: outcome.id,
        visualState: visualState
      };
      
      const visualResult = baseResolver.visualEngine.applyConstraints(
        patternResult.grid,
        outcome,
        winEvents,  // v1.5.0: 傳入 winEvents
        context,
        patternResult.winLine  // v1.5.0: legacy fallback
      );
      
      patternResult.grid = visualResult.grid;
      patternResult.visualTelemetry = visualResult.telemetry;
    }

    // --------------------------------------------------------------------
    // 6.4 State Transition Logic (P2: FSM)
    // Core Spec v1.0.2: 修復 Off-by-one 錯誤
    // --------------------------------------------------------------------
    let stateChanged = false;
    const previousState = currentState;  // 記錄 Spin 時的狀態（用於統計）
    let justTriggered = false;  // 標記是否剛觸發 Free Game

    // Transition Rule: BASE -> FREE (當 Outcome Type 為 FEATURE 時觸發)
    if (currentState === STATE.BASE && outcome.type === 'FEATURE') {
      currentState = STATE.FREE;
      freeSpinsRemaining = config.featureConfig.freeSpinCount;  // 設定為 10
      result.triggerCount++;
      stateChanged = true;
      justTriggered = true;  // 標記剛觸發，當次迴圈不得再進行 decrement
      stateTransitions.push({
        baseSpin: baseSpins,
        from: previousState,
        to: currentState,
        trigger: outcome.id,
        freeSpinsRemaining: freeSpinsRemaining
      });
    }

    // Transition Rule: FREE -> BASE (當 freeSpinsRemaining 歸零時觸發)
    // Core Spec v1.0.2: 只有在已經處於 FREE 狀態且不是剛觸發的情況下，才進行 decrement
    if (currentState === STATE.FREE && !justTriggered) {
      // Standard Free Spin Logic: 10 -> 9 ... 1 -> 0
      freeSpinsRemaining--;
      if (freeSpinsRemaining <= 0) {
        currentState = STATE.BASE;
        freeSpinsRemaining = 0;
        stateChanged = true;
        stateTransitions.push({
          baseSpin: baseSpins,
          from: 'FREE',
          to: STATE.BASE,
          reason: 'Free Spins Exhausted'
        });
      }
    }

    // --------------------------------------------------------------------
    // 6.5 Accumulate Win (P3: Virtual Bet Reference)
    // v1.5.0: winAmount 已在上方由 validateStrict 計算（使用 evaluatedWinAmount）
    // --------------------------------------------------------------------

    // 根據 Spin 時的狀態（previousState）進行統計
    if (previousState === STATE.BASE) {
      result.baseGameWin += winAmount;
      // Hit Rate: 僅計算 Base Game 中 Win > 0 的次數（Feature Trigger 不計入）
      if (outcome.type === 'WIN' && winAmount > 0) {
        baseHitCount++;
      }
      result.baseOutcomeDistribution[outcome.id].count++;
      
      // v1.1: Gap Tracking (僅 BASE 狀態)
      const tracker = gapTrackers[outcome.id];
      if (tracker) {
        if (tracker.lastOccurredBaseIndex === null) {
          // 第一次出現: 僅初始化
          tracker.lastOccurredBaseIndex = baseSpins;
        } else {
          // 第二次及之後: 記錄 Gap
          const gap = baseSpins - tracker.lastOccurredBaseIndex;
          tracker.gaps.push(gap);
          tracker.lastOccurredBaseIndex = baseSpins;
        }
      }
    } else if (previousState === STATE.FREE) {
      result.featureWin += winAmount;
      result.freeOutcomeDistribution[outcome.id].count++;
    }

    // v1.1: Spin Logging (CSV Data Source)
    if (spinLog) {
      const baseSpinIndex = previousState === STATE.BASE 
        ? baseSpins 
        : currentParentBaseSpin;  // FREE 狀態使用觸發的 Base Spin
      
      const triggeredFeatureId = outcome.type === 'FEATURE' 
        ? outcome.id 
        : '';
      
      // v1.4.patch_tease_diag_fix: 收集 telemetry（如果存在，已 finalize）
      const visualTelemetry = patternResult.visualTelemetry || null;
      
      // v1.4.patch_tease_diag_fix: visualPaylinesChosen 保持為陣列（CSV exporter 會處理）
      const visualPaylinesChosen = visualTelemetry 
        ? (Array.isArray(visualTelemetry.visualPaylinesChosen) 
            ? visualTelemetry.visualPaylinesChosen 
            : [])
        : [];
      
      // v1.4.patch_tease_diag_fix: visualAttemptReasons 已經是字串（在 finalization 中處理）
      const visualAttemptReasons = visualTelemetry 
        ? (typeof visualTelemetry.visualAttemptReasons === 'string'
            ? visualTelemetry.visualAttemptReasons
            : (Array.isArray(visualTelemetry.visualAttemptReasons) 
                ? visualTelemetry.visualAttemptReasons.join(';')
                : ''))
        : '';
      
      // v1.5.0: 準備 shadow mode 欄位
      const evaluatedEventCount = winEvents ? winEvents.length : 0;
      const evaluatedRuleTypes = winEvents && winEvents.length > 0
        ? winEvents.map(e => e.ruleType).join('|')
        : '';
      const eventsJson = winEvents && winEvents.length > 0
        ? JSON.stringify(winEvents)
        : '';
      
      spinLog.push({
        globalSpinIndex: globalSpinIndex,
        baseSpinIndex: baseSpinIndex,
        state: previousState,
        outcomeId: outcome.id,
        type: outcome.type,
        winAmount: winAmount,  // v1.5.0: 使用 evaluatedWinAmount（如果存在）
        triggeredFeatureId: triggeredFeatureId,
        // v1.4: Pattern Generation 資訊
        patternSource: patternResult.patternSource || 'NONE',
        winConditionType: patternResult.winConditionType || null,
        generatedWinLine: patternResult.winLine !== null ? patternResult.winLine : null,
        anchorsCount: patternResult.anchorsCount || 0,
        // Phase A3: Visual Telemetry（已 finalize）
        visualRequestedType: visualTelemetry ? visualTelemetry.visualRequestedType : 'NONE',
        visualAppliedType: visualTelemetry ? visualTelemetry.visualAppliedType : 'NONE',
        visualApplied: visualTelemetry ? visualTelemetry.visualApplied : false,
        visualPaylinesChosen: visualPaylinesChosen,  // v1.4.patch_tease_diag_fix: 保持為陣列
        visualAttemptsUsed: visualTelemetry ? visualTelemetry.visualAttemptsUsed : 0,
        visualGuardFailReason: visualTelemetry ? (visualTelemetry.visualGuardFailReason || '') : '',
        visualSeed: visualTelemetry ? visualTelemetry.visualSeed : '',
        // v1.4.patch: Tease Probability fields
        teaseEligible: visualTelemetry ? (visualTelemetry.teaseEligible || false) : false,
        teaseChanceUsed: visualTelemetry ? (visualTelemetry.teaseChanceUsed !== null && visualTelemetry.teaseChanceUsed !== undefined ? visualTelemetry.teaseChanceUsed : null) : null,
        teaseRoll: visualTelemetry ? (visualTelemetry.teaseRoll !== null && visualTelemetry.teaseRoll !== undefined ? visualTelemetry.teaseRoll : null) : null,
        teaseBlockedBy: visualTelemetry ? (visualTelemetry.teaseBlockedBy || 'NONE') : 'NONE',
        // v1.4.patch_tease_diag_fix: Guard Diagnostics fields（已 finalize，成功案例已清理）
        visualGuardFailDetail: visualTelemetry ? (visualTelemetry.visualGuardFailDetail || '') : '',
        visualAttemptReasons: visualAttemptReasons,  // v1.4.patch_tease_diag_fix: 已經是字串
        // v1.5.0: Shadow Mode fields
        expectedWinAmount: validationResult.expectedWinAmount,
        evaluatedWinAmount: validationResult.evaluatedWinAmount,
        evaluationMatch: validationResult.evaluationMatch,
        evaluatedEventCount: evaluatedEventCount,
        evaluatedRuleTypes: evaluatedRuleTypes,
        eventsJson: eventsJson
      });
    }

    // --------------------------------------------------------------------
    // 6.6 記錄詳細資訊（用於輸出）
    // --------------------------------------------------------------------
    if (spinDetails.length < 20) {
      spinDetails.push({
        baseSpin: previousState === STATE.BASE ? baseSpins : null,
        state: previousState,
        outcome: outcome,
        patternResult: patternResult,  // v1.2: 改用 patternResult (包含 grid 和 winLine)
        winAmount: winAmount,
        stateAfter: currentState,
        freeSpinsRemaining: freeSpinsRemaining,
        stateChanged: stateChanged
      });
    }
  }

  // ========================================================================
  // 7. 計算衍生指標
  // ========================================================================
  // Core Spec v1.0.1: 使用顯式計數器設定 freeGameSpins
  result.freeGameSpins = freeGameSpinsCount;  // 必須等於 Triggers * freeSpinCount
  result.calculateDerivedMetrics();
  result.hitRate = result.baseGameSpins > 0 
    ? (baseHitCount / result.baseGameSpins) * 100 
    : 0;

  // 計算 Outcome Distribution 的百分比
  Object.keys(result.baseOutcomeDistribution).forEach(outcomeId => {
    const count = result.baseOutcomeDistribution[outcomeId].count;
    result.baseOutcomeDistribution[outcomeId].percentage = 
      result.baseGameSpins > 0 ? (count / result.baseGameSpins) * 100 : 0;
  });

  Object.keys(result.freeOutcomeDistribution).forEach(outcomeId => {
    const count = result.freeOutcomeDistribution[outcomeId].count;
    result.freeOutcomeDistribution[outcomeId].percentage = 
      result.freeGameSpins > 0 ? (count / result.freeGameSpins) * 100 : 0;
  });

  // v1.1: 計算 Gap 統計
  Object.keys(gapTrackers).forEach(outcomeId => {
    const tracker = gapTrackers[outcomeId];
    const gaps = tracker.gaps;
    const metrics = calculateGapMetrics(gaps);
    result.baseOutcomeDistribution[outcomeId].avgGap = metrics.avgGap;
    result.baseOutcomeDistribution[outcomeId].medianGap = metrics.medianGap;
    result.baseOutcomeDistribution[outcomeId].maxGap = metrics.maxGap;
  });

  // ========================================================================
  // 8. 輸出結果（可選）
  // ========================================================================
  // 如果沒有提供 customReporter，使用內建輸出
  if (typeof customReporter === 'undefined') {
    printSimulationResults(result, config, spinDetails, stateTransitions, targetBaseSpins, baseBet);
  }

  // 返回完整資料（包含詳細資訊）
  return {
    result: result,
    config: config,
    spinDetails: spinDetails,
    stateTransitions: stateTransitions,
    targetBaseSpins: targetBaseSpins,
    baseBet: baseBet,
    spinLog: spinLog  // v1.1: CSV 資料來源
  };
}

// ============================================================================
// Output Formatter
// ============================================================================

/**
 * 輸出模擬結果
 */
function printSimulationResults(result, config, spinDetails, stateTransitions, targetBaseSpins, baseBet) {
  // v1.2: 此函式已被 reporter.js 取代，保留僅作為備用
  // 輸出前 20 次的詳細結果
  console.log('前 20 次模擬 Spin 詳細結果:');
  console.log('-'.repeat(60));
  spinDetails.forEach((detail, index) => {
    const stateLabel = detail.state === STATE.BASE ? 'BASE' : 'FREE';
    const baseSpinLabel = detail.baseSpin !== null ? `[Base #${detail.baseSpin}]` : '[Free]';
    const outcomeInfo = `${detail.outcome.id} (${detail.outcome.type})`;
    const winInfo = detail.winAmount > 0 ? `Win: ${detail.winAmount}` : 'Win: 0';
    const freeSpinsInfo = detail.stateAfter === STATE.FREE 
      ? ` | Free Spins: ${detail.freeSpinsRemaining}` 
      : '';
    const transitionInfo = detail.stateChanged
      ? (detail.state === STATE.BASE && detail.stateAfter === STATE.FREE 
          ? ' >>> Enter Free Game' 
          : ' <<< Back to Base')
      : '';
    
    // v1.2: 使用 grid 格式顯示
    const gridDisplay = detail.patternResult && detail.patternResult.grid
      ? formatGrid(detail.patternResult.grid)
      : '[Empty Grid]';
    const winLineInfo = detail.patternResult && detail.patternResult.winLine !== null
      ? ` | Win Line: ${detail.patternResult.winLine + 1}`
      : '';

    console.log(`#${index + 1} ${baseSpinLabel} [${stateLabel}]:`);
    console.log(gridDisplay);
    console.log(`  → ${outcomeInfo} - ${winInfo}${winLineInfo}${freeSpinsInfo}${transitionInfo}`);
    console.log('');
  });

  // 輸出狀態切換摘要
  if (stateTransitions.length > 0) {
    console.log('狀態切換摘要:');
    console.log('-'.repeat(60));
    stateTransitions.slice(0, 10).forEach(transition => {
      if (transition.trigger) {
        console.log(
          `Base Spin #${transition.baseSpin}: ${transition.from} -> ${transition.to} ` +
          `(Trigger: ${transition.trigger}, Free Spins: ${transition.freeSpinsRemaining})`
        );
      } else {
        console.log(
          `Base Spin #${transition.baseSpin}: ${transition.from} -> ${transition.to} (${transition.reason})`
        );
      }
    });
    if (stateTransitions.length > 10) {
      console.log(`... 還有 ${stateTransitions.length - 10} 次狀態切換`);
    }
    console.log('');
  }

  // 計算總權重（用於顯示理論機率）
  const baseTotalWeight = config.outcomeTables[STATE.BASE].outcomes.reduce(
    (sum, outcome) => sum + outcome.weight, 0
  );
  const freeTotalWeight = config.outcomeTables[STATE.FREE].outcomes.reduce(
    (sum, outcome) => sum + outcome.weight, 0
  );

  // 輸出最終統計
  console.log('='.repeat(60));
  console.log('最終統計數據 (SimulationResult)');
  console.log('='.repeat(60));
  console.log(`模擬目標: ${targetBaseSpins} 次 Base Game Spins`);
  console.log('');
  console.log(`Base Game Spins: ${result.baseGameSpins} (必須精準等於 ${targetBaseSpins})`);
  console.log(`Free Game Spins: ${result.freeGameSpins} (顯式累加，必須等於 ${result.triggerCount} × ${config.featureConfig.freeSpinCount} = ${result.triggerCount * config.featureConfig.freeSpinCount})`);
  console.log('');
  console.log(`Total Base Bet: ${result.totalBaseBet} (應該等於 ${result.baseGameSpins} × ${baseBet} = ${result.baseGameSpins * baseBet})`);
  console.log(`Total Win: ${result.totalWin}`);
  console.log(`  - Base Game Win: ${result.baseGameWin}`);
  console.log(`  - Feature Win: ${result.featureWin}`);
  console.log('');
  console.log(`RTP 計算公式: Total Win / Total Base Bet`);
  console.log(`RTP: ${result.rtp.toFixed(2)}%`);
  console.log('');
  console.log(`Hit Rate: ${result.hitRate.toFixed(2)}% (Count(Base Win > 0) / baseGameSpins, Feature Trigger 不計入)`);
  console.log('');
  console.log(`Free Game Triggers: ${result.triggerCount}`);
  console.log(`Trigger Frequency: ${result.triggerFrequency.toFixed(2)}%`);
  console.log('');

  // 輸出 BASE 狀態的 Outcome Distribution
  console.log('BASE Game Outcome Distribution:');
  console.log('-'.repeat(60));
  config.outcomeTables[STATE.BASE].outcomes.forEach(outcome => {
    const dist = result.baseOutcomeDistribution[outcome.id];
    const theoreticalPercentage = (outcome.weight / baseTotalWeight) * 100;
    console.log(
      `${outcome.id.padEnd(25)} | ` +
      `次數: ${String(dist.count).padStart(5)} | ` +
      `實際: ${dist.percentage.toFixed(2)}% | ` +
      `理論: ${theoreticalPercentage.toFixed(2)}% | ` +
      `Type: ${outcome.type}`
    );
  });
  console.log('');

  // 輸出 FREE 狀態的 Outcome Distribution
  console.log('FREE Game Outcome Distribution:');
  console.log('-'.repeat(60));
  config.outcomeTables[STATE.FREE].outcomes.forEach(outcome => {
    const dist = result.freeOutcomeDistribution[outcome.id];
    const theoreticalPercentage = (outcome.weight / freeTotalWeight) * 100;
    console.log(
      `${outcome.id.padEnd(25)} | ` +
      `次數: ${String(dist.count).padStart(5)} | ` +
      `實際: ${dist.percentage.toFixed(2)}% | ` +
      `理論: ${theoreticalPercentage.toFixed(2)}% | ` +
      `Type: ${outcome.type}`
    );
  });
  console.log('='.repeat(60));
}

// ============================================================================
// Module Exports
// ============================================================================

// 如果直接執行此檔案，執行模擬
if (require.main === module) {
  const configPath = path.join(__dirname, 'design.json');
  const targetBaseSpins = parseInt(process.argv[2]) || 10000;
  const customBet = process.argv[3] ? parseFloat(process.argv[3]) : null;

  simulate(configPath, targetBaseSpins, customBet);
}

module.exports = {
  simulate,
  STATE,
  SimulationResult,
  selectOutcome
  // v1.2: selectPattern 已移除，改用 PatternResolver
  // v1.2.1: RNG 已移至獨立模組 logic/rng.js
};
