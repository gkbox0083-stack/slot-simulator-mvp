# Branch A — Invariant / Regression P0 Gate（v1.5.x）

> 目的：在你採用 vibe coding（AI 生成具有隨機性）的前提下，把「不自相矛盾」變成**可機器驗證**的硬門禁。  
> 通過本清單後，才允許進入下一版（v1.5.1~v1.5.4）開發或合併。

---

## P0-1 Determinism Gate（Seeded 必須完全可重現）

**必須通過：同一台機器、同一份 code、同一份 design.json、相同 seed → 產物完全一致**

- [ ] 執行（建議 spins ≥ 2000）  
  ```bash
  node checklist/verify_determinism_v1.5.0.js --spins 2000 --seed 12345
  ```
- [ ] 結果必須為 PASS（hash-based 全檔一致）
- [ ] 必須再補一個 edge case：seed=0 不能被當成 legacy  
  ```bash
  node checklist/verify_determinism_v1.5.0.js --spins 2000 --seed 0
  ```
  - [ ] PASS（同 seed 重跑仍一致）

**Fail 代表什麼**  
- seed 的判斷寫成 `if (!seed)`（seed=0 變 legacy）  
- 有模組仍在用 `Math.random()` 或 seed 推導不穩定  
- 同 seed 下有「呼叫次序/次數」依賴外部狀態（例如時間、檔案順序）

---

## P0-2 Legacy Random Gate（無 seed 必須保持「真隨機」）

**必須通過：不帶 seed → 兩次執行輸出應該不同（不應該意外變 deterministic）**

- [ ] 連跑兩次（同 spins，但不帶 seed）  
  ```bash
  node logic/cli.js -n 1000 --csv result_run1.csv
  node logic/cli.js -n 1000 --csv result_run2.csv
  ```
- [ ] 檢查兩份 CSV 至少在 outcomeId/winAmount/eventsJson 有差異（任一差異即可）
- [ ] Console 必須顯示 legacy banner（例：`🔀 Active Math Seed: (none) (legacy random mode)`）

**Fail 代表什麼**  
- 你不帶 seed 但內部仍推導 string seed → 變成「半確定性」  
- 某些 RNG 仍被固定初始化

---

## P0-3 No Stray Math.random Gate（禁止偷用）

**必須通過：repo 內的 `Math.random(` 只能出現在 `logic/rng.js` 的 legacy 分支**

- [ ] 執行（Windows PowerShell 範例）  
  ```powershell
  Select-String -Path .\logic\*.js,.\logic\**\*.js -Pattern "Math\.random\(" -SimpleMatch
  ```
- [ ] 允許清單（Allowlist）只包含：  
  - `logic/rng.js`（legacy mode 分支）

> 建議：把此條加進 `checklist/verify_v1.5.0_v2.js`，讓它變成自動 fail。

---

## P0-4 Single Evaluation Point Gate（Evaluator 只能在 simulate.js 呼叫一次）

- [ ] 重新跑靜態驗證  
  ```bash
  node checklist/verify_v1.5.0_v2.js
  ```
- [ ] 必須 PASS，且滿足：
  - `payRuleEvaluator.evaluate()` 只出現在 `simulate.js`
  - `visualConstraint.js` / `resolver.js` 不得 import/require evaluator

---

## P0-5 G2 Strict Validation Gate（payout > 0 不可 mismatch）

- [ ] 執行一次完整模擬輸出 CSV（seeded 或 legacy 皆可）  
  ```bash
  node logic/cli.js -n 2000 --csv result.csv --seed 12345
  ```
- [ ] 以 verifier 檢查（或你現有的 verify_v1.5.0_v2.js）：
  - payout > 0 的 rows：`evaluationMatch=false` 必須為 0
  - `evaluatedEventCount` 必須 ≤ 1（v1.5.0 單事件期）

---

## P0-6 WinEvent.positions Invariant（座標系統與保護格推導不漂移）

- [ ] WinEvent.positions 必須一律為 `[row, col]`（與 paylines 定義一致）
- [ ] Visual protectedCells 推導順序必須固定：  
  1) `winEvents[0].positions`  
  2) `legacyWinLine` fallback  
  3) empty（LOSS）
- [ ] 禁止 Visual layer 自行掃 grid 重新「找中獎格」

> 建議：在 `visualConstraint.js` 加註解 + 小型自檢（dev-only），避免後續版本偷改。

---

## P0-7 Seed Derivation Spec（子 RNG 推導規格固定化）

**必須通過：同 seed 下，pattern/visual 的子 RNG 推導方式不允許「無聲改動」**

- [ ] 子 RNG seed 字串格式必須帶**固定 prefix + 分隔符**（避免碰撞）
  - 例：`PATTERN|<mathSeed>|<spinIndex>|<outcomeId>`
  - 例：`VISUAL|<mathSeed>|<spinIndex>|<outcomeId>|<patchVersion>`
- [ ] hash/轉換方法必須集中到 `rng.js`（單一來源）
- [ ] 若你真的要改推導規則：必須 bump `patchVersion`（或明確版本號）並記錄在 changelog

---

## P0-8 “Green-to-Branch-A” 判定

只有當 **P0-1 ~ P0-7 全部 PASS**，才允許：

- [ ] 進入 Branch A：新增 Invariant/Regression 測試
- [ ] 開始 v1.5.1 / v1.5.2 / v1.5.3 / v1.5.4 的功能開發
- [ ] 合併任何影響 RNG / evaluator / visual 的 PR

---

## 建議你把這份 P0 Gate 變成「固定流程」

最小建議流程（每次改版都做）：

1. `node checklist/verify_v1.5.0_v2.js`
2. `node checklist/verify_determinism_v1.5.0.js --spins 2000 --seed 12345`
3. `node checklist/verify_determinism_v1.5.0.js --spins 2000 --seed 0`
4. 兩次 legacy run（不帶 seed）比對 CSV 有差異
5. grep `Math.random(` 只允許在 `logic/rng.js`

