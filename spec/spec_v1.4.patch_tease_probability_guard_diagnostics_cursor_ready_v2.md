# v1.4.patch — Tease Probability + Guard Diagnostics (Cursor Ready Spec)

> **Scope**: Add **probabilistic Tease triggering** and **diagnostic-grade guard rollback telemetry**.  
> **Layer rule**: This is **Visual Layer only** behavior. It must **never** alter Math outcomes, winAmount, paylines, matchCount, or consume Math RNG.

---

## 0) Non‑Negotiable Contract (Read First)

### Hard red lines
- ❌ Do not change **Outcome** selection / distribution.
- ❌ Do not change **winAmount**, **matchCount**, **winLines**.
- ❌ Do not consume or share **Math RNG**.
- ❌ Visual must remain **deterministic** under the same `(mathSeed, spinIndex, outcome.id, patchVersion)`.

### Allowed changes
- ✅ `logic/visualConstraint.js` and Visual helpers.
- ✅ `logic/cli.js` / CSV exporter: **output new telemetry fields**.
- ✅ `logic/resolver.js`: **pass-through telemetry only** (no branching).
- ⚠️ `logic/simulate.js`: **Do not modify** unless the repo already has telemetry wiring there.  
  If telemetry is currently collected in `simulate.js`, you may only do **non-behavioral logging wiring** (no RNG, no flow changes) and must prove via regression.

---

## 1) Goals

### G1 — Tease should not trigger on every eligible SMALL_WIN
- Add **probability gate**, optional **per-outcome chances**, and **cooldown / rate limiting**.

### G2 — Guard rollback must be diagnosable
- Keep an enum-like `visualGuardFailReason` for stats.
- Add `visualGuardFailDetail` (JSON string) for deep debugging:
  - which payline / coordinates / symbols caused the failure
  - which rule was violated
  - what was attempted

---

## 2) Config Additions (Backward Compatible)

**File(s):**
- `logic/design.json`
- Visual config loader / constructor in `logic/visualConstraint.js`

### 2.1 Proposed `visualConfig.tease` structure
```json
"visualConfig": {
  "tease": {
    "enabled": true,

    "targetOutcomeIds": ["SMALL_WIN", "FREE_SMALL_WIN"],

    "triggerChance": 0.12,
    "chanceByOutcomeId": {
      "SMALL_WIN": 0.08,
      "FREE_SMALL_WIN": 0.18
    },

    "cooldownSpins": 6,
    "maxTriggersPer100Spins": 12,

    "maxAttempts": 12
  }
}
```

### 2.2 Rules
- If `chanceByOutcomeId[outcome.id]` exists → use it.
- Else use `triggerChance`.
- If both missing → default to **0** (safe), not 1.
- `cooldownSpins` default: 0 (disabled).
- `maxTriggersPer100Spins` default: null (disabled).

---

## 3) Function Signatures & State

### 3.1 `applyConstraints` signature (must already exist)
**File:** `logic/visualConstraint.js`
```ts
applyConstraints(grid, outcome, context): { grid, telemetry }
```

### 3.2 Add Visual-only rolling state (cooldown / rate limit)
Do **NOT** store this in Math Core. Put it in `context.visualState` (created by caller) or keep it internal with deterministic counters from spinLog.

**Preferred (explicit state):**
- `context.visualState` includes:
```ts
visualState = {
  lastTeaseSpinIndex?: number,
  teaseWindow?: { startSpinIndex: number, count: number } // rolling window for 100 spins
}
```

**If `context.visualState` does not exist**, you must:
- safely assume no cooldown / no rate limit in effect (but still probability gate applies)
- and set telemetry fields accordingly.

---

## 3.3 Statelessness & Cross-Spin State (IMPORTANT — removes ambiguity)

**Problem:** `cooldownSpins` and `maxTriggersPer100Spins` require cross-spin memory.  
**Constraint:** Visual Layer must remain **stateless** in the sense of:
- ❌ No hidden internal mutable state inside the `VisualConstraintEngine` instance that persists across spins.
- ✅ It MAY read/write a **caller-owned** state object passed in via `context.visualState`.

### Required pattern
- The caller (typically the simulation loop / runner) owns a `visualState` object.
- On each spin, caller passes it via `context.visualState`.
- VisualConstraint reads it to apply cooldown/rate limiting and **may update it** (still stateless, because the state is not owned by the visual engine).

**State shape (caller-owned):**
```ts
context.visualState = {
  lastTeaseSpinIndex?: number,

  // rolling window over last 100 spins
  teaseWindow?: {
    startSpinIndex: number,
    count: number
  }
}
```

### Strict fallback if state is not provided
If `context.visualState` is missing:
- Probability gate still applies (roll vs chance).
- Cooldown and rate limiting are treated as **disabled**.
- Telemetry MUST still output:
  - `teaseBlockedBy="NONE"` (or "NOT_ELIGIBLE"/"CHANCE_MISS" as applicable)
  - and should NOT claim COOLDOWN/RATE_LIMIT blocks.

> This avoids forcing changes to Math Core. If you later choose to add a wrapper that maintains `visualState`, you get cooldown/rate limit for free without changing visual logic.


---

## 4) Tease Triggering Logic (Eligibility + Probability + Throttles)

### 4.1 Replace/extend `shouldTease`
**File:** `logic/visualConstraint.js`

```ts
shouldTease(outcome, visualRng, context): {
  eligible: boolean,
  requested: boolean,
  blockedBy?: "COOLDOWN" | "RATE_LIMIT" | "CHANCE_MISS" | "NOT_ELIGIBLE",
  roll?: number,
  chanceUsed?: number
}
```

#### Eligibility gate
- `tease.enabled === true`
- `outcome.type === "WIN"` (or your canonical win type)
- `outcome.id` is in `tease.targetOutcomeIds`

#### Probability gate
- `roll = visualRng.nextFloat()` in [0,1)
- `chanceUsed = chanceByOutcomeId[outcome.id] ?? triggerChance ?? 0`
- `requested = (roll < chanceUsed)`

#### Cooldown gate (if configured)
- if `cooldownSpins > 0` and `visualState.lastTeaseSpinIndex` exists
- block if `(spinIndex - lastTeaseSpinIndex) <= cooldownSpins`

#### Rate limit gate (if configured)
- if `maxTriggersPer100Spins` is set:
  - use rolling window length = 100 spins
  - if count in window >= max → block

> All blocks still keep the spin reproducible; they only decide `visualRequestedType`.

---

## 5) Telemetry Additions (CSV must include all)

### 5.1 Core fields (already exist)
- `visualRequestedType`
- `visualAppliedType`
- `visualApplied`
- `visualPaylinesChosen`
- `visualAttemptsUsed`
- `visualGuardFailReason`
- `visualSeed`

### 5.2 New Tease probability fields
Add to telemetry:
- `teaseEligible: boolean`
- `teaseChanceUsed: number`
- `teaseRoll: number`
- `teaseBlockedBy: "NONE" | "COOLDOWN" | "RATE_LIMIT" | "CHANCE_MISS" | "NOT_ELIGIBLE"`

### 5.3 New Guard diagnostics fields
- `visualGuardFailDetail: string` (JSON string)
- `visualAttemptReasons: string` (e.g. `"ANTI_EXTEND;ACCIDENTAL_WIN_CREATED;SUCCESS"`)

**CSV columns to add:**
- `teaseEligible`
- `teaseChanceUsed`
- `teaseRoll`
- `teaseBlockedBy`
- `visualGuardFailDetail`
- `visualAttemptReasons`

> Keep `visualGuardFailReason` as a **short code** suitable for grouping.

---

## 6) Guard Reason Codes + Detail Schema

### 6.1 Reason codes (enum-like)
Use **exact** strings:
- `ACCIDENTAL_WIN_CREATED`
- `ANTI_EXTEND_VIOLATION`
- `FORBIDDEN_SYMBOL_DETECTED`
- `MAX_RETRIES`

*(Optional forward-safe)*  
- `SCATTER_TRIGGER_RISK` (only if your safety scan can detect scatter patterns; otherwise omit)

### 6.2 `visualGuardFailDetail` JSON (examples)

**Accidental win example**
```json
{
  "type": "ACCIDENTAL_WIN_CREATED",
  "paylineIndex": 1,
  "rule": "LINE",
  "symbol": "A",
  "matchCount": 3,
  "positions": [[0,1],[1,1],[2,1]]
}
```

**Anti-extend example**
```json
{
  "type": "ANTI_EXTEND_VIOLATION",
  "winLineIndex": 0,
  "beforeMatchCount": 3,
  "afterMatchCount": 4,
  "positionsChanged": [[3,2]]
}
```

**Forbidden symbol example**
```json
{
  "type": "FORBIDDEN_SYMBOL_DETECTED",
  "symbol": "WILD",
  "position": [4,0]
}
```

---

## 7) Implementation Steps (Do in Order)

### Step 1 — Config
- Add new config fields under `visualConfig.tease`
- Ensure backward compatibility and safe defaults

### Step 2 — Tease gating (stateless + caller-owned state)
- Implement `shouldTease(...): { eligible, requested, blockedBy, roll, chanceUsed }`
- Ensure it uses **derived visual RNG** only

### Step 3 — Telemetry wiring
- In `applyConstraints`, set:
  - `visualRequestedType = "TEASE"` only if `requested===true` and not blocked
  - else `"NONE"` (or keep requestedType but blockedBy set; choose ONE consistent convention)
- Recommended convention:
  - `visualRequestedType` reflects *intent after gates* (i.e., blocked → NONE)
  - but still record `teaseEligible`, `teaseBlockedBy`, `teaseRoll`, `teaseChanceUsed`

### Step 4 — Guard diagnostics
- Where guard returns fail, set:
  - `visualGuardFailReason` (short code)
  - `visualGuardFailDetail` JSON string
  - append to `visualAttemptReasons`

### Step 5 — CSV columns
- Update CSV exporter to include the new telemetry columns
- Preserve existing column order; append new fields near other visual fields

---

## 8) Acceptance Checklist (Must Pass)

### A. Behavioral Safety (Math)
- [ ] Visual on/off yields identical Math outcomes distribution
- [ ] No change to winAmount / matchCount / winLines

### B. Tease Probability
- [ ] With `triggerChance = 0`, no spins request TEASE
- [ ] With `triggerChance = 1`, all eligible outcomes request TEASE (unless blocked by cooldown/rate limit)
- [ ] With `chanceByOutcomeId`, SMALL_WIN and FREE_SMALL_WIN have different request rates

### C. Cooldown / Rate limit
- [ ] When `cooldownSpins > 0`, consecutive tease requests are blocked and recorded in telemetry (`teaseBlockedBy=COOLDOWN`)
- [ ] When `maxTriggersPer100Spins` set, exceeding window blocks and recorded (`RATE_LIMIT`)

- [ ] When `context.visualState` is provided, cooldown/rate limit behavior is enforced deterministically.
- [ ] When `context.visualState` is NOT provided, cooldown/rate limit are effectively disabled (no COOLDOWN/RATE_LIMIT blocks).


### D. Diagnostics Quality
- [ ] Every rollback has `visualGuardFailReason` AND `visualGuardFailDetail` populated
- [ ] `visualAttemptReasons` shows at least the sequence of failure reasons before success/none

### E. Reproducibility
- [ ] Same `(mathSeed, spinIndex, outcome.id, patchVersion)` yields same:
  - requested/applied decisions
  - teaseRoll and chanceUsed
  - guard outcomes

---

## 9) Stop Conditions (No Guessing)
If any of these are unclear, STOP and ask:
- What is the canonical `outcome.type` values (`WIN` vs `SMALL_WIN` etc.)?
- How to access `spinIndex` and `mathSeed` in context?
- Where CSV schema is defined and column order expectations?

---

## Definition of Done
- All new config works with safe defaults
- CSV contains new columns
- Tease is probabilistic and throttleable
- Guard rollback is diagnosable via reason + detail
- Regression proves no Math behavior change
