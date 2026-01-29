import { Link } from "@tanstack/react-router";

import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

export default function Header() {
  const links = [
    { to: "/", label: "Home" },
    { to: "/dashboard", label: "Dashboard" },
    { to: "/accounts", label: "Accounts" },
  ] as const;

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <Link to="/" className="text-sm font-semibold tracking-[0.2em] uppercase">
            Cisco Finance
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            {links.map(({ to, label }) => {
              const isHome = to === "/";
              return (
                <Link
                  key={to}
                  to={to}
                  activeOptions={isHome ? { exact: true } : undefined}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  activeProps={{ className: "text-foreground" }}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <ModeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
