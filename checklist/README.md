# Checklist 工作流程定位

本目錄包含所有驗證腳本和檢查清單，用於確保程式碼品質和架構完整性。

## 目錄結構

### `acceptance/` - Feature 合併前的 Correctness 驗收

**用途：** v1.5.0 功能合併前的正確性驗證

**主要驗證項目：**
- Shadow columns 存在性（P0-8）
- 無 evaluationMatch=false 對於 payout>0（P0-3）
- evaluatedEventCount ≤ 1（P0-4）
- Single Evaluation Point（P0-2/P0-6）
- Visual Constraint 不引用 evaluator（P0-2）

**使用方式：**
```bash
# 先執行模擬生成 CSV
node logic/cli.js -n 1000 --csv result_v1.5.0_checklist.csv

# 執行驗證
node checklist/acceptance/verify_v1.5.0_v2.js
```

**檔案：**
- `verify_v1.5.0_v2.js` - 主要驗證腳本
- `v1.5.0_acceptance_checklist.md` - 檢查清單文件

---

### `determinism/` - Determinism 驗證

**用途：** 確保相同 seed 完全可重現，legacy mode 保持隨機

**主要驗證項目：**
- 相同 seed 產生完全相同的 CSV（hash-based 比對）
- seed=0 edge case 處理
- Legacy mode（無 seed）產生不同結果

**使用方式：**
```bash
# 測試特定 seed
node checklist/determinism/verify_determinism_v1.5.0.js --spins 2000 --seed 12345

# 測試 seed=0 edge case
node checklist/determinism/verify_determinism_v1.5.0.js --spins 2000 --seed 0
```

**檔案：**
- `verify_determinism_v1.5.0.js` - Determinism 驗證腳本

---

### `branchA_gate/` - Branch A P0 Gate（跨版本不矛盾守門）

**用途：** 進入 v1.5.1+ 開發前的架構完整性驗證

**重要：** 所有 Branch A 的變更都必須符合 [`Branch_A_Invariant_Spec.md`](./branchA_gate/Branch_A_Invariant_Spec.md)

**主要驗證項目：**
1. Acceptance Verifier（結構/欄位/單點評估等）
2. Determinism Gate（seed=12345 與 seed=0）
3. Legacy Random Gate（不帶 seed 連跑兩次，hash 必須不同）
4. No Stray Math.random Gate（禁止偷用）
5. Single Evaluation Point Gate（evaluator 只在 simulate.js 調用）
6. Seed Derivation Centralization Gate（P0-7）

**使用方式：**
```bash
# 完整驗證（預設 2000 spins）
node checklist/branchA_gate/gate_branch_A_p0.js --spins 2000

# 快速驗證（500 spins）
node checklist/branchA_gate/gate_branch_A_p0.js --spins 500

# 自訂參數
node checklist/branchA_gate/gate_branch_A_p0.js --spins 2000 --seed1 12345 --seed2 0 --workdir /tmp/gate_test
```

**檔案：**
- `gate_branch_A_p0.js` - 總入口驗證腳本
- `Branch_A_P0_Gate_Checklist_v1.5.x.md` - 檢查清單文件
- `Branch_A_Invariant_Spec.md` - **Invariant 規格（所有 Branch A 變更必須符合）**

---

## 工作流程規則

### 規則 1：任何進入 v1.5.1+ 的 PR / commit，都必須先通過 Branch A P0 Gate

**強制要求：**
- 本機執行 `node checklist/branchA_gate/gate_branch_A_p0.js --spins 2000` 必須 PASS
- CI/CD 環境也應執行此 gate（如果有的話）

**PASS 條件：**
- 所有 6 個 Gate 都必須通過
- 任一 Gate FAIL 即禁止合併

### 規則 2：Feature 開發流程

1. **開發階段：** 正常開發功能
2. **驗收階段：** 執行 `acceptance/verify_v1.5.0_v2.js` 確保功能正確
3. **Gate 階段：** 執行 `branchA_gate/gate_branch_A_p0.js` 確保架構完整性
4. **合併階段：** 所有驗證通過後才能合併

### 規則 3：Determinism 測試

- 每次修改 RNG 相關邏輯後，必須執行 determinism 測試
- 確保 seeded mode 和 legacy mode 都正常工作

---

## 快速參考

### 一鍵總測試（推薦）

```bash
# 完整驗證（約 2-3 分鐘）
node checklist/branchA_gate/gate_branch_A_p0.js --spins 2000

# 快速驗證（約 30 秒）
node checklist/branchA_gate/gate_branch_A_p0.js --spins 500
```

### 個別驗證

```bash
# Acceptance 驗證
node logic/cli.js -n 1000 --csv result.csv
node checklist/acceptance/verify_v1.5.0_v2.js

# Determinism 驗證
node checklist/determinism/verify_determinism_v1.5.0.js --spins 2000 --seed 12345
```

---

## 疑難排解

### Gate 失敗時該怎麼辦？

1. **查看錯誤訊息：** Gate 腳本會顯示具體的失敗原因
2. **檢查對應的驗證腳本：** 個別執行失敗的 Gate 以獲得更詳細的錯誤資訊
3. **修復問題：** 根據錯誤訊息修復程式碼
4. **重新執行：** 修復後重新執行 gate

### 常見問題

**Q: Legacy Random Gate 失敗（兩次執行 hash 相同）**
- A: 這可能是極低機率的偶發事件。可以嘗試增加 spins 數量或執行 3 次比較。

**Q: No Stray Math.random Gate 失敗**
- A: 檢查是否有檔案直接使用 `Math.random()`。只允許在 `logic/rng.js` 的 legacy mode 分支中使用。

**Q: Single Evaluation Point Gate 失敗**
- A: 確保 `payRuleEvaluator.evaluate()` 只在 `logic/simulate.js` 中調用。

---

## 版本歷史

- **v1.5.0**: 初始建立
- **v1.5.0 (P0-7)**: 新增 Seed Derivation Centralization Gate

