# Cursor System Prompt — Slot Math IDE (v1.5.1 / v2.1)

> **Project Positioning**
>
> This project is the **Math Core of a Slot Math IDE**, not a casual simulator.
> CLI is temporary; all outputs must be IDE / UI / Notebook consumable.
> Correctness, determinism, and spec fidelity are mandatory.

---

## ⛔ Core Constraints (ABSOLUTE — NEVER VIOLATE)

### 1. Math & RNG Integrity

- ❌ Do NOT modify RNG logic (`rng.js`)
- ❌ Do NOT modify outcome probability distributions / tables
- ❌ Do NOT alter RTP / Gap calculation logic
- ❌ Do NOT change FSM state transitions (BASE ↔ FREE)
- ❌ Do NOT consume Math RNG from Visual Layer

---

### 2. Truth Source Policy (v1.5.0 ~ v1.5.3)

- **Outcome defines expected payout**
- **Evaluator is a deterministic verifier + explainer**
- Evaluator result MUST match Outcome expected payout (STRICT_MODE)

```ts
expectedWin = outcome.payoutMultiplier * bet   // integer credits
evaluatedWin = sum(winEvents.winAmount)

if (STRICT_MODE && expectedWin !== evaluatedWin) {
  throw new Error("Validation mismatch: evaluator vs outcome");
}
```

❌ Evaluator must NOT invent payout  
❌ Evaluator must NOT override Outcome

---

### 3. Single Evaluation Point (Critical)

- Each spin may call **evaluator exactly once**
- **simulate.js** (or the main simulation pipeline) is the ONLY allowed entry point
- `resolver.js` MUST NOT call evaluator
- `visualConstraint.js` MUST NOT call evaluator

---

## 🧱 Strict Module Responsibilities

```
simulate.js
- RNG ownership
- Outcome selection
- FSM control
- Evaluator invocation (single point)
- Strict validation
- Telemetry only

resolver.js
- Outcome → Grid generation
- Pattern / Anchor logic (v1.4)
- NO payout logic
- NO evaluator invocation

evaluator/*
- Grid → WinEvent[]
- Rule-based evaluation only
- MUST NOT mutate grid
- NOTE (v1.5.1): loops must not change; only symbol matching may be abstracted via an injected predicate.

visualConstraint.js
- Visual-only optimization (Near Miss / Tease)
- Uses outcome + winEvents
- MUST NOT affect math result
- MUST NOT scan grid to determine wins

reporter.js
- Formatting & CSV output only
- NO math logic
```

---

## 🎯 Wild Rules (v1.5.1)

- v1.5.1 implements **Wild substitute-only** for LINE pay.
- Wild behavior MUST be **data-driven** via config (e.g., `wildConfig.substitutableTypes`).
- ❌ DO NOT hard-code `if (symbol.type === 'WILD')` inside evaluator.
- ✅ Evaluator may call a `matchPredicate/_isMatch(cellSymbolId, targetSymbolId, ruleCtx)` using rule context.
- Default Behavior: if `wildConfig` is missing, matching MUST fall back to strict equality (`===`).
- ❌ DO NOT introduce ANY_POSITION, Scatter, Free Spins, or multi-win in v1.5.1.

---

## 🎯 WinEvent Rules (v1.5.1)

- v1.5.x produces **0~1 WinEvent** per spin (no multi-win).
- LINE WinEvent MUST include `positions`
- `winAmount` MUST be integer credits
- Coordinate system MUST match paylines: `positions` is **[row, col]** (row-major)

### Required semantic fields (v1.5.1)
- `paidSymbolId`: the symbol used for payout math
- `observedSymbolIds`: original grid symbols at each `positions` entry (**observedSymbolIds.length MUST equal positions.length**)

This allows cases like `H1-H1-W` to pay as `H1` while preserving that the last cell is `W`.

---

## 🎨 Visual Layer Safety Rules

- Visual layer MUST respect `protectedCells` derived from `WinEvent.positions`
- Near-miss / tease logic MAY read `outcome.id` / `outcome.type`
- Visual layer MUST NOT alter winning cells
- Transitional fallback to `legacyWinLine` is allowed ONLY when winEvents are missing

---

## 🚫 Prohibited Behaviors

- ❌ Calling evaluator more than once per spin
- ❌ Performing math in reporter or visual layer
- ❌ Introducing multi-win in v1.5.1
- ❌ Refactoring for aesthetics without spec instruction
- ❌ Guessing behavior if spec is unclear (ASK instead)

---

## 🧪 Self-Check Checklist

Before submitting code, verify:

- [ ] RNG determinism preserved
- [ ] Outcome sequence unchanged
- [ ] Evaluator called exactly once per spin
- [ ] STRICT_MODE produces zero mismatches
- [ ] Wild is data-driven (wildConfig), not hard-coded in evaluator
- [ ] WinEvent includes paidSymbolId + observedSymbolIds
- [ ] Visual constraints do not break winning cells
- [ ] CSV outputs expected vs evaluated fields

---

## 🧠 Development Mindset

> Correctness > Cleverness  
> Determinism > Convenience  
> Spec > Assumptions  

If a change impacts:
- RNG determinism
- Outcome sequencing
- Payout semantics

You **MUST STOP AND ASK**.

---

**This system prompt is authoritative for v1.5.1 development (v2.1).**
