# P0-7 Invariant Fix: Centralize Sub-RNG Seed Derivation

## 實作完成 ✅

### 目標
建立**唯一**的 canonical API 用於子 RNG seed 推導，防止未來 AI 生成的回歸。

### 實作內容

#### 1. 新增集中化 API (`logic/rng.js`)
- ✅ 新增靜態方法 `RNG.deriveSubSeed(kind, context)`
- ✅ 統一 seed 字串格式：`kind|mathSeed|spinIndex|outcomeId|patchVersion`
- ✅ 集中化 hash 轉換邏輯（返回數字 seed）
- ✅ 支援 legacy mode（`mathSeed === null` 時使用 `'LEGACY'`）

#### 2. 更新 Pattern Generator (`logic/patternGenerator.js`)
- ✅ `_derivePatternSeed()` 現在使用 `RNG.deriveSubSeed('PATTERN', ...)`
- ✅ 移除本地 hash 邏輯
- ✅ 使用集中化 API

#### 3. 更新 Visual Constraint (`logic/visualConstraint.js`)
- ✅ `_deriveVisualSeed()` 現在使用 `RNG.deriveSubSeed('VISUAL', ...)`
- ✅ 移除本地 hash 邏輯
- ✅ 使用集中化 API，支援 `patchVersion` 配置

### 驗證結果

#### Determinism 測試
- ✅ `seed=12345`: 完整 CSV 內容 Hash 完全匹配
- ✅ `seed=0`: 完整 CSV 內容 Hash 完全匹配（edge case 通過）

#### 程式碼檢查
- ✅ 所有子 RNG seed 推導都通過 `RNG.deriveSubSeed()`
- ✅ 沒有其他模組自行推導 seed
- ✅ Hash 邏輯完全集中在 `rng.js`

### Seed 格式規範

**格式：** `kind|mathSeed|spinIndex|outcomeId|patchVersion`

**範例：**
- Pattern: `PATTERN|12345|1|SMALL_WIN|v1.5.0`
- Visual: `VISUAL|12345|1|SMALL_WIN|v1.5.0`
- Legacy: `PATTERN|LEGACY|1|SMALL_WIN|v1.5.0`

**重要：** 格式順序不得改變，除非 bump `patchVersion`。

### 架構保證

✅ **單一來源原則：** 所有子 RNG seed 推導都必須通過 `RNG.deriveSubSeed()`

✅ **向後相容：** Legacy mode (`mathSeed === null`) 使用 `'LEGACY'` 標記

✅ **版本控制：** `patchVersion` 參數允許未來變更格式而不影響現有結果

✅ **擴展性：** 未來新的子 RNG（如 SCATTER、Any-Position、Multi-Win）都必須使用此 API

### 結論

P0-7 Invariant 已完全實作。所有子 RNG seed 推導現在都通過集中化的 canonical API，防止未來無聲改動。

**狀態：** ✅ **PASS** - 可以進入 Branch A 開發

