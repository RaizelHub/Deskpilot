import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Page } from "@/lib/types";

// Re-export all dedicated Core UI State components and hooks
export {
  // 1. Empty State
  EmptyState,
  type EmptyStateProps,
  // 2. Loading State & Skeletons
  Skeleton,
  TableSkeleton,
  CardSkeleton,
  ActiveLoading,
  type SkeletonProps,
  // 3. Error State
  ErrorState,
  ErrorNotice,
  type ErrorStateProps,
  // 4. Offline State
  OfflineBanner,
  OfflineState,
  useOnlineStatus,
  // 5. Slow Network
  SlowNetworkNotice,
  useSlowNetwork,
  // 6. Zero Search Results
  ZeroSearchResults,
  type ZeroSearchResultsProps,
  // 7. Permission Denied
  PermissionDenied,
  type PermissionDeniedProps,
  // 8. Session Expiry & Draft Preservation
  SessionExpiredNotice,
  useDraftPersist,
  // 9. Form Validation
  Field,
  type FieldProps,
  // 10. Success State
  SuccessNotice,
  SuccessState,
  type SuccessNoticeProps,
  type SuccessStateProps,
} from "./ui/states";

/**
 * Backward-compatible Loading with animated spinner and active perception.
 */
export function Loading({ text = "Loading workspace…" }: { text?: string }) {
  return (
    <div className="empty-state" role="status" aria-live="polite">
      <div className="flex items-center gap-2.5">
        <Loader2 className="w-4 h-4 animate-spin text-primary flex-shrink-0" />
        <span>{text}</span>
      </div>
    </div>
  );
}

/**
 * Backward-compatible Empty component.
 */
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
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
