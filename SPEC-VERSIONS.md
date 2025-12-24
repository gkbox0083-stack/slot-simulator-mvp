# Specification Version Control - Slot Math Simulator

## 文件說明

本文件記錄 Spec 的**版本演進歷史**與**重大變更**。

### 版本命名規則

- **Major 版本** (v1.x → v2.x): 核心設計哲學變更、不向後相容

- **Minor 版本** (v1.1 → v1.2): 新增功能、向後相容

- **Patch 版本** (v1.1.0 → v1.1.1): Bug 修正、語義釐清

---

## 版本歷史

### v1.1 (Phase 2: Analysis Depth) - 2024-12-24

**狀態**: ✅ Final / Implemented

**新增功能**:

1. **Gap Tracking（體感指標）**
   - 計算 BASE Outcome 的出現間隔（avgGap, medianGap, maxGap）
   - FREE Outcome 永遠不計算 Gap
   - 第一次出現僅初始化，不記錄 Gap
   - 支援邊界情況處理（0/1/2/3+ 次出現）

2. **Raw Data Export（CSV）**
   - 逐 Spin 記錄完整資料
   - `baseSpinIndex` 在 FREE 狀態時為 Parent Base Spin Index
   - 包含所有必要欄位：globalSpinIndex, baseSpinIndex, state, outcomeId, type, winAmount, triggeredFeatureId
   - 自動建立目錄，支援相對/絕對路徑

**重大變更**:

- ✅ 明確定義 `baseSpinIndex` 在 FREE 狀態的語義（Parent Base Spin Index）
- ✅ 新增 Gap 統計邊界情況表格
- ✅ 新增 CSV Schema 定義
- ✅ `SimulationResult` 結構擴展：BASE Outcome Distribution 包含 Gap 統計欄位

**不相容變更**:

- 無（純新增功能，不影響 v1.0 核心）

**實作檔案**:

- `logic/simulate.js` - Gap Tracking 與 Spin Logging 實作
- `logic/cli.js` - `--csv` 參數與匯出邏輯
- `logic/reporter.js` - Gap 統計欄位顯示

**相關文件**:

- `spec_v1_1_final.md` - 完整規格

**審閱者**: Claude (Spec Reviewer)

**實作狀態**: ✅ 已完成

---

### v1.0.2 (Core Spec) - 2024-12-24

**狀態**: ✅ Gold Master（核心黑盒）

**修正**:

- 🐛 修復 Off-by-one 錯誤（Free Game 次數計算）
  - 問題：Trigger 發生時，`freeSpinsRemaining` 被設定為 10，但在同一個迴圈中立即被扣除了 1
  - 解決：新增 `justTriggered` 標記，確保 Trigger 當次迴圈不進行 decrement

- 🐛 修正 FSM 計數順序邏輯
  - 確保在狀態切換邏輯發生「之前」進行計數（Check-In Phase）

**核心原則確立**:

- Outcome-based 設計
- Finite State Machine (BASE ↔ FREE)
- Bet-centric 模擬

**實作檔案**:

- `logic/simulate.js` - Off-by-one 修正與 FSM 計數順序優化

**實作狀態**: ✅ 已完成

---

### v1.0.1 (Core Spec) - 2024-12-24

**狀態**: ✅ Stable

**修正**:

- 🐛 修正 FSM 計數順序邏輯
  - 必須在狀態切換邏輯發生「之前」進行計數
  - 確保最後一次 Spin 被正確記錄

- ✅ 引入顯式計數器（禁止使用推算）
  - `freeGameSpins` 必須由 `freeGameSpinsCount` 顯式累加
  - 禁止使用 `totalLoops - baseSpins` 推算

**核心原則確立**:

- Outcome-based 設計
- Finite State Machine (BASE ↔ FREE)
- Bet-centric 模擬

**實作狀態**: ✅ 已完成

---

### v1.0.0 (MVP) - 2024-12-24

**狀態**: ✅ 初始發布

**核心功能**:

- ✅ Outcome 抽選引擎（基於權重表）
  - 集中化 RNG 模組
  - 加權隨機選擇算法

- ✅ BASE ↔ FREE 狀態轉換
  - 明確的狀態常數定義
  - 狀態轉換規則：BASE → FREE (FEATURE), FREE → BASE (Exhausted)

- ✅ RTP 計算與驗證
  - RTP = Total Win / Total Base Bet
  - Hit Rate = Count(Base Win > 0) / baseGameSpins

- ✅ 基礎報表輸出
  - Outcome Distribution 統計
  - 分開統計 BASE 與 FREE 狀態

- ✅ CLI 工具與驗證機制
  - JSON 設定檔驗證器
  - 專業報表輸出
  - 命令列參數處理

**限制**:

- 不支援 Re-trigger
- 不支援 Reel Strip 模擬
- 僅支援單一 Feature 類型

**實作檔案**:

- `logic/simulate.js` - 核心模擬引擎
- `logic/cli.js` - CLI 進入點
- `logic/validator.js` - JSON 驗證器
- `logic/reporter.js` - 報表輸出器
- `logic/design.json` - 設定檔範本
- `README.md` - 使用指南

**實作狀態**: ✅ 已完成

---

## Spec 演進策略

### Phase 1: Core Engine (v1.0.x) - ✅ 完成

**目標**: 建立可信賴的數學模擬核心

**成果**:

- RTP 計算正確性驗證
- FSM 狀態管理穩定
- 基礎 Outcome 分布統計
- CLI 工具與驗證機制

---

### Phase 2: Analysis Depth (v1.1) - ✅ 完成

**目標**: 在不改動核心的前提下，新增分析能力

**新增**:

- Gap Tracking（體感指標）
- Raw Data Export（CSV）

**原則**:

- ❌ 不修改核心機率邏輯
- ❌ 不修改 FSM 狀態定義
- ✅ 新增觀測與分析能力

---

### Phase 3: IDE Integration (v1.2) - 📋 計劃中

**目標**: 為 UI / Web / Notebook 整合做準備

**預計新增**:

- JSON API 輸出格式
- 視覺化資料結構
- Batch 模擬支援

**原則**:

- 保持 Math Core 黑盒不變
- 優化資料結構可讀性
- 為 IDE 消費優化

---

### Phase 4: Advanced Features (v2.0) - 🔮 未來

**目標**: 支援更複雜的 Slot Math 場景

**可能新增**:

- Re-trigger 機制
- Multi-level Bonus
- Reel Strip 模擬
- Progressive Jackpot

**原則**:

- 可能需要重構核心（v2.0）
- 保持向後相容（透過設定檔版本號）

---

## Spec 變更審查流程

### 新增功能（Minor 版本）

1. 提出 Spec Draft
2. AI Review（多 AI 協作）
3. 記錄爭議點與共識（AI-DISCUSSION-LOG.md）
4. 發布 Final Spec
5. 實作驗證

### 核心變更（Major 版本）

1. 提出變更理由與影響分析
2. 多方審查（AI + 人類）
3. 建立 Migration Guide
4. 向後相容性評估
5. 發布 Breaking Changes 清單

### Bug 修正（Patch 版本）

1. 確認問題描述
2. 提出修正方案
3. 影響範圍評估
4. 快速發布

---

## 版本對照表

| Spec 版本 | Core Engine | Gap Tracking | CSV Export | Re-trigger | Reel Strip |
|-----------|-------------|--------------|------------|------------|------------|
| v1.0.0    | ✅          | ❌           | ❌         | ❌         | ❌         |
| v1.0.1    | ✅ (修正)   | ❌           | ❌         | ❌         | ❌         |
| v1.0.2    | ✅ (穩定)   | ❌           | ❌         | ❌         | ❌         |
| v1.1      | ✅ (黑盒)   | ✅           | ✅         | ❌         | ❌         |
| v1.2 (計劃)| ✅ (黑盒)   | ✅           | ✅         | ❌         | ❌         |
| v2.0 (未來)| 🔄 (重構?)  | ✅           | ✅         | ✅         | ✅         |

---

## 文件版本對應

| Spec 版本 | 主要文件 | 補充文件 |
|-----------|---------|---------|
| v1.0.x    | `README.md` | - |
| v1.1      | `spec_v1_1_final.md` | - |

---

## 相關資源

- **Spec 文件**: `/spec_v1_1_final.md`
- **專案定位**: `/context_for_claude.md`
- **實作程式碼**: `/logic/`
- **使用指南**: `/README.md`

---

**最後更新**: 2024-12-24

**維護者**: Claude (Spec Reviewer & Implementer)

