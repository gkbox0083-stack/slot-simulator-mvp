# Branch A Invariant Spec（Human & AI Readable Contract）

> 這份文件的用途：**把「我們不允許再犯的錯」寫成一份可機器驗證、可交付給 Cursor 的規格**。  
> 它的定位是 **Branch A（Invariant / Regression）** 的「憲法」，用來防止後續版本在 vibe coding/AI 隨機性下產生**自相矛盾**或**無聲退化**。

---

## 1) 目的

Branch A 的目標不是「加功能」，而是：

- 讓 **數學語義（Outcome 的 payout）** 永遠不會被不小心改壞
- 讓 **同 seed 可重播（determinism）** 永遠成立
- 讓 **驗證（validation）** 永遠能攔截不一致
- 讓 **視覺層（visual）** 永遠不能影響數學結果

> 若某改動會破壞本文件任何 Invariant：**該改動必須延期或改設計**，不能用 workaround「先過再說」。

---

## 2) Invariant 清單（必須永遠成立）

### I-1 Truth Source Invariant（真相來源）
**Outcome 是 payout 的唯一真相來源：**
- ExpectedWin = `outcome.payoutMultiplier * bet`

Evaluator 的角色只有：
- 讀 grid → 產生 WinEvents → 計算 EvaluatedWin
- **EvaluatedWin 必須等於 ExpectedWin**

**禁止：**
- evaluator 影響 outcome 抽選
- visual 層改變 payout
- resolver 私自決定 payout

---

### I-2 Single Evaluation Point（單一評估點）
`PayRuleEvaluator.evaluate()` **只能在 `logic/simulate.js` 被呼叫一次**。

**禁止：**
- resolver.js 呼叫 evaluator
- visualConstraint.js 呼叫 evaluator
- 任何 helper/util 多點呼叫 evaluator

---

### I-3 Resolver ≠ Evaluator（責任不可混淆）
- Resolver：產生 grid（生成層），不計 payout、不產生 winEvents
- Evaluator：讀 grid（驗證層），產生 winEvents，不修改 grid

---

### I-4 RNG Ownership & Determinism（隨機性可控）
所有隨機性必須來自 `logic/rng.js`：
- **除 `rng.js` legacy 分支外，禁止使用 `Math.random()`**

支援兩模式：
- Seeded mode（有 seed）：完全 deterministic
- Legacy mode（無 seed）：維持舊行為、非 deterministic

---

### I-5 Sub-RNG Seed Centralization（P0-7）
所有子 RNG seed 推導必須集中到唯一 canonical API：

- `RNG.deriveSubSeed(kind, context)`

Seed 字串格式（不可更動，除非 bump patchVersion）：
- `kind|mathSeed|spinIndex|outcomeId|patchVersion`

**禁止：**
- pattern/visual 模組自行 hash 或自行拼 seed
- 任何地方重複出現自寫 hash 函數

---

### I-6 Visual Layer Non-Inference（視覺層不得猜測）
視覺層推導 protectedCells 的合法來源（優先序）：

1. `winEvents.positions`
2. legacy `winLine` fallback
3. empty

**禁止：**
- 掃描 grid 找中獎格
- 由 outcome 類型猜位置
- 由符號分布推測中獎格

---

### I-7 Validation Must Not Be Skipped（不得跳過驗證）
任何 `expectedWinAmount > 0` 的 spin：
- 必須執行 strict validation
- mismatch 必須拋錯（或至少在 gate 中 FAIL）

**禁止：**
- 因為 FREE 或 placeholder 就 skip
- 用「先關掉驗證」解決 mismatch

---

### I-8 Legacy Compatibility（向後相容）
在 **未提供 seed** 的情況下：
- 必須維持 legacy random 行為（非 deterministic）
- 不可「不小心變成部分 deterministic」

---

## 3) Enforcement（如何保證）

### 3.1 Branch A P0 Gate
任何要進 Branch A 或合併的變更：
- 必須跑 `checklist/branchA_gate/gate_branch_A_p0.js`
- 全部 PASS 才能進入下一步

### 3.2 AI（Cursor）規範
若需求或實作會違反任一 Invariant：
- **必須停下來詢問**
- 不可用 workaround 硬過 gate

---

## 4) 文件放置建議（Repo 內）
建議放到：

- `checklist/branchA_gate/Branch_A_Invariant_Spec.md`

並在 `checklist/README.md` 或根 `README.md` 放一句：
- “All Branch A changes must comply with Branch_A_Invariant_Spec.md”
