import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BadgeVariant =
  | "default"
  | "primary"
  | "success"
  | "warning"
  | "destructive"
  | "info"
  | "outline"
  | "secondary";

export function Badge({
  children,
  variant = "default",
  dot = false,
  className,
}: {
  children: ReactNode;
  variant?: BadgeVariant;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("status-badge", `badge-${variant}`, className)}>
      {dot && <span className="badge-dot-indicator" />}
      {children}
    </span>
  );
}
