# Patch notes — development → main

## Summary

This release adds transaction line-item breakdowns, fixes PDF report generation for large datasets, and corrects projected cashflow calculations.

---

## New features

### Transaction line-item breakdown
- **Cashflow entries** can now be split into line items (e.g. multiple items on one receipt).
- New **Breakdown** action on the dashboard: add, edit, and remove line items. Totals must match the parent transaction amount before saving.
- **Reports**: Finance and project PDFs show parent rows with a dash (—) for amount and bullet (•) sub-rows for each line item.
- **Budgets**: Linked expenses and income display their line items; link dialog shows item count.
- API: `getLineItems` / `setLineItems` with sum validation; `lineItems` included in list, report, and budget endpoints.
- Schema: `CashflowLineItem` model and migration for external DB.

---

## Fixes

### PDF report (5MB response limit)
- **Problem:** As data grew, the single-query report response (entries + all receipt images) exceeded the 5MB limit and PDF generation failed.
- **Change:** Report data is now split:
  - **Report payload:** Entries and receipt metadata only (no image data). Responses stay small.
  - **Receipt images:** Fetched separately via `getReportReceiptImages` in batches of 8 so each response stays under 5MB.
- Dashboard (Finance report) and Budgets (Project report) fetch receipt images in batches and merge before building the PDF.
- **Receipt upload limit** reduced to **625 KB** (5MB ÷ 8) so up to 8 receipts per batch stay under the limit. Enforced in:
  - API: `receiptSubmission.submit` and `submitAndBind`
  - Client: public receipt form and dashboard “Attach receipt”
- PDF Report dialog: fixed nested button (Cancel) to avoid hydration warning.

### Projected cashflow
- **Projected cashflow** now uses **net minus reserved for planned events only** (no double-count).
- **Budget view:** Projected cashflow = net minus remaining budget only (previous fix retained).

---

## Technical / cleanup

- Removed `docs/cashflow-itemization-commit-checklist.md`.
- PDF types: `ReportReceiptRow.receipt.imageData` is `string | null`; builder only renders rows with image data.

---

## Commits in this PR

- `fix: PDF report over 5MB – multi-query receipts, 625KB upload limit`
- `feat(cashflow): add line-item breakdown for transactions`
- `fix: projected cashflow = net - reserved for planned events only, no double-count`
