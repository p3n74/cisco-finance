import { useNavigate } from "@tanstack/react-router";
import { ShieldX } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Shown when a logged-in user is not on the TRACE whitelist.
 * Only whitelisted users (including CISCO_OFFICER) can view finances.
 */
export function NotWhitelistedView() {
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await authClient.signOut();
    navigate({ to: "/" });
  };

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldX className="size-8 text-amber-500" />
            <CardTitle className="text-xl">Access restricted</CardTitle>
          </div>
          <CardDescription>
            You don’t have access to TRACE. Only whitelisted users can view finances. If you
            believe you should have access, ask THE Vice President for Finance to add you to the team.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button variant="default" onClick={() => navigate({ to: "/" })}>
            Back to Home
          </Button>
          <Button variant="outline" onClick={handleSignOut}>
            Sign Out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
