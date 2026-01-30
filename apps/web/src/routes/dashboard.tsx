import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TooltipProvider } from "@/components/ui/tooltip";
import { downloadPdfReport } from "@/lib/pdf-report";
import { queryClient, trpc } from "@/utils/trpc";
import { ArrowDown, ArrowUp, Calendar, FileDown, Filter, Info, Loader2 } from "lucide-react";

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

type StatusFilterValue = "all" | "no_receipt" | "verified" | "manual";

function RouteComponent() {
  const { session } = Route.useRouteContext();
  const navigate = useNavigate();

  // Only VP Finance and Auditor can verify transactions, attach/unbind receipts on dashboard
  const roleQueryOptions = trpc.team.getMyRole.queryOptions();
  const roleQuery = useQuery(roleQueryOptions);
  const canEditDashboard =
    roleQuery.data?.role === "VP_FINANCE" || roleQuery.data?.role === "AUDITOR";

  const cashflowQueryOptions = trpc.cashflowEntries.list.queryOptions({
    limit: 100,
  });
  const cashflowQuery = useQuery(cashflowQueryOptions);

  // Table uses server-side pagination (listPage); stats use list(100)
  const PAGE_SIZE = 20;
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all");
  const [dateFilterMode, setDateFilterMode] = useState<"all" | "single" | "range">("all");
  const [dateSingle, setDateSingle] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateSort, setDateSort] = useState<"desc" | "asc">("desc");
  const debouncedSearch = useDebouncedValue(searchQuery.trim(), 300);

  const listPageQueryOptions = trpc.cashflowEntries.listPage.queryOptions({
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    search: debouncedSearch || undefined,
    statusFilter,
    dateFrom: dateFilterMode === "range" && dateFrom ? dateFrom : undefined,
    dateTo: dateFilterMode === "range" && dateTo ? dateTo : undefined,
    dateSingle: dateFilterMode === "single" && dateSingle ? dateSingle : undefined,
    dateSort,
  });
  const listPageQuery = useQuery(listPageQueryOptions);
  const tableItems = listPageQuery.data?.items ?? [];
  const hasMore = listPageQuery.data?.hasMore ?? false;

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
    submitterName: session.data?.user?.name ?? "",
    purpose: "",
    notes: "",
  });
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageData, setImageData] = useState<string>("");
  const [imageType, setImageType] = useState<string>("");

  // View receipts state
  const [viewingReceiptsEntryId, setViewingReceiptsEntryId] = useState<string | null>(null);
  const [viewingReceiptIndex, setViewingReceiptIndex] = useState<number>(0);

  // PDF report dialog and cooldown (5 min whole cashflow, 2 min if >100 items)
  const PDF_COOLDOWN_KEY = "cisco-finance-pdf-cooldown-end";
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
  const [pdfDateFrom, setPdfDateFrom] = useState("");
  const [pdfDateTo, setPdfDateTo] = useState("");
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [pdfCooldownEnd, setPdfCooldownEnd] = useState<number | null>(() => {
    if (typeof sessionStorage === "undefined") return null;
    const stored = sessionStorage.getItem(PDF_COOLDOWN_KEY);
    const end = stored ? Number(stored) : NaN;
    return Number.isFinite(end) && end > Date.now() ? end : null;
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (pdfCooldownEnd == null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pdfCooldownEnd]);
  useEffect(() => {
    if (pdfCooldownEnd != null) {
      sessionStorage.setItem(PDF_COOLDOWN_KEY, String(pdfCooldownEnd));
    } else {
      sessionStorage.removeItem(PDF_COOLDOWN_KEY);
    }
  }, [pdfCooldownEnd]);
  useEffect(() => {
    if (pdfCooldownEnd != null && now >= pdfCooldownEnd) setPdfCooldownEnd(null);
  }, [pdfCooldownEnd, now]);
  const pdfCooldownRemaining = pdfCooldownEnd != null && pdfCooldownEnd > now ? pdfCooldownEnd - now : 0;
  const pdfCooldownMinutes = Math.floor(pdfCooldownRemaining / 60000);
  const pdfCooldownSeconds = Math.floor((pdfCooldownRemaining % 60000) / 1000);
  const pdfCooldownLabel =
    pdfCooldownRemaining > 0
      ? `${pdfCooldownMinutes}:${pdfCooldownSeconds.toString().padStart(2, "0")} cooldown`
      : null;
  const isPdfOnCooldown = pdfCooldownRemaining > 0;

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
        queryClient.invalidateQueries({ queryKey: listPageQueryOptions.queryKey });
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
        queryClient.invalidateQueries({ queryKey: listPageQueryOptions.queryKey });
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
        queryClient.invalidateQueries({ queryKey: listPageQueryOptions.queryKey });
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
        queryClient.invalidateQueries({ queryKey: listPageQueryOptions.queryKey });
        queryClient.invalidateQueries({ queryKey: unboundReceiptsQueryOptions.queryKey });
        queryClient.invalidateQueries({ queryKey: unboundListQueryOptions.queryKey });
        queryClient.invalidateQueries({ queryKey: receiptsQueryOptions.queryKey });
      },
    }),
  );

  const resetAttachDialog = () => {
    setAttachingToEntryId(null);
    setAttachingToEntry(null);
    setAttachMode("select");
    setSelectedReceiptId("");
    setUploadForm({
      submitterName: session.data?.user?.name ?? "",
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

  const cashflowEntries = cashflowQuery.data?.items ?? [];
  const activeEntries = cashflowEntries.filter((entry) => entry.isActive);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter, dateFilterMode, dateSingle, dateFrom, dateTo, dateSort]);

  // Mandatory 0.25s loading overlay when order, search, or filter changes
  const [isTableLoading, setIsTableLoading] = useState(false);
  const tableLoadTriggerRef = useRef(false);
  useEffect(() => {
    if (!tableLoadTriggerRef.current) {
      tableLoadTriggerRef.current = true;
      return;
    }
    setIsTableLoading(true);
    const t = setTimeout(() => setIsTableLoading(false), 250);
    return () => clearTimeout(t);
  }, [debouncedSearch, statusFilter, dateSort, dateFilterMode, dateSingle, dateFrom, dateTo, page]);

  // Store full entry when opening Attach/View dialogs so we have it after page change
  type TableEntry = (typeof tableItems)[number];
  const [attachingToEntry, setAttachingToEntry] = useState<TableEntry | null>(null);
  const [viewingEntry, setViewingEntry] = useState<TableEntry | null>(null);
  useEffect(() => {
    if (!attachingToEntryId) setAttachingToEntry(null);
  }, [attachingToEntryId]);
  useEffect(() => {
    if (!viewingReceiptsEntryId) setViewingEntry(null);
  }, [viewingReceiptsEntryId]);

  const totalInflow = activeEntries
    .filter((entry) => entry.amount > 0)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const totalOutflow = activeEntries
    .filter((entry) => entry.amount < 0)
    .reduce((sum, entry) => sum + Math.abs(entry.amount), 0);
  const netCashflow = totalInflow - totalOutflow;
  const projectedCashflow =
    netCashflow - (budgetOverview?.totalBudget ?? 0);
  
  const unverifiedNet = unverifiedEntries.reduce((sum, e) => sum + e.amount, 0);
  const netMovement = netCashflow + unverifiedNet;
  const deficit = netMovement - netCashflow;
  const unverifiedAmount = unverifiedEntries.reduce(
    (sum, e) => sum + Math.abs(e.amount),
    0,
  );
  const totalVerified = activeEntries.reduce(
    (sum, e) => sum + Math.abs(e.amount),
    0,
  );
  const totalActivity = unverifiedAmount + totalVerified;
  const deficitRatio = totalActivity === 0 ? 0 : Math.min(Math.abs(deficit) / Math.max(totalActivity, 1), 1);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
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
            {canEditDashboard
              ? `Welcome back, ${session.data?.user?.name ?? "User"}`
              : "View-only. Only VP Finance and Auditor can verify transactions and attach receipts."}
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
          {canEditDashboard && (
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
                  <Label>Select Transaction</Label>
                  <div className="border border-border/60 rounded-xl overflow-hidden bg-background/40 backdrop-blur-sm">
                    <div className="max-h-[240px] overflow-y-auto custom-scrollbar">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-muted/50 sticky top-0 border-b border-border/50 z-10">
                          <tr>
                            <th className="px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider">Date</th>
                            <th className="px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider">Account</th>
                            <th className="px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider">Description</th>
                            <th className="px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                          {unverifiedEntries.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                                No unverified transactions. Add transactions in the Accounts page first.
                              </td>
                            </tr>
                          ) : (
                            unverifiedEntries.map((e) => (
                              <tr 
                                key={e.id} 
                                onClick={() => setFormState({ ...formState, accountEntryId: e.id })}
                                className={cn(
                                  "cursor-pointer transition-colors hover:bg-primary/5",
                                  formState.accountEntryId === e.id ? "bg-primary/10 hover:bg-primary/15" : ""
                                )}
                              >
                                <td className="px-3 py-3 tabular-nums text-muted-foreground whitespace-nowrap">
                                  {new Date(e.date).toLocaleDateString()}
                                </td>
                                <td className="px-3 py-3 font-medium">{e.account}</td>
                                <td className="px-3 py-3 min-w-[120px]">{e.description}</td>
                                <td className={cn(
                                  "px-3 py-3 text-right font-semibold tabular-nums whitespace-nowrap",
                                  e.amount >= 0 ? "text-emerald-500" : "text-rose-500"
                                )}>
                                  {formatCurrency(e.amount)}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
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
                  <DialogClose asChild>
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
          )}
          <Button variant="outline" onClick={() => setPdfDialogOpen(true)} className="gap-2">
            <FileDown className="size-4" />
            {isPdfOnCooldown ? `PDF Report (${pdfCooldownLabel})` : "PDF Report"}
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
            <p className="text-xs text-muted-foreground">Current verified net balance (money left)</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Projected Cashflow</CardDescription>
            <CardTitle
              className={`text-2xl ${
                projectedCashflow >= 0 ? "text-emerald-500" : "text-rose-500"
              }`}
            >
              {formatCurrency(projectedCashflow)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              After planned event budgets
              {budgetOverview
                ? ` (${formatCurrency(budgetOverview.totalBudget)} planned)`
                : ""}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-1.5">
              <CardDescription>Deficit</CardDescription>
              <TooltipProvider
                side="top"
                content={
                  <p className="text-muted-foreground">
                    Net movement (accounts) minus net cashflow (verified). Positive deficit means more income in accounts than verified—likely income not yet verified. Negative deficit means more expenses in accounts than verified—likely expenses not yet verified. Zero = in sync.
                  </p>
                }
              >
                <Info className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              </TooltipProvider>
            </div>
            <CardTitle className={`text-2xl ${deficit === 0 ? "text-foreground" : deficit > 0 ? "text-emerald-500" : "text-rose-500"}`}>
              {formatCurrency(deficit)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {deficit === 0
                ? "In sync (net movement = net cashflow)"
                : deficit > 0
                  ? "Likely income not yet verified"
                  : "Likely expenses not yet verified"}
            </p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-2 rounded-full transition-all ${deficit === 0 ? "bg-emerald-500" : deficit > 0 ? "bg-emerald-500/80" : "bg-rose-500/80"}`}
                style={{ width: `${(1 - deficitRatio) * 100}%` }}
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
              <Input
                placeholder="Search by amount or description"
                className="w-full sm:w-72"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={(props) => (
                    <Button variant="outline" size="sm" className="gap-2" {...props}>
                      <Filter className="size-4" />
                      Status:{" "}
                      {statusFilter === "all"
                        ? "All"
                        : statusFilter === "no_receipt"
                          ? "No receipt"
                          : statusFilter === "verified"
                            ? "Verified"
                            : "Manual entry"}
                    </Button>
                  )}
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setStatusFilter("all")}>
                    All statuses
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setStatusFilter("no_receipt")}>
                    No receipt
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setStatusFilter("verified")}>
                    Verified
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setStatusFilter("manual")}>
                    Manual entry
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={(props) => (
                    <Button variant="outline" size="sm" className="gap-2" {...props}>
                      <Calendar className="size-4" />
                      Date:{" "}
                      {dateFilterMode === "all"
                        ? "All"
                        : dateFilterMode === "single" && dateSingle
                          ? dateSingle
                          : dateFilterMode === "range" && dateFrom && dateTo
                            ? `${dateFrom} → ${dateTo}`
                            : "All"}
                    </Button>
                  )}
                />
                <DropdownMenuContent align="end" className="min-w-64 p-0">
                  <DropdownMenuItem onClick={() => setDateFilterMode("all")}>
                    All dates
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="px-2 py-1.5 text-xs">
                      Specific date
                    </DropdownMenuLabel>
                    <div
                      className="px-2 pb-2"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <Input
                        type="date"
                        value={dateSingle}
                        onChange={(e) => {
                          setDateSingle(e.target.value);
                          setDateFilterMode("single");
                        }}
                        className="h-9 text-xs"
                      />
                    </div>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="px-2 py-1.5 text-xs">
                      Date range
                    </DropdownMenuLabel>
                    <div
                      className="flex flex-col gap-2 px-2 pb-3"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-2">
                        <Label className="shrink-0 text-xs text-muted-foreground">From</Label>
                        <Input
                          type="date"
                          value={dateFrom}
                          onChange={(e) => {
                            setDateFrom(e.target.value);
                            setDateFilterMode("range");
                          }}
                          className="h-9 text-xs"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Label className="shrink-0 text-xs text-muted-foreground">To</Label>
                        <Input
                          type="date"
                          value={dateTo}
                          onChange={(e) => {
                            setDateTo(e.target.value);
                            setDateFilterMode("range");
                          }}
                          className="h-9 text-xs"
                        />
                      </div>
                    </div>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Pagination above table */}
          {(tableItems.length > 0 || page > 1) && (
            <div className="flex items-center justify-between gap-4 border-b border-border/50 bg-muted/20 px-5 py-3">
              <p className="text-xs text-muted-foreground">
                Showing {(page - 1) * PAGE_SIZE + 1}–{(page - 1) * PAGE_SIZE + tableItems.length}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!hasMore}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-y border-border/50 bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-ml-2 h-8 gap-1.5 font-medium text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setDateSort((s) => (s === "desc" ? "asc" : "desc"))
                      }
                    >
                      Date
                      {dateSort === "desc" ? (
                        <ArrowDown className="size-3.5 shrink-0" />
                      ) : (
                        <ArrowUp className="size-3.5 shrink-0" />
                      )}
                    </Button>
                  </th>
                  <th className="px-5 py-3 font-medium">Description</th>
                  <th className="px-5 py-3 font-medium">Category</th>
                  <th className="px-5 py-3 font-medium">Account</th>
                  <th className="px-5 py-3 font-medium text-right">Amount</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Receipts</th>
                </tr>
              </thead>
              <tbody>
              {tableItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-muted-foreground">
                    {debouncedSearch || statusFilter !== "all" || dateFilterMode !== "all"
                      ? "No transactions match your search or filter."
                      : "No transactions yet. Verify transactions from the Accounts page."}
                  </td>
                </tr>
              ) : (
                tableItems.map((entry) => {
                  const hasAccountEntry = !!entry.accountEntryId;
                  const noReceipt = entry.receiptsCount === 0;
                  return (
                    <tr
                      key={entry.id}
                      className={cn(
                        "border-b border-border/30 last:border-0 transition-colors hover:bg-muted/20",
                        hasAccountEntry && "bg-emerald-500/5",
                        noReceipt && "bg-red-500/5"
                      )}
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
                        {entry.receiptsCount === 0 ? (
                          <span className="inline-flex items-center rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-600 dark:text-red-400">
                            No receipt
                          </span>
                        ) : hasAccountEntry ? (
                          <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                            Verified
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                            Manual entry
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
                                setViewingEntry(entry);
                                setViewingReceiptIndex(0);
                              }}
                            >
                              View
                            </Button>
                          )}
                          {canEditDashboard && (
                            <Button 
                              size="xs" 
                              variant="ghost"
                              onClick={() => {
                                setAttachingToEntryId(entry.id);
                                setAttachingToEntry(entry);
                              }}
                            >
                              Attach
                            </Button>
                          )}
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

      {/* Full-page loading overlay when order/search/filter changes */}
      {isTableLoading && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm animate-in fade-in duration-200 ease-out"
          aria-hidden="true"
        >
          <Loader2 className="size-12 text-primary animate-[spin_1.2s_linear_infinite]" />
        </div>
      )}

      {/* View Receipts Dialog */}
      <Dialog 
        open={!!viewingReceiptsEntryId} 
        onOpenChange={(open) => {
          if (!open) {
            setViewingReceiptsEntryId(null);
            setViewingEntry(null);
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

                  {/* Unbind Button — only VP / Auditor */}
                  {canEditDashboard && (
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
                  )}
                </>
              )}
            </div>
          )}

          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button variant="outline">Close</Button>
            </DialogClose>
            {canEditDashboard && (
              <Button onClick={() => {
                setViewingReceiptsEntryId(null);
                setAttachingToEntryId(viewingEntry?.id ?? null);
              }}>
                Attach More
              </Button>
            )}
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      {/* PDF Report Dialog */}
      <Dialog open={pdfDialogOpen} onOpenChange={setPdfDialogOpen}>
        <DialogPopup className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Generate PDF Report</DialogTitle>
            <DialogDescription>
              Choose a date range. The report will include a table of cashflow entries and attached receipts in order (4–8 receipts per page).
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground">From</Label>
              <Input
                type="date"
                value={pdfDateFrom}
                onChange={(e) => setPdfDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">To</Label>
              <Input
                type="date"
                value={pdfDateTo}
                onChange={(e) => setPdfDateTo(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Leave both empty for all dates.
            </p>
            {!pdfDateFrom.trim() && !pdfDateTo.trim() && (
              <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                <p className="font-medium">Heavy use notice</p>
                <p className="mt-1">
                  Reporting all dates uses significant server and browser resources. A{" "}
                  <strong>5-minute cooldown</strong> will apply before you can generate another report.
                </p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Reports with over 100 entries trigger a 2-minute cooldown. The cooldown timer is shown on the Generate PDF button.
            </p>
          </div>
          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              disabled={pdfGenerating || isPdfOnCooldown}
              onClick={async () => {
                const noDateRange = !pdfDateFrom.trim() && !pdfDateTo.trim();
                setPdfGenerating(true);
                try {
                  const data = await queryClient.fetchQuery(
                    trpc.report.getReportData.queryOptions({
                      dateFrom: pdfDateFrom.trim() || undefined,
                      dateTo: pdfDateTo.trim() || undefined,
                      dateSort: "desc",
                    })
                  );
                  downloadPdfReport(data, {
                    dateFrom: pdfDateFrom.trim() || undefined,
                    dateTo: pdfDateTo.trim() || undefined,
                  });
                  setPdfDialogOpen(false);
                  const entryCount = data.entries.length;
                  let cooldownMs = 0;
                  if (noDateRange) cooldownMs = 5 * 60 * 1000;
                  else if (entryCount > 100) cooldownMs = 2 * 60 * 1000;
                  if (cooldownMs > 0) setPdfCooldownEnd(Date.now() + cooldownMs);
                } finally {
                  setPdfGenerating(false);
                }
              }}
            >
              {pdfGenerating ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Generating…
                </>
              ) : isPdfOnCooldown ? (
                `Generate PDF (${pdfCooldownLabel})`
              ) : (
                "Generate PDF"
              )}
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
                  <Label>Select Unbound Receipt</Label>
                  <div className="border border-border/60 rounded-xl overflow-hidden bg-background/40 backdrop-blur-sm">
                    <div className="max-h-[240px] overflow-y-auto custom-scrollbar">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-muted/50 sticky top-0 border-b border-border/50 z-10">
                          <tr>
                            <th className="px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider">Date</th>
                            <th className="px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider">Submitter</th>
                            <th className="px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider">Purpose</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                          {unboundReceipts.length === 0 ? (
                            <tr>
                              <td colSpan={3} className="px-3 py-8 text-center text-muted-foreground">
                                No unbound receipts available. Upload a new one instead.
                              </td>
                            </tr>
                          ) : (
                            unboundReceipts.map((r) => (
                              <tr 
                                key={r.id} 
                                onClick={() => setSelectedReceiptId(r.id)}
                                className={cn(
                                  "cursor-pointer transition-colors hover:bg-primary/5",
                                  selectedReceiptId === r.id ? "bg-primary/10 hover:bg-primary/15" : ""
                                )}
                              >
                                <td className="px-3 py-3 tabular-nums text-muted-foreground whitespace-nowrap">
                                  {new Date(r.createdAt).toLocaleDateString()}
                                </td>
                                <td className="px-3 py-3 font-medium whitespace-nowrap">{r.submitterName}</td>
                                <td className="px-3 py-3 min-w-[120px]">{r.purpose}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <DialogClose asChild>
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
                  <DialogClose asChild>
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
