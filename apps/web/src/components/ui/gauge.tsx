import { cn } from "@/lib/utils";

export function RmmGauge({
  label,
  value,
  unit = "%",
  max = 100,
  className,
}: {
  label?: string;
  value: number | null | undefined;
  unit?: string;
  max?: number;
  className?: string;
}) {
  if (value == null) {
    return (
      <div className={cn("rmm-gauge-empty", className)}>
        {label && <span className="rmm-gauge-label">{label}</span>}
        <span className="rmm-gauge-na">—</span>
      </div>
    );
  }

  const percent = Math.min(100, Math.max(0, (value / max) * 100));
  const tone =
    percent >= 90 ? "critical" : percent >= 75 ? "warning" : "normal";

  return (
    <div className={cn("rmm-gauge-container", className)}>
      <div className="rmm-gauge-header">
        {label && <span className="rmm-gauge-label">{label}</span>}
        <span className={cn("rmm-gauge-value", `tone-${tone}`)}>
          {Math.round(value)}
          {unit}
        </span>
      </div>
      <div className="rmm-gauge-track">
        <div
          className={cn("rmm-gauge-bar", `tone-${tone}`)}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function MiniBar({
  value,
  max = 100,
  title,
}: {
  value: number | null | undefined;
  max?: number;
  title?: string;
}) {
  if (value == null) return <span className="text-muted text-xs">—</span>;
  const pct = Math.min(100, Math.max(2, (value / max) * 100));
  const tone = pct >= 90 ? "critical" : pct >= 75 ? "warning" : "normal";

  return (
    <div className="mini-bar-wrapper" title={title ?? `${Math.round(value)}%`}>
      <div className="mini-bar-track">
        <div
          className={cn("mini-bar-fill", `tone-${tone}`)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cn("mini-bar-text", `tone-${tone}`)}>
        {Math.round(value)}%
      </span>
    </div>
  );
}
