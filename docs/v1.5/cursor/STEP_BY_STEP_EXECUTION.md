# Cursor Execution Plan — v1.5.1 Wild（一次性分步執行）

> 目標：讓 Cursor「照流程走」而不是自由發揮。
> 規則：每一步完成後，先輸出結果摘要與檔案 diff，再進下一步。

---

## Step 0 — Load Constraints (MANDATORY)
Provide Cursor with:
- `docs/v1.5/blueprints/v1.5.1_wild_blueprint.md`
- `docs/v1.5/spec/v1.5.1_wild_minspec.md`
- `docs/v1.5/interfaces/v1.5_core_contracts.md`
- `docs/v1.5/spec/v1.5_branchA_invariant_spec.md`
- `docs/v1.5/gates/P0/v1.5_P0_gate_checklist.md`
- Cursor System Prompt (v1.5.1)

Ask Cursor to acknowledge:
- loops unchanged
- predicate injected
- no evaluator hard-coded WILD
- no ANY_POSITION / multi-win

---

## Step 1 — Repo Hygiene (Optional but recommended)
Task: move/rename docs into the target structure only (no code changes).
Output:
- new /docs tree
- moved files list
- skipped list

---

## Step 2 — Implement Wild (Minimal)
Task:
1) Add/Update config template (e.g., logic/template.json) to include symbols.type + wildConfig fields.
   - Use the example schema at: `docs/v1.5/examples/design_v1.5.1_wild_example.json`
2) Add config support: symbols.type + wildConfig schema usage.
3) Introduce match predicate mechanism.
4) Update evaluator to call predicate (loops unchanged).
5) Update WinEvent to include paidSymbolId + observedSymbolIds.
6) Keep strict validation semantics intact.

Output:
- summary of code changes by file
- why it satisfies Blueprint constraints
- list of tests run

---

## Step 3 — Acceptance
Task: self-check against `v1.5.1_wild_acceptance_checklist.md`.
Output:
- checklist with PASS/FAIL per item
- any gaps and proposed minimal fixes

---

## Step 4 — P0 Gate
Task: run and report `v1.5_P0_gate_checklist.md` items.
Output:
- PASS/FAIL
- deterministic replay proof (seed, outcome sequence hash, etc.)
- strict mode mismatch count

---

## Step 5 — PR-ready Summary
Output:
- final /docs/v1.5 tree
- key constraints confirmed
- risks / follow-ups (non-blocking)
