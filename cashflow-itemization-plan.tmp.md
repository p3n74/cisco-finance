## Cashflow Itemization – Temporary Design Notes

### Goal
- Allow a single verified cashflow transaction (linked 1:1 to an `AccountEntry`) to be **broken down into multiple descriptive line items**, without changing the core `AccountEntry ↔ CashflowEntry` 1:1 relationship.

### Data model (conceptual)
- **Existing**
  - `AccountEntry` = raw movement in an account (GCash, GoTyme, Cash, BPI).
  - `CashflowEntry` = official/verified transaction.
  - Relationship today: `AccountEntry 1 ↔ 0..1 CashflowEntry` via `CashflowEntry.accountEntryId @unique`.
- **New**
  - Add `CashflowLineItem` (name TBD, e.g. `CashflowLineItem` or `CashflowSubentry`):
    - `id`
    - `cashflowEntryId` (FK → `CashflowEntry`)
    - `description`
    - `category`
    - `amount` (Decimal, sign matches inflow/outflow)
    - `notes?`
    - `createdAt`, `updatedAt`
  - Relationships:
    - `CashflowEntry` has many `CashflowLineItem` (`lineItems[]`).
    - Each `CashflowLineItem` belongs to exactly one `CashflowEntry`.
  - Core shape becomes: **N (line items) → 1 (cashflow entry) → 1 (account entry)**.

### Invariants / business rules
- **Sum consistency**
  - For any `CashflowEntry` that has one or more line items:
    - Sum of line item amounts **must equal** the parent `CashflowEntry.amount`.
  - This rule is enforced in the backend when creating/updating/deleting line items.
  - If the sum does not match, the operation should be rejected (or at minimum flagged as invalid and not persisted).

- **Highlighting mismatches in the UI**
  - When a user is editing or viewing the breakdown for a `CashflowEntry`, the UI should:
    - Display:
      - **Parent amount** (official `CashflowEntry.amount`).
      - **Line items total** (sum of all `CashflowLineItem.amount`).
    - If totals **match**:
      - Show a positive state (e.g. green “Balanced” badge).
    - If totals **do not match**:
      - Show a clear warning state (e.g. red “Does not add up” badge + message).
      - Prevent saving the breakdown until the totals match (for editor roles).

- **Backwards compatibility**
  - Existing `CashflowEntry` records may have **zero** line items (treated as un-itemized).
  - Existing logic for:
    - `AccountEntry` ↔ `CashflowEntry` verification,
    - Receipts binding (`ReceiptSubmission` ↔ `CashflowEntry`),
    - Budget links (`BudgetItemExpense` / `BudgetItemIncome` ↔ `CashflowEntry`),
    remains valid and unchanged.

### UX notes (first pass)
- **Verify Transaction dialog (Dashboard)**
  - After verifying an `AccountEntry` into a `CashflowEntry`, optionally open a “Breakdown” view:
    - Start with a single default line item equal to the full amount.
    - Allow splitting into multiple items by editing/adding/removing rows.
    - Show real-time calculation of the line items total and the “Balanced / Does not add up” indicator.

- **Cashflow Activity table**
  - For rows that have line items:
    - Show a small “N items” badge next to the description.
    - Provide a “View breakdown” action that opens the itemization view (read-only or editable based on role).

