import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import z from "zod";
import {
  LayoutDashboard,
  Landmark,
  Receipt,
  Wallet,
  Users,
  Plus,
  CheckCircle2,
  Link2,
  Unlink,
  Upload,
  Archive,
  Circle,
  FileDown,
  Loader2,
} from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { downloadActivityLogPdf } from "@/lib/pdf-report";
import { NotWhitelistedView } from "@/components/not-whitelisted-view";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { queryClient, trpc } from "@/utils/trpc";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  const { data: session, isPending } = authClient.useSession();
  const roleQuery = useQuery({
    ...trpc.team.getMyRole.queryOptions(),
    enabled: !!session,
  });
  const isWhitelisted = (roleQuery.data?.role ?? null) !== null;

  if (isPending) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // Signed in but not whitelisted: show forbidden
  if (session && roleQuery.isSuccess && !isWhitelisted) {
    return <NotWhitelistedView />;
  }

  // Still loading role for signed-in user
  if (session && roleQuery.isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // Show dashboard overview if signed in and whitelisted
  if (session) {
    return <SignedInHome />;
  }

  return <SignedOutHome />;
}

function SignedInHome() {
  const { data: session } = authClient.useSession();

  const statsQuery = useQuery(trpc.overview.stats.queryOptions());
  const budgetOverviewQuery = useQuery(trpc.budgetProjects.overview.queryOptions());
  const activityQuery = useQuery(trpc.activityLog.list.queryOptions({ limit: 20 }));

  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [printDateFrom, setPrintDateFrom] = useState("");
  const [printDateTo, setPrintDateTo] = useState("");
  const [printGenerating, setPrintGenerating] = useState(false);

  const stats = statsQuery.data;
  const budgetOverview = budgetOverviewQuery.data;
  const activities = activityQuery.data?.items ?? [];

  const netCashflow = stats?.netCashflow ?? 0;
  const reservedForPlanned = budgetOverview?.reservedForPlanned ?? 0;
  const projectedCashflow = netCashflow - reservedForPlanned;

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
      maximumFractionDigits: 2,
    }).format(value);

  const formatRelativeTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(date).toLocaleDateString();
  };

  const getActionConfig = (action: string) => {
    switch (action) {
      case "created":
        return { icon: Plus, label: "Created", className: "text-emerald-600 bg-emerald-500/15 border-emerald-500/20" };
      case "verified":
        return { icon: CheckCircle2, label: "Verified", className: "text-emerald-600 bg-emerald-500/15 border-emerald-500/20" };
      case "bound":
        return { icon: Link2, label: "Bound", className: "text-blue-600 bg-blue-500/15 border-blue-500/20" };
      case "uploaded":
        return { icon: Upload, label: "Uploaded", className: "text-blue-600 bg-blue-500/15 border-blue-500/20" };
      case "unbound":
        return { icon: Unlink, label: "Unbound", className: "text-amber-600 bg-amber-500/15 border-amber-500/20" };
      case "archived":
        return { icon: Archive, label: "Archived", className: "text-amber-600 bg-amber-500/15 border-amber-500/20" };
      default:
        return { icon: Circle, label: "Activity", className: "text-muted-foreground bg-muted/80 border-border" };
    }
  };

  return (
    <div className="mx-auto max-w-6xl min-w-0 px-3 py-6 sm:px-4 sm:py-8">
      {/* Header */}
      <div className="mb-8">
        <p className="text-xs font-medium uppercase tracking-widest text-primary">Home</p>
        <h1 className="text-3xl font-bold tracking-tight">
          Welcome back, {session?.user.name?.split(" ")[0] ?? "User"}
        </h1>
        <p className="text-muted-foreground">
          Here's an overview of your financial activity
        </p>
      </div>

      {/* Stats Cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Net Cashflow</CardDescription>
            <CardTitle className={`text-2xl ${(stats?.netCashflow ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
              {stats ? formatCurrency(stats.netCashflow) : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Current verified balance
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pending Receipts</CardDescription>
            <CardTitle className="text-2xl text-amber-500">
              {stats?.pendingReceipts ?? 0}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Unbound submissions</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Deficit</CardDescription>
            <CardTitle
              className={`text-2xl ${
                !stats
                  ? ""
                  : stats.pendingVerificationAmount === 0
                    ? "text-foreground"
                    : stats.pendingVerificationAmount > 0
                      ? "text-emerald-500"
                      : "text-rose-500"
              }`}
            >
              {stats ? formatCurrency(stats.pendingVerificationAmount) : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {!stats
                ? "—"
                : stats.pendingVerificationAmount === 0
                  ? "In sync (net movement = net cashflow)"
                  : stats.pendingVerificationAmount > 0
                    ? "Likely income not yet verified"
                    : "Likely expenses not yet verified"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Projected Cashflow</CardDescription>
            <CardTitle className={`text-2xl ${projectedCashflow >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
              {stats ? formatCurrency(projectedCashflow) : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Net minus reserved for planned events
              {budgetOverview && reservedForPlanned > 0
                ? ` (${formatCurrency(reservedForPlanned)} reserved)`
                : ""}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions + Activity Log */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Quick Actions */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Jump to common tasks</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Link
              to="/dashboard"
              className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-3 text-left transition-colors hover:border-primary/30 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <LayoutDashboard className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">Dashboard</p>
                <p className="text-xs text-muted-foreground">Cashflow, deficit & projected balance</p>
              </div>
            </Link>
            <Link
              to="/accounts"
              className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-3 text-left transition-colors hover:border-blue-500/30 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
                <Landmark className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">Accounts</p>
                <p className="text-xs text-muted-foreground">Bank & e-wallet, log transactions</p>
              </div>
            </Link>
            <Link
              to="/receipts"
              className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-3 text-left transition-colors hover:border-amber-500/30 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                <Receipt className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium text-foreground">
                  Receipts
                  {(stats?.pendingReceipts ?? 0) > 0 && (
                    <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-medium text-white">
                      {stats.pendingReceipts} pending
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">Submissions, bind & reimburse</p>
              </div>
            </Link>
            <Link
              to="/budgets"
              className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-3 text-left transition-colors hover:border-emerald-500/30 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
                <Wallet className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">Budgets</p>
                <p className="text-xs text-muted-foreground">Events, projects & planned spending</p>
              </div>
            </Link>
            <Link
              to="/team"
              className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-3 text-left transition-colors hover:border-violet-500/30 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-500">
                <Users className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">Team</p>
                <p className="text-xs text-muted-foreground">Members, roles & permissions</p>
              </div>
            </Link>
          </CardContent>
        </Card>

        {/* Activity Log */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle>Activity Log</CardTitle>
              <CardDescription>Recent actions across your workspace</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 gap-2"
              onClick={() => setPrintDialogOpen(true)}
            >
              <FileDown className="size-4" />
              Print Activity Log
            </Button>
          </CardHeader>
          <CardContent>
            {activityQuery.isLoading ? (
              <div className="py-8 text-center text-muted-foreground">Loading activity...</div>
            ) : activities.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                No activity yet. Start by adding transactions or receipts.
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {activities.map((activity) => {
                  const config = getActionConfig(activity.action);
                  const Icon = config.icon;
                  return (
                    <div
                      key={activity.id}
                      className="flex items-start gap-3 rounded-xl border border-transparent bg-muted/30 px-3 py-2.5 transition-colors hover:bg-muted/50"
                    >
                      <span
                        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${config.className}`}
                        title={config.label}
                      >
                        <Icon className="size-4" strokeWidth={2.25} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">
                          <span className="font-medium text-foreground">{activity.user?.name ?? "Unknown User"}</span>
                          <span className="text-muted-foreground"> — </span>
                          <span className="text-muted-foreground">{activity.description}</span>
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatRelativeTime(activity.createdAt)}
                        </p>
                      </div>
                      <span className="hidden shrink-0 rounded-md bg-muted/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:inline-block">
                        {config.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Print Activity Log Dialog */}
      <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
        <DialogPopup className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Print Activity Log</DialogTitle>
            <DialogDescription>
              Choose a date range. The report will include all activity in that period (up to 500 entries).
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground">From</Label>
              <Input
                type="date"
                value={printDateFrom}
                onChange={(e) => setPrintDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">To</Label>
              <Input
                type="date"
                value={printDateTo}
                onChange={(e) => setPrintDateTo(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Leave both empty for all dates (most recent 500 entries).
            </p>
          </div>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPrintDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={printGenerating}
              onClick={async () => {
                setPrintGenerating(true);
                try {
                  const data = await queryClient.fetchQuery(
                    trpc.activityLog.list.queryOptions({
                      limit: 500,
                      dateFrom: printDateFrom.trim() || undefined,
                      dateTo: printDateTo.trim() || undefined,
                    })
                  );
                  downloadActivityLogPdf(data.items, {
                    dateFrom: printDateFrom.trim() || undefined,
                    dateTo: printDateTo.trim() || undefined,
                  });
                  setPrintDialogOpen(false);
                  toast.success("Activity log PDF downloaded.");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Failed to generate PDF");
                } finally {
                  setPrintGenerating(false);
                }
              }}
            >
              {printGenerating ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Generating…
                </>
              ) : (
                "Generate PDF"
              )}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      {/* Receipt Submission for signed-in users */}
      <div className="mt-8">
        <Card>
          <CardHeader>
            <CardTitle>Quick Receipt Upload</CardTitle>
            <CardDescription>
              Upload a receipt directly - it will be added to your unbound receipts
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReceiptSubmissionForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const CONTACT_SUBJECT = "TRACE — Organization inquiry";
const CONTACT_BODY = "Hi, we're interested in using TRACE for our organization.\n\nOrganization name:\nYour name & role:\n";

function SignedOutHome() {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const whoSectionRef = useRef<HTMLElement | null>(null);
  const howSectionRef = useRef<HTMLElement | null>(null);
  const everythingSectionRef = useRef<HTMLElement | null>(null);
  const vpEmailQuery = useQuery(trpc.team.getVpFinanceEmail.queryOptions());
  const vpEmail = vpEmailQuery.data ?? null;
  const contactMailto =
    (vpEmail ? `mailto:${encodeURIComponent(vpEmail)}?` : "mailto:?") +
    `subject=${encodeURIComponent(CONTACT_SUBJECT)}&body=${encodeURIComponent(CONTACT_BODY)}`;
  const [whoInView, setWhoInView] = useState(false);
  const [howInView, setHowInView] = useState(false);
  const [everythingInView, setEverythingInView] = useState(false);
  useEffect(() => {
    const el = whoSectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => setWhoInView(e.isIntersecting),
      { threshold: 0.2, rootMargin: "0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    const el = howSectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => setHowInView(e.isIntersecting),
      { threshold: 0.2, rootMargin: "0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    const el = everythingSectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => setEverythingInView(e.isIntersecting),
      { threshold: 0.2, rootMargin: "0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={scrollContainerRef}
      className="h-full min-h-0 overflow-y-auto overflow-x-hidden snap-y snap-mandatory scroll-smooth"
    >
      {/* Slide 1: Hero + Social proof + Login + Receipt — dynamic vertical spacing */}
      <section className="flex min-h-full snap-start snap-always flex-col px-3 py-6 sm:px-4 sm:py-8">
        <div className="mx-auto flex w-full max-w-6xl flex-1 min-w-0 flex-col">
          <div className="min-h-0 flex-1" />
          <div className="text-center shrink-0">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Finance for student orgs & councils
            </p>
            <h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              Council finance, without the spreadsheets
            </h1>
            <p className="mx-auto mb-6 max-w-2xl text-lg text-muted-foreground">
              TRACE — Track Receipts And Council Expenses. Receipts, cashflow, and audit trails in one place. Built for CISCO. Ready for your org.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> No spreadsheets
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Public receipt form
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Role-based access
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Audit-ready
              </span>
            </div>
          </div>
          <div className="min-h-0 flex-1" />
          <div className="shrink-0 text-center mb-6">
            <p className="text-sm text-muted-foreground">
              Trusted by the <strong className="text-foreground">Computer Information Sciences Council</strong>
            </p>
          </div>
          <div className="min-h-0 flex-1" />
          <div className="grid shrink-0 gap-8 lg:grid-cols-[1fr_1.6fr]">
            <div className="min-w-0">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Already use TRACE?
              </p>
              <LoginCard />
            </div>
            <div className="min-w-0">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Try it — no account needed
              </p>
              <Card>
                <CardHeader>
                  <CardTitle className="text-xl">Submit a Receipt</CardTitle>
                  <CardDescription>
                    Upload receipts for reimbursement or record keeping
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ReceiptSubmissionForm />
                </CardContent>
              </Card>
            </div>
          </div>
          <div className="min-h-0 flex-1" />
        </div>
      </section>

      {/* Slide 2: How it works */}
      <section
        ref={howSectionRef}
        className={`how-section flex min-h-full snap-start snap-always flex-col px-3 py-6 sm:px-4 sm:py-8 ${howInView ? "in-view" : ""}`}
      >
        <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-1 flex-col justify-center overflow-y-auto">
        <h2 className="mb-2 text-center text-xl font-semibold sm:text-2xl">
          How it works
        </h2>
        <p className="mb-4 text-center text-sm text-muted-foreground max-w-xl mx-auto">
          From first receipt to reimbursed expense — the full process and features.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 sm:gap-4">
          <Card variant="subtle" className="how-card p-4">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  1
                </span>
                Sign in & team
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Officers and whitelisted members sign in with Google. In <strong>Team</strong>, VP Finance (or other admins) add members by email and assign roles: Auditor, Treasurer, Ways and Means, or view-only. Only approved users see the app.
              </p>
              <p className="text-xs text-muted-foreground">
                The public receipt form (first slide) needs no login — anyone can submit.
              </p>
            </CardContent>
          </Card>

          <Card variant="subtle" className="how-card p-4">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  2
                </span>
                Submit a receipt
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Submitters upload a receipt photo, name, and what it’s for. They can request <strong>reimbursement</strong>: cash, or online (GCash or bank — account number, name, optional QR code). Contact info (phone or email) is collected so officers can follow up.
              </p>
              <p className="text-xs text-muted-foreground">
                All submissions show in <strong>Receipts</strong> for officers to review and bind.
              </p>
            </CardContent>
          </Card>

          <Card variant="subtle" className="how-card p-4">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  3
                </span>
                Log account transactions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">
                In <strong>Accounts</strong>, officers add council bank and e-wallet accounts (e.g. GCash). They log each deposit and withdrawal with amount, date, and description so cashflow reflects real balances.
              </p>
              <p className="text-xs text-muted-foreground">
                This keeps net cashflow and deficit accurate before binding receipts.
              </p>
            </CardContent>
          </Card>

          <Card variant="subtle" className="how-card p-4">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  4
                </span>
                Bind receipts to transactions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">
                In <strong>Receipts</strong>, officers “bind” each receipt to the matching account transaction (the deposit or withdrawal it represents). That links the paper trail to the bank record and updates the deficit (unverified difference between net movement and net cashflow).
              </p>
              <p className="text-xs text-muted-foreground">
                Full audit trail: every receipt tied to a transaction.
              </p>
            </CardContent>
          </Card>

          <Card variant="subtle" className="how-card p-4">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  5
                </span>
                Mark reimbursed
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">
                When reimbursement is done — cash handed over or online transfer sent — officers mark the receipt as <strong>reimbursed</strong> in TRACE (cash or online). Receipt status and activity log stay updated so everyone can see what’s been paid.
              </p>
              <p className="text-xs text-muted-foreground">
                Submitters’ contact and payout details are used only for reimbursement.
              </p>
            </CardContent>
          </Card>

          <Card variant="subtle" className="how-card p-4">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  6
                </span>
                Dashboard & budgets
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">
                The <strong>Dashboard</strong> shows net cashflow, pending receipts count, deficit, and projected cashflow (after planned budgets). In <strong>Budgets</strong>, officers create events and set budgets; projected balance compares planned spending to current cashflow for handover or audit.
              </p>
              <p className="text-xs text-muted-foreground">
                Activity log records who did what and when.
              </p>
            </CardContent>
          </Card>
        </div>
        </div>
      </section>

      {/* Slide 3: Features */}
      <section
        ref={everythingSectionRef}
        className={`everything-section flex min-h-full snap-start snap-always flex-col px-3 py-6 sm:px-4 sm:py-8 ${everythingInView ? "in-view" : ""}`}
      >
        <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-1 flex-col justify-center overflow-y-auto">
        <h2 className="mb-2 text-center text-2xl font-semibold sm:text-3xl">
          Everything your org needs
        </h2>
        <p className="mb-8 text-center text-base text-muted-foreground max-w-2xl mx-auto sm:text-lg">
          Plan for future events and projects, see how much money is left for planning, and generate project and financial reports in one place.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 sm:gap-6">
          <Card variant="subtle" className="everything-card p-5 sm:p-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg sm:text-xl">Dashboard</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-base text-muted-foreground sm:text-lg">
                Net cashflow, pending receipts, and projected balance at a glance — so you can see if there’s enough money for upcoming projects and events.
              </p>
            </CardContent>
          </Card>
          <Card variant="subtle" className="everything-card p-5 sm:p-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg sm:text-xl">Budgets & projects</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-base text-muted-foreground sm:text-lg">
                Plan for future events and projects with dedicated budgets. Compare planned spending to actual cashflow and see how much is left for planning.
              </p>
            </CardContent>
          </Card>
          <Card variant="subtle" className="everything-card p-5 sm:p-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg sm:text-xl">Project & financial reports</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-base text-muted-foreground sm:text-lg">
                Generate project reports and financial reports easily — documents you need for handover, audit, or reporting, without leaving TRACE.
              </p>
            </CardContent>
          </Card>
          <Card variant="subtle" className="everything-card p-5 sm:p-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg sm:text-xl">Receipts</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-base text-muted-foreground sm:text-lg">
                All submitted receipts in one place. Bind them to account transactions and mark reimbursements so project spending is documented.
              </p>
            </CardContent>
          </Card>
          <Card variant="subtle" className="everything-card p-5 sm:p-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg sm:text-xl">Accounts</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-base text-muted-foreground sm:text-lg">
                Bank and e-wallet accounts (GCash, etc.). Log transactions and track balances so cashflow and project budgets stay accurate.
              </p>
            </CardContent>
          </Card>
          <Card variant="subtle" className="everything-card p-5 sm:p-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg sm:text-xl">Team</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Control who’s in. Add members and assign roles: full access for officers, view-only for oversight — you define the structure.
              </p>
            </CardContent>
          </Card>
        </div>
        </div>
      </section>

      {/* Slide 4: Who it's for */}
      <section
        ref={whoSectionRef}
        className={`who-section flex min-h-full snap-start snap-always flex-col px-3 py-6 sm:px-4 sm:py-8 ${whoInView ? "in-view" : ""}`}
      >
        <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-1 flex-col justify-center overflow-y-auto">
        <h2 className="mb-2 text-center text-2xl font-semibold sm:text-3xl">
          Who it’s for
        </h2>
        <p className="mb-4 text-center text-base text-muted-foreground max-w-2xl mx-auto sm:text-lg">
          TRACE fits any group that spends money, collects receipts, and needs clear books — from student councils and orgs to committees, departments, and project-based teams.
        </p>
        <p className="mb-8 text-center text-sm text-muted-foreground max-w-xl mx-auto">
          Ideal for: student councils · orgs · committees · departments · event and project teams
        </p>
        <div className="grid gap-6 sm:grid-cols-3 sm:gap-8">
          <Card variant="subtle" className="who-card border-emerald-500/20 p-5 sm:p-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg sm:text-xl">Submitters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-base text-muted-foreground sm:text-lg">
                Anyone with a receipt to turn in — whether they’re a member or not. No account or login required: use the public form on the first slide.
              </p>
              <p className="text-sm text-muted-foreground">
                They enter their name, what the receipt is for, and optionally request reimbursement (cash or online transfer with account details). Great for members who bought supplies, paid for an event expense, or need to be reimbursed quickly.
              </p>
            </CardContent>
          </Card>
          <Card variant="subtle" className="who-card border-blue-500/20 p-5 sm:p-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg sm:text-xl">Officers</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-base text-muted-foreground sm:text-lg">
                Finance leads with full access: VP Finance, Auditor, Treasurer, and Ways and Means. They run the books day to day.
              </p>
              <p className="text-sm text-muted-foreground">
                They bind receipts to transactions, mark reimbursements (cash or online), manage accounts and budgets, add events and projects, and manage the team (who’s in and which role). They also generate project and financial reports for handover or audit.
              </p>
            </CardContent>
          </Card>
          <Card variant="subtle" className="who-card border-amber-500/20 p-5 sm:p-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg sm:text-xl">View-only</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-base text-muted-foreground sm:text-lg">
                People who need to see the books but shouldn’t edit — e.g. CISCO Officer, advisor, or incoming officer preparing for handover.
              </p>
              <p className="text-sm text-muted-foreground">
                They see the dashboard, receipts, accounts, and budgets in read-only mode. Nothing gets changed, so you get oversight and transparency without risk to the data.
              </p>
            </CardContent>
          </Card>
        </div>
        </div>
      </section>

      {/* Slide 5: CTA */}
      <section className="flex min-h-full snap-start snap-always flex-col px-3 py-6 sm:px-4 sm:py-8">
        <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-1 flex-col justify-center">
        <Card className="border-primary/30 bg-primary/5 overflow-hidden">
          <CardContent className="py-12 px-6 sm:px-10 text-center">
            <h2 className="text-2xl font-bold mb-2">Get TRACE for your org</h2>
            <p className="text-muted-foreground max-w-md mx-auto mb-8 text-sm">
              Stop juggling spreadsheets and scattered receipts. Get a dedicated TRACE instance for your organization — same tool CISCO uses.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button
                size="lg"
                asChild
                className="font-semibold"
              >
                <a href={contactMailto}>
                  Contact us
                </a>
              </Button>
              <p className="text-xs text-muted-foreground">
                Already use TRACE? <a href="#login" className="underline hover:text-foreground">Sign in</a> above.
              </p>
            </div>
          </CardContent>
        </Card>
        </div>
      </section>
    </div>
  );
}

function LoginCard() {
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    const callbackURL =
      typeof window === "undefined" ? "/" : `${window.location.origin}/`;
    setIsGoogleLoading(true);
    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL,
      });
    } catch (error) {
      toast.error("Google sign in failed. Please try again.");
    } finally {
      setIsGoogleLoading(false);
    }
  };

  return (
    <Card id="login">
      <CardHeader>
        <CardTitle className="text-xl">Welcome Back</CardTitle>
        <CardDescription>
          Sign in to access your finance dashboard
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Button
          type="button"
          className="w-full"
          onClick={handleGoogleSignIn}
          disabled={isGoogleLoading}
          size="lg"
        >
          {isGoogleLoading ? "Connecting..." : "Continue with Google"}
        </Button>

        <div className="rounded-xl bg-muted/50 p-4 space-y-3">
          <p className="text-sm font-medium text-foreground">
            Why sign in with Google?
          </p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
              <span>Secure authentication powered by Google's industry-leading security</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
              <span>No passwords to remember — one-click seamless access</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
              <span>Your data stays protected with enterprise-grade encryption</span>
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function ReceiptSubmissionForm() {
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageData, setImageData] = useState<string>("");
  const [imageType, setImageType] = useState<string>("");
  const [isSubmitted, setIsSubmitted] = useState(false);

  // Reimbursement state
  const [needsReimbursement, setNeedsReimbursement] = useState(false);
  const [reimbursementMethod, setReimbursementMethod] = useState<"cash" | "online" | "">("");
  const [accountType, setAccountType] = useState<"gcash" | "bank" | "">("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [qrCodePreview, setQrCodePreview] = useState<string | null>(null);
  const [qrCodeData, setQrCodeData] = useState<string>("");
  const [qrCodeType, setQrCodeType] = useState<string>("");
  const [contactInfo, setContactInfo] = useState("");
  const [contactType, setContactType] = useState<"phone" | "email" | "">("");

  const submitMutation = useMutation(
    trpc.receiptSubmission.submit.mutationOptions({
      onSuccess: () => {
        toast.success("Receipt submitted successfully!");
        setIsSubmitted(true);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to submit receipt");
      },
    }),
  );

  const form = useForm({
    defaultValues: {
      submitterName: "",
      purpose: "",
      notes: "",
    },
    onSubmit: async ({ value }) => {
      if (!imageData) {
        toast.error("Please upload a receipt image");
        return;
      }

      // Validate reimbursement fields if needed
      if (needsReimbursement) {
        if (!reimbursementMethod) {
          toast.error("Please select a reimbursement method");
          return;
        }
        if (reimbursementMethod === "online") {
          if (!accountType) {
            toast.error("Please select an account type (GCash or Bank)");
            return;
          }
          if (!accountNumber) {
            toast.error("Please enter your account number");
            return;
          }
          if (!accountName) {
            toast.error("Please enter the name on the account");
            return;
          }
        }
        if (!contactType || !contactInfo) {
          toast.error("Please provide your contact information");
          return;
        }
      }

      await submitMutation.mutateAsync({
        submitterName: value.submitterName,
        purpose: value.purpose,
        imageData,
        imageType,
        notes: value.notes || undefined,
        // Reimbursement fields
        needsReimbursement,
        reimbursementMethod: needsReimbursement ? reimbursementMethod || undefined : undefined,
        accountType: needsReimbursement && reimbursementMethod === "online" ? accountType || undefined : undefined,
        accountNumber: needsReimbursement && reimbursementMethod === "online" ? accountNumber || undefined : undefined,
        accountName: needsReimbursement && reimbursementMethod === "online" ? accountName || undefined : undefined,
        qrCodeData: needsReimbursement && reimbursementMethod === "online" ? qrCodeData || undefined : undefined,
        qrCodeType: needsReimbursement && reimbursementMethod === "online" ? qrCodeType || undefined : undefined,
        contactInfo: needsReimbursement ? contactInfo || undefined : undefined,
        contactType: needsReimbursement ? contactType || undefined : undefined,
      });
    },
    validators: {
      onSubmit: z.object({
        submitterName: z.string().min(2, "Name must be at least 2 characters"),
        purpose: z.string().min(5, "Please describe what this receipt is for"),
        notes: z.string().optional(),
      }),
    },
  });

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image must be less than 10MB");
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

  const handleQrCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("QR code image must be less than 5MB");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      setQrCodePreview(base64);
      setQrCodeData(base64.split(",")[1] || "");
      setQrCodeType(file.type);
    };
    reader.readAsDataURL(file);
  };

  const resetForm = () => {
    setIsSubmitted(false);
    setImagePreview(null);
    setImageData("");
    setImageType("");
    // Reset reimbursement state
    setNeedsReimbursement(false);
    setReimbursementMethod("");
    setAccountType("");
    setAccountNumber("");
    setAccountName("");
    setQrCodePreview(null);
    setQrCodeData("");
    setQrCodeType("");
    setContactInfo("");
    setContactType("");
    form.reset();
  };

  if (isSubmitted) {
    return (
      <div className="space-y-4 text-center py-4">
        <div className="flex items-center justify-center gap-2 text-xl text-emerald-500">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10">
            ✓
          </span>
          Receipt Submitted!
        </div>
        <p className="text-muted-foreground">
          Thank you for submitting your receipt. It will be reviewed shortly.
        </p>
        <Button onClick={resetForm} variant="outline">
          Submit Another Receipt
        </Button>
      </div>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="space-y-4"
    >
      <form.Field name="submitterName">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Your Name</Label>
            <Input
              id={field.name}
              name={field.name}
              placeholder="Enter your full name"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
            />
            {field.state.meta.errors.map((error) => (
              <p key={error?.message} className="text-xs text-destructive">
                {error?.message}
              </p>
            ))}
          </div>
        )}
      </form.Field>

      <div className="space-y-2">
        <Label htmlFor="receiptImage">Receipt Image</Label>
        <Input
          id="receiptImage"
          name="receiptImage"
          type="file"
          accept="image/*"
          onChange={handleImageChange}
          className="cursor-pointer"
        />
        <p className="text-xs text-muted-foreground">
          Use a scanned image from apps like CamScanner or similar (not a casual photo). Max 10MB.
        </p>
        {imagePreview && (
          <div className="mt-3 overflow-hidden rounded-xl border border-border/50 bg-muted/30 p-2">
            <img
              src={imagePreview}
              alt="Receipt preview"
              className="mx-auto max-h-32 rounded-lg object-contain"
            />
          </div>
        )}
      </div>

      <form.Field name="purpose">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>What is this for?</Label>
            <Textarea
              id={field.name}
              name={field.name}
              placeholder="e.g., Office supplies for marketing event"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              rows={2}
            />
            {field.state.meta.errors.map((error) => (
              <p key={error?.message} className="text-xs text-destructive">
                {error?.message}
              </p>
            ))}
          </div>
        )}
      </form.Field>

      {/* Reimbursement Section */}
      <div className="space-y-4 rounded-xl border border-border/50 bg-muted/20 p-4">
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="needsReimbursement"
            checked={needsReimbursement}
            onChange={(e) => {
              setNeedsReimbursement(e.target.checked);
              if (!e.target.checked) {
                // Reset reimbursement fields when unchecked
                setReimbursementMethod("");
                setAccountType("");
                setAccountNumber("");
                setAccountName("");
                setQrCodePreview(null);
                setQrCodeData("");
                setQrCodeType("");
                setContactInfo("");
                setContactType("");
              }
            }}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          <Label htmlFor="needsReimbursement" className="cursor-pointer font-medium">
            I need reimbursement for this expense
          </Label>
        </div>

        {needsReimbursement && (
          <div className="space-y-4 pt-2">
            {/* Reimbursement Method */}
            <div className="space-y-2">
              <Label>How would you like to be reimbursed?</Label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="reimbursementMethod"
                    value="cash"
                    checked={reimbursementMethod === "cash"}
                    onChange={() => {
                      setReimbursementMethod("cash");
                      // Clear online transfer fields
                      setAccountType("");
                      setAccountNumber("");
                      setAccountName("");
                      setQrCodePreview(null);
                      setQrCodeData("");
                      setQrCodeType("");
                    }}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="text-sm">Cash</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="reimbursementMethod"
                    value="online"
                    checked={reimbursementMethod === "online"}
                    onChange={() => setReimbursementMethod("online")}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="text-sm">Online Transfer</span>
                </label>
              </div>
            </div>

            {/* Online Transfer Options */}
            {reimbursementMethod === "online" && (
              <div className="space-y-4 rounded-lg border border-border/40 bg-background/50 p-3">
                {/* Account Type */}
                <div className="space-y-2">
                  <Label>Account Type</Label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="accountType"
                        value="gcash"
                        checked={accountType === "gcash"}
                        onChange={() => setAccountType("gcash")}
                        className="h-4 w-4 accent-primary"
                      />
                      <span className="text-sm">GCash</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="accountType"
                        value="bank"
                        checked={accountType === "bank"}
                        onChange={() => setAccountType("bank")}
                        className="h-4 w-4 accent-primary"
                      />
                      <span className="text-sm">Bank Account</span>
                    </label>
                  </div>
                </div>

                {/* Account Number */}
                <div className="space-y-2">
                  <Label htmlFor="accountNumber">
                    {accountType === "gcash" ? "GCash Number" : "Account Number"}
                  </Label>
                  <Input
                    id="accountNumber"
                    placeholder={accountType === "gcash" ? "09XX XXX XXXX" : "Enter account number"}
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                  />
                </div>

                {/* Account Name */}
                <div className="space-y-2">
                  <Label htmlFor="accountName">Name on Account</Label>
                  <Input
                    id="accountName"
                    placeholder="Enter the name as it appears on the account"
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                  />
                </div>

                {/* QR Code Upload */}
                <div className="space-y-2">
                  <Label htmlFor="qrCode">QR Code (Optional)</Label>
                  <Input
                    id="qrCode"
                    type="file"
                    accept="image/*"
                    onChange={handleQrCodeChange}
                    className="cursor-pointer"
                  />
                  <p className="text-xs text-muted-foreground">
                    Upload your payment QR code for easier transfer
                  </p>
                  {qrCodePreview && (
                    <div className="mt-2 overflow-hidden rounded-lg border border-border/50 bg-muted/30 p-2">
                      <img
                        src={qrCodePreview}
                        alt="QR Code preview"
                        className="mx-auto max-h-24 rounded object-contain"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Contact Information */}
            <div className="space-y-2">
              <Label>Contact Information</Label>
              <div className="flex gap-4 mb-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="contactType"
                    value="phone"
                    checked={contactType === "phone"}
                    onChange={() => setContactType("phone")}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="text-sm">Phone</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="contactType"
                    value="email"
                    checked={contactType === "email"}
                    onChange={() => setContactType("email")}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="text-sm">Email</span>
                </label>
              </div>
              <Input
                id="contactInfo"
                placeholder={contactType === "email" ? "your.email@example.com" : "09XX XXX XXXX"}
                value={contactInfo}
                onChange={(e) => setContactInfo(e.target.value)}
                type={contactType === "email" ? "email" : "tel"}
              />
              <p className="text-xs text-muted-foreground">
                We'll use this to contact you about your reimbursement
              </p>
            </div>
          </div>
        )}
      </div>

      <form.Subscribe>
        {(state) => (
          <Button
            type="submit"
            className="w-full"
            disabled={!state.canSubmit || state.isSubmitting || submitMutation.isPending || !imageData}
          >
            {state.isSubmitting || submitMutation.isPending
              ? "Submitting..."
              : "Submit Receipt"}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
