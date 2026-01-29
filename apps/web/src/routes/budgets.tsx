import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

// Calculate budget status color
const getBudgetStatus = (estimated: number, actual: number) => {
  if (actual === 0) return { color: "text-muted-foreground", bg: "bg-muted", label: "Not started" };
  const ratio = actual / estimated;
  if (ratio <= 0.8) return { color: "text-emerald-600", bg: "bg-emerald-500", label: "Under budget" };
  if (ratio <= 1) return { color: "text-amber-600", bg: "bg-amber-500", label: "Near budget" };
  return { color: "text-rose-600", bg: "bg-rose-500", label: "Over budget" };
};

function BudgetsRoute() {
  const { session } = Route.useRouteContext();

  // Queries
  const projectsQueryOptions = trpc.budgetProjects.list.queryOptions();
  const projectsQuery = useQuery(projectsQueryOptions);
  const projects = projectsQuery.data ?? [];

  // State for dialogs
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [addingItemToProjectId, setAddingItemToProjectId] = useState<string | null>(null);
  const [isLinkExpenseOpen, setIsLinkExpenseOpen] = useState(false);
  const [linkingToItemId, setLinkingToItemId] = useState<string | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

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
    estimatedAmount: "",
    notes: "",
  });

  const [selectedCashflowId, setSelectedCashflowId] = useState("");

  // Unlinked cashflows query (for linking dialog)
  const unlinkedCashflowsQueryOptions = trpc.budgetItems.getUnlinkedCashflows.queryOptions(
    { budgetItemId: linkingToItemId ?? "" },
    { enabled: !!linkingToItemId }
  );
  const unlinkedCashflowsQuery = useQuery(unlinkedCashflowsQueryOptions);
  const unlinkedCashflows = unlinkedCashflowsQuery.data ?? [];

  // Mutations
  const createProject = useMutation(
    trpc.budgetProjects.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: projectsQueryOptions.queryKey });
        setProjectForm({ name: "", description: "", category: "", eventDate: "" });
        setIsCreateProjectOpen(false);
      },
    })
  );

  const updateProject = useMutation(
    trpc.budgetProjects.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: projectsQueryOptions.queryKey });
        setEditingProjectId(null);
        setProjectForm({ name: "", description: "", category: "", eventDate: "" });
      },
    })
  );

  const archiveProject = useMutation(
    trpc.budgetProjects.archive.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: projectsQueryOptions.queryKey });
      },
    })
  );

  const toggleProjectStatus = useMutation(
    trpc.budgetProjects.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: projectsQueryOptions.queryKey });
      },
    })
  );

  const createItem = useMutation(
    trpc.budgetItems.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: projectsQueryOptions.queryKey });
        setItemForm({ name: "", description: "", estimatedAmount: "", notes: "" });
        setIsAddItemOpen(false);
        setAddingItemToProjectId(null);
      },
    })
  );

  const updateItem = useMutation(
    trpc.budgetItems.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: projectsQueryOptions.queryKey });
        setEditingItemId(null);
        setItemForm({ name: "", description: "", estimatedAmount: "", notes: "" });
      },
    })
  );

  const deleteItem = useMutation(
    trpc.budgetItems.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: projectsQueryOptions.queryKey });
      },
    })
  );

  const linkExpense = useMutation(
    trpc.budgetItems.linkExpense.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: projectsQueryOptions.queryKey });
        queryClient.invalidateQueries({ queryKey: unlinkedCashflowsQueryOptions.queryKey });
        setSelectedCashflowId("");
        setIsLinkExpenseOpen(false);
        setLinkingToItemId(null);
      },
    })
  );

  const unlinkExpense = useMutation(
    trpc.budgetItems.unlinkExpense.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: projectsQueryOptions.queryKey });
      },
    })
  );

  // Calculate totals
  const totalBudget = projects.reduce((sum, p) => sum + p.totalBudget, 0);
  const totalActual = projects.reduce((sum, p) => sum + p.totalActual, 0);
  const plannedProjects = projects.filter((p) => p.status === "planned");
  const completedProjects = projects.filter((p) => p.status === "completed");

  const openAddItemDialog = (projectId: string) => {
    setAddingItemToProjectId(projectId);
    setItemForm({ name: "", description: "", estimatedAmount: "", notes: "" });
    setIsAddItemOpen(true);
  };

  const openLinkExpenseDialog = (itemId: string) => {
    setLinkingToItemId(itemId);
    setSelectedCashflowId("");
    setIsLinkExpenseOpen(true);
  };

  const openEditProjectDialog = (project: typeof projects[0]) => {
    setEditingProjectId(project.id);
    setProjectForm({
      name: project.name,
      description: project.description ?? "",
      category: project.category ?? "",
      eventDate: project.eventDate ? new Date(project.eventDate).toISOString().slice(0, 10) : "",
    });
  };

  const openEditItemDialog = (item: typeof projects[0]["items"][0]) => {
    setEditingItemId(item.id);
    setItemForm({
      name: item.name,
      description: item.description ?? "",
      estimatedAmount: item.estimatedAmount.toString(),
      notes: item.notes ?? "",
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-primary">Planning</p>
          <h1 className="text-3xl font-bold tracking-tight">Budget Planning</h1>
          <p className="text-muted-foreground">
            Plan budgets for upcoming events and track actual spending
          </p>
        </div>
        <Button onClick={() => setIsCreateProjectOpen(true)}>
          New Project
        </Button>
      </div>

      {/* Stats Overview */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Projects</CardDescription>
            <CardTitle className="text-2xl">{projects.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {plannedProjects.length} planned, {completedProjects.length} completed
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Budget</CardDescription>
            <CardTitle className="text-2xl">{formatCurrency(totalBudget)}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Across all projects</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Spent</CardDescription>
            <CardTitle className={`text-2xl ${totalActual > totalBudget ? "text-rose-500" : "text-emerald-500"}`}>
              {formatCurrency(totalActual)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {totalBudget > 0 ? `${((totalActual / totalBudget) * 100).toFixed(1)}% of budget` : "No budget set"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Remaining</CardDescription>
            <CardTitle className={`text-2xl ${totalBudget - totalActual < 0 ? "text-rose-500" : "text-foreground"}`}>
              {formatCurrency(totalBudget - totalActual)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-2 rounded-full transition-all ${totalActual > totalBudget ? "bg-rose-500" : "bg-emerald-500"}`}
                style={{ width: `${Math.min((totalActual / totalBudget) * 100, 100) || 0}%` }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Projects List */}
      <div className="space-y-4">
        {projects.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No budget projects yet.</p>
              <p className="text-sm text-muted-foreground">Create your first project to start planning.</p>
              <Button className="mt-4" onClick={() => setIsCreateProjectOpen(true)}>
                Create Project
              </Button>
            </CardContent>
          </Card>
        ) : (
          projects.map((project) => {
            const isExpanded = expandedProjectId === project.id;
            const status = getBudgetStatus(project.totalBudget, project.totalActual);
            const progressPercent = project.totalBudget > 0 
              ? Math.min((project.totalActual / project.totalBudget) * 100, 100) 
              : 0;

            return (
              <Card key={project.id} className={project.status === "completed" ? "opacity-75" : ""}>
                <CardHeader className="cursor-pointer" onClick={() => setExpandedProjectId(isExpanded ? null : project.id)}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-lg">{project.name}</CardTitle>
                        {project.status === "completed" && (
                          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600">
                            Completed
                          </span>
                        )}
                        {project.category && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            {project.category}
                          </span>
                        )}
                      </div>
                      <CardDescription className="mt-1">
                        {project.description || "No description"}
                        {project.eventDate && (
                          <span className="ml-2 text-primary">• {formatDate(project.eventDate)}</span>
                        )}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-sm font-medium">{formatCurrency(project.totalActual)} / {formatCurrency(project.totalBudget)}</p>
                        <p className={`text-xs ${status.color}`}>{status.label}</p>
                      </div>
                      <span className="text-muted-foreground">{isExpanded ? "▲" : "▼"}</span>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-2 rounded-full transition-all ${status.bg}`}
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </CardHeader>

                {isExpanded && (
                  <CardContent className="border-t pt-4">
                    {/* Project Actions */}
                    <div className="mb-4 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => openAddItemDialog(project.id)}>
                        Add Item
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openEditProjectDialog(project)}>
                        Edit Project
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleProjectStatus.mutate({
                          id: project.id,
                          status: project.status === "completed" ? "planned" : "completed",
                        })}
                      >
                        Mark as {project.status === "completed" ? "Planned" : "Completed"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-rose-600 hover:text-rose-700"
                        onClick={() => {
                          if (confirm("Are you sure you want to archive this project?")) {
                            archiveProject.mutate({ id: project.id });
                          }
                        }}
                      >
                        Archive
                      </Button>
                    </div>

                    {/* Budget Items Table */}
                    {project.items.length === 0 ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">
                        No budget items yet. Add items to track planned expenses.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="border-y bg-muted/30 text-xs text-muted-foreground">
                            <tr>
                              <th className="px-4 py-2 text-left font-medium">Item</th>
                              <th className="px-4 py-2 text-right font-medium">Estimated</th>
                              <th className="px-4 py-2 text-right font-medium">Actual</th>
                              <th className="px-4 py-2 text-right font-medium">Variance</th>
                              <th className="px-4 py-2 text-left font-medium">Status</th>
                              <th className="px-4 py-2 text-right font-medium">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {project.items.map((item) => {
                              const variance = item.estimatedAmount - item.actualAmount;
                              const itemStatus = getBudgetStatus(item.estimatedAmount, item.actualAmount);

                              return (
                                <tr key={item.id} className="border-b last:border-0">
                                  <td className="px-4 py-3">
                                    <div className="font-medium">{item.name}</div>
                                    {item.description && (
                                      <div className="text-xs text-muted-foreground">{item.description}</div>
                                    )}
                                    {/* Linked expenses */}
                                    {item.expenses.length > 0 && (
                                      <div className="mt-2 space-y-1">
                                        {item.expenses.map((exp) => (
                                          <div key={exp.id} className="flex items-center gap-2 text-xs">
                                            <span className="text-emerald-600">↳</span>
                                            <span className="text-muted-foreground">
                                              {formatDate(exp.cashflowEntry.date)} — {exp.cashflowEntry.description}
                                            </span>
                                            <span className="font-medium text-rose-500">
                                              {formatCurrency(Math.abs(exp.cashflowEntry.amount))}
                                            </span>
                                            <button
                                              type="button"
                                              className="text-rose-500 hover:text-rose-700"
                                              onClick={() => unlinkExpense.mutate({ id: exp.id })}
                                            >
                                              ✕
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-right font-medium">
                                    {formatCurrency(item.estimatedAmount)}
                                  </td>
                                  <td className={`px-4 py-3 text-right font-medium ${item.actualAmount > 0 ? "text-rose-500" : "text-muted-foreground"}`}>
                                    {formatCurrency(item.actualAmount)}
                                  </td>
                                  <td className={`px-4 py-3 text-right font-medium ${variance >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                                    {variance >= 0 ? "+" : ""}{formatCurrency(variance)}
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className={`text-xs ${itemStatus.color}`}>{itemStatus.label}</span>
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    <div className="flex justify-end gap-1">
                                      <Button size="xs" variant="ghost" onClick={() => openLinkExpenseDialog(item.id)}>
                                        Link
                                      </Button>
                                      <Button size="xs" variant="ghost" onClick={() => openEditItemDialog(item)}>
                                        Edit
                                      </Button>
                                      <Button
                                        size="xs"
                                        variant="ghost"
                                        className="text-rose-600"
                                        onClick={() => {
                                          if (item.expenseCount > 0) {
                                            alert("Cannot delete item with linked expenses. Unlink all expenses first.");
                                            return;
                                          }
                                          if (confirm("Delete this budget item?")) {
                                            deleteItem.mutate({ id: item.id });
                                          }
                                        }}
                                      >
                                        Delete
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot className="border-t bg-muted/30 font-medium">
                            <tr>
                              <td className="px-4 py-2">Total</td>
                              <td className="px-4 py-2 text-right">{formatCurrency(project.totalBudget)}</td>
                              <td className="px-4 py-2 text-right text-rose-500">{formatCurrency(project.totalActual)}</td>
                              <td className={`px-4 py-2 text-right ${project.totalBudget - project.totalActual >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                                {project.totalBudget - project.totalActual >= 0 ? "+" : ""}
                                {formatCurrency(project.totalBudget - project.totalActual)}
                              </td>
                              <td colSpan={2} />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })
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
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
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
                onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-description">Description (optional)</Label>
              <Textarea
                id="project-description"
                placeholder="Brief description of the event/project"
                value={projectForm.description}
                onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })}
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
                  onChange={(e) => setProjectForm({ ...projectForm, category: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="project-date">Event Date (optional)</Label>
                <Input
                  id="project-date"
                  type="date"
                  value={projectForm.eventDate}
                  onChange={(e) => setProjectForm({ ...projectForm, eventDate: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter className="mt-6">
              <DialogClose asChild>
                <Button type="button" variant="outline">Cancel</Button>
              </DialogClose>
              <Button type="submit" disabled={createProject.isPending}>
                {createProject.isPending ? "Creating..." : "Create Project"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>

      {/* Edit Project Dialog */}
      <Dialog open={!!editingProjectId} onOpenChange={(open) => !open && setEditingProjectId(null)}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
            <DialogDescription>Update project details.</DialogDescription>
          </DialogHeader>
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!editingProjectId) return;
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
                onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-project-description">Description</Label>
              <Textarea
                id="edit-project-description"
                value={projectForm.description}
                onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })}
                rows={2}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-project-category">Category</Label>
                <Input
                  id="edit-project-category"
                  value={projectForm.category}
                  onChange={(e) => setProjectForm({ ...projectForm, category: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-project-date">Event Date</Label>
                <Input
                  id="edit-project-date"
                  type="date"
                  value={projectForm.eventDate}
                  onChange={(e) => setProjectForm({ ...projectForm, eventDate: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter className="mt-6">
              <DialogClose asChild>
                <Button type="button" variant="outline">Cancel</Button>
              </DialogClose>
              <Button type="submit" disabled={updateProject.isPending}>
                {updateProject.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>

      {/* Add Item Dialog */}
      <Dialog open={isAddItemOpen} onOpenChange={(open) => { if (!open) { setIsAddItemOpen(false); setAddingItemToProjectId(null); } }}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Add Budget Item</DialogTitle>
            <DialogDescription>
              Add a planned expense to this project.
            </DialogDescription>
          </DialogHeader>
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!addingItemToProjectId) return;
              createItem.mutate({
                budgetProjectId: addingItemToProjectId,
                name: itemForm.name,
                description: itemForm.description || undefined,
                estimatedAmount: itemForm.estimatedAmount,
                notes: itemForm.notes || undefined,
              });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="item-name">Item Name</Label>
              <Input
                id="item-name"
                placeholder="e.g., Venue Rental"
                value={itemForm.name}
                onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="item-description">Description (optional)</Label>
              <Input
                id="item-description"
                placeholder="Brief description"
                value={itemForm.description}
                onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="item-amount">Estimated Amount</Label>
              <Input
                id="item-amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={itemForm.estimatedAmount}
                onChange={(e) => setItemForm({ ...itemForm, estimatedAmount: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="item-notes">Notes (optional)</Label>
              <Textarea
                id="item-notes"
                placeholder="Any additional notes"
                value={itemForm.notes}
                onChange={(e) => setItemForm({ ...itemForm, notes: e.target.value })}
                rows={2}
              />
            </div>
            <DialogFooter className="mt-6">
              <DialogClose asChild>
                <Button type="button" variant="outline">Cancel</Button>
              </DialogClose>
              <Button type="submit" disabled={createItem.isPending}>
                {createItem.isPending ? "Adding..." : "Add Item"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>

      {/* Edit Item Dialog */}
      <Dialog open={!!editingItemId} onOpenChange={(open) => !open && setEditingItemId(null)}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Edit Budget Item</DialogTitle>
            <DialogDescription>Update item details.</DialogDescription>
          </DialogHeader>
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!editingItemId) return;
              updateItem.mutate({
                id: editingItemId,
                name: itemForm.name,
                description: itemForm.description || undefined,
                estimatedAmount: itemForm.estimatedAmount,
                notes: itemForm.notes || undefined,
              });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="edit-item-name">Item Name</Label>
              <Input
                id="edit-item-name"
                value={itemForm.name}
                onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-item-description">Description</Label>
              <Input
                id="edit-item-description"
                value={itemForm.description}
                onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-item-amount">Estimated Amount</Label>
              <Input
                id="edit-item-amount"
                type="number"
                step="0.01"
                min="0"
                value={itemForm.estimatedAmount}
                onChange={(e) => setItemForm({ ...itemForm, estimatedAmount: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-item-notes">Notes</Label>
              <Textarea
                id="edit-item-notes"
                value={itemForm.notes}
                onChange={(e) => setItemForm({ ...itemForm, notes: e.target.value })}
                rows={2}
              />
            </div>
            <DialogFooter className="mt-6">
              <DialogClose asChild>
                <Button type="button" variant="outline">Cancel</Button>
              </DialogClose>
              <Button type="submit" disabled={updateItem.isPending}>
                {updateItem.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>

      {/* Link Expense Dialog */}
      <Dialog open={isLinkExpenseOpen} onOpenChange={(open) => { if (!open) { setIsLinkExpenseOpen(false); setLinkingToItemId(null); } }}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Link Expense</DialogTitle>
            <DialogDescription>
              Link a verified cashflow entry to this budget item.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label>Select Cashflow Entry</Label>
              <div className="border border-border/60 rounded-xl overflow-hidden bg-background/40 backdrop-blur-sm">
                <div className="max-h-[280px] overflow-y-auto custom-scrollbar">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-muted/50 sticky top-0 border-b border-border/50 z-10">
                      <tr>
                        <th className="px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider">Date</th>
                        <th className="px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider">Description</th>
                        <th className="px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider">Account</th>
                        <th className="px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {unlinkedCashflows.length === 0 && !unlinkedCashflowsQuery.isLoading ? (
                        <tr>
                          <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                            No available cashflow entries. Create a verified transaction first.
                          </td>
                        </tr>
                      ) : (
                        unlinkedCashflows.map((cf) => (
                          <tr 
                            key={cf.id} 
                            onClick={() => setSelectedCashflowId(cf.id)}
                            className={cn(
                              "cursor-pointer transition-colors hover:bg-primary/5",
                              selectedCashflowId === cf.id ? "bg-primary/10 hover:bg-primary/15" : ""
                            )}
                          >
                            <td className="px-3 py-3 tabular-nums text-muted-foreground whitespace-nowrap">
                              {formatDate(cf.date)}
                            </td>
                            <td className="px-3 py-3 font-medium min-w-[140px]">
                              {cf.description}
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">
                              {cf.accountEntry?.account || "Manual"}
                            </td>
                            <td className={cn(
                              "px-3 py-3 text-right font-semibold tabular-nums whitespace-nowrap",
                              cf.amount >= 0 ? "text-emerald-500" : "text-rose-500"
                            )}>
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
                    linkExpense.mutate({
                      budgetItemId: linkingToItemId,
                      cashflowEntryId: selectedCashflowId,
                    });
                  }
                }}
                disabled={!selectedCashflowId || linkExpense.isPending}
              >
                {linkExpense.isPending ? "Linking..." : "Link Expense"}
              </Button>
            </DialogFooter>
          </div>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
