import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { Menu, X } from "lucide-react";

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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleSignOut = async () => {
    await authClient.signOut();
    setIsSignOutOpen(false);
    setIsMobileMenuOpen(false);
    navigate({ to: "/" });
  };

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

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

  const navLinkClass =
    "rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
  const navLinkActiveClass = "bg-muted text-foreground";

  return (
    <header className="sticky top-0 z-50 w-full">
      <div className="mx-auto max-w-6xl px-3 py-2 sm:px-4 sm:py-3">
        <nav className="glass flex items-center justify-between gap-2 rounded-2xl px-3 py-2.5 sm:px-4">
          <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-8">
            <Link
              to="/"
              className="flex shrink-0 items-center gap-2 font-semibold tracking-tight text-foreground transition-opacity hover:opacity-80"
            >
              <img
                src="/cisco-face-primary.ico"
                alt="TRACE"
                className="h-8 w-8 rounded-lg object-contain"
              />
              <span className="hidden sm:inline">TRACE</span>
            </Link>

            {/* Desktop nav: hidden on mobile */}
            <div className="hidden items-center gap-1 md:flex">
              {publicLinks.map(({ to, label }) => (
                <Link
                  key={to}
                  to={to}
                  activeOptions={{ exact: true }}
                  className={navLinkClass}
                  activeProps={{ className: navLinkActiveClass }}
                >
                  {label}
                </Link>
              ))}
              {session &&
                authLinks.map(({ to, label }) => (
                  <Link
                    key={to}
                    to={to}
                    className={navLinkClass}
                    activeProps={{ className: navLinkActiveClass }}
                  >
                    {label}
                  </Link>
                ))}
            </div>
          </div>

          {/* Right side: actions + hamburger on mobile */}
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {session && <WebSocketStatus />}
            <ModeToggle />
            {session ? (
              <>
                <span className="hidden text-sm text-muted-foreground md:inline">
                  {session.user?.name ?? "User"}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="hidden md:inline-flex"
                  onClick={() => setIsSignOutOpen(true)}
                >
                  Sign Out
                </Button>
              </>
            ) : (
              <Link to="/" hash="login" className="hidden md:block">
                <Button variant="default" size="sm">
                  Sign In
                </Button>
              </Link>
            )}

            {/* Hamburger: visible only on mobile */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label="Open menu"
              onClick={() => setIsMobileMenuOpen(true)}
            >
              <Menu className="size-5" />
            </Button>
          </div>
        </nav>
      </div>

      {/* Mobile menu: slide-in panel */}
      <Dialog open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
        <DialogPopup
          className="!fixed !left-0 !top-0 !h-full !w-full !max-w-[min(320px,85vw)] !-translate-x-0 !-translate-y-0 rounded-r-2xl rounded-l-none border-r border-border/50 bg-card/98 backdrop-blur-xl p-4 shadow-2xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm sm:p-6"
          aria-describedby={undefined}
        >
          <DialogHeader className="flex flex-row items-center justify-between border-b border-border/50 pb-3">
            <DialogTitle className="text-lg">Menu</DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close menu"
              onClick={closeMobileMenu}
            >
              <X className="size-5" />
            </Button>
          </DialogHeader>
          <nav className="flex flex-col gap-1 py-4">
            {publicLinks.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                onClick={closeMobileMenu}
                activeOptions={{ exact: true }}
                className="rounded-lg px-4 py-3 text-base font-medium text-foreground hover:bg-muted"
                activeProps={{ className: "bg-muted text-foreground" }}
              >
                {label}
              </Link>
            ))}
            {session &&
              authLinks.map(({ to, label }) => (
                <Link
                  key={to}
                  to={to}
                  onClick={closeMobileMenu}
                  className="rounded-lg px-4 py-3 text-base font-medium text-foreground hover:bg-muted"
                  activeProps={{ className: "bg-muted text-foreground" }}
                >
                  {label}
                </Link>
              ))}
          </nav>
          {session && (
            <DialogFooter className="mt-auto border-t border-border/50 pt-4">
              <p className="w-full truncate px-4 py-2 text-sm text-muted-foreground">
                {session.user?.name ?? session.user?.email}
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setIsSignOutOpen(true);
                }}
              >
                Sign Out
              </Button>
            </DialogFooter>
          )}
          {!session && (
            <DialogFooter className="mt-auto border-t border-border/50 pt-4">
              <Link to="/" hash="login" onClick={closeMobileMenu} className="w-full">
                <Button variant="default" className="w-full">
                  Sign In
                </Button>
              </Link>
            </DialogFooter>
          )}
        </DialogPopup>
      </Dialog>

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
