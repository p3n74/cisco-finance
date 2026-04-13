import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import {
	ArrowDown,
	ArrowUp,
	Calendar,
	FileDown,
	Filter,
	Loader2,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { NotWhitelistedView } from "@/components/not-whitelisted-view";
import { Button, buttonVariants } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogClose,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogPopup,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { AppRouter } from "@cisco-finance/api/routers/index";
import { authClient } from "@/lib/auth-client";
import { downloadAccountLedgerPdf } from "@/lib/pdf-report";
import { queryClient, trpc } from "@/utils/trpc";

type AccountLedgerExportRow =
	inferRouterOutputs<AppRouter>["accountEntries"]["exportLedger"]["items"][number];

export const Route = createFileRoute("/accounts")({
	component: AccountsRoute,
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

const ACCOUNT_OPTIONS = ["GCash", "GoTyme", "Cash", "BPI"] as const;

const formatCurrency = (value: number) =>
	new Intl.NumberFormat("en-PH", {
		style: "currency",
		currency: "PHP",
		maximumFractionDigits: 2,
	}).format(value);

const PAGE_SIZE = 20;
const LEDGER_PDF_COOLDOWN_KEY = "cisco-finance-account-ledger-pdf-cooldown-end";

function AccountsRoute() {
	const roleQuery = useQuery(trpc.team.getMyRole.queryOptions());
	const isWhitelisted = (roleQuery.data?.role ?? null) !== null;
	const canEditAccounts =
		roleQuery.data?.role === "TREASURER" ||
		roleQuery.data?.role === "VP_FINANCE";

	const summaryQueryOptions = trpc.accountEntries.summary.queryOptions();
	const summaryQuery = useQuery({
		...summaryQueryOptions,
		enabled: isWhitelisted,
	});

	const [page, setPage] = useState(1);
	const [searchQuery, setSearchQuery] = useState("");
	const [accountFilter, setAccountFilter] = useState<
		"all" | (typeof ACCOUNT_OPTIONS)[number]
	>("all");
	const [statusFilter, setStatusFilter] = useState<
		"all" | "verified" | "unverified" | "archived"
	>("all");
	const [dateFilterMode, setDateFilterMode] = useState<
		"all" | "single" | "range"
	>("all");
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
		dateSingle:
			dateFilterMode === "single" && dateSingle ? dateSingle : undefined,
		dateSort,
	});
	const listPageQuery = useQuery({
		...listPageQueryOptions,
		enabled: isWhitelisted,
	});
	const tableItems = listPageQuery.data?.items ?? [];
	const hasMore = listPageQuery.data?.hasMore ?? false;

	useEffect(() => {
		setPage(1);
	}, [
		debouncedSearch,
		accountFilter,
		statusFilter,
		dateFilterMode,
		dateSingle,
		dateFrom,
		dateTo,
		dateSort,
	]);

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
	}, [
		debouncedSearch,
		accountFilter,
		statusFilter,
		dateSort,
		dateFilterMode,
		dateSingle,
		dateFrom,
		dateTo,
		page,
	]);

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
				queryClient.invalidateQueries({
					queryKey: summaryQueryOptions.queryKey,
				});
				queryClient.invalidateQueries({
					queryKey: listPageQueryOptions.queryKey,
				});
				setEditingId(null);
			},
		}),
	);

	const createEntry = useMutation(
		trpc.accountEntries.create.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: summaryQueryOptions.queryKey,
				});
				queryClient.invalidateQueries({
					queryKey: listPageQueryOptions.queryKey,
				});
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
				queryClient.invalidateQueries({
					queryKey: summaryQueryOptions.queryKey,
				});
				queryClient.invalidateQueries({
					queryKey: listPageQueryOptions.queryKey,
				});
			},
		}),
	);

	const [ledgerPdfDialogOpen, setLedgerPdfDialogOpen] = useState(false);
	const [ledgerPdfAccount, setLedgerPdfAccount] = useState<
		(typeof ACCOUNT_OPTIONS)[number]
	>(ACCOUNT_OPTIONS[0]);
	const [ledgerPdfDateFrom, setLedgerPdfDateFrom] = useState("");
	const [ledgerPdfDateTo, setLedgerPdfDateTo] = useState("");
	const [ledgerPdfStatus, setLedgerPdfStatus] = useState<
		"all" | "verified" | "unverified" | "archived"
	>("all");
	const [ledgerPdfSearch, setLedgerPdfSearch] = useState("");
	const [ledgerPdfGenerating, setLedgerPdfGenerating] = useState(false);
	const [ledgerPdfCooldownEnd, setLedgerPdfCooldownEnd] = useState<
		number | null
	>(() => {
		if (typeof sessionStorage === "undefined") return null;
		const stored = sessionStorage.getItem(LEDGER_PDF_COOLDOWN_KEY);
		const end = stored ? Number(stored) : Number.NaN;
		return Number.isFinite(end) && end > Date.now() ? end : null;
	});
	const [ledgerNow, setLedgerNow] = useState(() => Date.now());
	useEffect(() => {
		if (ledgerPdfCooldownEnd == null) return;
		const id = setInterval(() => setLedgerNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, [ledgerPdfCooldownEnd]);
	useEffect(() => {
		if (ledgerPdfCooldownEnd != null) {
			sessionStorage.setItem(
				LEDGER_PDF_COOLDOWN_KEY,
				String(ledgerPdfCooldownEnd),
			);
		} else {
			sessionStorage.removeItem(LEDGER_PDF_COOLDOWN_KEY);
		}
	}, [ledgerPdfCooldownEnd]);
	useEffect(() => {
		if (ledgerPdfCooldownEnd != null && ledgerNow >= ledgerPdfCooldownEnd)
			setLedgerPdfCooldownEnd(null);
	}, [ledgerPdfCooldownEnd, ledgerNow]);
	const ledgerPdfCooldownRemaining =
		ledgerPdfCooldownEnd != null && ledgerPdfCooldownEnd > ledgerNow
			? ledgerPdfCooldownEnd - ledgerNow
			: 0;
	const ledgerPdfCooldownMinutes = Math.floor(
		ledgerPdfCooldownRemaining / 60000,
	);
	const ledgerPdfCooldownSeconds = Math.floor(
		(ledgerPdfCooldownRemaining % 60000) / 1000,
	);
	const ledgerPdfCooldownLabel =
		ledgerPdfCooldownRemaining > 0
			? `${ledgerPdfCooldownMinutes}:${ledgerPdfCooldownSeconds.toString().padStart(2, "0")} cooldown`
			: null;
	const isLedgerPdfOnCooldown = ledgerPdfCooldownRemaining > 0;

	function openLedgerPdfDialog() {
		setLedgerPdfAccount(
			accountFilter !== "all" ? accountFilter : ACCOUNT_OPTIONS[0],
		);
		setLedgerPdfStatus(statusFilter);
		setLedgerPdfSearch(searchQuery);
		setLedgerPdfDateFrom("");
		setLedgerPdfDateTo("");
		setLedgerPdfDialogOpen(true);
	}

	// Use aggregate summary from server (not limited by pagination)
	const summary = summaryQuery.data;
	const totalInflow = summary?.totalInflow ?? 0;
	const totalOutflow = summary?.totalOutflow ?? 0;
	const netMovement = summary?.netMovement ?? 0;
	const accountBalances = summary?.accountBalances ?? {
		GCash: 0,
		GoTyme: 0,
		Cash: 0,
		BPI: 0,
	};

	if (roleQuery.isLoading) {
		return (
			<div className="flex min-h-[40vh] items-center justify-center">
				<Loader2 className="size-8 animate-spin text-muted-foreground" />
			</div>
		);
	}
	if (roleQuery.isSuccess && !isWhitelisted) {
		return <NotWhitelistedView />;
	}

	return (
		<div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-4 px-3 py-4 sm:gap-6 sm:px-4 sm:py-6">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<p className="text-muted-foreground text-xs uppercase tracking-[0.2em]">
						Treasury
					</p>
					<h1 className="font-semibold text-2xl">Accounts ledger</h1>
					<p className="text-muted-foreground text-sm">
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
							noValidate
							className="mt-4 space-y-4"
							onSubmit={(event) => {
								event.preventDefault();
								if (
									!newEntry.date.trim() ||
									!newEntry.account.trim() ||
									!newEntry.description.trim() ||
									newEntry.amount === ""
								) {
									toast.error("Please fill out all required fields.");
									return;
								}
								createEntry.mutate({
									date: newEntry.date,
									description: newEntry.description,
									account: newEntry.account as (typeof ACCOUNT_OPTIONS)[number],
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
										onChange={(e) =>
											setNewEntry({ ...newEntry, date: e.target.value })
										}
										required
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="new-account">Account</Label>
									<select
										id="new-account"
										className="flex h-9 w-full border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
										value={newEntry.account}
										onChange={(e) =>
											setNewEntry({ ...newEntry, account: e.target.value })
										}
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
									onChange={(e) =>
										setNewEntry({ ...newEntry, description: e.target.value })
									}
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
									onChange={(e) =>
										setNewEntry({ ...newEntry, amount: e.target.value })
									}
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
					<CardDescription>
						Current totals across all treasury accounts.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4 md:grid-cols-3">
					<div>
						<p className="text-muted-foreground text-xs">Total inflow</p>
						<p className="font-semibold text-emerald-500 text-lg">
							{formatCurrency(totalInflow)}
						</p>
					</div>
					<div>
						<p className="text-muted-foreground text-xs">Total outflow</p>
						<p className="font-semibold text-lg text-rose-500">
							{formatCurrency(totalOutflow)}
						</p>
					</div>
					<div>
						<p className="text-muted-foreground text-xs">Net movement</p>
						<p className="font-semibold text-lg">
							{formatCurrency(netMovement)}
						</p>
					</div>
				</CardContent>
				<CardContent className="border-t pt-4">
					<div className="grid gap-3 md:grid-cols-4">
						{ACCOUNT_OPTIONS.map((account) => (
							<div
								key={account}
								className="rounded-none border border-border/60 p-3"
							>
								<p className="text-muted-foreground text-xs">{account}</p>
								<p className="font-semibold text-sm">
									{formatCurrency(accountBalances[account])}
								</p>
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
							<CardDescription>
								Track what goes in and out per account.
							</CardDescription>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								className="gap-2"
								onClick={openLedgerPdfDialog}
							>
								<FileDown className="size-4" />
								Download account ledger
							</Button>
							<Input
								placeholder="Search by amount or description"
								className="w-full sm:w-72"
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
							/>
							<DropdownMenu>
								<DropdownMenuTrigger
									render={(props) => (
										<Button
											variant="outline"
											size="sm"
											className="gap-2"
											{...props}
										>
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
										<DropdownMenuItem
											key={opt}
											onClick={() => setAccountFilter(opt)}
										>
											{opt}
										</DropdownMenuItem>
									))}
								</DropdownMenuContent>
							</DropdownMenu>
							<DropdownMenu>
								<DropdownMenuTrigger
									render={(props) => (
										<Button
											variant="outline"
											size="sm"
											className="gap-2"
											{...props}
										>
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
									<DropdownMenuItem
										onClick={() => setStatusFilter("unverified")}
									>
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
										<Button
											variant="outline"
											size="sm"
											className="gap-2"
											{...props}
										>
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
												<Label className="shrink-0 text-muted-foreground text-xs">
													From
												</Label>
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
												<Label className="shrink-0 text-muted-foreground text-xs">
													To
												</Label>
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
							className="fade-in fixed inset-0 z-50 flex animate-in items-center justify-center bg-background/50 backdrop-blur-sm duration-200 ease-out"
							aria-hidden="true"
						>
							<Loader2 className="size-12 animate-[spin_1.2s_linear_infinite] text-primary" />
						</div>
					)}
					{(tableItems.length > 0 || page > 1) && (
						<div className="flex items-center justify-between gap-4 border-border/50 border-b bg-muted/20 px-4 py-3">
							<p className="text-muted-foreground text-xs">
								Showing {(page - 1) * PAGE_SIZE + 1}–
								{(page - 1) * PAGE_SIZE + tableItems.length}
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
								<span className="text-muted-foreground text-sm">
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
										<th
											key={account}
											className="px-4 py-3 text-right font-medium"
										>
											{account}
										</th>
									))}
									<th className="px-4 py-3 font-medium">Verification</th>
									<th className="px-4 py-3 text-right font-medium">Actions</th>
								</tr>
							</thead>
							<tbody>
								{tableItems.length === 0 ? (
									<tr>
										<td
											className="px-4 py-6 text-center text-muted-foreground"
											colSpan={8}
										>
											{debouncedSearch ||
											accountFilter !== "all" ||
											statusFilter !== "all" ||
											dateFilterMode !== "all"
												? "No entries match your search or filter."
												: 'No entries yet. Click "New transaction" to add your first account entry.'}
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
														<div className="font-medium text-foreground">
															{entry.description}
														</div>
														<div className="text-muted-foreground">
															#{entry.id.slice(0, 8)}
														</div>
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
																	amount && amount >= 0
																		? "text-emerald-500"
																		: "text-rose-500"
																}`}
															>
																{amount === null ? "—" : formatCurrency(amount)}
															</td>
														);
													})}
													<td className="px-4 py-3">
														<div className="flex items-center gap-1">
															{!entry.isActive && (
																<span className="inline-flex items-center rounded-full bg-muted px-2 py-1 font-medium text-[10px] text-muted-foreground">
																	ARCHIVED
																</span>
															)}
															{entry.isVerified && (
																<span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-1 font-medium text-[10px] text-emerald-600">
																	VERIFIED
																</span>
															)}
															{entry.isActive && !entry.isVerified && (
																<span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-1 font-medium text-[10px] text-amber-600">
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
																				date: new Date(entry.date)
																					.toISOString()
																					.slice(0, 10),
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
																		onClick={() =>
																			archiveEntry.mutate({ id: entry.id })
																		}
																		disabled={
																			archiveEntry.isPending || entry.isVerified
																		}
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
															<span className="text-muted-foreground">
																Archived
															</span>
														)}
													</td>
												</tr>
												{editingId === entry.id ? (
													<tr className="border-b bg-muted/30">
														<td colSpan={8} className="px-4 py-4">
															<form
																noValidate
																className="grid gap-3 md:grid-cols-[1fr_2fr_1fr_1fr_auto]"
																onSubmit={(event) => {
																	event.preventDefault();
																	if (
																		!editForm.date.trim() ||
																		!editForm.description.trim() ||
																		!editForm.account.trim() ||
																		editForm.amount === ""
																	) {
																		toast.error(
																			"Please fill out all required fields.",
																		);
																		return;
																	}
																	updateEntry.mutate({
																		id: editForm.id,
																		date: editForm.date,
																		description: editForm.description,
																		account:
																			editForm.account as (typeof ACCOUNT_OPTIONS)[number],
																		amount: editForm.amount,
																	});
																}}
															>
																<Input
																	type="date"
																	value={editForm.date}
																	onChange={(event) =>
																		setEditForm({
																			...editForm,
																			date: event.target.value,
																		})
																	}
																	required
																/>
																<Input
																	placeholder="Description"
																	value={editForm.description}
																	onChange={(event) =>
																		setEditForm({
																			...editForm,
																			description: event.target.value,
																		})
																	}
																	required
																/>
																<select
																	className="flex h-8 w-full border border-input bg-background px-3 py-1 text-xs"
																	value={editForm.account}
																	onChange={(event) =>
																		setEditForm({
																			...editForm,
																			account: event.target.value,
																		})
																	}
																	required
																>
																	{ACCOUNT_OPTIONS.map((opt) => (
																		<option key={opt} value={opt}>
																			{opt}
																		</option>
																	))}
																</select>
																<Input
																	placeholder="Amount"
																	type="number"
																	step="0.01"
																	value={editForm.amount}
																	onChange={(event) =>
																		setEditForm({
																			...editForm,
																			amount: event.target.value,
																		})
																	}
																	required
																/>
																<div className="flex items-center gap-2">
																	<Button
																		type="submit"
																		disabled={updateEntry.isPending}
																	>
																		{updateEntry.isPending
																			? "Saving..."
																			: "Save"}
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

			<Dialog open={ledgerPdfDialogOpen} onOpenChange={setLedgerPdfDialogOpen}>
				<DialogPopup className="max-w-sm">
					<DialogHeader>
						<DialogTitle>Download account ledger</DialogTitle>
						<DialogDescription>
							Generate a PDF of inflows and outflows for one treasury account.
							Optional filters match the main ledger table.
						</DialogDescription>
					</DialogHeader>
					<div className="mt-4 space-y-4">
						<div className="space-y-2">
							<Label className="text-muted-foreground">Account</Label>
							<select
								className="flex h-9 w-full border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
								value={ledgerPdfAccount}
								onChange={(e) =>
									setLedgerPdfAccount(
										e.target.value as (typeof ACCOUNT_OPTIONS)[number],
									)
								}
							>
								{ACCOUNT_OPTIONS.map((opt) => (
									<option key={opt} value={opt}>
										{opt}
									</option>
								))}
							</select>
						</div>
						<div className="space-y-2">
							<Label className="text-muted-foreground">Status</Label>
							<select
								className="flex h-9 w-full border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
								value={ledgerPdfStatus}
								onChange={(e) =>
									setLedgerPdfStatus(
										e.target.value as
											| "all"
											| "verified"
											| "unverified"
											| "archived",
									)
								}
							>
								<option value="all">All statuses</option>
								<option value="verified">Verified</option>
								<option value="unverified">Unverified</option>
								<option value="archived">Archived</option>
							</select>
						</div>
						<div className="space-y-2">
							<Label className="text-muted-foreground">Search</Label>
							<Input
								placeholder="Description or amount (optional)"
								value={ledgerPdfSearch}
								onChange={(e) => setLedgerPdfSearch(e.target.value)}
							/>
						</div>
						<div className="space-y-2">
							<Label className="text-muted-foreground">From</Label>
							<Input
								type="date"
								value={ledgerPdfDateFrom}
								onChange={(e) => setLedgerPdfDateFrom(e.target.value)}
							/>
						</div>
						<div className="space-y-2">
							<Label className="text-muted-foreground">To</Label>
							<Input
								type="date"
								value={ledgerPdfDateTo}
								onChange={(e) => setLedgerPdfDateTo(e.target.value)}
							/>
						</div>
						<p className="text-muted-foreground text-xs">
							Leave both dates empty for all dates. Opening and closing balances
							appear only when both From and To are set.
						</p>
						{!ledgerPdfDateFrom.trim() && !ledgerPdfDateTo.trim() && (
							<div className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-amber-800 text-xs dark:text-amber-200">
								<p className="font-medium">Heavy use notice</p>
								<p className="mt-1">
									Exporting all dates uses more server and browser resources. A{" "}
									<strong>5-minute cooldown</strong> applies before another
									ledger PDF.
								</p>
							</div>
						)}
						<p className="text-muted-foreground text-xs">
							Exports with over 100 rows trigger a 2-minute cooldown.
						</p>
					</div>
					<DialogFooter className="mt-6">
						<DialogClose asChild>
							<button
								type="button"
								className={buttonVariants({ variant: "outline" })}
							>
								Cancel
							</button>
						</DialogClose>
						<Button
							disabled={ledgerPdfGenerating || isLedgerPdfOnCooldown}
							onClick={async () => {
								const pdfFrom = ledgerPdfDateFrom.trim();
								const pdfTo = ledgerPdfDateTo.trim();
								if ((pdfFrom && !pdfTo) || (!pdfFrom && pdfTo)) {
									toast.error(
										"Enter both From and To dates, or leave both empty for all dates.",
									);
									return;
								}
								const noDateRange = !pdfFrom && !pdfTo;
								setLedgerPdfGenerating(true);
								try {
									const data = await queryClient.fetchQuery(
										trpc.accountEntries.exportLedger.queryOptions({
											account: ledgerPdfAccount,
											search: ledgerPdfSearch.trim() || undefined,
											statusFilter: ledgerPdfStatus,
											dateFrom: pdfFrom && pdfTo ? pdfFrom : undefined,
											dateTo: pdfFrom && pdfTo ? pdfTo : undefined,
											dateSort: "asc",
										}),
									);
									const entries = data.items.map((row: AccountLedgerExportRow) => ({
										date: new Date(row.date),
										description: row.description,
										amount: row.amount,
										statusLabel: !row.isActive
											? "ARCHIVED"
											: row.isVerified
												? "VERIFIED"
												: "UNVERIFIED",
										linkedCashflowDescription:
											row.cashflowEntry?.description ?? null,
									}));
									downloadAccountLedgerPdf(
										{
											account: ledgerPdfAccount,
											entries,
											startingBalance: data.startingBalance,
											endingBalance: data.endingBalance,
										},
										{
											dateFrom: pdfFrom && pdfTo ? pdfFrom : undefined,
											dateTo: pdfFrom && pdfTo ? pdfTo : undefined,
										},
									);
									toast.success("Ledger PDF downloaded.");
									setLedgerPdfDialogOpen(false);
									const rowCount = data.items.length;
									let cooldownMs = 0;
									if (noDateRange) cooldownMs = 5 * 60 * 1000;
									else if (rowCount > 100) cooldownMs = 2 * 60 * 1000;
									if (cooldownMs > 0)
										setLedgerPdfCooldownEnd(Date.now() + cooldownMs);
								} catch (err) {
									const message =
										err instanceof Error
											? err.message
											: "Failed to generate PDF.";
									toast.error(message);
								} finally {
									setLedgerPdfGenerating(false);
								}
							}}
						>
							{ledgerPdfGenerating ? (
								<>
									<Loader2 className="size-4 animate-spin" />
									Generating…
								</>
							) : isLedgerPdfOnCooldown ? (
								`Download PDF (${ledgerPdfCooldownLabel})`
							) : (
								"Download PDF"
							)}
						</Button>
					</DialogFooter>
				</DialogPopup>
			</Dialog>
		</div>
	);
}
