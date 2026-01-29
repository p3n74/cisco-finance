import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/utils/trpc";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // Show dashboard overview if signed in
  if (session) {
    return <SignedInHome />;
  }

  return <SignedOutHome />;
}

function SignedInHome() {
  const { data: session } = authClient.useSession();
  const navigate = useNavigate();

  const statsQuery = useQuery(trpc.overview.stats.queryOptions());
  const activityQuery = useQuery(trpc.activityLog.list.queryOptions({ limit: 20 }));

  const stats = statsQuery.data;
  const activities = activityQuery.data ?? [];

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
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

  const getActionIcon = (action: string) => {
    switch (action) {
      case "created":
        return "+";
      case "verified":
        return "✓";
      case "bound":
        return "⟷";
      case "unbound":
        return "✕";
      case "uploaded":
        return "↑";
      case "archived":
        return "⌫";
      default:
        return "•";
    }
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case "created":
      case "verified":
        return "text-emerald-500 bg-emerald-500/10";
      case "bound":
      case "uploaded":
        return "text-blue-500 bg-blue-500/10";
      case "unbound":
      case "archived":
        return "text-amber-500 bg-amber-500/10";
      default:
        return "text-muted-foreground bg-muted";
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <p className="text-xs font-medium uppercase tracking-widest text-primary">Home</p>
        <h1 className="text-3xl font-bold tracking-tight">
          Welcome back, {session?.user.name?.split(" ")[0]}
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
              {stats?.totalTransactions ?? 0} transactions
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Inflow</CardDescription>
            <CardTitle className="text-2xl text-emerald-500">
              {stats ? formatCurrency(stats.totalInflow) : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">All time</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Outflow</CardDescription>
            <CardTitle className="text-2xl text-rose-500">
              {stats ? formatCurrency(stats.totalOutflow) : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">All time</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pending Items</CardDescription>
            <CardTitle className="text-2xl text-amber-500">
              {(stats?.unboundReceipts ?? 0) + (stats?.unverifiedTransactions ?? 0)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {stats?.unboundReceipts ?? 0} receipts, {stats?.unverifiedTransactions ?? 0} unverified
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
            <CardDescription>Navigate to common tasks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => navigate({ to: "/dashboard" })}
            >
              <span className="mr-2 flex h-6 w-6 items-center justify-center rounded bg-primary/10 text-xs text-primary">
                $
              </span>
              View Cashflow Dashboard
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => navigate({ to: "/accounts" })}
            >
              <span className="mr-2 flex h-6 w-6 items-center justify-center rounded bg-blue-500/10 text-xs text-blue-500">
                A
              </span>
              Manage Accounts
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start relative"
              onClick={() => navigate({ to: "/receipts" })}
            >
              <span className="mr-2 flex h-6 w-6 items-center justify-center rounded bg-amber-500/10 text-xs text-amber-500">
                R
              </span>
              View Receipts
              {(stats?.unboundReceipts ?? 0) > 0 && (
                <span className="ml-auto rounded-full bg-amber-500 px-2 py-0.5 text-xs font-medium text-white">
                  {stats?.unboundReceipts}
                </span>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Activity Log */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Activity Log</CardTitle>
            <CardDescription>Recent actions across your workspace</CardDescription>
          </CardHeader>
          <CardContent>
            {activityQuery.isLoading ? (
              <div className="py-8 text-center text-muted-foreground">Loading activity...</div>
            ) : activities.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                No activity yet. Start by adding transactions or receipts.
              </div>
            ) : (
              <div className="space-y-4 max-h-96 overflow-y-auto">
                {activities.map((activity) => (
                  <div key={activity.id} className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ${getActionColor(activity.action)}`}
                    >
                      {getActionIcon(activity.action)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">
                        <span className="font-medium">{activity.user.name}</span>{" "}
                        <span className="text-muted-foreground">{activity.description}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatRelativeTime(activity.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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

function SignedOutHome() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Hero Section */}
      <div className="mb-12 text-center">
        <h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
          Cisco Finance
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
          Modern financial management with seamless receipt tracking and expense verification.
        </p>
      </div>

      {/* Main Content Grid */}
      <div className="grid gap-8 lg:grid-cols-2">
        {/* Login Section */}
        <LoginCard />

        {/* Receipt Submission Section */}
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

      {/* Features Section */}
      <div className="mt-16 grid gap-6 sm:grid-cols-3">
        <Card variant="subtle">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
                $
              </span>
              Track Cashflow
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Monitor inflows and outflows with real-time tracking across all your accounts.
            </p>
          </CardContent>
        </Card>

        <Card variant="subtle">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
                R
              </span>
              Receipt Management
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Collect and organize receipts from your team with easy public submission forms.
            </p>
          </CardContent>
        </Card>

        <Card variant="subtle">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                V
              </span>
              Verify Transactions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Link account transactions to official records for complete audit trails.
            </p>
          </CardContent>
        </Card>
      </div>
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
    <Card>
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
      await submitMutation.mutateAsync({
        submitterName: value.submitterName,
        purpose: value.purpose,
        imageData,
        imageType,
        notes: value.notes || undefined,
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

  const resetForm = () => {
    setIsSubmitted(false);
    setImagePreview(null);
    setImageData("");
    setImageType("");
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
          Upload a clear photo or scan (max 10MB)
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
