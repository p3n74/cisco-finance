import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/login")({
  component: RouteComponent,
});

function RouteComponent() {
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    const callbackURL =
      typeof window === "undefined" ? "/dashboard" : `${window.location.origin}/dashboard`;
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
    <div className="mx-auto w-full mt-10 max-w-md p-6">
      <h1 className="mb-6 text-center text-3xl font-bold">Sign in</h1>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={handleGoogleSignIn}
        disabled={isGoogleLoading}
      >
        {isGoogleLoading ? "Connecting..." : "Continue with Google"}
      </Button>
    </div>
  );
}
