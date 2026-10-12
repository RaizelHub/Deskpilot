import * as Primitive from "@radix-ui/react-dialog";

import type { ReactNode } from "react";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Portal>
        <Primitive.Overlay className="dialog-overlay" />
        <Primitive.Content className="dialog-content">
          <Primitive.Title>{title}</Primitive.Title>
          <Primitive.Description>{description}</Primitive.Description>
          <Primitive.Close className="dialog-close" aria-label="Close dialog">
            Close
          </Primitive.Close>
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
