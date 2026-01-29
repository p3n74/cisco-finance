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
import { Textarea } from "@/components/ui/textarea";
import { queryClient, trpc } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard")({
  component: RouteComponent,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({
        to: "/",
        throw: true,
      });
    }
    return { session };
  },
});

function RouteComponent() {
  const { session } = Route.useRouteContext();
  const navigate = useNavigate();
  
  const cashflowQueryOptions = trpc.cashflowEntries.list.queryOptions();
  const cashflowQuery = useQuery(cashflowQueryOptions);
  
  const unverifiedQueryOptions = trpc.accountEntries.listUnverified.queryOptions();
  const unverifiedQuery = useQuery(unverifiedQueryOptions);
  
  const unboundReceiptsQueryOptions = trpc.receiptSubmission.countUnbound.queryOptions();
  const unboundReceiptsQuery = useQuery(unboundReceiptsQueryOptions);
  const unboundReceiptsCount = unboundReceiptsQuery.data?.count ?? 0;

  const budgetOverviewQueryOptions = trpc.budgetProjects.overview.queryOptions();
  const budgetOverviewQuery = useQuery(budgetOverviewQueryOptions);
  const budgetOverview = budgetOverviewQuery.data;

  const unboundListQueryOptions = trpc.receiptSubmission.listUnbound.queryOptions();
  const unboundListQuery = useQuery(unboundListQueryOptions);
  const unboundReceipts = unboundListQuery.data ?? [];
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formState, setFormState] = useState({
    description: "",
    category: "",
    accountEntryId: "",
  });

  // Attach receipt state
  const [attachingToEntryId, setAttachingToEntryId] = useState<string | null>(null);
  const [attachMode, setAttachMode] = useState<"select" | "upload">("select");
  const [selectedReceiptId, setSelectedReceiptId] = useState<string>("");
  const [uploadForm, setUploadForm] = useState({
    submitterName: session.data?.user.name ?? "",
    purpose: "",
    notes: "",
  });
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageData, setImageData] = useState<string>("");
  const [imageType, setImageType] = useState<string>("");

  // View receipts state
  const [viewingReceiptsEntryId, setViewingReceiptsEntryId] = useState<string | null>(null);
  const [viewingReceiptIndex, setViewingReceiptIndex] = useState<number>(0);

  const receiptsQueryOptions = trpc.cashflowEntries.getReceipts.queryOptions(
    { id: viewingReceiptsEntryId ?? "" },
    { enabled: !!viewingReceiptsEntryId }
  );
  const receiptsQuery = useQuery(receiptsQueryOptions);
  const receipts = receiptsQuery.data ?? [];

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

  const bindReceiptMutation = useMutation(
    trpc.receiptSubmission.bind.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: cashflowQueryOptions.queryKey });
        queryClient.invalidateQueries({ queryKey: unboundReceiptsQueryOptions.queryKey });
        queryClient.invalidateQueries({ queryKey: unboundListQueryOptions.queryKey });
        resetAttachDialog();
      },
    }),
  );

  const submitAndBindMutation = useMutation(
    trpc.receiptSubmission.submitAndBind.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: cashflowQueryOptions.queryKey });
        queryClient.invalidateQueries({ queryKey: unboundReceiptsQueryOptions.queryKey });
        queryClient.invalidateQueries({ queryKey: unboundListQueryOptions.queryKey });
        resetAttachDialog();
      },
    }),
  );

  const unbindMutation = useMutation(
    trpc.receiptSubmission.unbind.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: cashflowQueryOptions.queryKey });
        queryClient.invalidateQueries({ queryKey: unboundReceiptsQueryOptions.queryKey });
        queryClient.invalidateQueries({ queryKey: unboundListQueryOptions.queryKey });
        queryClient.invalidateQueries({ queryKey: receiptsQueryOptions.queryKey });
      },
    }),
  );

  const resetAttachDialog = () => {
    setAttachingToEntryId(null);
    setAttachMode("select");
    setSelectedReceiptId("");
    setUploadForm({
      submitterName: session.data?.user.name ?? "",
      purpose: "",
      notes: "",
    });
    setImagePreview(null);
    setImageData("");
    setImageType("");
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      setImagePreview(base64);
      setImageData(base64.split(",")[1] || "");
      setImageType(file.type);
    };
    reader.readAsDataURL(file);
  };

  const unverifiedEntries = unverifiedQuery.data ?? [];
  const selectedAccountEntry = unverifiedEntries.find(
    (e) => e.id === formState.accountEntryId
  );

  const cashflowEntries = cashflowQuery.data ?? [];
  const activeEntries = cashflowEntries.filter((entry) => entry.isActive);

  const attachingToEntry = activeEntries.find((e) => e.id === attachingToEntryId);
  const viewingEntry = activeEntries.find((e) => e.id === viewingReceiptsEntryId);

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

  const currentReceipt = receipts[viewingReceiptIndex];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
      {/* Header Section */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-primary">Dashboard</p>
          <h1 className="text-3xl font-bold tracking-tight">Finance Overview</h1>
          <p className="text-muted-foreground">
            Welcome back, {session.data?.user.name}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="relative"
            onClick={() => navigate({ to: "/receipts" })}
          >
            View Submitted Receipts
            {unboundReceiptsCount > 0 && (
              <span className="absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">
                {unboundReceiptsCount}
              </span>
            )}
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <Button variant="default" onClick={() => setIsDialogOpen(true)}>
              Verify Transaction
            </Button>
            <DialogPopup>
              <DialogHeader>
                <DialogTitle>Verify Account Transaction</DialogTitle>
                <DialogDescription>
                  Select a transaction and give it an official designation.
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
                  <Label htmlFor="accountEntry">Select Transaction</Label>
                  <select
                    id="accountEntry"
                    className="flex h-10 w-full rounded-xl border border-border/60 bg-background/60 backdrop-blur-sm px-4 py-2 text-sm outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/30"
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
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Selected Transaction</p>
                      <div className="mt-3 grid gap-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Date</span>
                          <span className="font-medium">{new Date(selectedAccountEntry.date).toLocaleDateString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Account</span>
                          <span className="font-medium">{selectedAccountEntry.account}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Description</span>
                          <span className="font-medium">{selectedAccountEntry.description}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Amount</span>
                          <span className={`font-semibold ${selectedAccountEntry.amount >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                            {formatCurrency(selectedAccountEntry.amount)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="description">Official Description</Label>
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
                    {createCashflowEntry.isPending ? "Verifying..." : "Verify Transaction"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogPopup>
          </Dialog>
          <Button variant="outline" disabled>
            Export
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Inflow</CardDescription>
            <CardTitle className="text-2xl text-emerald-500">{formatCurrency(totalInflow)}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Cleared + pending</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Outflow</CardDescription>
            <CardTitle className="text-2xl text-rose-500">{formatCurrency(totalOutflow)}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Operational + capital</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Net Cashflow</CardDescription>
            <CardTitle className={`text-2xl ${netCashflow >= 0 ? "text-foreground" : "text-rose-500"}`}>
              {formatCurrency(netCashflow)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Rolling 30-day</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Receipts</CardDescription>
            <CardTitle className="text-2xl">{receiptsCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Attached files</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pending Verification</CardDescription>
            <CardTitle className="text-2xl text-amber-500">{formatCurrency(unverifiedAmount)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">{unverifiedEntries.length} transactions</p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-2 rounded-full transition-all ${deficitRatio === 0 ? "bg-emerald-500" : "bg-amber-500"}`}
                style={{ width: `${Math.min(deficitRatio * 100, 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Budget Planning Quick Start */}
      {budgetOverview && (
        <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  Budget Planning
                  {budgetOverview.plannedCount > 0 && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {budgetOverview.plannedCount} active
                    </span>
                  )}
                </CardTitle>
                <CardDescription>Track planned expenses for upcoming events</CardDescription>
              </div>
              <Button variant="outline" onClick={() => navigate({ to: "/budgets" })}>
                View All Budgets
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border border-border/60 p-4">
                <p className="text-xs font-medium text-muted-foreground">Total Budget</p>
                <p className="text-xl font-semibold">{formatCurrency(budgetOverview.totalBudget)}</p>
                <p className="text-xs text-muted-foreground">{budgetOverview.totalProjects} project{budgetOverview.totalProjects === 1 ? "" : "s"}</p>
              </div>
              <div className="rounded-lg border border-border/60 p-4">
                <p className="text-xs font-medium text-muted-foreground">Total Spent</p>
                <p className={`text-xl font-semibold ${budgetOverview.totalActual > budgetOverview.totalBudget ? "text-rose-500" : "text-emerald-500"}`}>
                  {formatCurrency(budgetOverview.totalActual)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {budgetOverview.totalBudget > 0 
                    ? `${((budgetOverview.totalActual / budgetOverview.totalBudget) * 100).toFixed(1)}% of budget`
                    : "No budget set"}
                </p>
              </div>
              <div className="rounded-lg border border-border/60 p-4">
                <p className="text-xs font-medium text-muted-foreground">Remaining</p>
                <p className={`text-xl font-semibold ${budgetOverview.totalBudget - budgetOverview.totalActual < 0 ? "text-rose-500" : ""}`}>
                  {formatCurrency(budgetOverview.totalBudget - budgetOverview.totalActual)}
                </p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-1.5 rounded-full transition-all ${budgetOverview.totalActual > budgetOverview.totalBudget ? "bg-rose-500" : "bg-emerald-500"}`}
                    style={{ width: `${Math.min((budgetOverview.totalActual / budgetOverview.totalBudget) * 100, 100) || 0}%` }}
                  />
                </div>
              </div>
            </div>
            {budgetOverview.upcomingEvents.length > 0 && (
              <div className="mt-4 border-t pt-4">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Upcoming Events</p>
                <div className="space-y-2">
                  {budgetOverview.upcomingEvents.map((event) => (
                    <div key={event.id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{event.name}</span>
                        {event.category && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            {event.category}
                          </span>
                        )}
                      </div>
                      <span className="text-muted-foreground">
                        {event.eventDate && new Date(event.eventDate).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Transactions Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Cashflow Activity</CardTitle>
              <CardDescription>Your verified transactions</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input placeholder="Search transactions..." className="w-full sm:w-60" />
              <Button variant="outline" size="sm" disabled>
                Filters
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-y border-border/50 bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Description</th>
                  <th className="px-5 py-3 font-medium">Category</th>
                  <th className="px-5 py-3 font-medium">Account</th>
                  <th className="px-5 py-3 font-medium text-right">Amount</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Receipts</th>
                </tr>
              </thead>
              <tbody>
              {activeEntries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-muted-foreground">
                    No transactions yet. Verify transactions from the Accounts page.
                  </td>
                </tr>
              ) : (
                activeEntries.map((entry) => {
                  const hasAccountEntry = !!entry.accountEntryId;
                  return (
                    <tr
                      key={entry.id}
                      className={`border-b border-border/30 last:border-0 transition-colors hover:bg-muted/20 ${hasAccountEntry ? "bg-emerald-500/5" : ""}`}
                    >
                      <td className="px-5 py-4 text-muted-foreground">
                        {new Date(entry.date).toLocaleDateString()}
                      </td>
                      <td className="px-5 py-4">
                        <div className="font-medium">{entry.description}</div>
                        <div className="text-xs text-muted-foreground">#{entry.id.slice(0, 8)}</div>
                        {hasAccountEntry && entry.accountEntry && (
                          <div className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                            From: {entry.accountEntry.account} — {entry.accountEntry.description}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <span className="rounded-lg bg-muted px-2 py-1 text-xs font-medium">
                          {entry.category}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-muted-foreground">
                        {entry.accountEntry?.account ?? "—"}
                      </td>
                      <td
                        className={`px-5 py-4 text-right font-semibold ${
                          entry.amount >= 0 ? "text-emerald-500" : "text-rose-500"
                        }`}
                      >
                        {formatCurrency(entry.amount)}
                      </td>
                      <td className="px-5 py-4">
                        {hasAccountEntry ? (
                          <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                            Verified
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                            Manual
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">
                            {entry.receiptsCount} file{entry.receiptsCount === 1 ? "" : "s"}
                          </span>
                          {entry.receiptsCount > 0 && (
                            <Button 
                              size="xs" 
                              variant="ghost"
                              onClick={() => {
                                setViewingReceiptsEntryId(entry.id);
                                setViewingReceiptIndex(0);
                              }}
                            >
                              View
                            </Button>
                          )}
                          <Button 
                            size="xs" 
                            variant="ghost"
                            onClick={() => setAttachingToEntryId(entry.id)}
                          >
                            Attach
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* View Receipts Dialog */}
      <Dialog 
        open={!!viewingReceiptsEntryId} 
        onOpenChange={(open) => {
          if (!open) {
            setViewingReceiptsEntryId(null);
            setViewingReceiptIndex(0);
          }
        }}
      >
        <DialogPopup className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Attached Receipts</DialogTitle>
            <DialogDescription>
              {viewingEntry?.description} — {receipts.length} receipt{receipts.length === 1 ? "" : "s"}
            </DialogDescription>
          </DialogHeader>
          
          {receiptsQuery.isLoading ? (
            <div className="py-8 text-center text-muted-foreground">Loading...</div>
          ) : receipts.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">No receipts attached.</div>
          ) : (
            <div className="mt-4 space-y-4">
              {/* Receipt Navigation */}
              {receipts.length > 1 && (
                <div className="flex items-center justify-between">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setViewingReceiptIndex((i) => Math.max(0, i - 1))}
                    disabled={viewingReceiptIndex === 0}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {viewingReceiptIndex + 1} of {receipts.length}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setViewingReceiptIndex((i) => Math.min(receipts.length - 1, i + 1))}
                    disabled={viewingReceiptIndex === receipts.length - 1}
                  >
                    Next
                  </Button>
                </div>
              )}

              {currentReceipt && (
                <>
                  {/* Receipt Details */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Submitter</p>
                      <p className="font-medium">{currentReceipt.submitterName}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Date Submitted</p>
                      <p className="font-medium">
                        {new Date(currentReceipt.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="sm:col-span-2">
                      <p className="text-xs font-medium text-muted-foreground">Purpose</p>
                      <p className="font-medium">{currentReceipt.purpose}</p>
                    </div>
                    {currentReceipt.notes && (
                      <div className="sm:col-span-2">
                        <p className="text-xs font-medium text-muted-foreground">Notes</p>
                        <p>{currentReceipt.notes}</p>
                      </div>
                    )}
                  </div>

                  {/* Receipt Image */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">Receipt Image</p>
                    <div className="rounded-lg border border-border/60 overflow-hidden bg-muted/20">
                      <img
                        src={`data:${currentReceipt.imageType};base64,${currentReceipt.imageData}`}
                        alt="Receipt"
                        className="max-h-80 w-full object-contain"
                      />
                    </div>
                  </div>

                  {/* Unbind Button */}
                  <div className="pt-4 border-t">
                    <Button
                      variant="outline"
                      className="text-amber-600 hover:text-amber-700"
                      onClick={() => unbindMutation.mutate({ id: currentReceipt.id })}
                      disabled={unbindMutation.isPending}
                    >
                      {unbindMutation.isPending ? "Unbinding..." : "Unbind This Receipt"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          <DialogFooter className="mt-6">
            <DialogClose>
              <Button variant="outline">Close</Button>
            </DialogClose>
            <Button onClick={() => {
              setViewingReceiptsEntryId(null);
              setAttachingToEntryId(viewingEntry?.id ?? null);
            }}>
              Attach More
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      {/* Attach Receipt Dialog */}
      <Dialog open={!!attachingToEntryId} onOpenChange={(open) => !open && resetAttachDialog()}>
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Attach Receipt</DialogTitle>
            <DialogDescription>
              Attach a receipt to: {attachingToEntry?.description}
            </DialogDescription>
          </DialogHeader>
          
          <div className="mt-4 space-y-4">
            {/* Mode Tabs */}
            <div className="flex rounded-lg border border-border/60 p-1">
              <button
                type="button"
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  attachMode === "select"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setAttachMode("select")}
              >
                Select Existing
              </button>
              <button
                type="button"
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  attachMode === "upload"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setAttachMode("upload")}
              >
                Upload New
              </button>
            </div>

            {attachMode === "select" ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="selectReceipt">Select Unbound Receipt</Label>
                  <select
                    id="selectReceipt"
                    className="flex h-10 w-full rounded-xl border border-border/60 bg-background/60 backdrop-blur-sm px-4 py-2 text-sm outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/30"
                    value={selectedReceiptId}
                    onChange={(e) => setSelectedReceiptId(e.target.value)}
                  >
                    <option value="">Choose a receipt...</option>
                    {unboundReceipts.map((r) => (
                      <option key={r.id} value={r.id}>
                        {new Date(r.createdAt).toLocaleDateString()} — {r.submitterName} — {r.purpose}
                      </option>
                    ))}
                  </select>
                  {unboundReceipts.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No unbound receipts available. Upload a new one instead.
                    </p>
                  )}
                </div>
                <DialogFooter>
                  <DialogClose>
                    <Button type="button" variant="outline">
                      Cancel
                    </Button>
                  </DialogClose>
                  <Button
                    onClick={() => {
                      if (attachingToEntryId && selectedReceiptId) {
                        bindReceiptMutation.mutate({
                          id: selectedReceiptId,
                          cashflowEntryId: attachingToEntryId,
                        });
                      }
                    }}
                    disabled={!selectedReceiptId || bindReceiptMutation.isPending}
                  >
                    {bindReceiptMutation.isPending ? "Binding..." : "Bind Receipt"}
                  </Button>
                </DialogFooter>
              </div>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!attachingToEntryId || !imageData) return;
                  submitAndBindMutation.mutate({
                    submitterName: uploadForm.submitterName,
                    purpose: uploadForm.purpose,
                    notes: uploadForm.notes || undefined,
                    imageData,
                    imageType,
                    cashflowEntryId: attachingToEntryId,
                  });
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="uploaderName">Your Name</Label>
                  <Input
                    id="uploaderName"
                    value={uploadForm.submitterName}
                    onChange={(e) => setUploadForm({ ...uploadForm, submitterName: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="purpose">Purpose</Label>
                  <Input
                    id="purpose"
                    placeholder="What is this receipt for?"
                    value={uploadForm.purpose}
                    onChange={(e) => setUploadForm({ ...uploadForm, purpose: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Notes (optional)</Label>
                  <Textarea
                    id="notes"
                    placeholder="Any additional notes..."
                    value={uploadForm.notes}
                    onChange={(e) => setUploadForm({ ...uploadForm, notes: e.target.value })}
                    rows={2}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="receiptImage">Receipt Image</Label>
                  <Input
                    id="receiptImage"
                    type="file"
                    accept="image/*"
                    onChange={handleImageChange}
                    required
                  />
                  {imagePreview && (
                    <div className="mt-2 rounded-lg border border-border/60 overflow-hidden">
                      <img
                        src={imagePreview}
                        alt="Receipt preview"
                        className="max-h-40 w-full object-contain"
                      />
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <DialogClose>
                    <Button type="button" variant="outline">
                      Cancel
                    </Button>
                  </DialogClose>
                  <Button
                    type="submit"
                    disabled={!imageData || submitAndBindMutation.isPending}
                  >
                    {submitAndBindMutation.isPending ? "Uploading..." : "Upload & Bind"}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </div>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
