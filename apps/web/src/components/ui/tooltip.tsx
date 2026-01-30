import * as React from "react";
import { Tooltip } from "@base-ui/react/tooltip";

import { cn } from "@/lib/utils";

const SHOW_DELAY_MS = 150;
const HIDE_DELAY_MS = 80;

function TooltipProvider({
  children,
  content,
  side = "top",
  className,
}: {
  children: React.ReactNode;
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}) {
  return (
    <Tooltip.Provider delay={SHOW_DELAY_MS} closeDelay={HIDE_DELAY_MS}>
      <Tooltip.Root>
        <Tooltip.Trigger
          delay={SHOW_DELAY_MS}
          closeDelay={HIDE_DELAY_MS}
          className="inline-flex cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-full border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
        >
          {children}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner side={side} sideOffset={6} align="center">
            <Tooltip.Popup
              className={cn(
                "z-50 max-w-xs rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md",
                "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
                "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
                className
              )}
            >
              {content}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

export { TooltipProvider };
