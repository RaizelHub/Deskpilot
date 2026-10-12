import {
  Trash2,
  Pencil,
  Upload,
  Download,
  RefreshCw,
  Plus,
  Save,
  Copy,
  X,
} from "lucide-react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const actionIcons = {
  delete: Trash2,
  edit: Pencil,
  upload: Upload,
  download: Download,
  refresh: RefreshCw,
  add: Plus,
  save: Save,
  copy: Copy,
  close: X,
};

const variants = cva("button", {
  variants: {
    variant: {
      default: "button-primary",
      outline: "button-outline",
      ghost: "button-ghost",
      destructive: "button-danger",
    },
    size: { default: "", sm: "button-small", icon: "button-icon" },
  },
  defaultVariants: { variant: "default", size: "default" },
});
export function Button({
  className,
  variant,
  size,
  asChild = false,
  icon,
  ...props
}: ComponentProps<"button"> &
  VariantProps<typeof variants> & {
    asChild?: boolean;
    icon?: keyof typeof actionIcons;
  }) {
  const Component = asChild ? Slot : "button";
  const Icon = icon ? actionIcons[icon] : null;
  return (
    <Component
      className={cn(variants({ variant, size }), className)}
      title={size === "icon" ? props["aria-label"] : undefined}
      {...props}
    >
      {asChild ? (
        props.children
      ) : (
        <>
          {Icon && (
            <Icon size={16} aria-hidden="true" className="action-icon" />
          )}
          {size === "icon" && !Icon
            ? (props["aria-label"] ?? props.title ?? "Open")
            : size === "icon"
              ? null
              : props.children}
        </>
      )}
    </Component>
  );
}
