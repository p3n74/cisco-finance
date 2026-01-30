import * as React from "react";

import { cn } from "@/lib/utils";

function Card({
  className,
  variant = "glass",
  ...props
}: React.ComponentProps<"div"> & { variant?: "glass" | "solid" | "subtle" }) {
  return (
    <div
      data-slot="card"
      className={cn(
        "flex min-w-0 flex-col gap-4 rounded-2xl p-4 text-card-foreground transition-all duration-200 sm:p-5",
        variant === "glass" && "glass hover:shadow-lg",
        variant === "solid" && "bg-card border border-border shadow-sm",
        variant === "subtle" && "glass-subtle",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "flex flex-col gap-1.5",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("text-base font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("self-start", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("flex flex-col gap-3", className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center gap-3 pt-3 border-t border-border/50",
        className,
      )}
      {...props}
    />
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
