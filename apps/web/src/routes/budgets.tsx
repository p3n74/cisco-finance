import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { FileDown, Loader2, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { NotWhitelistedView } from "@/components/not-whitelisted-view";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
	Dialog,
	DialogClose,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogPopup,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { authClient } from "@/lib/auth-client";
import {
	downloadProjectReportPdf,
	type ProjectReportData,
} from "@/lib/pdf-report";
import { cn } from "@/lib/utils";
import { queryClient, trpc } from "@/utils/trpc";

export const Route = createFileRoute("/budgets")({
	component: BudgetsRoute,
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

const formatCurrency = (value: number) =>
	new Intl.NumberFormat("en-PH", {
		style: "currency",
		currency: "PHP",
		maximumFractionDigits: 2,
	}).format(value);

const formatDate = (date: Date | string | null | undefined) => {
	if (!date) return "No date set";
	return new Date(date).toLocaleDateString("en-PH", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
};

// Expenditure variance: under budget = favorable, over = unfavorable
const getBudgetStatus = (estimated: number, actual: number) => {
	if (actual === 0)
		return {
			color: "text-muted-foreground",
			bg: "bg-muted",
			label: "Not started",
		};
	const ratio = estimated > 0 ? actual / estimated : 0;
	if (ratio <= 0.8)
		return {
			color: "text-emerald-600",
			bg: "bg-emerald-500",
			label: "Favorable",
		};
	if (ratio <= 1)
		return {
			color: "text-amber-600",
			bg: "bg-amber-500",
			label: "Near budget",
		};
	return { color: "text-rose-600", bg: "bg-rose-500", label: "Unfavorable" };
};

// Revenue variance: at/over target = favorable, under = unfavorable
const getIncomeStatus = (estimated: number, actual: number) => {
	if (estimated === 0)
		return { color: "text-muted-foreground", bg: "bg-muted", label: "—" };
	if (actual === 0)
		return {
			color: "text-muted-foreground",
			bg: "bg-muted",
			label: "Not started",
		};
	const ratio = actual / estimated;
	if (ratio >= 1)
		return {
			color: "text-emerald-600",
			bg: "bg-emerald-500",
			label: "Favorable",
		};
	if (ratio >= 0.8)
		return {
			color: "text-amber-600",
			bg: "bg-amber-500",
			label: "Near target",
		};
	return { color: "text-rose-600", bg: "bg-rose-500", label: "Unfavorable" };
};

const BUDGET_EDITOR_ROLES = [
	"VP_FINANCE",
	"TREASURER",
	"AUDITOR",
	"WAYS_AND_MEANS",
] as const;

type ProjectType = {
	id: string;
	name: string;
	description: string | null;
	category: string | null;
	eventDate: Date | string | null;
	status: string;
	isActive: boolean;
	createdAt: Date | string;
	updatedAt: Date | string;
	totalBudget: number;
	totalIncomeBudget: number;
	totalActual: number;
	totalActualIncome: number;
	itemCount: number;
	items: Array<{
		id: string;
		name: string;
		description: string | null;
		type: string;
		estimatedAmount: number;
		notes: string | null;
		isActive: boolean;
		createdAt: Date | string;
		actualAmount: number;
		expenseCount: number;
		incomeCount: number;
		expenses: Array<{
			id: string;
			cashflowEntryId: string;
			cashflowEntry: {
				id: string;
				amount: number;
				description: string;
				date: Date | string;
				lineItems: Array<{
					id: string;
					description: string;
					category: string;
					amount: number;
				}>;
			};
			createdAt: Date | string;
		}>;
		incomes: Array<{
			id: string;
			cashflowEntryId: string;
			cashflowEntry: {
				id: string;
				amount: number;
				description: string;
				date: Date | string;
				lineItems: Array<{
					id: string;
					description: string;
					category: string;
					amount: number;
				}>;
			};
			createdAt: Date | string;
		}>;
	}>;
};

interface ProjectCardProps {
	project: ProjectType;
	isExpanded: boolean;
	canEditBudgets: boolean;
	setExpandedProjectId: (id: string | null) => void;
	openAddItemDialog: (projectId: string) => void;
	openEditProjectDialog: (project: ProjectType) => void;
	toggleProjectStatus: { mutate: (data: { id: string; status?: "completed" | "planned" }) => void };
	setConfirmArchiveProjectId: (id: string | null) => void;
	pdfGeneratingProjectId: string | null;
	setPdfGeneratingProjectId: (id: string | null) => void;
	openLinkExpenseDialog: (item: { id: string; type: string }) => void;
	openEditItemDialog: (item: ProjectType["items"][0]) => void;
	unlinkExpense: { mutate: (data: { id: string }) => void };
	unlinkIncome: { mutate: (data: { id: string }) => void };
	setConfirmDeleteItemId: (id: string | null) => void;
}

function ProjectCard({
	project,
	isExpanded,
	canEditBudgets,
	setExpandedProjectId,
	openAddItemDialog,
	openEditProjectDialog,
	toggleProjectStatus,
	setConfirmArchiveProjectId,
	pdfGeneratingProjectId,
	setPdfGeneratingProjectId,
	openLinkExpenseDialog,
	openEditItemDialog,
	unlinkExpense,
	unlinkIncome,
	setConfirmDeleteItemId,
}: ProjectCardProps) {
	const totalIncomeBudgetP = project.totalIncomeBudget ?? 0;
	const totalActualIncomeP = project.totalActualIncome ?? 0;
	const status = getBudgetStatus(project.totalBudget, project.totalActual);
	const progressPercent = project.totalBudget > 0
		? Math.min((project.totalActual / project.totalBudget) * 100, 100)
		: 0;

	return (
		<Card className={project.status === "completed" ? "opacity-75" : ""}>
			<CardHeader
				className="cursor-pointer"
				onClick={() => setExpandedProjectId(isExpanded ? null : project.id)}
			>
				<div className="flex items-start justify-between">
					<div className="flex-1">
						<div className="flex items-center gap-2">
							<CardTitle className="text-lg">{project.name}</CardTitle>
							{project.status === "completed" && (
								<span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-600 text-xs">
									Completed
								</span>
							)}
							{project.category && (
								<span className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground text-xs">
									{project.category}
								</span>
							)}
						</div>
						<CardDescription className="mt-1">
							{project.description || "No description"}
							{project.eventDate && (
								<span className="ml-2 text-primary">
									• {formatDate(project.eventDate)}
								</span>
							)}
						</CardDescription>
					</div>
					<div className="flex items-center gap-4">
						<div className="text-right">
							<p className="font-medium text-sm">
								Expenditures {formatCurrency(project.totalActual)} /{" "}
								{formatCurrency(project.totalBudget)}
								{(totalIncomeBudgetP > 0 || totalActualIncomeP > 0) && (
									<span className="ml-2 text-emerald-600">
										• Revenue {formatCurrency(totalActualIncomeP)}
										{totalIncomeBudgetP > 0
											? ` / ${formatCurrency(totalIncomeBudgetP)}`
											: ""}
									</span>
								)}
							</p>
							<p className={`text-xs ${status.color}`}>{status.label}</p>
						</div>
						<span className="text-muted-foreground">
							{isExpanded ? "▲" : "▼"}
						</span>
					</div>
				</div>
				<div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
					<div
						className={`h-2 rounded-full transition-all ${status.bg}`}
						style={{ width: `${progressPercent}%` }}
					/>
				</div>
			</CardHeader>

			{isExpanded && (
				<CardContent className="border-t pt-4">
					<div className="mb-4 flex flex-wrap gap-2">
						<Button
							size="sm"
							variant="outline"
							disabled={!!pdfGeneratingProjectId}
							onClick={async (e) => {
								e.stopPropagation();
								setPdfGeneratingProjectId(project.id);
								try {
									const data = await queryClient.fetchQuery(
										trpc.report.getProjectReportData.queryOptions({
											projectId: project.id,
										}),
									) as ProjectReportData | null;
									if (!data) {
										toast.error("Project not found or unavailable.");
										return;
									}
									const receiptIds = data.receiptsInOrder.map((r) => r.receipt.id);
									const BATCH = 5;
									for (let i = 0; i < receiptIds.length; i += BATCH) {
										const batch = receiptIds.slice(i, i + BATCH);
										const images = await queryClient.fetchQuery(
											trpc.report.getReportReceiptImages.queryOptions({
												receiptIds: batch,
											}),
										) as Array<{ id: string; imageData: string | null }>;
										const byId = new Map(images.map((img) => [img.id, img]));
										for (const row of data.receiptsInOrder) {
											const img = byId.get(row.receipt.id);
											if (img) row.receipt.imageData = img.imageData;
										}
									}
									downloadProjectReportPdf(data);
									toast.success("Project report PDF downloaded.");
								} catch (err) {
									toast.error(
										err instanceof Error ? err.message : "Failed to generate PDF.",
									);
								} finally {
									setPdfGeneratingProjectId(null);
								}
							}}
						>
							{pdfGeneratingProjectId === project.id ? (
								<>
									<Loader2 className="mr-1.5 size-3.5 animate-spin" />
									Generating…
								</>
							) : (
								<>
									<FileDown className="mr-1.5 size-3.5" />
									Download Project Report PDF
								</>
							)}
						</Button>
						{canEditBudgets && (
							<>
								<Button
									size="sm"
									variant="outline"
									onClick={(e) => {
										e.stopPropagation();
										openAddItemDialog(project.id);
									}}
								>
									Add Item
								</Button>
								<Button
									size="sm"
									variant="outline"
									onClick={(e) => {
										e.stopPropagation();
										openEditProjectDialog(project);
									}}
								>
									Edit Project
								</Button>
								<Button
									size="sm"
									variant="outline"
									onClick={(e) => {
										e.stopPropagation();
										toggleProjectStatus.mutate({
											id: project.id,
											status: project.status === "completed" ? "planned" : "completed",
										});
									}}
								>
									Mark as {project.status === "completed" ? "Planned" : "Completed"}
								</Button>
								<Button
									size="sm"
									variant="outline"
									className="text-rose-600 hover:text-rose-700"
									onClick={(e) => {
										e.stopPropagation();
										setConfirmArchiveProjectId(project.id);
									}}
								>
									Archive
								</Button>
							</>
						)}
					</div>

					{project.items.length === 0 ? (
						<p className="py-4 text-center text-muted-foreground text-sm">
							No budget items yet. Add budgeted expenditure or revenue line items.
						</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead className="border-y bg-muted/30 text-muted-foreground text-xs">
									<tr>
										<th className="px-4 py-2 text-left font-medium">Line Item</th>
										<th className="px-4 py-2 text-left font-medium">Type</th>
										<th className="px-4 py-2 text-right font-medium">Budgeted</th>
										<th className="px-4 py-2 text-right font-medium">Actual</th>
										<th className="px-4 py-2 text-right font-medium">Variance</th>
										<th className="px-4 py-2 text-left font-medium">Status</th>
										{canEditBudgets && (
											<th className="px-4 py-2 text-right font-medium">Actions</th>
										)}
									</tr>
								</thead>
								<tbody>
									{project.items.map((item) => {
										const isIncome = item.type === "income";
										const variance = isIncome
											? item.actualAmount - item.estimatedAmount
											: item.estimatedAmount - item.actualAmount;
										const itemStatus = isIncome
											? getIncomeStatus(item.estimatedAmount, item.actualAmount)
											: getBudgetStatus(item.estimatedAmount, item.actualAmount);

										return (
											<tr key={item.id} className="border-b last:border-0">
												<td className="px-4 py-3">
													<div className="font-medium">{item.name}</div>
													{item.description && (
														<div className="text-muted-foreground text-xs">
															{item.description}
														</div>
													)}
													{item.expenses.length > 0 && (
														<div className="mt-2 space-y-1">
															{item.expenses.map((exp) => (
																<div key={exp.id} className="space-y-0.5">
																	<div className="flex items-center gap-2 text-xs">
																		<span className="text-rose-500">↳</span>
																		<span className="text-muted-foreground">
																			{formatDate(exp.cashflowEntry.date)} —{" "}
																			{exp.cashflowEntry.description}
																		</span>
																		<span className="font-medium text-rose-500">
																			{formatCurrency(
																				Math.abs(exp.cashflowEntry.amount),
																			)}
																		</span>
																		{canEditBudgets && (
																			<button
																				type="button"
																				className="text-rose-500 hover:text-rose-700"
																				onClick={(e) => {
																					e.stopPropagation();
																					unlinkExpense.mutate({ id: exp.id });
																				}}
																			>
																				✕
																			</button>
																		)}
																	</div>
																	{exp.cashflowEntry.lineItems?.length ? (
																		<div className="ml-4 space-y-0.5 border-border/50 border-l pl-2 text-[11px] text-muted-foreground">
																			{exp.cashflowEntry.lineItems.map((li, idx) => (
																				<div
																					key={li.id ?? idx}
																					className="flex items-center gap-2"
																				>
																					<span>↳ {li.description}</span>
																					<span className="text-rose-500/80">
																						{formatCurrency(Math.abs(li.amount))}
																					</span>
																				</div>
																			))}
																		</div>
																	) : null}
																</div>
															))}
														</div>
													)}
													{item.incomes?.length > 0 && (
														<div className="mt-2 space-y-1">
															{item.incomes.map((inc) => (
																<div key={inc.id} className="space-y-0.5">
																	<div className="flex items-center gap-2 text-xs">
																		<span className="text-emerald-600">↳</span>
																		<span className="text-muted-foreground">
																			{formatDate(inc.cashflowEntry.date)} —{" "}
																			{inc.cashflowEntry.description}
																		</span>
																		<span className="font-medium text-emerald-600">
																			{formatCurrency(inc.cashflowEntry.amount)}
																		</span>
																		{canEditBudgets && (
																			<button
																				type="button"
																				className="text-rose-500 hover:text-rose-700"
																				onClick={(e) => {
																					e.stopPropagation();
																					unlinkIncome.mutate({ id: inc.id });
																				}}
																			>
																				✕
																			</button>
																		)}
																	</div>
																	{inc.cashflowEntry.lineItems?.length ? (
																		<div className="ml-4 space-y-0.5 border-border/50 border-l pl-2 text-[11px] text-muted-foreground">
																			{inc.cashflowEntry.lineItems.map((li, idx) => (
																				<div
																					key={li.id ?? idx}
																					className="flex items-center gap-2"
																				>
																					<span>↳ {li.description}</span>
																					<span className="text-emerald-600/80">
																						{formatCurrency(li.amount)}
																					</span>
																				</div>
																			))}
																		</div>
																	) : null}
																</div>
															))}
														</div>
													)}
												</td>
												<td className="px-4 py-3">
													<span
														className={
															isIncome
																? "rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-600 text-xs"
																: "rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground text-xs"
														}
													>
														{isIncome ? "Revenue" : "Expenditure"}
													</span>
												</td>
												<td className="px-4 py-3 text-right font-medium">
													{formatCurrency(item.estimatedAmount)}
												</td>
												<td
													className={`px-4 py-3 text-right font-medium ${
														isIncome
															? item.actualAmount > 0
																? "text-emerald-600"
																: "text-muted-foreground"
															: item.actualAmount > 0
																? "text-rose-500"
																: "text-muted-foreground"
													}`}
												>
													{formatCurrency(item.actualAmount)}
												</td>
												<td
													className={`px-4 py-3 text-right font-medium ${variance >= 0 ? "text-emerald-500" : "text-rose-500"}`}
												>
													{variance >= 0 ? "+" : ""}
													{formatCurrency(variance)}
												</td>
												<td className="px-4 py-3">
													<span className={`text-xs ${itemStatus.color}`}>
														{itemStatus.label}
													</span>
												</td>
												{canEditBudgets && (
													<td className="px-4 py-3 text-right">
														<div className="flex justify-end gap-1">
															<Button
																size="xs"
																variant="ghost"
																onClick={(e) => {
																	e.stopPropagation();
																	openLinkExpenseDialog(item);
																}}
															>
																{isIncome ? "Link revenue" : "Link"}
															</Button>
															<Button
																size="xs"
																variant="ghost"
																onClick={(e) => {
																	e.stopPropagation();
																	openEditItemDialog(item);
																}}
															>
																Edit
															</Button>
															<Button
																size="xs"
																variant="ghost"
																className="text-rose-600"
																onClick={(e) => {
																	e.stopPropagation();
																	if (item.expenseCount > 0) {
																		toast.error(
																			"Cannot delete item with linked expenses. Unlink all expenses first.",
																		);
																		return;
																	}
																	if ((item.incomeCount ?? 0) > 0) {
																		toast.error(
																			"Cannot delete item with linked income. Unlink all income first.",
																		);
																		return;
																	}
																	setConfirmDeleteItemId(item.id);
																}}
															>
																Delete
															</Button>
														</div>
													</td>
												)}
											</tr>
										);
									})}
								</tbody>
								<tfoot className="border-t bg-muted/30 font-medium">
									<tr>
										<td className="px-4 py-2">Total</td>
										<td className="px-4 py-2" />
										<td className="px-4 py-2 text-right">
											{formatCurrency(project.totalBudget)}
											{(project.totalIncomeBudget ?? 0) > 0 && (
												<span className="ml-1 text-emerald-600">
													+ {formatCurrency(project.totalIncomeBudget ?? 0)} revenue
												</span>
											)}
										</td>
										<td className="px-4 py-2 text-right">
											<span className="text-rose-500">
												{formatCurrency(project.totalActual)}
											</span>
											{(project.totalActualIncome ?? 0) > 0 && (
												<span className="ml-1 text-emerald-600">
													+ {formatCurrency(project.totalActualIncome ?? 0)}
												</span>
											)}
										</td>
										<td
											className={`px-4 py-2 text-right font-medium ${((project.totalActualIncome ?? 0) - project.totalActual) < 0 ? "text-rose-500" : "text-emerald-600"}`}
										>
											{(project.totalActualIncome ?? 0) - project.totalActual >= 0
												? formatCurrency(
														(project.totalActualIncome ?? 0) - project.totalActual,
													)
												: `-${formatCurrency(Math.abs((project.totalActualIncome ?? 0) - project.totalActual))}`}
										</td>
										<td colSpan={canEditBudgets ? 2 : 1} />
									</tr>
								</tfoot>
							</table>
						</div>
					)}
				</CardContent>
			)}
		</Card>
	);
}

function BudgetsRoute() {
	const { session } = Route.useRouteContext();

	// Whitelist check: only whitelisted users can view finances
	const myRoleQueryOptions = trpc.team.getMyRole.queryOptions();
	const myRoleQuery = useQuery(myRoleQueryOptions);
	const isWhitelisted = (myRoleQuery.data?.role ?? null) !== null;
	const canEditBudgets = Boolean(
		myRoleQuery.data?.role &&
			(BUDGET_EDITOR_ROLES as readonly string[]).includes(myRoleQuery.data.role)
	);

	// Queries (only when whitelisted)
	const projectsQueryOptions = trpc.budgetProjects.list.queryOptions();
	const projectsQuery = useQuery({
		...projectsQueryOptions,
		enabled: isWhitelisted,
	});
	const projects = projectsQuery.data?.items ?? [];

	// Tab and search state
	const [activeTab, setActiveTab] = useState<"active" | "completed">("active");
	const [searchQuery, setSearchQuery] = useState("");
	const debouncedSearch = useDebouncedValue(searchQuery.trim().toLowerCase(), 300);

	// State for dialogs
	const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
	const [expandedProjectId, setExpandedProjectId] = useState<string | null>(
		null,
	);
	const [isAddItemOpen, setIsAddItemOpen] = useState(false);
	const [addingItemToProjectId, setAddingItemToProjectId] = useState<
		string | null
	>(null);
	const [isLinkExpenseOpen, setIsLinkExpenseOpen] = useState(false);
	const [linkingToItemId, setLinkingToItemId] = useState<string | null>(null);
	const [linkingToItemType, setLinkingToItemType] = useState<
		"expense" | "income"
	>("expense");
	const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
	const [editingItemId, setEditingItemId] = useState<string | null>(null);
	const [pdfGeneratingProjectId, setPdfGeneratingProjectId] = useState<
		string | null
	>(null);
	const [confirmArchiveProjectId, setConfirmArchiveProjectId] = useState<
		string | null
	>(null);
	const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<string | null>(
		null,
	);

	// Form states
	const [projectForm, setProjectForm] = useState({
		name: "",
		description: "",
		category: "",
		eventDate: "",
	});

	const [itemForm, setItemForm] = useState({
		name: "",
		description: "",
		type: "expense" as "expense" | "income",
		estimatedAmount: "",
		notes: "",
	});

	const [selectedCashflowId, setSelectedCashflowId] = useState("");

	// Unlinked cashflows query (for linking dialog) — filter by expense vs income
	const unlinkedCashflowsQueryOptions =
		trpc.budgetItems.getUnlinkedCashflows.queryOptions(
			{
				budgetItemId: linkingToItemId ?? "",
				itemType: linkingToItemType,
			},
			{ enabled: !!linkingToItemId },
		);
	const unlinkedCashflowsQuery = useQuery(unlinkedCashflowsQueryOptions);
	const unlinkedCashflows = unlinkedCashflowsQuery.data ?? [];

	// Mutations
	const createProject = useMutation(
		trpc.budgetProjects.create.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: projectsQueryOptions.queryKey,
				});
				setProjectForm({
					name: "",
					description: "",
					category: "",
					eventDate: "",
				});
				setIsCreateProjectOpen(false);
			},
		}),
	);

	const updateProject = useMutation(
		trpc.budgetProjects.update.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: projectsQueryOptions.queryKey,
				});
				setEditingProjectId(null);
				setProjectForm({
					name: "",
					description: "",
					category: "",
					eventDate: "",
				});
			},
		}),
	);

	const archiveProject = useMutation(
		trpc.budgetProjects.archive.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: projectsQueryOptions.queryKey,
				});
				setConfirmArchiveProjectId(null);
			},
		}),
	);

	const toggleProjectStatus = useMutation(
		trpc.budgetProjects.update.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: projectsQueryOptions.queryKey,
				});
			},
		}),
	);

	const createItem = useMutation(
		trpc.budgetItems.create.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: projectsQueryOptions.queryKey,
				});
				setItemForm({
					name: "",
					description: "",
					type: "expense",
					estimatedAmount: "",
					notes: "",
				});
				setIsAddItemOpen(false);
				setAddingItemToProjectId(null);
			},
		}),
	);

	const updateItem = useMutation(
		trpc.budgetItems.update.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: projectsQueryOptions.queryKey,
				});
				setEditingItemId(null);
				setItemForm({
					name: "",
					description: "",
					type: "expense",
					estimatedAmount: "",
					notes: "",
				});
			},
		}),
	);

	const deleteItem = useMutation(
		trpc.budgetItems.delete.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: projectsQueryOptions.queryKey,
				});
				setConfirmDeleteItemId(null);
			},
		}),
	);

	const linkExpense = useMutation(
		trpc.budgetItems.linkExpense.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: projectsQueryOptions.queryKey,
				});
				queryClient.invalidateQueries({
					queryKey: unlinkedCashflowsQueryOptions.queryKey,
				});
				setSelectedCashflowId("");
				setIsLinkExpenseOpen(false);
				setLinkingToItemId(null);
			},
		}),
	);

	const linkIncome = useMutation(
		trpc.budgetItems.linkIncome.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: projectsQueryOptions.queryKey,
				});
				queryClient.invalidateQueries({
					queryKey: unlinkedCashflowsQueryOptions.queryKey,
				});
				setSelectedCashflowId("");
				setIsLinkExpenseOpen(false);
				setLinkingToItemId(null);
			},
		}),
	);

	const unlinkExpense = useMutation(
		trpc.budgetItems.unlinkExpense.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: projectsQueryOptions.queryKey,
				});
			},
		}),
	);

	const unlinkIncome = useMutation(
		trpc.budgetItems.unlinkIncome.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: projectsQueryOptions.queryKey,
				});
			},
		}),
	);

	if (myRoleQuery.isLoading) {
		return (
			<div className="flex min-h-[40vh] items-center justify-center">
				<Loader2 className="size-8 animate-spin text-muted-foreground" />
			</div>
		);
	}
	if (myRoleQuery.isSuccess && !isWhitelisted) {
		return <NotWhitelistedView />;
	}

	type ProjectItem = (typeof projects)[number];

	// Calculate totals (expense budget/spent + income budget/collected)
	const totalBudget = projects.reduce((sum: number, p: ProjectItem) => sum + p.totalBudget, 0);
	const totalActual = projects.reduce((sum: number, p: ProjectItem) => sum + p.totalActual, 0);
	const totalIncomeBudget = projects.reduce(
		(sum: number, p: ProjectItem) => sum + (p.totalIncomeBudget ?? 0),
		0,
	);
	const totalActualIncome = projects.reduce(
		(sum: number, p: ProjectItem) => sum + (p.totalActualIncome ?? 0),
		0,
	);

	// Filter and sort projects
	const { activeProjects, completedProjects } = useMemo(() => {
		const searchFilter = (p: ProjectItem) => {
			if (!debouncedSearch) return true;
			return (
				p.name.toLowerCase().includes(debouncedSearch) ||
				(p.description?.toLowerCase().includes(debouncedSearch) ?? false) ||
				(p.category?.toLowerCase().includes(debouncedSearch) ?? false)
			);
		};

		const active = projects.filter(
			(p: ProjectItem) => p.status === "planned" && searchFilter(p)
		);
		const completed = projects.filter(
			(p: ProjectItem) => p.status === "completed" && searchFilter(p)
		);

		// Sort active projects: upcoming dates first (closest to now), then no-date projects
		const sortedActive = [...active].sort((a: ProjectItem, b: ProjectItem) => {
			const aDate = a.eventDate ? new Date(a.eventDate) : null;
			const bDate = b.eventDate ? new Date(b.eventDate) : null;

			if (aDate && bDate) {
				return aDate.getTime() - bDate.getTime();
			}
			if (aDate && !bDate) return -1;
			if (!aDate && bDate) return 1;
			return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
		});

		// Sort completed projects by eventDate descending (most recent first), then by createdAt
		const sortedCompleted = [...completed].sort((a: ProjectItem, b: ProjectItem) => {
			const aDate = a.eventDate ? new Date(a.eventDate) : null;
			const bDate = b.eventDate ? new Date(b.eventDate) : null;

			if (aDate && bDate) {
				return bDate.getTime() - aDate.getTime();
			}
			if (aDate && !bDate) return -1;
			if (!aDate && bDate) return 1;
			return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
		});

		return { activeProjects: sortedActive, completedProjects: sortedCompleted };
	}, [projects, debouncedSearch]);

	// Separate active projects into dated and undated for display grouping
	const { datedActiveProjects, undatedActiveProjects } = useMemo(() => {
		return {
			datedActiveProjects: activeProjects.filter((p: ProjectItem) => p.eventDate),
			undatedActiveProjects: activeProjects.filter((p: ProjectItem) => !p.eventDate),
		};
	}, [activeProjects]);

	// For stats display
	const plannedProjects = projects.filter((p: ProjectItem) => p.status === "planned");
	const allCompletedProjects = projects.filter((p: ProjectItem) => p.status === "completed");

	// Currently displayed projects based on active tab
	const displayedProjects = activeTab === "active" ? activeProjects : completedProjects;

	const openAddItemDialog = (projectId: string) => {
		setAddingItemToProjectId(projectId);
		setItemForm({
			name: "",
			description: "",
			type: "expense",
			estimatedAmount: "",
			notes: "",
		});
		setIsAddItemOpen(true);
	};

	const openLinkExpenseDialog = (item: { id: string; type: string }) => {
		setLinkingToItemId(item.id);
		setLinkingToItemType(item.type === "income" ? "income" : "expense");
		setSelectedCashflowId("");
		setIsLinkExpenseOpen(true);
	};

	const openEditProjectDialog = (project: (typeof projects)[0]) => {
		setEditingProjectId(project.id);
		setProjectForm({
			name: project.name,
			description: project.description ?? "",
			category: project.category ?? "",
			eventDate: project.eventDate
				? new Date(project.eventDate).toISOString().slice(0, 10)
				: "",
		});
	};

	const openEditItemDialog = (item: (typeof projects)[0]["items"][0]) => {
		setEditingItemId(item.id);
		setItemForm({
			name: item.name,
			description: item.description ?? "",
			type: (item.type === "income" ? "income" : "expense") as
				| "expense"
				| "income",
			estimatedAmount: item.estimatedAmount.toString(),
			notes: item.notes ?? "",
		});
	};

	return (
		<div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-4 px-3 py-4 sm:gap-6 sm:px-4 sm:py-6">
			{/* Header */}
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<p className="font-medium text-primary text-xs uppercase tracking-widest">
						Planning
					</p>
					<h1 className="font-bold text-3xl tracking-tight">Budget Planning</h1>
					<p className="text-muted-foreground">
						{canEditBudgets
							? "Plan budgets for upcoming events and track actual spending"
							: "View-only. Only VP Finance, Treasurer, Auditor, and Ways and Means can edit."}
					</p>
				</div>
				{canEditBudgets && (
					<Button onClick={() => setIsCreateProjectOpen(true)}>
						New Project
					</Button>
				)}
			</div>

			{/* Search and Tabs */}
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex gap-1 rounded-lg border border-border/60 bg-muted/30 p-1">
					<button
						type="button"
						onClick={() => setActiveTab("active")}
						className={cn(
							"rounded-md px-4 py-2 font-medium text-sm transition-colors",
							activeTab === "active"
								? "bg-background text-foreground shadow-sm"
								: "text-muted-foreground hover:text-foreground"
						)}
					>
						Active ({plannedProjects.length})
					</button>
					<button
						type="button"
						onClick={() => setActiveTab("completed")}
						className={cn(
							"rounded-md px-4 py-2 font-medium text-sm transition-colors",
							activeTab === "completed"
								? "bg-background text-foreground shadow-sm"
								: "text-muted-foreground hover:text-foreground"
						)}
					>
						Completed ({allCompletedProjects.length})
					</button>
				</div>
				<div className="relative w-full sm:w-64">
					<Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						placeholder="Search projects..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="pl-9"
					/>
				</div>
			</div>

			{/* Stats Overview */}
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Total Projects</CardDescription>
						<CardTitle className="text-2xl">{projects.length}</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-muted-foreground text-xs">
							{plannedProjects.length} planned, {completedProjects.length}{" "}
							completed
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Budgeted Expenditures</CardDescription>
						<CardTitle className="text-2xl">
							{formatCurrency(totalBudget)}
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-muted-foreground text-xs">Planned spending</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Actual Expenditures</CardDescription>
						<CardTitle
							className={`text-2xl ${totalActual > totalBudget ? "text-rose-500" : "text-emerald-500"}`}
						>
							{formatCurrency(totalActual)}
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-muted-foreground text-xs">
							{totalBudget > 0
								? `${((totalActual / totalBudget) * 100).toFixed(1)}% of budget`
								: "No budget set"}
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Budgeted Revenue</CardDescription>
						<CardTitle className="text-2xl">
							{formatCurrency(totalIncomeBudget)}
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-muted-foreground text-xs">
							Expected income (fees, donations)
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Actual Revenue</CardDescription>
						<CardTitle className="text-2xl text-emerald-600">
							{formatCurrency(totalActualIncome)}
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-muted-foreground text-xs">Collections to date</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Net</CardDescription>
						<CardTitle
							className={`text-2xl ${totalActualIncome - totalActual < 0 ? "text-rose-500" : "text-emerald-600"}`}
						>
							{totalActualIncome - totalActual < 0
								? `-${formatCurrency(Math.abs(totalActualIncome - totalActual))}`
								: formatCurrency(totalActualIncome - totalActual)}
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-muted-foreground text-xs">
							Revenue minus Expenditures
						</p>
					</CardContent>
				</Card>
			</div>

			{/* Projects List */}
			<div className="space-y-6">
				{projects.length === 0 ? (
					<Card>
						<CardContent className="py-12 text-center">
							<p className="text-muted-foreground">No budget projects yet.</p>
							{canEditBudgets ? (
								<>
									<p className="text-muted-foreground text-sm">
										Create your first project to start planning.
									</p>
									<Button
										className="mt-4"
										onClick={() => setIsCreateProjectOpen(true)}
									>
										Create Project
									</Button>
								</>
							) : (
								<p className="text-muted-foreground text-sm">
									You can view budgets once they are created.
								</p>
							)}
						</CardContent>
					</Card>
				) : displayedProjects.length === 0 ? (
					<Card>
						<CardContent className="py-12 text-center">
							<p className="text-muted-foreground">
								{debouncedSearch
									? `No ${activeTab === "active" ? "active" : "completed"} projects matching "${debouncedSearch}"`
									: `No ${activeTab === "active" ? "active" : "completed"} projects`}
							</p>
						</CardContent>
					</Card>
				) : activeTab === "active" ? (
					<>
						{/* Dated projects section */}
						{datedActiveProjects.length > 0 && (
							<div className="space-y-4">
								<h2 className="flex items-center gap-2 font-semibold text-muted-foreground text-sm">
									<span>Upcoming Events</span>
									<span className="rounded-full bg-muted px-2 py-0.5 text-xs">
										{datedActiveProjects.length}
									</span>
								</h2>
								{datedActiveProjects.map((project) => (
									<ProjectCard
										key={project.id}
										project={project}
										isExpanded={expandedProjectId === project.id}
										canEditBudgets={canEditBudgets}
										setExpandedProjectId={setExpandedProjectId}
										openAddItemDialog={openAddItemDialog}
										openEditProjectDialog={openEditProjectDialog}
										toggleProjectStatus={toggleProjectStatus}
										setConfirmArchiveProjectId={setConfirmArchiveProjectId}
										pdfGeneratingProjectId={pdfGeneratingProjectId}
										setPdfGeneratingProjectId={setPdfGeneratingProjectId}
										openLinkExpenseDialog={openLinkExpenseDialog}
										openEditItemDialog={openEditItemDialog}
										unlinkExpense={unlinkExpense}
										unlinkIncome={unlinkIncome}
										setConfirmDeleteItemId={setConfirmDeleteItemId}
									/>
								))}
							</div>
						)}
						{/* Undated projects section */}
						{undatedActiveProjects.length > 0 && (
							<div className="space-y-4">
								<h2 className="flex items-center gap-2 font-semibold text-muted-foreground text-sm">
									<span>No Date Set</span>
									<span className="rounded-full bg-muted px-2 py-0.5 text-xs">
										{undatedActiveProjects.length}
									</span>
								</h2>
								{undatedActiveProjects.map((project) => (
									<ProjectCard
										key={project.id}
										project={project}
										isExpanded={expandedProjectId === project.id}
										canEditBudgets={canEditBudgets}
										setExpandedProjectId={setExpandedProjectId}
										openAddItemDialog={openAddItemDialog}
										openEditProjectDialog={openEditProjectDialog}
										toggleProjectStatus={toggleProjectStatus}
										setConfirmArchiveProjectId={setConfirmArchiveProjectId}
										pdfGeneratingProjectId={pdfGeneratingProjectId}
										setPdfGeneratingProjectId={setPdfGeneratingProjectId}
										openLinkExpenseDialog={openLinkExpenseDialog}
										openEditItemDialog={openEditItemDialog}
										unlinkExpense={unlinkExpense}
										unlinkIncome={unlinkIncome}
										setConfirmDeleteItemId={setConfirmDeleteItemId}
									/>
								))}
							</div>
						)}
					</>
				) : (
					completedProjects.map((project) => (
						<ProjectCard
							key={project.id}
							project={project}
							isExpanded={expandedProjectId === project.id}
							canEditBudgets={canEditBudgets}
							setExpandedProjectId={setExpandedProjectId}
							openAddItemDialog={openAddItemDialog}
							openEditProjectDialog={openEditProjectDialog}
							toggleProjectStatus={toggleProjectStatus}
							setConfirmArchiveProjectId={setConfirmArchiveProjectId}
							pdfGeneratingProjectId={pdfGeneratingProjectId}
							setPdfGeneratingProjectId={setPdfGeneratingProjectId}
							openLinkExpenseDialog={openLinkExpenseDialog}
							openEditItemDialog={openEditItemDialog}
							unlinkExpense={unlinkExpense}
							unlinkIncome={unlinkIncome}
							setConfirmDeleteItemId={setConfirmDeleteItemId}
						/>
					))
				)}
			</div>

			{/* Create Project Dialog */}
			<Dialog open={isCreateProjectOpen} onOpenChange={setIsCreateProjectOpen}>
				<DialogPopup>
					<DialogHeader>
						<DialogTitle>Create Budget Project</DialogTitle>
						<DialogDescription>
							Set up a new budget for an upcoming event or project.
						</DialogDescription>
					</DialogHeader>
					<form
						noValidate
						className="mt-4 space-y-4"
						onSubmit={(e) => {
							e.preventDefault();
							if (!projectForm.name.trim()) {
								toast.error("Please fill out all required fields.");
								return;
							}
							createProject.mutate({
								name: projectForm.name,
								description: projectForm.description || undefined,
								category: projectForm.category || undefined,
								eventDate: projectForm.eventDate || undefined,
							});
						}}
					>
						<div className="space-y-2">
							<Label htmlFor="project-name">Project Name</Label>
							<Input
								id="project-name"
								placeholder="e.g., Annual Gala 2026"
								value={projectForm.name}
								onChange={(e) =>
									setProjectForm({ ...projectForm, name: e.target.value })
								}
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="project-description">
								Description (optional)
							</Label>
							<Textarea
								id="project-description"
								placeholder="Brief description of the event/project"
								value={projectForm.description}
								onChange={(e) =>
									setProjectForm({
										...projectForm,
										description: e.target.value,
									})
								}
								rows={2}
							/>
						</div>
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="project-category">Category (optional)</Label>
								<Input
									id="project-category"
									placeholder="e.g., Community Outreach"
									value={projectForm.category}
									onChange={(e) =>
										setProjectForm({ ...projectForm, category: e.target.value })
									}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="project-date">Event Date (optional)</Label>
								<Input
									id="project-date"
									type="date"
									value={projectForm.eventDate}
									onChange={(e) =>
										setProjectForm({
											...projectForm,
											eventDate: e.target.value,
										})
									}
								/>
							</div>
						</div>
						<DialogFooter className="mt-6">
							<DialogClose asChild>
								<Button type="button" variant="outline">
									Cancel
								</Button>
							</DialogClose>
							<Button type="submit" disabled={createProject.isPending}>
								{createProject.isPending ? "Creating..." : "Create Project"}
							</Button>
						</DialogFooter>
					</form>
				</DialogPopup>
			</Dialog>

			{/* Edit Project Dialog */}
			<Dialog
				open={!!editingProjectId}
				onOpenChange={(open) => !open && setEditingProjectId(null)}
			>
				<DialogPopup>
					<DialogHeader>
						<DialogTitle>Edit Project</DialogTitle>
						<DialogDescription>Update project details.</DialogDescription>
					</DialogHeader>
					<form
						noValidate
						className="mt-4 space-y-4"
						onSubmit={(e) => {
							e.preventDefault();
							if (!editingProjectId) return;
							if (!projectForm.name.trim()) {
								toast.error("Please fill out all required fields.");
								return;
							}
							updateProject.mutate({
								id: editingProjectId,
								name: projectForm.name,
								description: projectForm.description || undefined,
								category: projectForm.category || undefined,
								eventDate: projectForm.eventDate || null,
							});
						}}
					>
						<div className="space-y-2">
							<Label htmlFor="edit-project-name">Project Name</Label>
							<Input
								id="edit-project-name"
								value={projectForm.name}
								onChange={(e) =>
									setProjectForm({ ...projectForm, name: e.target.value })
								}
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="edit-project-description">Description</Label>
							<Textarea
								id="edit-project-description"
								value={projectForm.description}
								onChange={(e) =>
									setProjectForm({
										...projectForm,
										description: e.target.value,
									})
								}
								rows={2}
							/>
						</div>
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="edit-project-category">Category</Label>
								<Input
									id="edit-project-category"
									value={projectForm.category}
									onChange={(e) =>
										setProjectForm({ ...projectForm, category: e.target.value })
									}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="edit-project-date">Event Date</Label>
								<Input
									id="edit-project-date"
									type="date"
									value={projectForm.eventDate}
									onChange={(e) =>
										setProjectForm({
											...projectForm,
											eventDate: e.target.value,
										})
									}
								/>
							</div>
						</div>
						<DialogFooter className="mt-6">
							<DialogClose asChild>
								<Button type="button" variant="outline">
									Cancel
								</Button>
							</DialogClose>
							<Button type="submit" disabled={updateProject.isPending}>
								{updateProject.isPending ? "Saving..." : "Save Changes"}
							</Button>
						</DialogFooter>
					</form>
				</DialogPopup>
			</Dialog>

			{/* Add Item Dialog */}
			<Dialog
				open={isAddItemOpen}
				onOpenChange={(open) => {
					if (!open) {
						setIsAddItemOpen(false);
						setAddingItemToProjectId(null);
					}
				}}
			>
				<DialogPopup>
					<DialogHeader>
						<DialogTitle>Add Budget Item</DialogTitle>
						<DialogDescription>
							Add a budgeted expenditure or budgeted revenue line item (e.g.
							fees, donations).
						</DialogDescription>
					</DialogHeader>
					<form
						noValidate
						className="mt-4 space-y-4"
						onSubmit={(e) => {
							e.preventDefault();
							if (!addingItemToProjectId) return;
							if (
								!itemForm.name.trim() ||
								itemForm.estimatedAmount === "" ||
								Number(itemForm.estimatedAmount) < 0
							) {
								toast.error("Please fill out all required fields.");
								return;
							}
							createItem.mutate({
								budgetProjectId: addingItemToProjectId,
								name: itemForm.name,
								description: itemForm.description || undefined,
								type: itemForm.type,
								estimatedAmount: itemForm.estimatedAmount,
								notes: itemForm.notes || undefined,
							});
						}}
					>
						<div className="space-y-2">
							<Label>Type</Label>
							<div className="flex gap-4">
								<label className="flex cursor-pointer items-center gap-2">
									<input
										type="radio"
										name="item-type"
										checked={itemForm.type === "expense"}
										onChange={() =>
											setItemForm({ ...itemForm, type: "expense" })
										}
										className="rounded-full border-input"
									/>
									<span>Expenditure</span>
								</label>
								<label className="flex cursor-pointer items-center gap-2">
									<input
										type="radio"
										name="item-type"
										checked={itemForm.type === "income"}
										onChange={() =>
											setItemForm({ ...itemForm, type: "income" })
										}
										className="rounded-full border-input"
									/>
									<span>Revenue (fees, donations, etc.)</span>
								</label>
							</div>
						</div>
						<div className="space-y-2">
							<Label htmlFor="item-name">Item Name</Label>
							<Input
								id="item-name"
								placeholder={
									itemForm.type === "income"
										? "e.g., Registration fees"
										: "e.g., Venue rental"
								}
								value={itemForm.name}
								onChange={(e) =>
									setItemForm({ ...itemForm, name: e.target.value })
								}
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="item-description">Description (optional)</Label>
							<Input
								id="item-description"
								placeholder="Brief description"
								value={itemForm.description}
								onChange={(e) =>
									setItemForm({ ...itemForm, description: e.target.value })
								}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="item-amount">
								{itemForm.type === "income"
									? "Budgeted amount"
									: "Budgeted amount"}
							</Label>
							<Input
								id="item-amount"
								type="number"
								step="0.01"
								min="0"
								placeholder="0.00"
								value={itemForm.estimatedAmount}
								onChange={(e) =>
									setItemForm({ ...itemForm, estimatedAmount: e.target.value })
								}
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="item-notes">Notes (optional)</Label>
							<Textarea
								id="item-notes"
								placeholder="Any additional notes"
								value={itemForm.notes}
								onChange={(e) =>
									setItemForm({ ...itemForm, notes: e.target.value })
								}
								rows={2}
							/>
						</div>
						<DialogFooter className="mt-6">
							<DialogClose asChild>
								<Button type="button" variant="outline">
									Cancel
								</Button>
							</DialogClose>
							<Button type="submit" disabled={createItem.isPending}>
								{createItem.isPending ? "Adding..." : "Add Item"}
							</Button>
						</DialogFooter>
					</form>
				</DialogPopup>
			</Dialog>

			{/* Edit Item Dialog */}
			<Dialog
				open={!!editingItemId}
				onOpenChange={(open) => !open && setEditingItemId(null)}
			>
				<DialogPopup>
					<DialogHeader>
						<DialogTitle>Edit Budget Item</DialogTitle>
						<DialogDescription>Update item details.</DialogDescription>
					</DialogHeader>
					<form
						noValidate
						className="mt-4 space-y-4"
						onSubmit={(e) => {
							e.preventDefault();
							if (!editingItemId) return;
							if (
								!itemForm.name.trim() ||
								itemForm.estimatedAmount === "" ||
								Number(itemForm.estimatedAmount) < 0
							) {
								toast.error("Please fill out all required fields.");
								return;
							}
							updateItem.mutate({
								id: editingItemId,
								name: itemForm.name,
								description: itemForm.description || undefined,
								type: itemForm.type,
								estimatedAmount: itemForm.estimatedAmount,
								notes: itemForm.notes || undefined,
							});
						}}
					>
						<div className="space-y-2">
							<Label>Type</Label>
							<div className="flex gap-4">
								<label className="flex cursor-pointer items-center gap-2">
									<input
										type="radio"
										name="edit-item-type"
										checked={itemForm.type === "expense"}
										onChange={() =>
											setItemForm({ ...itemForm, type: "expense" })
										}
										className="rounded-full border-input"
									/>
									<span>Expenditure</span>
								</label>
								<label className="flex cursor-pointer items-center gap-2">
									<input
										type="radio"
										name="edit-item-type"
										checked={itemForm.type === "income"}
										onChange={() =>
											setItemForm({ ...itemForm, type: "income" })
										}
										className="rounded-full border-input"
									/>
									<span>Revenue</span>
								</label>
							</div>
						</div>
						<div className="space-y-2">
							<Label htmlFor="edit-item-name">Item Name</Label>
							<Input
								id="edit-item-name"
								value={itemForm.name}
								onChange={(e) =>
									setItemForm({ ...itemForm, name: e.target.value })
								}
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="edit-item-description">Description</Label>
							<Input
								id="edit-item-description"
								value={itemForm.description}
								onChange={(e) =>
									setItemForm({ ...itemForm, description: e.target.value })
								}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="edit-item-amount">Budgeted amount</Label>
							<Input
								id="edit-item-amount"
								type="number"
								step="0.01"
								min="0"
								value={itemForm.estimatedAmount}
								onChange={(e) =>
									setItemForm({ ...itemForm, estimatedAmount: e.target.value })
								}
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="edit-item-notes">Notes</Label>
							<Textarea
								id="edit-item-notes"
								value={itemForm.notes}
								onChange={(e) =>
									setItemForm({ ...itemForm, notes: e.target.value })
								}
								rows={2}
							/>
						</div>
						<DialogFooter className="mt-6">
							<DialogClose asChild>
								<Button type="button" variant="outline">
									Cancel
								</Button>
							</DialogClose>
							<Button type="submit" disabled={updateItem.isPending}>
								{updateItem.isPending ? "Saving..." : "Save Changes"}
							</Button>
						</DialogFooter>
					</form>
				</DialogPopup>
			</Dialog>

			{/* Link Expense / Income Dialog */}
			<Dialog
				open={isLinkExpenseOpen}
				onOpenChange={(open) => {
					if (!open) {
						setIsLinkExpenseOpen(false);
						setLinkingToItemId(null);
					}
				}}
			>
				<DialogPopup>
					<DialogHeader>
						<DialogTitle>
							{linkingToItemType === "income"
								? "Link Revenue"
								: "Link Expenditure"}
						</DialogTitle>
						<DialogDescription>
							{linkingToItemType === "income"
								? "Link a verified inflow (positive) cashflow entry to this revenue line item."
								: "Link a verified cashflow entry to this expenditure line item."}
						</DialogDescription>
					</DialogHeader>
					<div className="mt-4 space-y-4">
						<div className="space-y-2">
							<Label>
								{linkingToItemType === "income"
									? "Select inflow (positive) entry"
									: "Select Cashflow Entry"}
							</Label>
							<div className="overflow-hidden rounded-xl border border-border/60 bg-background/40 backdrop-blur-sm">
								<div className="custom-scrollbar max-h-[280px] overflow-y-auto">
									<table className="w-full border-collapse text-left text-xs">
										<thead className="sticky top-0 z-10 border-border/50 border-b bg-muted/50">
											<tr>
												<th className="px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider">
													Date
												</th>
												<th className="px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider">
													Description
												</th>
												<th className="px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider">
													Account
												</th>
												<th className="px-3 py-2.5 text-right font-semibold text-muted-foreground uppercase tracking-wider">
													Amount
												</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-border/30">
											{unlinkedCashflows.length === 0 &&
											!unlinkedCashflowsQuery.isLoading ? (
												<tr>
													<td
														colSpan={4}
														className="px-3 py-8 text-center text-muted-foreground"
													>
														No available cashflow entries. Create a verified
														transaction first.
													</td>
												</tr>
											) : (
												unlinkedCashflows.map((cf) => (
													<tr
														key={cf.id}
														onClick={() => setSelectedCashflowId(cf.id)}
														className={cn(
															"cursor-pointer transition-colors hover:bg-primary/5",
															selectedCashflowId === cf.id
																? "bg-primary/10 hover:bg-primary/15"
																: "",
														)}
													>
														<td className="whitespace-nowrap px-3 py-3 text-muted-foreground tabular-nums">
															{formatDate(cf.date)}
														</td>
														<td className="min-w-[140px] px-3 py-3 font-medium">
															<div>{cf.description}</div>
															{cf.lineItems?.length ? (
																<div className="mt-0.5 text-[10px] text-muted-foreground">
																	{cf.lineItems.length} item
																	{cf.lineItems.length === 1 ? "" : "s"}
																</div>
															) : null}
														</td>
														<td className="px-3 py-3 text-muted-foreground">
															{cf.accountEntry?.account || "Manual"}
														</td>
														<td
															className={cn(
																"whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums",
																cf.amount >= 0
																	? "text-emerald-500"
																	: "text-rose-500",
															)}
														>
															{formatCurrency(Math.abs(cf.amount))}
														</td>
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
									if (linkingToItemId && selectedCashflowId) {
										if (linkingToItemType === "income") {
											linkIncome.mutate({
												budgetItemId: linkingToItemId,
												cashflowEntryId: selectedCashflowId,
											});
										} else {
											linkExpense.mutate({
												budgetItemId: linkingToItemId,
												cashflowEntryId: selectedCashflowId,
											});
										}
									}
								}}
								disabled={
									!selectedCashflowId ||
									linkExpense.isPending ||
									linkIncome.isPending
								}
							>
								{linkExpense.isPending || linkIncome.isPending
									? "Linking..."
									: linkingToItemType === "income"
										? "Link Revenue"
										: "Link Expenditure"}
							</Button>
						</DialogFooter>
					</div>
				</DialogPopup>
			</Dialog>

			<ConfirmDialog
				open={!!confirmArchiveProjectId}
				onOpenChange={(open) => !open && setConfirmArchiveProjectId(null)}
				title="Archive project"
				description="Are you sure you want to archive this project? You can view it in archived projects."
				confirmLabel="Archive"
				cancelLabel="Cancel"
				variant="destructive"
				onConfirm={() => {
					if (confirmArchiveProjectId) {
						archiveProject.mutate({ id: confirmArchiveProjectId });
					}
				}}
				loading={archiveProject.isPending}
			/>

			<ConfirmDialog
				open={!!confirmDeleteItemId}
				onOpenChange={(open) => !open && setConfirmDeleteItemId(null)}
				title="Delete budget item"
				description="Are you sure you want to delete this budget item? This cannot be undone."
				confirmLabel="Delete"
				cancelLabel="Cancel"
				variant="destructive"
				onConfirm={() => {
					if (confirmDeleteItemId) {
						deleteItem.mutate({ id: confirmDeleteItemId });
					}
				}}
				loading={deleteItem.isPending}
			/>
		</div>
	);
}
