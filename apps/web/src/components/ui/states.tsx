import {
  type ReactNode,
  useState,
  useEffect,
  useCallback,
  type HTMLAttributes,
} from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Hourglass,
  Inbox,
  Loader2,
  RefreshCw,
  SearchX,
  ShieldAlert,
  WifiOff,
  Save,
  RotateCcw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { errorText } from "@/lib/api";

/* ==========================================================================
   1. EMPTY STATE: Guide user before data exists
   ========================================================================== */

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className = "",
  children,
}: EmptyStateProps) {
  return (
    <div className={`empty-state-card ${className}`} role="region" aria-label={title}>
      <div className="empty-state-icon-box" aria-hidden="true">
        {icon ?? <Inbox className="w-6 h-6 text-muted" />}
      </div>
      <h3 className="empty-state-title">{title}</h3>
      {description && <p className="empty-state-description">{description}</p>}
      {(action || secondaryAction) && (
        <div className="empty-state-actions">
          {action}
          {secondaryAction}
        </div>
      )}
      {children}
    </div>
  );
}

/* ==========================================================================
   2. LOADING STATE: Perceived speed matters; keep wait active
   ========================================================================== */

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export function Skeleton({ className = "", style, ...props }: SkeletonProps) {
  return (
    <div
      className={`skeleton-shimmer ${className}`}
      style={style}
      aria-hidden="true"
      {...props}
    />
  );
}

export function TableSkeleton({
  rows = 5,
  columns = 5,
}: {
  rows?: number;
  columns?: number;
}) {
  const cellWidths = ["70%", "85%", "55%", "90%", "65%", "45%", "80%"];
  return (
    <div className="table-responsive-container" role="status" aria-label="Loading data">
      <table className="tickets-data-table table-skeleton">
        <thead>
          <tr>
            {Array.from({ length: columns }).map((_, i) => (
              <th key={i}>
                <Skeleton className="h-4 w-24" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: columns }).map((_, c) => (
                <td key={c}>
                  <Skeleton
                    className="h-4"
                    style={{ width: cellWidths[(r * 2 + c) % cellWidths.length] }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }} role="status">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card-skeleton-box p-4 rounded-lg border border-border bg-surface">
          <Skeleton className="h-4 w-1/3 mb-3" />
          <Skeleton className="h-7 w-2/3 mb-2" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function ActiveLoading({
  text = "Loading workspace…",
  isSlow = false,
  onRetry,
}: {
  text?: string;
  isSlow?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className="empty-state" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
        <span>{text}</span>
      </div>
      {isSlow && (
        <div className="slow-network-notice mt-2">
          <Hourglass className="w-4 h-4 animate-pulse" />
          <span>Taking longer than expected…</span>
          {onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              Retry now
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   3. ERROR STATE: Clear cause plus actionable recovery
   ========================================================================== */

export interface ErrorStateProps {
  title?: string;
  error?: unknown;
  message?: string;
  retry?: () => void;
  action?: ReactNode;
  className?: string;
}

export function ErrorState({
  title = "Something went wrong",
  error,
  message,
  retry,
  action,
  className = "",
}: ErrorStateProps) {
  const detail = message ?? (error ? errorText(error) : "An unexpected error occurred.");
  return (
    <div className={`error-state-card ${className}`} role="alert">
      <div className="error-state-icon-box" aria-hidden="true">
        <AlertTriangle className="w-6 h-6 text-error" />
      </div>
      <h3 className="empty-state-title text-error">{title}</h3>
      <p className="empty-state-description">{detail}</p>
      <div className="empty-state-actions">
        {retry && (
          <Button variant="outline" size="sm" onClick={retry}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Try again
          </Button>
        )}
        {action}
      </div>
    </div>
  );
}

export function ErrorNotice({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <div className="error-notice" role="alert">
      <AlertCircle className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1">{errorText(error)}</span>
      {retry && (
        <Button variant="outline" size="sm" onClick={retry}>
          <RefreshCw className="w-3.5 h-3.5 mr-1" />
          Try again
        </Button>
      )}
    </div>
  );
}

/* ==========================================================================
   4. OFFLINE STATE: Inform state; prevent blank views
   ========================================================================== */

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}

export function OfflineBanner({
  onRefresh,
}: {
  onRefresh?: () => void;
}) {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <aside className="offline-banner" role="status" aria-live="assertive">
      <div className="offline-banner-content">
        <WifiOff className="w-4 h-4" />
        <span>
          <strong>Offline Mode:</strong> You are currently disconnected from the internet. Viewing cached workspace data.
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onRefresh ?? (() => window.location.reload())}
      >
        <RefreshCw className="w-3.5 h-3.5 mr-1" />
        Check Connection
      </Button>
    </aside>
  );
}

export function OfflineState({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="empty-state-card" role="alert">
      <div className="empty-state-icon-box text-warning" aria-hidden="true">
        <WifiOff className="w-6 h-6" />
      </div>
      <h3 className="empty-state-title">You're offline</h3>
      <p className="empty-state-description">
        This view requires an active network connection to communicate with DeskPilot agents and servers.
      </p>
      {onRetry && (
        <div className="empty-state-actions">
          <Button size="sm" onClick={onRetry}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Reconnect
          </Button>
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   5. SLOW NETWORK: Show incremental progress, avoid frozen spinners
   ========================================================================== */

export function useSlowNetwork(isLoading: boolean, thresholdMs = 3000) {
  const [isSlow, setIsSlow] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setIsSlow(false);
      return;
    }

    const timer = setTimeout(() => {
      setIsSlow(true);
    }, thresholdMs);

    return () => clearTimeout(timer);
  }, [isLoading, thresholdMs]);

  return isSlow;
}

export function SlowNetworkNotice({
  message = "Loading is taking longer than usual. Please wait or retry.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="slow-network-notice" role="status">
      <Hourglass className="w-4 h-4 animate-pulse flex-shrink-0" />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/* ==========================================================================
   6. ZERO SEARCH RESULTS: Provide suggestions/alternatives, avoid dead ends
   ========================================================================== */

export interface ZeroSearchResultsProps {
  query: string;
  onClear?: () => void;
  suggestions?: string[];
  title?: string;
  className?: string;
}

export function ZeroSearchResults({
  query,
  onClear,
  suggestions,
  title,
  className = "",
}: ZeroSearchResultsProps) {
  return (
    <div className={`zero-search-card ${className}`} role="status">
      <div className="zero-search-icon-box" aria-hidden="true">
        <SearchX className="w-6 h-6" />
      </div>
      <h3 className="empty-state-title">
        {title ?? (query ? `No results found for “${query}”` : "No matching records found")}
      </h3>
      <p className="empty-state-description">
        We couldn't find any matches with the current filter criteria. Check for typos or try clearing active filters.
      </p>
      {suggestions && suggestions.length > 0 && (
        <div className="text-xs text-muted flex items-center gap-1.5 flex-wrap justify-center mt-1">
          <span>Suggestions:</span>
          {suggestions.map((s, idx) => (
            <span key={idx} className="font-mono bg-elevated px-1.5 py-0.5 rounded">
              {s}
            </span>
          ))}
        </div>
      )}
      {onClear && (
        <div className="empty-state-actions">
          <Button variant="outline" size="sm" onClick={onClear}>
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            Clear search & filters
          </Button>
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   7. PERMISSION DENIED: Explain rationale and recovery route
   ========================================================================== */

export interface PermissionDeniedProps {
  permission?: string;
  role?: string;
  title?: string;
  description?: string;
  onBack?: () => void;
  onRequestAccess?: () => void;
}

export function PermissionDenied({
  permission,
  role,
  title = "Access Restricted",
  description,
  onBack,
  onRequestAccess,
}: PermissionDeniedProps) {
  const detail =
    description ??
    (permission
      ? `You lack the “${permission}” permission required to perform this action or view this resource.`
      : role
        ? `This section is restricted to the “${role}” role.`
        : "You do not have sufficient permissions to view this content.");

  return (
    <div className="permission-denied-card" role="alert">
      <div className="permission-denied-icon-box" aria-hidden="true">
        <ShieldAlert className="w-6 h-6" />
      </div>
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-description">{detail}</p>
      <div className="empty-state-actions">
        {onBack && (
          <Button variant="outline" size="sm" onClick={onBack}>
            Go back
          </Button>
        )}
        {onRequestAccess ? (
          <Button size="sm" onClick={onRequestAccess}>
            Request Access
          </Button>
        ) : (
          <span className="text-xs text-muted">Contact your workspace administrator to request permission.</span>
        )}
      </div>
    </div>
  );
}

/* ==========================================================================
   8. SESSION EXPIRY: Persist draft state before auth teardown
   ========================================================================== */

/**
 * Persists unsaved form draft state to sessionStorage so work is never lost
 * when auth tokens expire or the browser is inadvertently refreshed.
 */
export function useDraftPersist<T>(
  key: string,
  currentValues: T,
  isDirty = true
) {
  const storageKey = `deskpilot:draft:${key}`;

  // Save draft whenever values change and form is dirty
  useEffect(() => {
    if (!isDirty || !currentValues) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(currentValues));
    } catch {
      // Storage quota or private browsing safeguard
    }
  }, [storageKey, currentValues, isDirty]);

  const getSavedDraft = useCallback((): T | null => {
    try {
      const item = sessionStorage.getItem(storageKey);
      return item ? (JSON.parse(item) as T) : null;
    } catch {
      return null;
    }
  }, [storageKey]);

  const clearDraft = useCallback(() => {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  }, [storageKey]);

  return { getSavedDraft, clearDraft };
}

export function SessionExpiredNotice({
  onReauth,
  draftSaved = true,
}: {
  onReauth?: () => void;
  draftSaved?: boolean;
}) {
  return (
    <div className="session-expired-notice" role="alert">
      <div className="flex items-center gap-3">
        <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0" />
        <div className="text-xs">
          <strong>Session expired:</strong> Your session timed out.{" "}
          {draftSaved && (
            <span className="inline-flex items-center gap-1 text-success font-medium">
              <Save className="w-3 h-3" /> Draft preserved safely.
            </span>
          )}
        </div>
      </div>
      {onReauth && (
        <Button size="sm" onClick={onReauth}>
          Sign in to resume
        </Button>
      )}
    </div>
  );
}

/* ==========================================================================
   9. FORM VALIDATION: Inline error placement at exact input field
   ========================================================================== */

export interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  htmlFor: string;
  children: ReactNode;
  className?: string;
}

export function Field({
  label,
  error,
  hint,
  required,
  htmlFor,
  children,
  className = "",
}: FieldProps) {
  const errorId = `${htmlFor}-error`;
  const hintId = `${htmlFor}-hint`;

  return (
    <div className={`field ${className}`}>
      <label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-error ml-1" aria-hidden="true">*</span>}
      </label>
      {hint && (
        <small id={hintId} className="text-muted block mb-1">
          {hint}
        </small>
      )}
      {children}
      {error && (
        <div id={errorId} className="field-error-wrapper" role="alert" aria-live="polite">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="field-error">{error}</span>
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   10. SUCCESS STATE: Acknowledge completion, provide clear next step
   ========================================================================== */

export interface SuccessNoticeProps {
  title?: string;
  message: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
}

export function SuccessNotice({
  title,
  message,
  action,
  onDismiss,
}: SuccessNoticeProps) {
  return (
    <div className="success-notice flex items-center justify-between gap-3" role="status" aria-live="polite">
      <div className="flex items-center gap-2.5">
        <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
        <div>
          {title && <strong>{title}: </strong>}
          <span>{message}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {action}
        {onDismiss && (
          <button
            type="button"
            className="text-muted hover:text-foreground text-xs"
            onClick={onDismiss}
            aria-label="Dismiss notice"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

export interface SuccessStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  secondaryAction?: ReactNode;
}

export function SuccessState({
  icon,
  title,
  description,
  action,
  secondaryAction,
}: SuccessStateProps) {
  return (
    <div className="success-state-card" role="status" aria-live="polite">
      <div className="success-state-icon-box" aria-hidden="true">
        {icon ?? <CheckCircle2 className="w-6 h-6 text-success" />}
      </div>
      <h3 className="empty-state-title">{title}</h3>
      {description && <p className="empty-state-description">{description}</p>}
      {(action || secondaryAction) && (
        <div className="empty-state-actions">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
