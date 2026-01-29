import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import {
  Dialog,
  DialogClose,
  DialogPopup,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

import { ModeToggle } from "./mode-toggle";
import { Button } from "./ui/button";
import { WebSocketStatus } from "./websocket-provider";

export default function Header() {
  const { data: session } = authClient.useSession();
  const navigate = useNavigate();
  const [isSignOutOpen, setIsSignOutOpen] = useState(false);

  const handleSignOut = async () => {
    await authClient.signOut();
    setIsSignOutOpen(false);
    navigate({ to: "/" });
  };

  const publicLinks = [
    { to: "/", label: "Home" },
  ] as const;

  const authLinks = [
    { to: "/dashboard", label: "Dashboard" },
    { to: "/accounts", label: "Accounts" },
    { to: "/receipts", label: "Receipts" },
    { to: "/budgets", label: "Budgets" },
    { to: "/team", label: "Team" },
  ] as const;

  return (
    <header className="sticky top-0 z-50 w-full">
      <div className="mx-auto max-w-6xl px-4 py-3">
        <nav className="glass flex items-center justify-between rounded-2xl px-4 py-2.5">
          <div className="flex items-center gap-8">
            <Link 
              to="/" 
              className="flex items-center gap-2 font-semibold tracking-tight text-foreground transition-opacity hover:opacity-80"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
                CF
              </div>
              <span className="hidden sm:inline">Cisco Finance</span>
            </Link>
            
            <div className="flex items-center gap-1">
              {publicLinks.map(({ to, label }) => (
                <Link
                  key={to}
                  to={to}
                  activeOptions={{ exact: true }}
                  className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  activeProps={{ className: "bg-muted text-foreground" }}
                >
                  {label}
                </Link>
              ))}
              {session && authLinks.map(({ to, label }) => (
                <Link
                  key={to}
                  to={to}
                  className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  activeProps={{ className: "bg-muted text-foreground" }}
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {session && <WebSocketStatus />}
            <ModeToggle />
            {session ? (
              <div className="flex items-center gap-3">
                <span className="hidden text-sm text-muted-foreground sm:inline">
                  {session.user.name}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsSignOutOpen(true)}
                >
                  Sign Out
                </Button>
              </div>
            ) : (
              <Link to="/" hash="login">
                <Button variant="default" size="sm">
                  Sign In
                </Button>
              </Link>
            )}
          </div>
        </nav>
      </div>

      <Dialog open={isSignOutOpen} onOpenChange={setIsSignOutOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Sign Out</DialogTitle>
            <DialogDescription>
              Are you sure you want to sign out? You will be redirected to the home page.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleSignOut}>
              Sign Out
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </header>
  );
}
