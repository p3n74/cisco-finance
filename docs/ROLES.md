# Role-Based Access

Authorized users are assigned one of these roles (managed on the **Team** page by VP Finance):

| Role | Description |
|------|-------------|
| **VP_FINANCE** | Vice President for Finance |
| **AUDITOR** | Auditor |
| **TREASURER** | Treasurer |
| **WAYS_AND_MEANS** | Ways and Means Officer |

Users who are not in the authorized list have no access to the app. Authorized users without a role, or with a role not listed above, are treated as **regular users** (view-only where restrictions apply).

---

## Dashboard / Cashflow

**Who can perform actions:** VP Finance, Auditor only.

**Who can only view:** Treasurer, Ways and Means, regular users.

| Action | VP Finance | Auditor | Treasurer | Ways and Means | Regular |
|--------|------------|---------|-----------|----------------|---------|
| View dashboard, stats, cashflow table | ✅ | ✅ | ✅ | ✅ | ✅ |
| Verify transaction (link account entry → cashflow) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Attach receipt to cashflow entry | ✅ | ✅ | ❌ | ❌ | ❌ |
| Unbind receipt from cashflow entry | ✅ | ✅ | ❌ | ❌ | ❌ |

- **API:** `cashflowEntries.create`, `cashflowEntries.archive` require **cashflowEditorProcedure** (VP_FINANCE or AUDITOR).
- **UI:** “Verify Transaction”, “Attach”, “Attach More”, “Unbind This Receipt” are hidden for view-only users.

---

## Submitted Receipts

**Who can perform actions:** VP Finance, Auditor, Treasurer.

**Who can only view:** Ways and Means, regular users.

| Action | VP Finance | Auditor | Treasurer | Ways and Means | Regular |
|--------|------------|---------|-----------|----------------|---------|
| View receipts list and details | ✅ | ✅ | ✅ | ✅ | ✅ |
| Bind receipt to transaction | ✅ | ✅ | ✅ | ❌ | ❌ |
| Unbind receipt | ✅ | ✅ | ✅ | ❌ | ❌ |
| Endorse for reimbursement | ✅ | ✅ | ❌ | ❌ | ❌ |
| Mark as reimbursed | ❌ | ❌ | ✅ | ❌ | ❌ |

- **API:** `receiptSubmission.bind`, `unbind`, `submitAndBind`, `endorse`, `markAsReimbursed` require **receiptEditorProcedure** (VP_FINANCE, AUDITOR, or TREASURER). Endorse is further restricted to Auditor or VP Finance; Mark as reimbursed is Treasurer only.
- **UI:** Bind/Unbind, Endorse, and Mark as Reimbursed are hidden for view-only users.

---

## Budgets

**Who can perform actions:** VP Finance, Treasurer, Auditor, Ways and Means.

**Who can only view:** Regular users (authorized but no role or other role).

| Action | VP Finance | Auditor | Treasurer | Ways and Means | Regular |
|--------|------------|---------|-----------|----------------|---------|
| View budgets, projects, items | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create / edit / archive projects | ✅ | ✅ | ✅ | ✅ | ❌ |
| Add / edit / delete budget items | ✅ | ✅ | ✅ | ✅ | ❌ |
| Link / unlink expenses to budget items | ✅ | ✅ | ✅ | ✅ | ❌ |

- **API:** `budgetProjects.create`, `update`, `archive` and `budgetItems.create`, `update`, `delete`, `linkExpense`, `unlinkExpense` require **budgetEditorProcedure** (VP_FINANCE, TREASURER, AUDITOR, or WAYS_AND_MEANS).
- **UI:** “New Project”, “Add Item”, “Edit”, “Archive”, “Link”, “Unlink”, “Delete” are hidden for view-only users.

---

## Team Page

- **List authorized users:** Any authenticated, authorized user.
- **Add/remove users and assign roles:** VP Finance only.

---

## Implementation Notes

- Procedures are defined in `packages/api/src/index.ts`: `budgetEditorProcedure`, `receiptEditorProcedure`, `cashflowEditorProcedure`.
- Routers in `packages/api/src/routers/index.ts` use these procedures for mutations; read operations use `protectedProcedure` so any logged-in authorized user can view where applicable.
- Frontend pages (`apps/web/src/routes/*.tsx`) use `trpc.team.getMyRole` and derive flags like `canEditBudgets`, `canEditReceipts`, `canEditDashboard` to show or hide actions.
