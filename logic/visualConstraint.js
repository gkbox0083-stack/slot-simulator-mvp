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
    
    // Phase A1: Config Schema Extension (Backward Compatible)
    // 提供預設值，確保向後相容
    const defaultConfig = {
      enabled: true,
      safeFiller: 'L1',
      maxRetries: 10,
      seedStrategy: 'DERIVED',
      patchVersion: 'v1.4.patch',
      nearMiss: {
        enabled: true,
        multiLineCountRange: [1, 2]
      },
      tease: {
        enabled: true,
        targetOutcomeIds: ['SMALL_WIN', 'FREE_SMALL_WIN']
      }
    };
    
    // 合併配置（向後相容）
    this.visualConfig = {
      ...defaultConfig,
      ...visualConfig,
      nearMiss: {
        ...defaultConfig.nearMiss,
        ...(visualConfig && visualConfig.nearMiss || {})
      },
      tease: {
        ...defaultConfig.tease,
        ...(visualConfig && visualConfig.tease || {})
      }
    };
    
    // Phase B: Forward-Compatibility Guard
    // 禁止在 Visual Layer 使用 WILD/SCATTER/BONUS 符號
    this.forbiddenSymbolsInVisual = ['WILD', 'SCATTER', 'BONUS'];
    
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
   * Phase A2: Telemetry Contract
   * 返回格式：{ grid, telemetry }
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
   * @returns {Object} { grid, telemetry }
   */
  /**
   * v1.5.0: 更新簽名，加入 winEvents 參數
   * 
   * @param {Array<Array<string>>} grid - 盤面
   * @param {Object} outcome - Outcome 物件
   * @param {Array} winEvents - WinEvent 陣列（v1.5.0 新增）
   * @param {Object} context - Context 物件
   * @param {number|null} legacyWinLine - Legacy winLine（v1.5.0 過渡期暫留）
   * @returns {Object} { grid, telemetry }
   */
  applyConstraints(grid, outcome, winEvents = [], context = null, legacyWinLine = null) {
    // v1.4.patch: 初始化 telemetry（包含新欄位）
    const telemetry = {
      visualRequestedType: 'NONE',
      visualAppliedType: 'NONE',
      visualApplied: false,
      visualPaylinesChosen: [],
      visualAttemptsUsed: 0,
      visualGuardFailReason: null,
      visualSeed: '',
      // v1.4.patch: Tease probability fields
      teaseEligible: false,
      teaseChanceUsed: 0,
      teaseRoll: null,
      teaseBlockedBy: 'NONE',
      // v1.4.patch: Guard diagnostics fields
      visualGuardFailDetail: null,
      visualAttemptReasons: []
    };
    
    // 如果 Visual Layer 被關閉，直接返回原始 grid + telemetry
    if (!this.visualConfig.enabled) {
      return { grid, telemetry };
    }

    // v1.4.x: 改進 context 處理（fallback + warning）
    const safeContext = this._ensureContext(context, outcome);
    if (!safeContext) {
      console.warn(`[VisualConstraint] context 不完整，使用預設值: ${outcome.id}`);
      return { grid, telemetry };  // 如果 context 完全無效，回退原始 grid
    }

    // Phase C: Derived Seed Unification
    // 建立獨立的 Visual RNG（使用 derived visual seed，包含 patchVersion）
    const visualSeed = this._deriveVisualSeed(safeContext);
    telemetry.visualSeed = String(visualSeed);
    const visualRng = new RNG(visualSeed);

    // 深拷貝 grid（避免修改原始 grid）
    let processedGrid = grid.map(row => [...row]);
    const baseGrid = grid.map(row => [...row]);  // 保存原始 grid 作為 fallback

    // v1.5.0: 推導 protectedCells（嚴格順序：winEvents.positions > legacyWinLine > empty）
    const protectedCells = this._deriveProtectedCells(winEvents, legacyWinLine, outcome);

    // ========================================================================
    // Phase 1: Feature Patch (Near Miss / Tease)
    // ========================================================================
    // v1.4.patch: 使用新的 shouldTease 方法（包含機率、cooldown、rate limit）
    const teaseCheck = this.shouldTease(outcome, visualRng, safeContext);
    
    // 記錄 tease telemetry
    telemetry.teaseEligible = teaseCheck.eligible;
    telemetry.teaseChanceUsed = teaseCheck.chanceUsed;
    telemetry.teaseRoll = teaseCheck.roll;
    telemetry.teaseBlockedBy = teaseCheck.blockedBy;

    if (teaseCheck.requested) {
      // 通過所有檢查，請求 Tease
      telemetry.visualRequestedType = 'TEASE';
      
      // 更新 visualState（如果存在）
      const visualState = safeContext.visualState;
      if (visualState) {
        visualState.lastTeaseSpinIndex = safeContext.spinIndex || 0;
        
        // 更新 rate limit window
        if (visualState.teaseWindow) {
          visualState.teaseWindow.count = (visualState.teaseWindow.count || 0) + 1;
        }
      }
      
      // v1.5.0: 從 winEvents 推導 winLine（用於 _applyTease，過渡期相容）
      const teaseWinLine = winEvents && winEvents.length > 0 && winEvents[0].paylineIndex !== undefined
        ? winEvents[0].paylineIndex
        : legacyWinLine;
      
      const teaseResult = this._applyTease(processedGrid, outcome, teaseWinLine, visualRng, telemetry, protectedCells);
      processedGrid = teaseResult.grid;
      Object.assign(telemetry, teaseResult.telemetry);
    } else if (this.isNearMiss(outcome)) {
      telemetry.visualRequestedType = 'NEAR_MISS';
      const nearMissResult = this._applyNearMiss(processedGrid, outcome, visualRng, telemetry);
      processedGrid = nearMissResult.grid;
      Object.assign(telemetry, nearMissResult.telemetry);
    }

    // ========================================================================
    // Phase 2: General Visual Optimization (v1.3 behaviors)
    // v1.5.0: 使用 protectedCells（從 winEvents 推導）
    // ========================================================================
    if (outcome.type === 'WIN') {
      // v1.5.0: 從 winEvents 推導 winLine（過渡期相容）
      const winLineForOpt = winEvents && winEvents.length > 0 && winEvents[0].paylineIndex !== undefined
        ? winEvents[0].paylineIndex
        : legacyWinLine;
      processedGrid = this._applyWinGeneralOptimization(processedGrid, outcome, winLineForOpt, visualRng, protectedCells);
    } else if (outcome.type === 'LOSS' || this.isNearMiss(outcome)) {
      processedGrid = this._applyLossGeneralOptimization(processedGrid, outcome, visualRng);
    }

    // ========================================================================
    // Phase 3: Mandatory Safety Scans + Retry/Fallback
    // ========================================================================
    const maxRetries = this.visualConfig.maxRetries || 10;
    
    // v1.4.patch_tease_diag_fix: 使用內部變數追蹤 attempt-level failures
    let lastFailReason = null;
    let lastFailDetail = null;
    
    // v1.5.0: 推導 expectedWinLine（用於後續檢查）
    const expectedWinLine = winEvents && winEvents.length > 0 && winEvents[0].paylineIndex !== undefined
      ? winEvents[0].paylineIndex
      : legacyWinLine;
    
    for (let retry = 0; retry < maxRetries; retry++) {
      telemetry.visualAttemptsUsed = retry + 1;
      
      // Phase B: 檢查是否包含禁止符號
      const forbiddenSymbolResult = this._checkForbiddenSymbols(processedGrid, outcome, expectedWinLine);
      if (forbiddenSymbolResult.detected) {
        // v1.4.patch_tease_diag_fix: 只記錄到 attempt history，不寫入 final-fail fields
        telemetry.visualAttemptReasons.push('FORBIDDEN_SYMBOL_DETECTED');
        lastFailReason = 'FORBIDDEN_SYMBOL_DETECTED';
        lastFailDetail = forbiddenSymbolResult.detail;
        
        // 如果驗證失敗，重新應用 Phase 2（保留 Phase 1 的結果）
        if (outcome.type === 'WIN') {
          processedGrid = this._applyWinGeneralOptimization(processedGrid, outcome, expectedWinLine, visualRng, protectedCells);
        } else {
          processedGrid = this._applyLossGeneralOptimization(processedGrid, outcome, visualRng);
        }
        continue;
      }
      
      // v1.5.0: 驗證安全性（使用 winEvents 推導 expectedWinLine）
      const safetyResult = this._validateSafety(processedGrid, outcome, expectedWinLine);
      if (safetyResult.isSafe) {
        // v1.4.patch_tease_diag_fix: 成功時記錄到 attempt history
        telemetry.visualAttemptReasons.push('SUCCESS');
        // 成功時不設定 visualApplied，將在 finalization 階段統一處理
        telemetry.visualAppliedType = telemetry.visualRequestedType;
        // v1.4.patch_tease_diag_fix: 在 finalization 前先清理 final-fail fields（雖然會在 finalization 再清理一次，但確保一致性）
        telemetry.visualGuardFailReason = '';
        telemetry.visualGuardFailDetail = '';
        // Finalization 將在 return 前執行
        return this._finalizeTelemetry(telemetry, processedGrid);
      }
      
      // v1.4.patch_tease_diag_fix: 記錄 guard fail reason 到 attempt history，不直接寫入 final-fail fields
      if (safetyResult.reason) {
        telemetry.visualAttemptReasons.push(safetyResult.reason);
        lastFailReason = safetyResult.reason;
      }
      
      if (safetyResult.detail) {
        lastFailDetail = safetyResult.detail;
      }

      // 如果驗證失敗，重新應用 Phase 2（保留 Phase 1 的結果）
      if (outcome.type === 'WIN') {
        processedGrid = this._applyWinGeneralOptimization(processedGrid, outcome, expectedWinLine, visualRng, protectedCells);
      } else {
        processedGrid = this._applyLossGeneralOptimization(processedGrid, outcome, visualRng);
      }
    }

    // v1.4.patch_tease_diag_fix: 如果重試失敗，fallback 到 baseGrid
    telemetry.visualAppliedType = 'NONE';
    telemetry.visualAttemptReasons.push('MAX_RETRIES');
    lastFailReason = 'MAX_RETRIES';
    lastFailDetail = {
      type: 'MAX_RETRIES',
      maxRetries: maxRetries,
      finalReason: lastFailReason
    };
    
    // v1.4.patch_tease_diag_fix: 只在最終失敗時設定 final-fail fields
    telemetry.visualGuardFailReason = lastFailReason;
    telemetry.visualGuardFailDetail = lastFailDetail ? JSON.stringify(lastFailDetail) : '';
    
    console.warn(`[VisualConstraint] 無法通過安全檢查，fallback 到 baseGrid: ${outcome.id}`);
    return this._finalizeTelemetry(telemetry, baseGrid);
  }

  /**
   * v1.4.patch_tease_diag_fix: Telemetry finalization
   * 
   * 確保 telemetry 語義正確：
   * 1. visualApplied = (visualAppliedType !== "NONE")
   * 2. 成功時清理 final-fail fields
   * 3. 無請求時清理 final-fail fields
   */
  _finalizeTelemetry(telemetry, finalGrid) {
    // 1. Normalize visualApplied according to visualAppliedType
    telemetry.visualApplied = telemetry.visualAppliedType !== 'NONE';
    
    // 2. Check if a visual effect was requested
    const requested = telemetry.visualRequestedType && telemetry.visualRequestedType !== 'NONE';
    
    // 3. Finalize final-fail fields
    if (telemetry.visualApplied) {
      // Success: clear final-fail fields
      telemetry.visualGuardFailReason = '';
      telemetry.visualGuardFailDetail = '';
    } else {
      // Failure: only keep final-fail fields if a visual effect was requested
      if (!requested) {
        // No request → clear final-fail fields
        telemetry.visualGuardFailReason = '';
        telemetry.visualGuardFailDetail = '';
      }
      // else: keep final-fail fields (already set in retry loop)
    }
    
    // 4. Ensure visualAttemptReasons is a string (join if array)
    if (Array.isArray(telemetry.visualAttemptReasons)) {
      telemetry.visualAttemptReasons = telemetry.visualAttemptReasons.join(';');
    }
    
    // 5. Ensure visualPaylinesChosen is an array (for CSV encoding)
    if (!Array.isArray(telemetry.visualPaylinesChosen)) {
      telemetry.visualPaylinesChosen = [];
    }
    
    return { grid: finalGrid, telemetry };
  }

  /**
   * v1.5.0: 推導 protectedCells（嚴格順序）
   * 
   * Priority 1: use winEvents[0].positions (no guessing)
   * Priority 2: fallback to legacyWinLine (v1.5.0 transitional only)
   * Priority 3: LOSS → protectedCells empty
   * 
   * @param {Array} winEvents - WinEvent 陣列
   * @param {number|null} legacyWinLine - Legacy winLine（過渡期）
   * @param {Object} outcome - Outcome 物件
   * @returns {Set<string>} protectedCells（cellKey 格式："row,col"）
   */
  _deriveProtectedCells(winEvents, legacyWinLine, outcome) {
    const protectedCells = new Set();
    
    // Priority 1: use winEvents[0].positions (no guessing)
    if (winEvents && winEvents.length > 0 && winEvents[0].positions && winEvents[0].positions.length > 0) {
      winEvents[0].positions.forEach(([row, col]) => {
        protectedCells.add(`${row},${col}`);
      });
      return protectedCells;
    }
    
    // Priority 2: fallback to legacyWinLine (v1.5.0 transitional only)
    if (legacyWinLine !== null && legacyWinLine >= 0 && legacyWinLine < this.gameRule.paylines.length) {
      const payline = this.gameRule.paylines[legacyWinLine];
      const matchCount = outcome.winConfig ? outcome.winConfig.matchCount : 0;
      for (let i = 0; i < matchCount && i < payline.length; i++) {
        const [row, col] = payline[i];
        protectedCells.add(`${row},${col}`);
      }
      return protectedCells;
    }
    
    // Priority 3: LOSS → protectedCells empty
    return protectedCells;
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
   * Phase C: Derived Seed Unification
   * 
   * 統一 seed 推導公式（包含 patchVersion）
   * hash(mathSeed, spinIndex, outcome.id, "VISUAL", patchVersion)
   */
  _deriveVisualSeed(context) {
    if (context.visualSeed !== undefined) {
      return context.visualSeed;
    }

    // Phase C: 使用統一的 seed 推導公式，包含 patchVersion
    const patchVersion = this.visualConfig.patchVersion || 'v1.4.patch';
    const seedString = `${context.mathSeed || 'default'}:${context.spinIndex || 0}:${context.outcomeId || 'unknown'}:VISUAL:${patchVersion}`;
    
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
   * Phase A1: 判斷是否為 Near Miss（使用配置）
   */
  isNearMiss(outcome) {
    if (!this.visualConfig.nearMiss || !this.visualConfig.nearMiss.enabled) {
      return false;
    }
    return outcome.type === 'LOSS' && outcome.id && outcome.id.includes('NEAR_MISS');
  }

  /**
   * v1.4.patch: 判斷是否應該應用 Tease（加入機率、cooldown、rate limit）
   * 
   * @param {Object} outcome - Outcome 物件
   * @param {Object} visualRng - Visual RNG 實例
   * @param {Object} context - 必須包含 spinIndex，可選包含 visualState
   * @returns {Object} { eligible, requested, blockedBy, roll, chanceUsed }
   */
  shouldTease(outcome, visualRng, context) {
    const result = {
      eligible: false,
      requested: false,
      blockedBy: 'NOT_ELIGIBLE',
      roll: null,
      chanceUsed: 0
    };

    // Eligibility gate
    if (!this.visualConfig.tease || !this.visualConfig.tease.enabled) {
      return result;
    }

    if (outcome.type !== 'WIN') {
      return result;
    }

    const targetIds = this.visualConfig.tease.targetOutcomeIds || [];
    if (!outcome.id || !targetIds.includes(outcome.id)) {
      return result;
    }

    result.eligible = true;
    result.blockedBy = 'NONE';

    // Probability gate
    const roll = visualRng.random(); // [0, 1)
    result.roll = roll;

    const chanceByOutcome = this.visualConfig.tease.chanceByOutcomeId || {};
    const triggerChance = this.visualConfig.tease.triggerChance;
    const chanceUsed = chanceByOutcome[outcome.id] ?? triggerChance ?? 0;
    result.chanceUsed = chanceUsed;

    if (roll >= chanceUsed) {
      result.blockedBy = 'CHANCE_MISS';
      return result;
    }

    // Cooldown gate (if configured and visualState provided)
    const visualState = context?.visualState;
    const cooldownSpins = this.visualConfig.tease.cooldownSpins || 0;
    
    if (cooldownSpins > 0 && visualState && visualState.lastTeaseSpinIndex !== undefined) {
      const spinIndex = context.spinIndex || 0;
      const spinsSinceLastTease = spinIndex - visualState.lastTeaseSpinIndex;
      
      if (spinsSinceLastTease <= cooldownSpins) {
        result.blockedBy = 'COOLDOWN';
        return result;
      }
    }

    // Rate limit gate (if configured and visualState provided)
    const maxTriggersPer100Spins = this.visualConfig.tease.maxTriggersPer100Spins;
    
    if (maxTriggersPer100Spins !== null && maxTriggersPer100Spins !== undefined && visualState) {
      const spinIndex = context.spinIndex || 0;
      let teaseWindow = visualState.teaseWindow;

      // 初始化或更新 rolling window
      if (!teaseWindow || spinIndex < teaseWindow.startSpinIndex) {
        teaseWindow = { startSpinIndex: Math.max(0, spinIndex - 99), count: 0 };
      } else if (spinIndex >= teaseWindow.startSpinIndex + 100) {
        // 移動 window
        teaseWindow = { startSpinIndex: Math.max(0, spinIndex - 99), count: 0 };
      }

      if (teaseWindow.count >= maxTriggersPer100Spins) {
        result.blockedBy = 'RATE_LIMIT';
        return result;
      }

      // 更新 window（如果通過所有檢查，會在 applyConstraints 中實際更新）
      visualState.teaseWindow = teaseWindow;
    }

    // 通過所有檢查
    result.requested = true;
    result.blockedBy = 'NONE';
    return result;
  }

  /**
   * Phase A2: 應用 Near Miss（返回 { grid, telemetry }）
   * 
   * 支援：
   * - LINE-pay context (LTR left-to-right line pays)
   * - Any-position-pay context (scatter minCount) - 僅當配置存在時
   */
  _applyNearMiss(grid, outcome, visualRng, telemetry) {
    // 檢查是否為 any-position count-based（例如 scatter minCount）
    // MVP: 預設使用 LINE-pay，除非明確配置為 any-position
    const isAnyPosition = false;  // v1.4.x MVP: 預設 LINE-pay

    if (isAnyPosition) {
      return this._applyNearMissAnyPosition(grid, outcome, visualRng, telemetry);
    } else {
      return this._applyNearMissLinePay(grid, outcome, visualRng, telemetry);
    }
  }

  /**
   * Phase A2: Near Miss - LINE-pay strategy（返回 { grid, telemetry }）
   * Phase A1: 支援 multiLineCountRange
   * 
   * - 隨機選擇 1~2 條 payline（根據 multiLineCountRange）
   * - 選擇一個目標符號（prefer HIGH，否則任何非特殊符號）
   * - 在選定的 payline 上：放置 N-1 個相同符號（default N=3，所以前 2 個位置）
   * - 強制第 N 個位置為明顯不同的符號（prefer LOW）
   */
  _applyNearMissLinePay(grid, outcome, visualRng, telemetry) {
    const nearMissGrid = grid.map(row => [...row]);

    // Phase A1: 支援 multiLineCountRange
    const range = this.visualConfig.nearMiss?.multiLineCountRange || [1, 2];
    const minLines = range[0] || 1;
    const maxLines = range[1] || 2;
    const numLines = Math.min(visualRng.randomInt(maxLines - minLines + 1) + minLines, this.gameRule.paylines.length);
    
    // 隨機選擇 payline（deterministic）
    const availablePaylines = this.gameRule.paylines.map((pl, idx) => idx);
    const selectedPaylineIndices = [];
    
    for (let i = 0; i < numLines && availablePaylines.length > 0; i++) {
      const randomIndex = visualRng.randomInt(availablePaylines.length);
      selectedPaylineIndices.push(availablePaylines.splice(randomIndex, 1)[0]);
    }
    
    // Phase A2: 記錄 telemetry
    telemetry.visualPaylinesChosen = [...selectedPaylineIndices];

    // 預設 N=3（Near Miss 通常是 "差一個"）
    const nearMissCount = 3;

    // Phase B: 選擇目標符號（排除禁止符號）
    const forbiddenTypes = new Set(this.forbiddenSymbolsInVisual);
    const highSymbols = this.symbols.filter(s => s.type === 'HIGH' && !forbiddenTypes.has(s.type));
    const nonSpecialSymbols = this.symbols.filter(s => 
      s.type !== 'WILD' && s.type !== 'SCATTER' && !forbiddenTypes.has(s.type)
    );
    const targetSymbols = highSymbols.length > 0 ? highSymbols : nonSpecialSymbols;
    
    if (targetSymbols.length === 0) {
      return { grid, telemetry };  // 無法應用 Near Miss，回退
    }

    const targetSymbol = visualRng.selectFromArray(targetSymbols);

    // 在選定的 payline 上放置 N-1 個相同符號
    selectedPaylineIndices.forEach(paylineIndex => {
      const selectedPayline = this.gameRule.paylines[paylineIndex];
      
      for (let i = 0; i < nearMissCount - 1 && i < selectedPayline.length; i++) {
        const [row, col] = selectedPayline[i];
        nearMissGrid[row][col] = targetSymbol.id;
      }

      // 強制第 N 個位置為明顯不同的符號（prefer LOW，排除禁止符號）
      if (nearMissCount - 1 < selectedPayline.length) {
        const [row, col] = selectedPayline[nearMissCount - 1];
        const lowSymbols = this.symbols.filter(s => s.type === 'LOW' && !forbiddenTypes.has(s.type));
        const differentSymbols = lowSymbols.length > 0 
          ? lowSymbols 
          : this.symbols.filter(s => s.id !== targetSymbol.id && !forbiddenTypes.has(s.type));
        
        if (differentSymbols.length > 0) {
          const breakSymbol = visualRng.selectFromArray(differentSymbols);
          nearMissGrid[row][col] = breakSymbol.id;
        }
      }
    });

    return { grid: nearMissGrid, telemetry };
  }

  /**
   * Phase A2: Near Miss - Any-position strategy（返回 { grid, telemetry }）
   * 
   * - 放置 exactly minCount-1 個 scatters 在不重複的隨機位置
   * - 填充其餘位置時，明確排除 scatter 以防止意外觸發
   */
  _applyNearMissAnyPosition(grid, outcome, visualRng, telemetry) {
    // v1.4.x MVP: 此功能需要明確配置，目前不實作
    // 如果未來需要，可以從 outcome 或 config 讀取 minCount
    return { grid, telemetry };
  }

  /**
   * Phase A2: 應用 Tease（返回 { grid, telemetry }）
   * v1.5.0: 使用 protectedCells 參數（從 winEvents 推導）
   * 
   * Tease Red Lines (non-negotiable):
   * 1. WinLine protection: 對於 true winLine，前 matchCount 個符號 MUST NOT change
   * 2. Anti-Extend (MVP): 對於 winLine 上 matchCount 之後的位置，MUST NOT 等於 winSymbolId
   * 3. Tease placement: 優先應用 tease 到 1~2 條與 true winLine 不同的 payline
   */
  _applyTease(grid, outcome, winLine, visualRng, telemetry, protectedCells = null) {
    if (winLine === null || winLine < 0 || winLine >= this.gameRule.paylines.length) {
      return { grid, telemetry };  // 無效的 winLine，不應用 tease
    }

    const teaseGrid = grid.map(row => [...row]);
    const truePayline = this.gameRule.paylines[winLine];
    const matchCount = outcome.winConfig ? outcome.winConfig.matchCount : 0;
    const winSymbolId = outcome.winConfig ? outcome.winConfig.symbolId : null;

    if (!winSymbolId || matchCount === 0) {
      return { grid, telemetry };  // 無法應用 tease
    }

    // v1.5.0: 使用傳入的 protectedCells（如果存在），否則從 winLine 推導
    const protectedCellsSet = protectedCells || new Set();
    if (protectedCellsSet.size === 0) {
      // Fallback: 從 winLine 推導（過渡期）
      for (let i = 0; i < matchCount && i < truePayline.length; i++) {
        const [row, col] = truePayline[i];
        protectedCellsSet.add(`${row},${col}`);
      }
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

    // Phase A2: 記錄 telemetry
    telemetry.visualPaylinesChosen = selectedTeasePaylines.map(({ index }) => index);

    // Phase B: 排除禁止符號
    const forbiddenTypes = new Set(this.forbiddenSymbolsInVisual);
    
    // 在選定的 tease payline 上應用 near-miss style
    selectedTeasePaylines.forEach(({ payline }) => {
      const highSymbols = this.symbols.filter(s => s.type === 'HIGH' && !forbiddenTypes.has(s.type));
      const lowSymbols = this.symbols.filter(s => s.type === 'LOW' && !forbiddenTypes.has(s.type));
      
      if (highSymbols.length > 0 && lowSymbols.length > 0) {
        const teaseSymbol = visualRng.selectFromArray(highSymbols);
        
        // 前 2 個位置使用相同 HIGH 符號
        for (let i = 0; i < 2 && i < payline.length; i++) {
          const [row, col] = payline[i];
          const cellKey = `${row},${col}`;
          if (!protectedCellsSet.has(cellKey)) {
            teaseGrid[row][col] = teaseSymbol.id;
          }
        }
        
        // 第 3 個位置強制 LOW（break）
        if (2 < payline.length) {
          const [row, col] = payline[2];
          const cellKey = `${row},${col}`;
          if (!protectedCellsSet.has(cellKey)) {
            const breakSymbol = visualRng.selectFromArray(lowSymbols);
            teaseGrid[row][col] = breakSymbol.id;
          }
        }
      }
    });

    // 確保 Anti-Extend: true winLine 上 matchCount 之後的位置不得使用 winSymbolId
    // Phase B: 替換時也要排除禁止符號
    antiExtendCells.forEach(cellKey => {
      const [row, col] = cellKey.split(',').map(Number);
      if (teaseGrid[row][col] === winSymbolId) {
        // 替換為不同的符號（排除禁止符號）
        const differentSymbols = this.symbols.filter(s => 
          s.id !== winSymbolId && !forbiddenTypes.has(s.type)
        );
        if (differentSymbols.length > 0) {
          teaseGrid[row][col] = visualRng.selectFromArray(differentSymbols).id;
        }
      }
    });

    return { grid: teaseGrid, telemetry };
  }

  /**
   * v1.4.x: WIN General Optimization (Phase 2)
   * v1.5.0: 使用 protectedCells 參數（從 winEvents 推導）
   */
  _applyWinGeneralOptimization(grid, outcome, winLine, visualRng, protectedCells = null) {
    // v1.5.0: 使用傳入的 protectedCells（如果存在），否則從 winLine 推導
    let protectedCellsSet = protectedCells || new Set();
    
    if (protectedCellsSet.size === 0 && winLine !== null && winLine >= 0 && winLine < this.gameRule.paylines.length) {
      // Fallback: 從 winLine 推導（過渡期）
      const payline = this.gameRule.paylines[winLine];
      const matchCount = outcome.winConfig ? outcome.winConfig.matchCount : 0;
      for (let i = 0; i < matchCount && i < payline.length; i++) {
        const [row, col] = payline[i];
        protectedCellsSet.add(`${row},${col}`);
      }
    }

    const winSymbol = outcome.winConfig ? outcome.winConfig.symbolId : null;

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

    // v1.5.0: 如果 winLine 有效，使用 payline 和 matchCount（用於 forbiddenSymbols 邏輯）
    let payline = null;
    let matchCount = 0;
    if (winLine !== null && winLine >= 0 && winLine < this.gameRule.paylines.length) {
      payline = this.gameRule.paylines[winLine];
      matchCount = outcome.winConfig ? outcome.winConfig.matchCount : 0;
    }
    
    return this._improveVisualDistribution(grid, protectedCellsSet, forbiddenSymbols, payline, matchCount, visualRng);
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
   * v1.4.patch: 驗證安全性（返回 { isSafe, reason, detail }）
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
            return {
              isSafe: false,
              reason: 'ANTI_EXTEND_VIOLATION',
              detail: {
                type: 'ANTI_EXTEND_VIOLATION',
                winLineIndex: winLine,
                beforeMatchCount: matchCount,
                afterMatchCount: i + 1,
                positionsChanged: [[row, col]]
              }
            };
          }
        }
      }

      // Accidental win scan（除了預期的 winLine）
      const accidentalWinResult = this._validateNoAccidentalWin(grid, winLine);
      if (!accidentalWinResult.isSafe) {
        return {
          isSafe: false,
          reason: accidentalWinResult.reason || 'ACCIDENTAL_WIN_CREATED',
          detail: accidentalWinResult.detail || null
        };
      }
      return { isSafe: true, reason: null, detail: null };
    } else {
      // LOSS: accidental-win scan across all paylines
      const accidentalWinResult = this._validateNoAccidentalWin(grid, null);
      if (!accidentalWinResult.isSafe) {
        return {
          isSafe: false,
          reason: accidentalWinResult.reason || 'ACCIDENTAL_WIN_CREATED',
          detail: accidentalWinResult.detail || null
        };
      }
      return { isSafe: true, reason: null, detail: null };
    }
  }

  /**
   * v1.4.patch: 驗證沒有創造 Accidental Win（返回 { isSafe, reason, detail }）
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
      let consecutiveStart = 0;

      for (let i = 0; i < payline.length; i++) {
        const [row, col] = payline[i];
        const currentSymbol = grid[row][col];

        if (currentSymbol === lastSymbol && lastSymbol !== null) {
          consecutiveCount++;
        } else {
          consecutiveCount = 1;
          consecutiveStart = i;
        }

        // 檢查是否形成 ≥3 個連續相同符號
        if (consecutiveCount >= 3) {
          // 如果是預期的中獎線，允許
          if (expectedWinLine === paylineIndex) {
            // 允許，這是預期的中獎線
          } else {
            // 非預期的中獎線，視為 Accidental Win
            const positions = [];
            for (let j = consecutiveStart; j <= i; j++) {
              positions.push(payline[j]);
            }
            
            return {
              isSafe: false,
              reason: `ACCIDENTAL_WIN_PAYLINE_${paylineIndex}`,
              detail: {
                type: 'ACCIDENTAL_WIN_CREATED',
                paylineIndex: paylineIndex,
                rule: 'LINE',
                symbol: currentSymbol,
                matchCount: consecutiveCount,
                positions: positions
              }
            };
          }
        }

        lastSymbol = currentSymbol;
      }
    }

    return { isSafe: true, reason: null, detail: null };
  }

  /**
   * v1.4.patch: 檢查是否包含禁止符號（返回詳細資訊）
   * 
   * @returns {Object} { detected: boolean, detail: Object }
   */
  _checkForbiddenSymbols(grid, outcome, winLine) {
    // 建立禁止符號類型集合
    const forbiddenTypes = new Set(this.forbiddenSymbolsInVisual);
    
    // 建立禁止符號 ID 集合
    const forbiddenSymbolIds = new Set();
    const symbolTypeMap = new Map();
    this.symbols.forEach(symbol => {
      if (forbiddenTypes.has(symbol.type)) {
        forbiddenSymbolIds.add(symbol.id);
        symbolTypeMap.set(symbol.id, symbol.type);
      }
    });
    
    // 檢查 grid 中是否有禁止符號（排除 winLine 的保護區域）
    const protectedCells = new Set();
    if (winLine !== null && winLine >= 0 && winLine < this.gameRule.paylines.length && outcome.type === 'WIN') {
      const payline = this.gameRule.paylines[winLine];
      const matchCount = outcome.winConfig ? outcome.winConfig.matchCount : 0;
      for (let i = 0; i < matchCount && i < payline.length; i++) {
        const [row, col] = payline[i];
        protectedCells.add(`${row},${col}`);
      }
    }
    
    // 掃描 grid（排除保護區域）
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const cellKey = `${row},${col}`;
        if (!protectedCells.has(cellKey)) {
          const symbolId = grid[row][col];
          if (forbiddenSymbolIds.has(symbolId)) {
            return {
              detected: true,
              detail: {
                type: 'FORBIDDEN_SYMBOL_DETECTED',
                symbol: symbolId,
                symbolType: symbolTypeMap.get(symbolId),
                position: [row, col]
              }
            };
          }
        }
      }
    }
    
    return { detected: false, detail: null };
  }

  /**
   * v1.4.x: 獲取加權填充符號
   * Phase B: 排除禁止符號（WILD/SCATTER/BONUS）
   */
  _getWeightedFillerSymbol(visualRng, candidateSymbols = null) {
    let symbols = candidateSymbols || this.symbols;
    
    // Phase B: 排除禁止符號類型
    const forbiddenTypes = new Set(this.forbiddenSymbolsInVisual);
    symbols = symbols.filter(s => !forbiddenTypes.has(s.type));
    
    if (symbols.length === 0) {
      // 如果所有符號都被排除，回退到非禁止符號（不應該發生）
      symbols = this.symbols.filter(s => !forbiddenTypes.has(s.type));
      if (symbols.length === 0) {
        throw new Error('沒有可用的填充符號（所有符號都被禁止）');
      }
    }
    
    // 優先使用 LOW 和 MID 類型的符號
    const lowMidSymbols = symbols.filter(s => s.type === 'LOW' || s.type === 'MID');
    
    if (lowMidSymbols.length > 0 && visualRng.random() < 0.7) {
      return visualRng.selectFromArray(lowMidSymbols).id;
    }

    // 30% 機率使用其他符號（根據權重，但排除禁止符號）
    const weights = {
      'LOW': 50,
      'MID': 30,
      'HIGH': 15
      // WILD, SCATTER, BONUS 已被排除
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

