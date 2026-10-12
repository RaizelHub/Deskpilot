import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { Page } from "@/lib/types";
import { errorText } from "@/lib/api";

export function ErrorNotice({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <div className="error-notice" role="alert">
      <span>{errorText(error)}</span>
      {retry && (
        <Button variant="outline" size="sm" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}
export function Loading() {
  return (
    <div className="empty-state" role="status">
      Loading workspace…
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}
export function Field({
  label,
  error,
  children,
  htmlFor,
}: {
  label: string;
  error?: string;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
export function Pagination<T>({
  result,
  page,
  onChange,
}: {
  result: Page<T>;
  page: number;
  onChange: (page: number) => void;
}) {
  const last = result.meta?.last_page ?? result.last_page ?? 1;
  return (
    <div className="pagination">
      <span>
        {result.meta?.total ?? result.total ?? 0} records · Page {page} of{" "}
        {last}
      </span>
      <div className="button-row">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= last}
          onClick={() => onChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
