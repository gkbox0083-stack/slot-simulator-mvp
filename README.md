# Slot Math Simulator v1.4.patch

## ⚠️ 重要聲明

**本工具為數學模擬器，不包含盤面動畫或遊戲互動功能。**

本工具專注於驗證 Slot Game 的數學模型（RTP、Hit Rate、Outcome 分布等），透過大量模擬來驗證設計參數是否符合預期。

## 功能說明

### 核心功能

- **Outcome-based 模擬引擎**: 基於權重表進行結果抽取，不支援 Reel-strip 滾輪模擬
- **Finite State Machine (FSM)**: 支援 BASE <-> FREE 狀態轉換
- **Bet-centric 模擬**: 模擬玩家實際下注的 Base Game Spins，Free Game 為延伸結果
- **Gap Tracking（體感指標）**: 計算 BASE Outcome 的出現間隔（平均、中位數、最大值）
- **Raw Data Export（CSV）**: 匯出逐 Spin 的詳細記錄，支援後續分析
- **Pattern Auto Generation（v1.4）**: 基於 `winCondition` 自動生成最小錨點模式，取代硬編碼 pattern
- **Visual Constraint Layer（v1.3+）**: 改善盤面視覺呈現，消除整列重複，支援 Near Miss 和 Tease 視覺特徵
- **Tease Probability & Guard Diagnostics（v1.4.patch）**: 機率性 Tease 觸發、cooldown/rate limiting、詳細的 guard 診斷資訊

### 驗證機制

- **Validator**: 檢查 JSON 設定檔的結構完整性與致命錯誤
  - 檢查必要欄位是否存在
  - 檢查 Outcome ID 與 Pattern/winCondition 的對應關係（v1.4）
  - 檢查權重總和是否為 0（會導致 RNG 錯誤）
  - 驗證 `winCondition` 結構完整性（v1.4）
  - 警告邏輯不一致（如 WIN 類型的 Outcome 缺少 `winCondition` 或 legacy pattern）

**注意**: Validator 僅檢查資料結構與致命錯誤，**不驗證數學合理性**（如 RTP 是否達到目標值、權重分配是否合理等）。數學驗證需透過模擬結果自行判斷。

## 安裝

### 需求

- Node.js 14.0 或更高版本

### 安裝步驟

1. 確保已安裝 Node.js
2. 下載或複製本專案檔案
3. 進入專案目錄

## 使用指南

### 基本使用

```bash
# 使用預設設定（10000 次 Base Spins，logic/design.json）
node logic/cli.js

# 指定模擬次數
node logic/cli.js -n 50000

# 指定自訂設定檔
node logic/cli.js -f logic/design.json

# 組合使用
node logic/cli.js -n 100000 -f my-config.json

# 匯出 CSV 資料
node logic/cli.js -n 10000 --csv result.csv

# 關閉 Visual Constraint Layer（行為等同 v1.2）
node logic/cli.js -n 10000 --no-visual

# 完整範例
node logic/cli.js -n 50000 -f logic/design.json --csv output/data.csv
```

### 命令列參數

- `-n, --spins <number>`: 設定模擬 Base Spin 次數（預設 10000）
  - 必須為正整數
  - 範例: `-n 50000`

- `-f, --file <path>`: 指定 JSON 設定檔路徑（預設 `logic/design.json`）
  - 可使用相對路徑或絕對路徑
  - 範例: `-f logic/design.json`

- `--csv <filename>`: 匯出逐 Spin 詳細記錄到 CSV 檔案（v1.1 新增）
  - 自動建立目錄（如果不存在）
  - 支援相對路徑或絕對路徑
  - 範例: `--csv result.csv` 或 `--csv output/data.csv`

- `--no-visual`: 關閉 Visual Constraint Layer（v1.3 新增）
  - 關閉時行為與 v1.2 bitwise identical
  - 適用於驗證數學正確性或需要重現 v1.2 結果時
  - 範例: `--no-visual`

- `-h, --help`: 顯示幫助訊息

### 輸出說明

模擬完成後會顯示：

1. **模擬參數**: 設定檔路徑、模擬目標、Base Bet、Free Spin 次數
2. **RTP 定義**: 明確說明 RTP 計算公式
3. **關鍵指標**: RTP、Hit Rate、Max Win、Feature Trigger Rate
4. **Spin 統計**: Base/Free Game Spins、Total Bet、Total Win
5. **Feature 統計**: Trigger Count、Avg Feature Win per Spin
6. **Outcome 分布表**: BASE 與 FREE 狀態的詳細分布
   - **BASE Game**: Name, Type, Weight, Count, Freq%, Avg Gap, Med Gap, Max Gap, RTP Contrib.%
   - **FREE Game**: Name, Type, Weight, Count, Freq%, Avg Gap (N/A), Med Gap (N/A), Max Gap (N/A), RTP Contrib.%
   - **Gap 統計說明**: 僅 BASE Outcome 計算 Gap（出現間隔），FREE Outcome 永遠顯示 N/A
7. **前 20 次詳細結果**: 顯示前 20 次 Spin 的詳細資訊
8. **CSV 匯出**（使用 `--csv` 時）: 匯出完整的逐 Spin 記錄

## JSON 結構說明

### 基本結構

```json
{
  "meta": {
    "version": "v0.2.0",
    "description": "描述"
  },
  "betConfig": {
    "baseBet": 1,
    "betLevels": [1, 2, 5, 10]
  },
  "featureConfig": {
    "freeSpinCount": 10
  },
  "visualConfig": {
    "enabled": true,
    "safeFiller": "L1",
    "maxRetries": 10
  },
  "symbols": [...],
  "gameRules": {
    "BASE": {
      "grid": { "rows": 3, "cols": 5 },
      "winCondition": "payline",
      "paylines": [...]
    },
    "FREE": null
  },
  "outcomeTables": {
    "BASE": {
      "outcomes": [...]
    },
    "FREE": {
      "outcomes": [...]
    }
  }
}
```

### 欄位說明

#### `betConfig`
- `baseBet`: 基礎下注金額（數字）
- `betLevels`: 下注等級陣列（可選）

#### `featureConfig`
- `freeSpinCount`: Free Game 觸發時的免費 Spin 次數（數字，必須 > 0）

#### `visualConfig` (v1.3+)
- `enabled`: 是否啟用 Visual Constraint Layer（布林值，預設 true）
- `safeFiller`: 安全填充符號 ID（字串，預設 "L1"）
- `maxRetries`: 視覺約束重試次數（數字，預設 10）
- `seedStrategy`: Seed 推導策略（字串，預設 "DERIVED"）
- `patchVersion`: Patch 版本號（字串，預設 "v1.4.patch"）
- `nearMiss` (v1.3+): Near Miss 配置
  - `enabled`: 是否啟用 Near Miss（布林值，預設 true）
  - `multiLineCountRange`: 多線 Near Miss 數量範圍（陣列，預設 [1, 2]）
- `tease` (v1.4.patch+): Tease 配置
  - `enabled`: 是否啟用 Tease（布林值，預設 true）
  - `targetOutcomeIds`: 目標 Outcome ID 陣列（陣列，預設 ["SMALL_WIN", "FREE_SMALL_WIN"]）
  - `triggerChance`: 預設觸發機率（數字，0-1，預設 0.12）
  - `chanceByOutcomeId`: 每個 Outcome ID 的個別機率（物件，可選）
  - `cooldownSpins`: Cooldown 間隔（數字，預設 0，0 表示關閉）
  - `maxTriggersPer100Spins`: 每 100 次 Spin 的最大觸發次數（數字，預設 null，null 表示關閉）
  - `maxAttempts`: 最大嘗試次數（數字，預設 12）

#### `gameRules` (v1.2+)
- `BASE`: Base Game 規則
  - `grid`: Grid 尺寸定義
    - `rows`: 行數（數字）
    - `cols`: 列數（數字）
  - `winCondition`: 中獎條件（目前僅支援 "payline"）
  - `paylines`: Payline 陣列（每個 payline 為 [row, col] 座標陣列）
- `FREE`: Free Game 規則（v1.3 MVP 為 null）

#### `outcomes` (v1.4+)
- `winCondition` (WIN 類型可選，v1.4 新增): 中獎條件定義（取代 legacy pattern）
  - `type`: 條件類型（"LINE" | "SCATTER"）
  - `LINE` 類型:
    - `symbolId`: 中獎符號 ID（字串）
    - `matchCount`: 連線數量（數字）
    - `payDirection`: 支付方向（"LTR" | "RTL"，預設 "LTR"）
    - `eligiblePaylines`: 符合條件的 payline 索引陣列（可選，預設為所有 paylines）
  - `SCATTER` 類型:
    - `symbolId`: Scatter 符號 ID（字串）
    - `minCount`: 最小數量（數字）
    - `anyPosition`: 是否任意位置（布林值，預設 true）

#### `outcomeTables.BASE` / `outcomeTables.FREE`
- `outcomes`: Outcome 陣列
  - `id`: Outcome 識別碼（字串，必須唯一）
  - `weight`: 權重（數字，必須 >= 0）
  - `payoutMultiplier`: 賠率倍數（數字）
  - `type`: 類型（"WIN" | "LOSS" | "FEATURE"）
  - `winConfig` (WIN 類型必填): 中獎配置
    - `symbolId`: 中獎符號 ID（字串）
    - `matchCount`: 連線數量（數字，必須 >= 2 且 <= grid.cols）
    - `allowWild`: 是否允許 Wild（布林值）

### 重要約束

1. **每個 Outcome Table 的總權重必須 > 0**
2. **FEATURE 類型的 Outcome 只能出現在 BASE Table 中**
3. **FREE Table 中不得包含 FEATURE 類型的 Outcome**（v1.0 不支援 Re-trigger）
4. **WIN 類型的 Outcome 必須包含 winConfig**（v1.2+）
5. **WIN 類型的 Outcome 必須包含 winCondition 或 legacy pattern/patterns**（v1.4+）
6. **winConfig.matchCount 不得超過 grid.cols**（v1.2+）
7. **symbols 陣列中的每個元素必須包含 id 和 type 欄位**（v1.2+）
8. **winCondition 與 winConfig 必須一致**（v1.4+，如 symbolId、matchCount）

### 範本檔案

請參考 `template.json` 作為起始範本，其中包含詳細的註解說明。

## 常見問題

### Q: 為什麼 Free Game Spins 不等於 Triggers × freeSpinCount？

A: 這表示程式邏輯有誤。請檢查：
1. 是否正確設定 `freeSpinCount`
2. 是否在 Trigger 發生時正確設定 `freeSpinsRemaining`
3. 是否在狀態切換邏輯中錯誤地扣除了計數

### Q: RTP 計算是否包含 Free Game？

A: 是的。RTP = Total Win / Total Base Bet，其中：
- Total Win = Base Game Win + Feature Win（包含 Free Game 的 Win）
- Total Base Bet = Base Game Spins × baseBet（不包含 Free Game Spins）

### Q: Hit Rate 如何計算？

A: Hit Rate = Count(Base Win > 0) / baseGameSpins
- 僅計算 Base Game 中 Win > 0 的次數
- Feature Trigger（type: FEATURE）不計入 Hit Rate

### Q: 如何驗證數學模型是否合理？

A: Validator 僅檢查結構錯誤，不驗證數學合理性。請透過模擬結果自行判斷：
1. RTP 是否達到目標值
2. Hit Rate 是否符合預期
3. Outcome 分布是否接近理論機率
4. Feature Trigger Rate 是否合理
5. Gap 統計是否符合預期（平均間隔是否接近理論值）

### Q: Gap 統計是什麼？如何解讀？

A: Gap 統計是體感指標，用於評估 Outcome 的出現頻率：
- **Avg Gap**: 平均間隔（平均每 N 轉出現一次）
- **Med Gap**: 中位數間隔（50% 的情況間隔小於此值）
- **Max Gap**: 最大間隔（最長等待時間）
- **注意**: 僅 BASE Outcome 計算 Gap，FREE Outcome 永遠為 N/A
- **範例**: 如果 MEGA_WIN 的 Avg Gap 為 1000，表示平均每 1000 次 Base Spin 出現一次

### Q: CSV 匯出的資料格式是什麼？

A: CSV 檔案包含以下欄位：

**基本欄位**:
- `globalSpinIndex`: 全域流水號（1, 2, 3...）
- `baseSpinIndex`: Base Spin Index（FREE 狀態時為觸發該 Free Game 的 Base Spin）
- `state`: "BASE" 或 "FREE"
- `outcomeId`: Outcome ID
- `type`: "WIN" / "LOSS" / "FEATURE"
- `winAmount`: 該轉贏分
- `triggeredFeatureId`: 如果是 FEATURE 類型，記錄 outcomeId；否則為空字串

**Pattern Generation 欄位（v1.4+）**:
- `patternSource`: Pattern 來源（"GENERATED" | "LEGACY" | "NONE"）
- `winConditionType`: winCondition 類型（"LINE" | "SCATTER" | ""）
- `generatedWinLine`: 生成的 winLine 索引（數字或空字串）
- `anchorsCount`: 生成的錨點數量（數字）

**Visual Telemetry 欄位（v1.3+）**:
- `visualRequestedType`: 請求的視覺類型（"TEASE" | "NEAR_MISS" | "NONE"）
- `visualAppliedType`: 實際應用的視覺類型（"TEASE" | "NEAR_MISS" | "NONE"）
- `visualApplied`: 是否成功應用視覺效果（布林值）
- `visualPaylinesChosen`: 選擇的 payline 索引（逗號分隔字串）
- `visualAttemptsUsed`: 視覺嘗試次數（數字）
- `visualGuardFailReason`: Guard 失敗原因（字串或空字串）
- `visualSeed`: Visual RNG seed（字串）

**Tease Probability 欄位（v1.4.patch+）**:
- `teaseEligible`: 是否符合 Tease 條件（布林值）
- `teaseChanceUsed`: 使用的觸發機率（數字或空字串）
- `teaseRoll`: 機率骰子結果（數字或空字串）
- `teaseBlockedBy`: 被阻擋的原因（"NONE" | "COOLDOWN" | "RATE_LIMIT" | "CHANCE_MISS" | "NOT_ELIGIBLE"）

**Guard Diagnostics 欄位（v1.4.patch+）**:
- `visualGuardFailDetail`: Guard 失敗詳細資訊（JSON 字串或空字串）
- `visualAttemptReasons`: 嘗試序列（分號分隔字串，如 "ACCIDENTAL_WIN_PAYLINE_1;SUCCESS"）

### Q: Visual Constraint Layer 是什麼？會影響數學結果嗎？

A: Visual Constraint Layer（v1.3+）是純視覺優化層，**完全不會影響數學結果**：
- 使用獨立的 Visual RNG（與 Math RNG 完全隔離，seed 由 `mathSeed`、`spinIndex`、`outcomeId`、`patchVersion` 推導）
- 僅改善盤面視覺呈現（消除整列重複、Near Miss 視覺特徵、Tease 視覺效果）
- 不修改 Outcome、不影響 RTP、不改變任何數學行為
- 固定 seed 下，v1.2 與 v1.3+ 的 Total Win Amount 完全相同
- 可使用 `--no-visual` 關閉，行為與 v1.2 bitwise identical
- **v1.4.patch 新增**: 機率性 Tease 觸發、cooldown/rate limiting、詳細的 guard 診斷資訊

### Q: 什麼時候應該使用 `--no-visual`？

A: 建議在以下情況使用 `--no-visual`：
- 需要驗證數學正確性（確保與 v1.2 結果一致）
- 需要重現 v1.2 的結果
- 僅關注數學數據，不關心視覺呈現
- 進行回歸測試時

## 技術細節

### 核心引擎

- **檔案**: `logic/simulate.js`
- **版本**: Core Spec v1.4.patch
- **原則**: Outcome-based, FSM, Bet-centric
- **v1.1 新增**: Gap Tracking、Spin Logging (CSV)
- **v1.2 新增**: Pattern Resolver Layer（動態 Grid 生成）
- **v1.3 新增**: Visual Constraint Layer（視覺優化）
- **v1.4 新增**: Pattern Auto Generation（基於 winCondition 自動生成錨點）
- **v1.4.patch 新增**: Tease Probability、Guard Diagnostics、visualState 管理

### 驗證器

- **檔案**: `logic/validator.js`
- **功能**: JSON 結構驗證、完整性檢查

### 報表輸出

- **檔案**: `logic/reporter.js`
- **功能**: 格式化輸出、專業報表生成

### Pattern Generator

- **檔案**: `logic/patternGenerator.js`
- **版本**: v1.4
- **功能**: 基於 winCondition 自動生成最小錨點模式
  - 支援 LINE 類型（LTR/RTL 支付方向）
  - 支援 SCATTER 類型（任意位置）
  - 使用獨立的 Pattern RNG（與 Math RNG 完全隔離）
  - 僅生成必要的錨點位置，不生成完整 grid

### Visual Constraint Layer

- **檔案**: `logic/visualConstraint.js`
- **版本**: v1.4.patch
- **功能**: 視覺約束處理，改善盤面呈現
  - 消除整列重複
  - Near Miss 視覺特徵（支援多線）
  - Tease 視覺效果（機率性觸發、cooldown/rate limiting）
  - 符號分布自然度改善
  - 完全隔離的 Visual RNG（不影響數學結果）
  - Guard Diagnostics（詳細的失敗原因和診斷資訊）

## 授權

本工具為內部開發工具，僅供內部使用。

## 版本歷史

詳細版本歷史請參考 [SPEC-VERSIONS.md](spec/SPEC-VERSIONS.md)

### v1.4.patch - Tease Probability & Guard Diagnostics
- ✅ 實現機率性 Tease 觸發（triggerChance、chanceByOutcomeId）
- ✅ 實現 Cooldown 機制（cooldownSpins）
- ✅ 實現 Rate Limiting（maxTriggersPer100Spins，rolling window）
- ✅ 增強 Guard Diagnostics（visualGuardFailDetail、visualAttemptReasons）
- ✅ 使用 caller-owned visualState（不持有跨 spin 內部狀態）
- ✅ 擴充 CSV telemetry 欄位（teaseEligible、teaseChanceUsed、teaseRoll、teaseBlockedBy 等）

### v1.4 - Pattern Auto Generation
- ✅ 實現基於 winCondition 的自動模式生成
- ✅ 支援 LINE 類型（LTR/RTL 支付方向）
- ✅ 支援 SCATTER 類型（任意位置，防意外觸發）
- ✅ 使用獨立的 Pattern RNG（與 Math RNG 完全隔離）
- ✅ 向後相容 legacy pattern/patterns
- ✅ 新增 patternSource、winConditionType、generatedWinLine、anchorsCount 欄位

### v1.3 - Visual Constraint Layer
- ✅ 實現視覺約束處理
- ✅ 消除整列重複，改善符號分布自然度
- ✅ Near Miss 視覺特徵（前 N-1 格高價值符號，第 N 格低價值符號）
- ✅ 完全隔離的 Visual RNG（不影響數學結果）
- ✅ 支援 `--no-visual` 參數（關閉時行為與 v1.2 bitwise identical）

### v1.2 - Pattern Resolver Layer
- ✅ 實現 Outcome → Pattern 解耦
- ✅ 支援動態 Grid 生成
- ⚠️ 視覺呈現尚未優化

詳細說明請參考：[v1.2 視覺語義聲明](./v1.2_VISUAL_SEMANTICS.md)

## 開發工作流程

### Branch A P0 Gate（進入 v1.5.1+ 開發前的必過關卡）

**任何進入 v1.5.1+ 的 PR / commit，都必須先通過 Branch A P0 Gate。**

**重要：** 所有 Branch A 的變更都必須符合 [`checklist/branchA_gate/Branch_A_Invariant_Spec.md`](./checklist/branchA_gate/Branch_A_Invariant_Spec.md)

```bash
# 完整驗證（推薦，約 2-3 分鐘）
node checklist/branchA_gate/gate_branch_A_p0.js --spins 2000

# 快速驗證（約 30 秒）
node checklist/branchA_gate/gate_branch_A_p0.js --spins 500
```

**Gate 驗證項目：**
1. Acceptance Verifier（結構/欄位/單點評估等）
2. Determinism Gate（seed=12345 與 seed=0）
3. Legacy Random Gate（不帶 seed 連跑兩次，hash 必須不同）
4. No Stray Math.random Gate（禁止偷用）
5. Single Evaluation Point Gate（evaluator 只在 simulate.js 調用）
6. Seed Derivation Centralization Gate（P0-7）

**詳細說明：** 請參考 `checklist/README.md` 和 [`checklist/branchA_gate/Branch_A_Invariant_Spec.md`](./checklist/branchA_gate/Branch_A_Invariant_Spec.md)

---

## 版本歷史

- **v1.5.0**: Pay Rule Engine + Determinism Support
- **v1.4.patch**: Near Miss & Tease Visual Upgrade
- **v1.4**: Pattern Auto Generation
- **v1.3**: Visual Constraint Layer
- **v1.2.1**: RNG 獨立模組、版本號統一
- **v1.2**: Pattern Resolver Layer
- **v1.1** (2024-12-24): Analysis Depth Phase
  - 新增 Gap Tracking（體感指標）
  - 新增 CSV 匯出功能
  - 優化報表輸出格式（加入 Gap 統計欄位）

- **v1.0.2** (2024-12-24): 修復 Off-by-one 錯誤（Free Game 次數計算）
- **v1.0.1** (2024-12-24): 修正 FSM 計數順序邏輯
- **v1.0.0** (2024-12-24): 初始版本（Base Game + Free Game）

