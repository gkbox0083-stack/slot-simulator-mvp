# v1.4.patch_tease_diag_fix — CSV Correctness + Telemetry Semantics Hardening (Cursor Ready Patch Spec)

> **Purpose**: Fix three critical issues discovered in `result.csv` after implementing **Tease Probability + Guard Diagnostics**:
> 1) `visualGuardFailReason` / `visualGuardFailDetail` are polluted on **successful** spins (attempt-level failures leak into final fields).  
> 2) `visualApplied` semantics are inconsistent (can be `true` while `visualRequestedType=NONE`).  
> 3) CSV output is not RFC/standard compliant because JSON/arrays contain commas without proper quoting/escaping.

> **Non-negotiable**: This patch must not change Math outcomes, winAmount, paylines, matchCount, or consume Math RNG.

---

## 0) Scope & File Targets

### Allowed files to modify
- `logic/visualConstraint.js` (telemetry finalization logic)
- `logic/cli.js` (CSV exporter)
- *(Optional, wiring only)* `logic/simulate.js` (if it already passes telemetry through; no behavior changes)

### Not allowed
- Any change that affects **Outcome selection**, **FSM**, **RTP distribution**, **Math RNG consumption**, or **win evaluation**.

---

## 1) Required Telemetry Semantics (Single Source of Truth)

### 1.1 `visualApplied` MUST mean "final effect applied"
**Definition:**
```ts
visualApplied = (visualAppliedType !== "NONE")
```

**Rule:**
- If `visualAppliedType === "NONE"` → `visualApplied` must be `false`.
- If `visualAppliedType !== "NONE"` → `visualApplied` must be `true`.

> If you still need "engine ran" visibility, add a new field `visualRan` (optional). Do not overload `visualApplied`.

### 1.2 Final-failure fields MUST represent the FINAL outcome only
These fields:
- `visualGuardFailReason`
- `visualGuardFailDetail`

**MUST be populated only when the FINAL result is a rollback (no effect applied).**

**Definition:**
- If `visualAppliedType === "NONE"` **AND** `visualRequestedType !== "NONE"` → FINAL failure.
- Otherwise → these fields must be blank/empty.

✅ Required behavior:
- **Success after retries**: final-failure fields **must be empty**.
- **Failure after max retries**: final-failure fields contain the final failure reason/detail.

### 1.3 Attempt history MUST be kept in `visualAttemptReasons`
Attempt-level failures belong here (not in final-failure fields).

**Required field:**
- `visualAttemptReasons` (string) — semicolon-separated codes, e.g.:
  - `"ANTI_EXTEND_VIOLATION;ACCIDENTAL_WIN_CREATED;SUCCESS"`
  - `"CHANCE_MISS"` (if you log gating; optional)

> NOTE: It is OK for `visualAttemptReasons` to contain failures even when final success occurs.

---

## 2) Implementation Requirements

### 2.1 Visual telemetry finalization step (MANDATORY)
**File:** `logic/visualConstraint.js`

At the end of `applyConstraints(...)`, before returning telemetry:
1) Normalize `visualApplied` according to §1.1.
2) If `visualApplied === true`:
   - Set `visualGuardFailReason = ""`
   - Set `visualGuardFailDetail = ""`
3) If `visualApplied === false`:
   - Only keep `visualGuardFailReason/detail` if a visual effect was requested (requestedType != NONE)
   - If `visualRequestedType === "NONE"`:
     - Clear `visualGuardFailReason/detail` (because there was no request)

**Pseudocode:**
```ts
telemetry.visualApplied = telemetry.visualAppliedType !== "NONE";

const requested = telemetry.visualRequestedType && telemetry.visualRequestedType !== "NONE";

if (telemetry.visualApplied) {
  telemetry.visualGuardFailReason = "";
  telemetry.visualGuardFailDetail = "";
} else {
  if (!requested) {
    telemetry.visualGuardFailReason = "";
    telemetry.visualGuardFailDetail = "";
  } else {
    // keep final reason/detail (must reflect final fail only)
  }
}
```

### 2.2 Split "attempt fail" vs "final fail" (MANDATORY)
Wherever you currently set `visualGuardFailReason/detail` during retries:
- Do NOT write into the final-failure fields directly.
- Instead:
  - append reason code into an internal `attemptReasons[]`
  - keep a local `lastFailReason/detail` variables if needed
- Only at the end, if final fail, set final-failure fields from `lastFailReason/detail`.

**Required internal pattern:**
```ts
attemptReasons.push(reasonCode);
lastFailReason = reasonCode;
lastFailDetail = detailObj;
```

Finally:
- `telemetry.visualAttemptReasons = attemptReasons.join(";")`
- if final fail → set `visualGuardFailReason/detail` from lastFail...

---

## 3) CSV Output MUST be Standard-Compliant (MANDATORY)

### 3.1 Use a real CSV writer / quoting
**File:** `logic/cli.js`

You MUST ensure any field containing:
- commas `,`
- quotes `"`
- newlines `\n`
is properly CSV-quoted.

**Minimum requirement**:
- Wrap field with `"` and escape internal quotes as `""`.

### 3.2 Fields that MUST be safely encoded
- `visualGuardFailDetail` (JSON string)
- `visualPaylinesChosen` (array)
- Any other array/object-like telemetry field

**Recommended encoding:**
- `visualPaylinesChosen`: convert to pipe-joined string, e.g. `"0|2|4"` (no commas)
- `visualGuardFailDetail`: JSON stringify as one cell, with CSV quoting applied

### 3.3 Column schema (append-only)
Do NOT reorder existing columns. Only adjust encoding and fix semantics.
Ensure the following are present and valid:
- `visualRequestedType`
- `visualAppliedType`
- `visualApplied`
- `visualAttemptsUsed`
- `visualAttemptReasons`
- `visualGuardFailReason`
- `visualGuardFailDetail`

---

## 4) Regression & Verification Checklist (Must Pass)

### 4.1 Semantics checks (spot-check on generated CSV)
Generate with:
```bash
node logic/cli.js -n 10000 --csv result.csv
```

Then verify:
- [ ] For all rows where `visualAppliedType != NONE`:  
      `visualGuardFailReason` and `visualGuardFailDetail` are empty.
- [ ] `visualApplied` equals `(visualAppliedType != NONE)` for all rows.
- [ ] Rows where `visualRequestedType=NONE` have empty `visualGuardFailReason/detail`.

### 4.2 CSV structural validity
- [ ] The CSV file can be opened in Excel/Numbers without column shifting.
- [ ] A standard parser (Node `csv-parse` / Python `pandas.read_csv`) reads it with a fixed column count.
- [ ] `visualGuardFailDetail` remains a single field per row (not split into multiple columns).

### 4.3 Non-behavioral guarantee (Math unchanged)
Run a deterministic regression (same seed/config):
- [ ] Outcome sequence (outcome.id) unchanged vs before patch.
- [ ] RTP and distribution unchanged within tolerance.
- [ ] Only telemetry/CSV formatting changes.

---

## 5) Stop Conditions (No guessing)
STOP and ask if:
- You cannot locate the CSV exporter logic in `logic/cli.js`.
- Telemetry fields are produced in multiple places and you are unsure where to finalize.
- There is an existing CSV library already used—use it rather than hand-rolling.

---

## Definition of Done
- Final-failure fields represent **final rollback only** (no pollution on success).
- `visualApplied` semantics are correct and consistent.
- CSV is standards-compliant and robust with JSON/arrays.
- Math behavior is proven unchanged via regression.
