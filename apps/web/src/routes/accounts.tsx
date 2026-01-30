import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useRef, useState } from "react";

import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { ArrowDown, ArrowUp, Calendar, Filter, Loader2 } from "lucide-react";

export const Route = createFileRoute("/accounts")({
  component: AccountsRoute,
});

const ACCOUNT_OPTIONS = ["GCash", "GoTyme", "Cash", "BPI"] as const;

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(value);

const PAGE_SIZE = 20;

function AccountsRoute() {
  const listQueryOptions = trpc.accountEntries.list.queryOptions({ limit: 100 });
  const entriesQuery = useQuery(listQueryOptions);
  const roleQuery = useQuery(trpc.team.getMyRole.queryOptions());
  const canEditAccounts =
    roleQuery.data?.role === "TREASURER" || roleQuery.data?.role === "VP_FINANCE";

  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [accountFilter, setAccountFilter] = useState<"all" | (typeof ACCOUNT_OPTIONS)[number]>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "verified" | "unverified" | "archived">("all");
  const [dateFilterMode, setDateFilterMode] = useState<"all" | "single" | "range">("all");
  const [dateSingle, setDateSingle] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateSort, setDateSort] = useState<"desc" | "asc">("desc");
  const debouncedSearch = useDebouncedValue(searchQuery.trim(), 300);

  const listPageQueryOptions = trpc.accountEntries.listPage.queryOptions({
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    search: debouncedSearch || undefined,
    accountFilter,
    statusFilter,
    dateFrom: dateFilterMode === "range" && dateFrom ? dateFrom : undefined,
    dateTo: dateFilterMode === "range" && dateTo ? dateTo : undefined,
    dateSingle: dateFilterMode === "single" && dateSingle ? dateSingle : undefined,
    dateSort,
  });
  const listPageQuery = useQuery(listPageQueryOptions);
  const tableItems = listPageQuery.data?.items ?? [];
  const hasMore = listPageQuery.data?.hasMore ?? false;

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, accountFilter, statusFilter, dateFilterMode, dateSingle, dateFrom, dateTo, dateSort]);

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
  }, [debouncedSearch, accountFilter, statusFilter, dateSort, dateFilterMode, dateSingle, dateFrom, dateTo, page]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newEntry, setNewEntry] = useState({
    date: new Date().toISOString().slice(0, 10),
    description: "",
    account: ACCOUNT_OPTIONS[0] as string,
    amount: "",
  });
  const [editForm, setEditForm] = useState({
    id: "",
    date: "",
    description: "",
    account: ACCOUNT_OPTIONS[0] as string,
    amount: "",
  });

  const updateEntry = useMutation(
    trpc.accountEntries.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: listQueryOptions.queryKey });
        queryClient.invalidateQueries({ queryKey: listPageQueryOptions.queryKey });
        setEditingId(null);
      },
    }),
  );

  const createEntry = useMutation(
    trpc.accountEntries.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: listQueryOptions.queryKey });
        queryClient.invalidateQueries({ queryKey: listPageQueryOptions.queryKey });
        setNewEntry({
          date: new Date().toISOString().slice(0, 10),
          description: "",
          account: ACCOUNT_OPTIONS[0],
          amount: "",
        });
        setIsDialogOpen(false);
      },
    }),
  );

  const archiveEntry = useMutation(
    trpc.accountEntries.archive.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: listQueryOptions.queryKey });
        queryClient.invalidateQueries({ queryKey: listPageQueryOptions.queryKey });
      },
    }),
  );

  const entries = entriesQuery.data?.items ?? [];
  const activeEntries = entries.filter((entry) => entry.isActive);

  const totalInflow = activeEntries
    .filter((entry) => entry.amount > 0)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const totalOutflow = activeEntries
    .filter((entry) => entry.amount < 0)
    .reduce((sum, entry) => sum + Math.abs(entry.amount), 0);
  const netMovement = totalInflow - totalOutflow;
  const accountBalances = ACCOUNT_OPTIONS.reduce<Record<string, number>>((acc, account) => {
    acc[account] = activeEntries
      .filter((entry) => entry.account === account)
      .reduce((sum, entry) => sum + entry.amount, 0);
    return acc;
  }, {});

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Treasury</p>
          <h1 className="text-2xl font-semibold">Accounts ledger</h1>
          <p className="text-sm text-muted-foreground">
            Record inflows and outflows across GCash, GoTyme, Cash, and BPI.
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          {canEditAccounts && (
            <Button variant="outline" onClick={() => setIsDialogOpen(true)}>
              New transaction
            </Button>
          )}
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>New account transaction</DialogTitle>
              <DialogDescription>
                Record a transaction in one of your treasury accounts.
              </DialogDescription>
            </DialogHeader>
            <form
              className="mt-4 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                createEntry.mutate({
                  date: newEntry.date,
                  description: newEntry.description,
                  account: newEntry.account as typeof ACCOUNT_OPTIONS[number],
                  amount: newEntry.amount,
                });
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="new-date">Date</Label>
                  <Input
                    id="new-date"
                    type="date"
                    value={newEntry.date}
                    onChange={(e) => setNewEntry({ ...newEntry, date: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-account">Account</Label>
                  <select
                    id="new-account"
                    className="flex h-9 w-full border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={newEntry.account}
                    onChange={(e) => setNewEntry({ ...newEntry, account: e.target.value })}
                    required
                  >
                    {ACCOUNT_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-description">Description</Label>
                <Input
                  id="new-description"
                  placeholder="What was this transaction for?"
                  value={newEntry.description}
                  onChange={(e) => setNewEntry({ ...newEntry, description: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-amount">Amount</Label>
                <Input
                  id="new-amount"
                  type="number"
                  step="0.01"
                  placeholder="0.00 (negative for outflow)"
                  value={newEntry.amount}
                  onChange={(e) => setNewEntry({ ...newEntry, amount: e.target.value })}
                  required
                />
              </div>
              <DialogFooter className="mt-6">
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={createEntry.isPending}>
                  {createEntry.isPending ? "Saving..." : "Create entry"}
                </Button>
              </DialogFooter>
            </form>
          </DialogPopup>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active Summary</CardTitle>
          <CardDescription>Current totals across all treasury accounts.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Total inflow</p>
            <p className="text-lg font-semibold text-emerald-500">{formatCurrency(totalInflow)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total outflow</p>
            <p className="text-lg font-semibold text-rose-500">{formatCurrency(totalOutflow)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Net movement</p>
            <p className="text-lg font-semibold">{formatCurrency(netMovement)}</p>
          </div>
        </CardContent>
        <CardContent className="border-t pt-4">
          <div className="grid gap-3 md:grid-cols-4">
            {ACCOUNT_OPTIONS.map((account) => (
              <div key={account} className="rounded-none border border-border/60 p-3">
                <p className="text-xs text-muted-foreground">{account}</p>
                <p className="text-sm font-semibold">{formatCurrency(accountBalances[account])}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="relative">
        <CardHeader className="border-b">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Ledger</CardTitle>
              <CardDescription>Track what goes in and out per account.</CardDescription>
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
                      Account: {accountFilter === "all" ? "All" : accountFilter}
                    </Button>
                  )}
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setAccountFilter("all")}>
                    All accounts
                  </DropdownMenuItem>
                  {ACCOUNT_OPTIONS.map((opt) => (
                    <DropdownMenuItem key={opt} onClick={() => setAccountFilter(opt)}>
                      {opt}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={(props) => (
                    <Button variant="outline" size="sm" className="gap-2" {...props}>
                      <Filter className="size-4" />
                      Status:{" "}
                      {statusFilter === "all"
                        ? "All"
                        : statusFilter === "verified"
                          ? "Verified"
                          : statusFilter === "unverified"
                            ? "Unverified"
                            : "Archived"}
                    </Button>
                  )}
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setStatusFilter("all")}>
                    All statuses
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setStatusFilter("verified")}>
                    Verified
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setStatusFilter("unverified")}>
                    Unverified
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setStatusFilter("archived")}>
                    Archived
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
          {isTableLoading && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm animate-in fade-in duration-200 ease-out"
              aria-hidden="true"
            >
              <Loader2 className="size-12 text-primary animate-[spin_1.2s_linear_infinite]" />
            </div>
          )}
          {(tableItems.length > 0 || page > 1) && (
            <div className="flex items-center justify-between gap-4 border-b border-border/50 bg-muted/20 px-4 py-3">
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
                <span className="text-sm text-muted-foreground">Page {page}</span>
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
            <table className="w-full text-left text-xs">
              <thead className="border-b bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">
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
                  <th className="px-4 py-3 font-medium">Description</th>
                  {ACCOUNT_OPTIONS.map((account) => (
                    <th key={account} className="px-4 py-3 font-medium text-right">
                      {account}
                    </th>
                  ))}
                  <th className="px-4 py-3 font-medium">Verification</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tableItems.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-muted-foreground" colSpan={8}>
                      {debouncedSearch ||
                      accountFilter !== "all" ||
                      statusFilter !== "all" ||
                      dateFilterMode !== "all"
                        ? "No entries match your search or filter."
                        : "No entries yet. Click \"New transaction\" to add your first account entry."}
                    </td>
                  </tr>
                ) : (
                  tableItems.map((entry) => {
                    return (
                    <Fragment key={entry.id}>
                      <tr
                        className={`border-b last:border-0 ${
                          entry.isActive ? "" : "opacity-60"
                        } ${entry.isVerified ? "bg-emerald-500/5" : ""}`}
                      >
                        <td className="px-4 py-3 text-muted-foreground">
                          {new Date(entry.date).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{entry.description}</div>
                          <div className="text-muted-foreground">#{entry.id.slice(0, 8)}</div>
                          {entry.isVerified && entry.cashflowEntry && (
                            <div className="mt-1 text-[10px] text-emerald-600">
                              Verified as: {entry.cashflowEntry.description}
                            </div>
                          )}
                        </td>
                        {ACCOUNT_OPTIONS.map((account) => {
                          const isMatch = entry.account === account;
                          const amount = isMatch ? entry.amount : null;
                          return (
                            <td
                              key={`${entry.id}-${account}`}
                              className={`px-4 py-3 text-right font-medium ${
                                amount && amount >= 0 ? "text-emerald-500" : "text-rose-500"
                              }`}
                            >
                              {amount === null ? "—" : formatCurrency(amount)}
                            </td>
                          );
                        })}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {!entry.isActive && (
                              <span className="inline-flex items-center rounded-full bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
                                ARCHIVED
                              </span>
                            )}
                            {entry.isVerified && (
                              <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-600">
                                VERIFIED
                              </span>
                            )}
                            {entry.isActive && !entry.isVerified && (
                              <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-600">
                                UNVERIFIED
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {entry.isActive ? (
                            canEditAccounts ? (
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="xs"
                                  variant="outline"
                                  onClick={() => {
                                    setEditingId(entry.id);
                                    const account = ACCOUNT_OPTIONS.includes(
                                      entry.account as (typeof ACCOUNT_OPTIONS)[number],
                                    )
                                      ? (entry.account as (typeof ACCOUNT_OPTIONS)[number])
                                      : ACCOUNT_OPTIONS[0];
                                    setEditForm({
                                      id: entry.id,
                                      date: new Date(entry.date).toISOString().slice(0, 10),
                                      description: entry.description,
                                      account,
                                      amount: entry.amount.toString(),
                                    });
                                  }}
                                >
                                  Edit
                                </Button>
                                <Button
                                  size="xs"
                                  variant="outline"
                                  onClick={() => archiveEntry.mutate({ id: entry.id })}
                                  disabled={archiveEntry.isPending || entry.isVerified}
                                  title={
                                    entry.isVerified
                                      ? "Cannot archive: linked to a verified transaction"
                                      : undefined
                                  }
                                >
                                  Archive
                                </Button>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )
                          ) : (
                            <span className="text-muted-foreground">Archived</span>
                          )}
                        </td>
                      </tr>
                      {editingId === entry.id ? (
                        <tr className="border-b bg-muted/30">
                          <td colSpan={8} className="px-4 py-4">
                            <form
                              className="grid gap-3 md:grid-cols-[1fr_2fr_1fr_1fr_auto]"
                              onSubmit={(event) => {
                                event.preventDefault();
                                updateEntry.mutate({
                                  id: editForm.id,
                                  date: editForm.date,
                                  description: editForm.description,
                                  account: editForm.account as typeof ACCOUNT_OPTIONS[number],
                                  amount: editForm.amount,
                                });
                              }}
                            >
                              <Input
                                type="date"
                                value={editForm.date}
                                onChange={(event) =>
                                  setEditForm({ ...editForm, date: event.target.value })
                                }
                                required
                              />
                              <Input
                                placeholder="Description"
                                value={editForm.description}
                                onChange={(event) =>
                                  setEditForm({ ...editForm, description: event.target.value })
                                }
                                required
                              />
                              <select
                                className="flex h-8 w-full border border-input bg-background px-3 py-1 text-xs"
                                value={editForm.account}
                                onChange={(event) =>
                                  setEditForm({ ...editForm, account: event.target.value })
                                }
                                required
                              >
                                {ACCOUNT_OPTIONS.map((opt) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                              <Input
                                placeholder="Amount"
                                type="number"
                                step="0.01"
                                value={editForm.amount}
                                onChange={(event) =>
                                  setEditForm({ ...editForm, amount: event.target.value })
                                }
                                required
                              />
                              <div className="flex items-center gap-2">
                                <Button type="submit" disabled={updateEntry.isPending}>
                                  {updateEntry.isPending ? "Saving..." : "Save"}
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => setEditingId(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </form>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
