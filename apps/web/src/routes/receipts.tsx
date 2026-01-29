import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { queryClient, trpc } from "@/utils/trpc";

export const Route = createFileRoute("/receipts")({
  component: ReceiptsRoute,
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
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);

function ReceiptsRoute() {
  const listQueryOptions = trpc.receiptSubmission.list.queryOptions();
  const submissionsQuery = useQuery(listQueryOptions);
  const countQueryOptions = trpc.receiptSubmission.countUnbound.queryOptions();

  const cashflowQueryOptions = trpc.cashflowEntries.list.queryOptions();
  const cashflowQuery = useQuery(cashflowQueryOptions);

  const [viewingId, setViewingId] = useState<string | null>(null);
  const [bindingId, setBindingId] = useState<string | null>(null);
  const [endorsingId, setEndorsingId] = useState<string | null>(null);
  const [endorsementMessage, setEndorsementMessage] = useState("");
  const [selectedCashflowId, setSelectedCashflowId] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterReimbursement, setFilterReimbursement] = useState<string>("all");

  const viewQueryOptions = trpc.receiptSubmission.getById.queryOptions(
    { id: viewingId ?? "" },
    { enabled: !!viewingId }
  );
  const viewQuery = useQuery(viewQueryOptions);

  const roleQueryOptions = trpc.team.getMyRole.queryOptions();
  const roleQuery = useQuery(roleQueryOptions);
  const userRole = roleQuery.data?.role;

  const bindMutation = useMutation(
    trpc.receiptSubmission.bind.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: listQueryOptions.queryKey });
        queryClient.invalidateQueries({ queryKey: countQueryOptions.queryKey });
        queryClient.invalidateQueries({ queryKey: viewQueryOptions.queryKey });
        setBindingId(null);
        setSelectedCashflowId("");
      },
    })
  );

  const unbindMutation = useMutation(
    trpc.receiptSubmission.unbind.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: listQueryOptions.queryKey });
        queryClient.invalidateQueries({ queryKey: countQueryOptions.queryKey });
        queryClient.invalidateQueries({ queryKey: viewQueryOptions.queryKey });
      },
    })
  );

  const endorseMutation = useMutation(
    trpc.receiptSubmission.endorse.mutationOptions({
      onSuccess: () => {
        toast.success("Reimbursement endorsed and sent to treasurer.");
        setEndorsingId(null);
        setEndorsementMessage("");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to endorse reimbursement");
      },
    })
  );

  const markAsReimbursedMutation = useMutation(
    trpc.receiptSubmission.markAsReimbursed.mutationOptions({
      onSuccess: () => {
        toast.success("Receipt marked as reimbursed");
        queryClient.invalidateQueries({ queryKey: listQueryOptions.queryKey });
        queryClient.invalidateQueries({ queryKey: viewQueryOptions.queryKey });
      },
      onError: (error) => {
        toast.error(error.message || "Failed to mark as reimbursed");
      },
    })
  );

  const submissions = submissionsQuery.data ?? [];
  const cashflowEntries = cashflowQuery.data?.filter((e) => e.isActive) ?? [];

  const filteredSubmissions = submissions.filter((s) => {
    // Filter by binding status
    if (filterStatus === "bound" && !s.isBound) return false;
    if (filterStatus === "unbound" && s.isBound) return false;
    // Filter by reimbursement
    if (filterReimbursement === "needs" && !s.needsReimbursement) return false;
    if (filterReimbursement === "none" && s.needsReimbursement) return false;
    return true;
  });
  const sortedFilteredSubmissions = [...filteredSubmissions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const unboundCount = submissions.filter((s) => !s.isBound).length;
  const pendingEndorsementCount = submissions.filter((s) => s.needsReimbursement && !s.endorsedAt && !s.reimbursedAt).length;
  const pendingPaymentCount = submissions.filter((s) => s.needsReimbursement && s.endorsedAt && !s.reimbursedAt).length;

  const bindingSubmission = submissions.find((s) => s.id === bindingId);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-primary">Receipts</p>
          <h1 className="text-3xl font-bold tracking-tight">Submitted Receipts</h1>
          <p className="text-muted-foreground">
            Review and bind receipt submissions to cashflow transactions
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-xs font-medium">
          {unboundCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-amber-500/10 px-3 py-1 text-amber-600 dark:text-amber-400">
              {unboundCount} unbound
            </span>
          )}
          {pendingEndorsementCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-blue-500/10 px-3 py-1 text-blue-600 dark:text-blue-400">
              {pendingEndorsementCount} pending endorsement
            </span>
          )}
          {pendingPaymentCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-purple-500/10 px-3 py-1 text-purple-600 dark:text-purple-400">
              {pendingPaymentCount} pending payment
            </span>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Status:</span>
          <select
            className="flex h-9 rounded-xl border border-border/60 bg-background/60 backdrop-blur-sm px-4 py-2 text-sm outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/30"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="all">All</option>
            <option value="unbound">Unbound</option>
            <option value="bound">Bound</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Reimbursement:</span>
          <select
            className="flex h-9 rounded-xl border border-border/60 bg-background/60 backdrop-blur-sm px-4 py-2 text-sm outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/30"
            value={filterReimbursement}
            onChange={(e) => setFilterReimbursement(e.target.value)}
          >
            <option value="all">All</option>
            <option value="needs">Needs Reimbursement</option>
            <option value="none">No Reimbursement</option>
          </select>
        </div>
      </div>

      {/* Submissions Table */}
      <Card>
        <CardHeader>
          <CardTitle>Receipt Submissions</CardTitle>
            <CardDescription>
            {sortedFilteredSubmissions.length} submission{sortedFilteredSubmissions.length === 1 ? "" : "s"}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-y border-border/50 bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Submitter</th>
                  <th className="px-5 py-3 font-medium">Purpose</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Linked Transaction</th>
                  <th className="px-5 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedFilteredSubmissions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                      No receipts found.
                    </td>
                  </tr>
                ) : (
                  sortedFilteredSubmissions.map((submission) => (
                    <tr
                      key={submission.id}
                      className={`border-b border-border/30 last:border-0 transition-colors hover:bg-muted/20 ${
                        submission.isBound ? "bg-emerald-500/5" : ""
                      }`}
                    >
                      <td className="px-5 py-4 text-muted-foreground">
                        {new Date(submission.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-5 py-4">
                        <div className="font-medium">{submission.submitterName}</div>
                        <div className="text-xs text-muted-foreground">
                          #{submission.id.slice(0, 8)}
                        </div>
                      </td>
                      <td className="px-5 py-4 max-w-xs truncate">{submission.purpose}</td>
                      <td className="px-5 py-4">
                        <div className="flex flex-col gap-1">
                          {submission.isBound ? (
                            <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 w-fit">
                              Bound
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400 w-fit">
                              Unbound
                            </span>
                          )}
                          {submission.reimbursedAt ? (
                            <span className="inline-flex items-center rounded-full bg-purple-500/10 px-2.5 py-1 text-xs font-medium text-purple-600 dark:text-purple-400 w-fit">
                              Reimbursed
                            </span>
                          ) : submission.endorsedAt ? (
                            <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 w-fit">
                              Endorsed
                            </span>
                          ) : submission.needsReimbursement ? (
                            <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400 w-fit">
                              Needs Reimbursement
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        {submission.cashflowEntry ? (
                          <div>
                            <div className="font-medium text-sm">
                              {submission.cashflowEntry.description}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatCurrency(submission.cashflowEntry.amount)} &middot;{" "}
                              {new Date(submission.cashflowEntry.date).toLocaleDateString()}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => setViewingId(submission.id)}
                          >
                            View
                          </Button>
                          {submission.isBound ? (
                            <Button
                              size="xs"
                              variant="outline"
                              className="text-amber-600 hover:text-amber-700"
                              onClick={() => unbindMutation.mutate({ id: submission.id })}
                              disabled={unbindMutation.isPending}
                            >
                              Unbind
                            </Button>
                          ) : (
                            <Button
                              size="xs"
                              variant="outline"
                              className="text-emerald-600 hover:text-emerald-700"
                              onClick={() => setBindingId(submission.id)}
                            >
                              Bind
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Bind Receipt Dialog */}
      <Dialog open={!!bindingId} onOpenChange={(open) => !open && setBindingId(null)}>
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Bind Receipt to Transaction</DialogTitle>
            <DialogDescription>
              Link this receipt from {bindingSubmission?.submitterName} to a cashflow transaction
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            {bindingSubmission && (
              <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Receipt Details
                </p>
                <div className="mt-2 space-y-1 text-sm">
                  <p>
                    <span className="text-muted-foreground">Purpose:</span>{" "}
                    {bindingSubmission.purpose}
                  </p>
                  {bindingSubmission.notes && (
                    <p>
                      <span className="text-muted-foreground">Notes:</span>{" "}
                      {bindingSubmission.notes}
                    </p>
                  )}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="cashflowEntry">Select Transaction</Label>
              <select
                id="cashflowEntry"
                className="flex h-10 w-full rounded-xl border border-border/60 bg-background/60 backdrop-blur-sm px-4 py-2 text-sm outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/30"
                value={selectedCashflowId}
                onChange={(e) => setSelectedCashflowId(e.target.value)}
              >
                <option value="">Choose a transaction...</option>
                {cashflowEntries.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {new Date(entry.date).toLocaleDateString()} — {entry.description} (
                    {formatCurrency(entry.amount)})
                  </option>
                ))}
              </select>
              {cashflowEntries.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No cashflow transactions available. Create one from the Dashboard first.
                </p>
              )}
            </div>
          </div>
          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={() => {
                if (bindingId && selectedCashflowId) {
                  bindMutation.mutate({
                    id: bindingId,
                    cashflowEntryId: selectedCashflowId,
                  });
                }
              }}
              disabled={!selectedCashflowId || bindMutation.isPending}
            >
              {bindMutation.isPending ? "Binding..." : "Bind Receipt"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      {/* View Receipt Dialog */}
      <Dialog open={!!viewingId} onOpenChange={(open) => !open && setViewingId(null)}>
        <DialogPopup className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Receipt Details</DialogTitle>
            <DialogDescription>
              Submitted by {viewQuery.data?.submitterName ?? "..."}
            </DialogDescription>
          </DialogHeader>
          {viewQuery.isLoading ? (
            <div className="py-8 text-center text-muted-foreground">Loading...</div>
          ) : viewQuery.data ? (
            <div className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Submitter</p>
                  <p className="font-medium">{viewQuery.data.submitterName}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Date Submitted</p>
                  <p className="font-medium">
                    {new Date(viewQuery.data.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs font-medium text-muted-foreground">Purpose</p>
                  <p className="font-medium">{viewQuery.data.purpose}</p>
                </div>
                {viewQuery.data.notes && (
                  <div className="sm:col-span-2">
                    <p className="text-xs font-medium text-muted-foreground">Notes</p>
                    <p>{viewQuery.data.notes}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Status</p>
                  <div className="flex flex-wrap gap-1">
                    {viewQuery.data.isBound ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        Bound
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                        Unbound
                      </span>
                    )}
                    {viewQuery.data.reimbursedAt ? (
                      <span className="inline-flex items-center rounded-full bg-purple-500/10 px-2.5 py-1 text-xs font-medium text-purple-600 dark:text-purple-400">
                        Reimbursed
                      </span>
                    ) : viewQuery.data.endorsedAt ? (
                      <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400">
                        Endorsed
                      </span>
                    ) : viewQuery.data.needsReimbursement ? (
                      <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                        Needs Reimbursement
                      </span>
                    ) : null}
                  </div>
                </div>
                {viewQuery.data.cashflowEntry && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Linked Transaction</p>
                    <p className="font-medium">{viewQuery.data.cashflowEntry.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(viewQuery.data.cashflowEntry.amount)}
                    </p>
                  </div>
                )}
              </div>

              {/* Reimbursement Details */}
              {viewQuery.data.needsReimbursement && (
                <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4">
                  <p className="text-sm font-semibold text-blue-600 dark:text-blue-400 mb-3">
                    Reimbursement Details
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2 text-sm">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Method</p>
                      <p className="font-medium capitalize">{viewQuery.data.reimbursementMethod}</p>
                    </div>
                    {viewQuery.data.reimbursementMethod === "online" && (
                      <>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Account Type</p>
                          <p className="font-medium">
                            {viewQuery.data.accountType === "gcash" ? "GCash" : "Bank Account"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">
                            {viewQuery.data.accountType === "gcash" ? "GCash Number" : "Account Number"}
                          </p>
                          <p className="font-medium font-mono">{viewQuery.data.accountNumber}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Account Name</p>
                          <p className="font-medium">{viewQuery.data.accountName}</p>
                        </div>
                      </>
                    )}
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        Contact ({viewQuery.data.contactType === "email" ? "Email" : "Phone"})
                      </p>
                      <p className="font-medium">{viewQuery.data.contactInfo}</p>
                    </div>
                  </div>
                  {/* QR Code */}
                  {viewQuery.data.qrCodeData && viewQuery.data.qrCodeType && (
                    <div className="mt-4 pt-3 border-t border-blue-500/20">
                      <p className="text-xs font-medium text-muted-foreground mb-2">Payment QR Code</p>
                      <div className="rounded-lg border border-border/60 overflow-hidden bg-white p-2 inline-block">
                        <img
                          src={`data:${viewQuery.data.qrCodeType};base64,${viewQuery.data.qrCodeData}`}
                          alt="Payment QR Code"
                          className="max-h-40 object-contain"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Receipt Image</p>
                <div className="rounded-lg border border-border/60 overflow-hidden bg-muted/20">
                  <img
                    src={`data:${viewQuery.data.imageType};base64,${viewQuery.data.imageData}`}
                    alt="Receipt"
                    className="max-h-96 w-full object-contain"
                  />
                </div>
              </div>
              {!viewQuery.data.isBound && (
                <div className="flex gap-2 pt-4 border-t">
                  <Button
                    className="flex-1"
                    onClick={() => {
                      setViewingId(null);
                      setBindingId(viewQuery.data!.id);
                    }}
                  >
                    Bind to Transaction
                  </Button>
                </div>
              )}
              {viewQuery.data.isBound && (
                <div className="flex gap-2 pt-4 border-t">
                  <Button
                    className="flex-1"
                    variant="outline"
                    onClick={() => {
                      unbindMutation.mutate(
                        { id: viewQuery.data!.id },
                        { onSuccess: () => setViewingId(null) }
                      );
                    }}
                    disabled={unbindMutation.isPending}
                  >
                    Unbind from Transaction
                  </Button>
                </div>
              )}
              
              {/* Endorsement and Reimbursement Buttons */}
              {viewQuery.data.needsReimbursement && !viewQuery.data.reimbursedAt && (
                <div className="flex gap-2 pt-4 border-t">
                  {!viewQuery.data.endorsedAt ? (
                    userRole === "AUDITOR" && (
                      <Button
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                        onClick={() => setEndorsingId(viewQuery.data!.id)}
                      >
                        Endorse for Reimbursement
                      </Button>
                    )
                  ) : (
                    userRole === "TREASURER" && (
                      <Button
                        className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
                        onClick={() => markAsReimbursedMutation.mutate({ id: viewQuery.data!.id })}
                        disabled={markAsReimbursedMutation.isPending}
                      >
                        {markAsReimbursedMutation.isPending ? "Marking..." : "Mark as Reimbursed"}
                      </Button>
                    )
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">Receipt not found</div>
          )}
          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button variant="outline">Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      {/* Endorse Confirmation Dialog */}
      <Dialog open={!!endorsingId} onOpenChange={(open) => !open && setEndorsingId(null)}>
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Endorsement</DialogTitle>
            <DialogDescription>
              Are you sure you want to endorse this receipt? This will notify the treasurer to proceed with payment.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="endorsementMessage">Confirmation Message</Label>
              <Textarea
                id="endorsementMessage"
                placeholder="Add a note or type 'Confirmed'..."
                value={endorsementMessage}
                onChange={(e) => setEndorsementMessage(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Please add a short note or confirmation message.
              </p>
            </div>
          </div>
          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={() => {
                if (endorsingId) {
                  endorseMutation.mutate({ 
                    id: endorsingId,
                    message: endorsementMessage 
                  });
                }
              }}
              disabled={endorseMutation.isPending || !endorsementMessage.trim()}
            >
              {endorseMutation.isPending ? "Sending..." : "Confirm & Send"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
