import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogPopup,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { queryClient, trpc } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard")({
  component: RouteComponent,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({
        to: "/login",
        throw: true,
      });
    }
    return { session };
  },
});

function RouteComponent() {
  const { session } = Route.useRouteContext();
  const navigate = useNavigate();
  
  // Cashflow entries
  const cashflowQueryOptions = trpc.cashflowEntries.list.queryOptions();
  const cashflowQuery = useQuery(cashflowQueryOptions);
  
  // Unverified account entries (for verification)
  const unverifiedQueryOptions = trpc.accountEntries.listUnverified.queryOptions();
  const unverifiedQuery = useQuery(unverifiedQueryOptions);
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formState, setFormState] = useState({
    description: "",
    category: "",
    accountEntryId: "",
  });

  const createCashflowEntry = useMutation(
    trpc.cashflowEntries.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: cashflowQueryOptions.queryKey });
        queryClient.invalidateQueries({ queryKey: unverifiedQueryOptions.queryKey });
        setFormState({
          description: "",
          category: "",
          accountEntryId: "",
        });
        setIsDialogOpen(false);
      },
    }),
  );

  const unverifiedEntries = unverifiedQuery.data ?? [];
  const selectedAccountEntry = unverifiedEntries.find(
    (e) => e.id === formState.accountEntryId
  );

  const cashflowEntries = cashflowQuery.data ?? [];
  const activeEntries = cashflowEntries.filter((entry) => entry.isActive);

  const totalInflow = activeEntries
    .filter((entry) => entry.amount > 0)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const totalOutflow = activeEntries
    .filter((entry) => entry.amount < 0)
    .reduce((sum, entry) => sum + Math.abs(entry.amount), 0);
  const netCashflow = totalInflow - totalOutflow;
  const receiptsCount = activeEntries.reduce(
    (sum, entry) => sum + entry.receiptsCount,
    0,
  );
  
  // Unverified account entries
  const unverifiedAmount = unverifiedEntries.reduce(
    (sum, e) => sum + Math.abs(e.amount),
    0,
  );
  const totalVerified = activeEntries.reduce(
    (sum, e) => sum + Math.abs(e.amount),
    0,
  );
  const totalActivity = unverifiedAmount + totalVerified;
  const deficitRatio = totalActivity === 0 ? 0 : unverifiedAmount / totalActivity;

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(value);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Cashflow</p>
          <h1 className="text-2xl font-semibold">Finance dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Welcome back, {session.data?.user.name}. Track daily inflows and outflows.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <Button variant="outline" onClick={() => setIsDialogOpen(true)}>
              Verify transaction
            </Button>
            <DialogPopup>
              <DialogHeader>
                <DialogTitle>Verify account transaction</DialogTitle>
                <DialogDescription>
                  Select a transaction from accounts and give it an official designation.
                </DialogDescription>
              </DialogHeader>
              <form
                className="mt-4 space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!selectedAccountEntry) return;
                  createCashflowEntry.mutate({
                    date: new Date(selectedAccountEntry.date).toISOString(),
                    description: formState.description,
                    category: formState.category,
                    amount: String(selectedAccountEntry.amount),
                    accountEntryId: formState.accountEntryId,
                  });
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="accountEntry">Select account transaction to verify</Label>
                  <select
                    id="accountEntry"
                    className="flex h-9 w-full border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={formState.accountEntryId}
                    onChange={(e) => setFormState({ ...formState, accountEntryId: e.target.value })}
                    required
                  >
                    <option value="">Choose a transaction...</option>
                    {unverifiedEntries.map((e) => (
                      <option key={e.id} value={e.id}>
                        {new Date(e.date).toLocaleDateString()} — {e.account} — {e.description} ({formatCurrency(e.amount)})
                      </option>
                    ))}
                  </select>
                  {unverifiedEntries.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No unverified transactions. Add transactions in the Accounts page first.
                    </p>
                  )}
                </div>

                {selectedAccountEntry && (
                  <>
                    <div className="rounded border border-emerald-500/20 bg-emerald-500/5 p-3">
                      <p className="text-xs font-medium text-emerald-600">Selected transaction</p>
                      <div className="mt-2 grid gap-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Date</span>
                          <span>{new Date(selectedAccountEntry.date).toLocaleDateString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Account</span>
                          <span>{selectedAccountEntry.account}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Original description</span>
                          <span>{selectedAccountEntry.description}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Amount</span>
                          <span className={selectedAccountEntry.amount >= 0 ? "text-emerald-500" : "text-rose-500"}>
                            {formatCurrency(selectedAccountEntry.amount)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="description">Official description</Label>
                      <Input
                        id="description"
                        placeholder="Official designation for this transaction"
                        value={formState.description}
                        onChange={(e) => setFormState({ ...formState, description: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="category">Category</Label>
                      <Input
                        id="category"
                        placeholder="e.g. Revenue, Expense, Transfer"
                        value={formState.category}
                        onChange={(e) => setFormState({ ...formState, category: e.target.value })}
                        required
                      />
                    </div>
                  </>
                )}

                <DialogFooter className="mt-6">
                  <DialogClose>
                    <Button type="button" variant="outline">
                      Cancel
                    </Button>
                  </DialogClose>
                  <Button 
                    type="submit" 
                    disabled={createCashflowEntry.isPending || !selectedAccountEntry}
                  >
                    {createCashflowEntry.isPending ? "Verifying..." : "Verify transaction"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogPopup>
          </Dialog>
          <Button variant="outline" disabled>
            Export
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              authClient.signOut({
                fetchOptions: {
                  onSuccess: () => {
                    navigate({ to: "/login" });
                  },
                },
              })
            }
          >
            Sign Out
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardHeader>
            <CardTitle>Total inflow</CardTitle>
            <CardDescription>Cleared + pending inflows</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold text-emerald-500">{formatCurrency(totalInflow)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Total outflow</CardTitle>
            <CardDescription>Operational + capital outflows</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold text-rose-500">{formatCurrency(totalOutflow)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Net cashflow</CardTitle>
            <CardDescription>Rolling 30-day net</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold">{formatCurrency(netCashflow)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Receipts</CardTitle>
            <CardDescription>Stored attachments (coming soon)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold">{receiptsCount} files</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Verification status</CardTitle>
            <CardDescription>Unverified account transactions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-lg font-semibold text-amber-500">
              {formatCurrency(unverifiedAmount)}
            </div>
            <div className="text-xs text-muted-foreground">
              {unverifiedEntries.length} pending verification
            </div>
            <div className="h-2 w-full rounded-none bg-muted">
              <div
                className={`h-2 rounded-none ${deficitRatio === 0 ? "bg-emerald-500" : "bg-amber-500"}`}
                style={{ width: `${Math.min(deficitRatio * 100, 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Cashflow activity</CardTitle>
              <CardDescription>Log transactions and prepare receipts</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input placeholder="Search transactions" className="w-full md:w-60" />
              <Input placeholder="Tag: revenue, rent..." className="w-full md:w-48" />
              <Button variant="outline" size="sm" disabled>
                Filters
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Description</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Account</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Receipts</th>
                </tr>
              </thead>
              <tbody>
              {activeEntries.map((entry) => {
                const hasAccountEntry = !!entry.accountEntryId;
                return (
                  <tr
                    key={entry.id}
                    className={`border-b last:border-0 ${hasAccountEntry ? "bg-emerald-500/5" : ""}`}
                  >
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(entry.date).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{entry.description}</div>
                      <div className="text-muted-foreground">#{entry.id.slice(0, 8)}</div>
                      {hasAccountEntry && entry.accountEntry && (
                        <div className="mt-1 text-[10px] text-emerald-600">
                          From: {entry.accountEntry.account} — {entry.accountEntry.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">{entry.category}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {entry.accountEntry?.account ?? "—"}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-medium ${
                        entry.amount >= 0 ? "text-emerald-500" : "text-rose-500"
                      }`}
                    >
                      {formatCurrency(entry.amount)}
                    </td>
                    <td className="px-4 py-3">
                      {hasAccountEntry ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-600">
                          VERIFIED
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
                          MANUAL
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">
                          {entry.receiptsCount} file
                          {entry.receiptsCount === 1 ? "" : "s"}
                        </span>
                        <Button size="xs" variant="outline" disabled>
                          Attach
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
