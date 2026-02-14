# Cashflow Itemization – Pre-commit checklist

Reviewed before commit/push. Build: **passes**. Lint: **no errors**.

---

## 1. Schema & migration

| Item | Status |
|------|--------|
| **Prisma** `CashflowLineItem` model in `packages/db/prisma/schema/auth.prisma` | ✅ id, cashflowEntryId, description, category, amount, notes, timestamps; `@@map("cashflow_line_item")` |
| **CashflowEntry** has `lineItems CashflowLineItem[]` | ✅ |
| **SQL migration** `packages/db/migrations/add_cashflow_itemization.sql` | ✅ Table + FK + index. **Note:** `CREATE INDEX IF NOT EXISTS` requires MySQL 8.0+; if you use 5.7, run the index line only if the index does not exist. |
| Migration already run on external DB | ✅ (you confirmed) |

---

## 2. API logic & types

| Area | What was checked |
|------|-------------------|
| **cashflowEntries.list / listPage** | Include `lineItems`; return `lineItems` with `amount` as number. Entries without breakdown have `lineItems: []`. |
| **cashflowEntries.getLineItems** | Returns array of `{ id, description, category, amount, notes }`; amounts as numbers. |
| **cashflowEntries.setLineItems** | Validates `sum(items.amount)` equals parent `entry.amount` (epsilon 0.01). Rejects with `BAD_REQUEST` if not. Replaces all line items (deleteMany + createMany). Optional `id` in payload; new rows get DB-generated id if omitted. |
| **report.getReportData** | Includes `lineItems` on each entry; `entryRows[].lineItems` is always an array (possibly empty). |
| **report.getProjectReportData** | Expenditure/income rows include `lineItems` (or `[]`). |
| **budgetProjects.list** | `cashflowEntry` select includes `lineItems`; response maps `lineItems` with `amount: Number(li.amount)`. |
| **budgetProjects.getById** | Same; `exp.cashflowEntry.lineItems` / `inc.cashflowEntry.lineItems` with numeric amounts. |
| **budgetItems.getUnlinkedCashflows** | Both branches (income/expense) return `lineItems` with numeric amounts. |

---

## 3. Types (frontend & report)

| Type | Location | Status |
|------|----------|--------|
| **ReportLineItem** | `apps/web/src/lib/pdf-report.ts` | ✅ description, category, amount (number) |
| **ReportEntry** | same | ✅ optional `lineItems?: ReportLineItem[]` |
| **ProjectReportExpenditureRow / IncomeRow** | same | ✅ optional `lineItems?: ReportLineItem[]` |
| **Dashboard** table item | From `cashflowEntries.listPage` | ✅ `entry.lineItems` array; UI uses `Array.isArray(entry.lineItems) && entry.lineItems.length > 0` before use. |
| **Budgets** expense/income | From `budgetProjects.list` or `getById` | ✅ `exp.cashflowEntry.lineItems` / `inc.cashflowEntry.lineItems`; UI uses `?.length` and `li.id ?? idx` for keys. |

---

## 4. UI behaviour

| Screen | Behaviour |
|--------|-----------|
| **Dashboard – Cashflow table** | “N items” / “No breakdown” badge; “Breakdown” button (editors) opens dialog. |
| **Dashboard – Breakdown dialog** | Shows parent amount vs line-items total; green “Balanced” / red “Does not add up”; Save disabled until totals match (within 0.01) and all rows filled. |
| **Dashboard – Save breakdown** | Sends `cashflowEntryId` + `items` (description, category, amount, optional id/notes); backend enforces sum = parent amount. |
| **Budgets – Linked expenses/income** | Each linked cashflow shows main line; if `cashflowEntry.lineItems?.length`, indented sub-rows with • and amount. |
| **Budgets – Link dialog** | Unlinked cashflows list includes “N item(s)” when `cf.lineItems?.length`. |

---

## 5. Reports (PDF)

| Report | Logic |
|--------|--------|
| **Main finance report** | Entries with breakdown: parent row has “—” in Credit/Debit; only detail rows show amounts (• prefix). Entries without breakdown: single row with amount. Totals still from `data.entries` (no double-count). |
| **Project report – Revenue / Expenditures** | Same: parent row amount “—” when `lineItems.length > 0`; only sub-rows (•) show amounts. |

---

## 6. Backwards compatibility

| Item | Status |
|------|--------|
| Existing cashflow entries with no line items | ✅ `lineItems` is empty array; all UIs and PDFs handle it. |
| Receipt binding, account verification, budget links | ✅ Still by `CashflowEntry`; no schema or contract change. |
| Seed data | ✅ Does not create line items; seed remains valid. |

---

## 7. Optional follow-ups (not required for this commit)

- **Seed:** Optionally add a few `CashflowLineItem` rows in seed for one or two cashflow entries.
- **MySQL 5.7:** If you ever run the migration on 5.7, replace the index statement with one that checks for index existence first, or run it only once.

---

You can commit and push with this scope; logic and types are consistent and the build passes.
