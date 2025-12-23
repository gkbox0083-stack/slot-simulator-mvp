# Slot Math Simulator MVP v1.0

## ⚠️ 重要聲明

**本工具為數學模擬器，不包含盤面動畫或遊戲互動功能。**

本工具專注於驗證 Slot Game 的數學模型（RTP、Hit Rate、Outcome 分布等），透過大量模擬來驗證設計參數是否符合預期。

## 功能說明

### 核心功能

- **Outcome-based 模擬引擎**: 基於權重表進行結果抽取，不支援 Reel-strip 滾輪模擬
- **Finite State Machine (FSM)**: 支援 BASE <-> FREE 狀態轉換
- **Bet-centric 模擬**: 模擬玩家實際下注的 Base Game Spins，Free Game 為延伸結果

### 驗證機制

- **Validator**: 檢查 JSON 設定檔的結構完整性與致命錯誤
  - 檢查必要欄位是否存在
  - 檢查 Outcome ID 與 Pattern 的對應關係
  - 檢查權重總和是否為 0（會導致 RNG 錯誤）
  - 警告邏輯不一致（如 WIN 類型的 Outcome 使用 `isWin: false` 的 Pattern）

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
```

### 命令列參數

- `-n, --spins <number>`: 設定模擬 Base Spin 次數（預設 10000）
  - 必須為正整數
  - 範例: `-n 50000`

- `-f, --file <path>`: 指定 JSON 設定檔路徑（預設 `logic/design.json`）
  - 可使用相對路徑或絕對路徑
  - 範例: `-f logic/design.json`

- `-h, --help`: 顯示幫助訊息

### 輸出說明

模擬完成後會顯示：

1. **模擬參數**: 設定檔路徑、模擬目標、Base Bet、Free Spin 次數
2. **RTP 定義**: 明確說明 RTP 計算公式
3. **關鍵指標**: RTP、Hit Rate、Max Win、Feature Trigger Rate
4. **Spin 統計**: Base/Free Game Spins、Total Bet、Total Win
5. **Feature 統計**: Trigger Count、Avg Feature Win per Spin
6. **Outcome 分布表**: BASE 與 FREE 狀態的詳細分布
   - 欄位: Name, Outcome Type, Weight, Count, Freq%, RTP Contrib.%
7. **前 20 次詳細結果**: 顯示前 20 次 Spin 的詳細資訊

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
  "symbols": [...],
  "outcomeTables": {
    "BASE": {
      "outcomes": [...],
      "patterns": {...}
    },
    "FREE": {
      "outcomes": [...],
      "patterns": {...}
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

#### `outcomeTables.BASE` / `outcomeTables.FREE`
- `outcomes`: Outcome 陣列
  - `id`: Outcome 識別碼（字串，必須唯一）
  - `weight`: 權重（數字，必須 >= 0）
  - `payoutMultiplier`: 賠率倍數（數字）
  - `type`: 類型（"WIN" | "LOSS" | "FEATURE"）
- `patterns`: Pattern 物件
  - 鍵值為 Outcome ID
  - 值為 Pattern 陣列
    - `symbols`: 符號陣列（字串陣列）
    - `isWin`: 是否為中獎 Pattern（布林值）

### 重要約束

1. **Outcome ID 必須在 patterns 中有對應定義**
2. **每個 Outcome Table 的總權重必須 > 0**
3. **FEATURE 類型的 Outcome 只能出現在 BASE Table 中**
4. **FREE Table 中不得包含 FEATURE 類型的 Outcome**（v1.0 不支援 Re-trigger）

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

## 技術細節

### 核心引擎

- **檔案**: `logic/simulate.js`
- **版本**: Core Spec v1.0.2
- **原則**: Outcome-based, FSM, Bet-centric

### 驗證器

- **檔案**: `logic/validator.js`
- **功能**: JSON 結構驗證、完整性檢查

### 報表輸出

- **檔案**: `logic/reporter.js`
- **功能**: 格式化輸出、專業報表生成

## 授權

本工具為內部開發工具，僅供內部使用。

## 版本歷史

- **v1.0.2**: 修復 Off-by-one 錯誤（Free Game 次數計算）
- **v1.0.1**: 修正 FSM 計數順序邏輯
- **v1.0.0**: 初始版本（Base Game + Free Game）

