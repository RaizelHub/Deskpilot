import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, json } from "@/lib/api";
import { date } from "@/lib/utils";
import type { Page } from "@/lib/types";
import { useSession } from "@/features/auth/session";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  Empty,
  ErrorNotice,
  Field,
  Loading,
  Pagination,
} from "@/components/shared";

interface Alert {
  id: string;
  kind: string;
  resource: string;
  severity: string;
  status: string;
  summary: string;
  value: number | null;
  opened_at: string;
  observed_at: string | null;
  recovered_at: string | null;
  close_reason: string | null;
  acknowledged_at: string | null;
  acknowledger: { name: string } | null;
  occurrences: number;
  device: { id: string; name: string };
  ticket: { id: string; number: string; status: string } | null;
}
interface Stats {
  stale: boolean;
  active: number;
  critical: number;
  acknowledged: number;
  recovered_today: number;
  evaluated_at: string | null;
}
interface Rule {
  kind: string;
  warning: number;
  critical: number | null;
  enabled: boolean;
  auto_incident: boolean;
  sustain_seconds: number;
  cooldown_seconds: number;
  version: number;
}
const names: Record<string, string> = {
  offline: "Device offline",
  disk: "Storage usage",
  cpu: "CPU usage",
  memory: "Memory usage",
};
function Status({ value }: { value: string }) {
  return (
    <span className={`monitor-status ${value}`}>
      {value.replaceAll("_", " ")}
    </span>
  );
}
export function MonitoringSummary() {
  const session = useSession();
  const allowed =
    session.data?.permissions.includes("monitoring.view") ?? false;
  const q = useQuery({
    queryKey: ["monitoring-statistics"],
    queryFn: () => api<Stats>("/monitoring-statistics"),
    enabled: allowed,
    refetchInterval: 30000,
  });
  if (!allowed) return null;
  if (q.error) return <ErrorNotice error={q.error} />;
  if (!q.data) return <Loading />;
  const s = q.data;
  const late = s.stale;
  return (
    <section className="monitor-summary">
      <div className="panel-header">
        <div>
          <h2>Device health alerts</h2>
          <p className="footnote">
            {s.evaluated_at
              ? `Last evaluated ${date(s.evaluated_at)}`
              : "Waiting for the first monitoring evaluation"}
          </p>
        </div>
        <Link to="/alerts" className="text-link">
          View alerts →
        </Link>
      </div>
      {late && (
        <p role="status" className="error-notice">
          Monitoring updates are overdue. The server scheduler must be running;
          these counts may be stale.
        </p>
      )}
      <div className="metric-grid">
        {[
          ["Active alerts", s.active, "Conditions needing attention"],
          ["Critical", s.critical, "Highest observed severity"],
          ["Acknowledged", s.acknowledged, "Being investigated"],
          [
            "Recovered today",
            s.recovered_today,
            "Fresh readings confirm recovery",
          ],
        ].map(([name, value, note]) => (
          <article className="metric" key={name}>
            <span>{name}</span>
            <strong>{value}</strong>
            <small>{note}</small>
          </article>
        ))}
      </div>
    </section>
  );
}
export function DeviceHealth({ id }: { id: string }) {
  const session = useSession();
  const allowed =
    session.data?.permissions.includes("monitoring.view") ?? false;
  const q = useQuery({
    queryKey: ["device-health", id],
    queryFn: () =>
      api<{
        status: string;
        evaluated_at: string | null;
        inventory_at: string | null;
        active_alerts: number;
      }>(`/devices/${id}/health`),
    enabled: allowed,
    refetchInterval: 30000,
  });
  if (!allowed) return null;
  if (q.error) return <ErrorNotice error={q.error} />;
  if (!q.data) return <Loading />;
  return (
    <section className="panel ticket-card monitor-device">
      <div>
        <h2>
          Device health <Status value={q.data.status} />
        </h2>
        <p>
          {q.data.active_alerts} active alerts ·{" "}
          {q.data.evaluated_at
            ? `Evaluated ${date(q.data.evaluated_at)}`
            : "Not evaluated yet"}
        </p>
        <p className="footnote">
          Health covers heartbeat, CPU, memory and storage. Unknown means
          incomplete or stale coverage. Disk readings use the latest inventory
          snapshot.
        </p>
      </div>
      <Link className="text-link" to={`/alerts?device_id=${id}`}>
        Review device alerts →
      </Link>
    </section>
  );
}
function RuleEditor({ rule, close }: { rule: Rule; close: () => void }) {
  const client = useQueryClient();
  const [form, setForm] = useState(rule);
  const save = useMutation({
    mutationFn: () =>
      api(
        `/alert-rules/${rule.kind}`,
        json("PUT", {
          enabled: form.enabled,
          auto_incident: form.auto_incident,
          warning: form.warning,
          ...(rule.kind !== "offline" ? { critical: form.critical } : {}),
          sustain_seconds: form.sustain_seconds,
          cooldown_seconds: form.cooldown_seconds,
          version: rule.version,
        }),
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["alert-rules"] });
      close();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={close}
      title={`Edit ${names[rule.kind].toLowerCase()}`}
      description="Changes apply on the next server evaluation. Disabling closes the condition as unmonitored; it does not resolve its ticket."
    >
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label className="check-label">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          />
          Enable this rule
        </label>
        <Field
          label={
            rule.kind === "offline"
              ? "Alert after (seconds without heartbeat)"
              : "Warning above (%)"
          }
          htmlFor="rule-warning"
        >
          <input
            id="rule-warning"
            type="number"
            required
            min={rule.kind === "offline" ? 120 : 10}
            max={rule.kind === "offline" ? 86400 : 98}
            value={form.warning}
            onChange={(e) =>
              setForm({ ...form, warning: Number(e.target.value) })
            }
          />
        </Field>
        {rule.kind !== "offline" && (
          <>
            <Field label="Critical above (%)" htmlFor="rule-critical">
              <input
                id="rule-critical"
                type="number"
                required
                min={form.warning + 1}
                max={100}
                value={form.critical ?? 95}
                onChange={(e) =>
                  setForm({ ...form, critical: Number(e.target.value) })
                }
              />
            </Field>
            <Field label="Sustained duration (seconds)" htmlFor="rule-sustain">
              <input
                id="rule-sustain"
                type="number"
                required
                min={0}
                max={3600}
                value={form.sustain_seconds}
                onChange={(e) =>
                  setForm({ ...form, sustain_seconds: Number(e.target.value) })
                }
              />
            </Field>
            <p className="footnote">
              A duration above zero also requires three distinct fresh samples.
              Disk snapshots arrive about every 15 minutes. Recovery needs usage
              five percentage points below the warning threshold.
            </p>
          </>
        )}
        <Field label="Incident cooldown (seconds)" htmlFor="rule-cooldown">
          <input
            id="rule-cooldown"
            type="number"
            required
            min={60}
            max={86400}
            value={form.cooldown_seconds}
            onChange={(e) =>
              setForm({ ...form, cooldown_seconds: Number(e.target.value) })
            }
          />
        </Field>
        <label className="check-label">
          <input
            type="checkbox"
            checked={form.auto_incident}
            onChange={(e) =>
              setForm({ ...form, auto_incident: e.target.checked })
            }
          />
          Automatically create an incident
        </label>
        <p className="footnote">
          A recurrence during cooldown reuses its alert and ticket. Recovery
          never closes a technician’s ticket.
        </p>
        {save.error && <ErrorNotice error={save.error} />}
        <Button icon="save" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save rule"}
        </Button>
      </form>
    </Dialog>
  );
}
export function Monitoring() {
  const [params, setParams] = useSearchParams();
  const deviceId = params.get("device_id") ?? "";
  const session = useSession();
  const client = useQueryClient();
  const [status, setStatus] = useState("active");
  const [kind, setKind] = useState("");
  const [severity, setSeverity] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Rule | null>(null);
  const q = useQuery({
    queryKey: ["alerts", deviceId, status, kind, severity, page],
    queryFn: () =>
      api<Page<Alert>>(
        `/alerts?${new URLSearchParams({ status, ...(kind ? { kind } : {}), ...(severity ? { severity } : {}), ...(deviceId ? { device_id: deviceId } : {}), page: String(page) })}`,
      ),
    refetchInterval: 15000,
  });
  const rules = useQuery({
    queryKey: ["alert-rules"],
    queryFn: () => api<{ data: Rule[] }>("/alert-rules"),
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["alerts"] });
    void client.invalidateQueries({ queryKey: ["monitoring-statistics"] });
  };
  const ack = useMutation({
    mutationFn: (id: string) => api(`/alerts/${id}/acknowledge`, json("POST")),
    onSuccess: refresh,
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">MONITORING</span>
          <h1>Alerts & device health</h1>
          <p>
            Spot sustained problems, track recovery, and keep incidents
            organized.
          </p>
        </div>
        <Button icon="refresh" variant="outline" onClick={refresh}>
          Refresh
        </Button>
      </div>
      <MonitoringSummary />
      <section className="panel monitor-alerts">
        <div className="panel-header">
          <h2>{deviceId ? "Device alerts" : "Alert inbox"}</h2>
          {deviceId && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setParams({});
                setPage(1);
              }}
            >
              Show all devices
            </Button>
          )}
        </div>
        <div className="monitor-filters">
          <Field label="Status" htmlFor="alert-status">
            <select
              id="alert-status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              {[
                "active",
                "open",
                "acknowledged",
                "recovered",
                "closed",
                "all",
              ].map((v) => (
                <option key={v} value={v}>
                  {v[0].toUpperCase() + v.slice(1)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Condition" htmlFor="alert-kind">
            <select
              id="alert-kind"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All conditions</option>
              {Object.entries(names).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Severity" htmlFor="alert-severity">
            <select
              id="alert-severity"
              value={severity}
              onChange={(e) => {
                setSeverity(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All severities</option>
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
            </select>
          </Field>
        </div>
        {ack.error && <ErrorNotice error={ack.error} />}
        {q.isPending ? (
          <Loading />
        ) : q.error ? (
          <ErrorNotice error={q.error} retry={() => void q.refetch()} />
        ) : !q.data.data.length ? (
          <Empty>
            No alerts match these filters. Check the evaluation time above for
            monitoring freshness.
          </Empty>
        ) : (
          q.data.data.map((a) => (
            <article key={a.id} className="monitor-alert">
              <div className="monitor-alert-heading">
                <div>
                  <Link to={`/devices/${a.device.id}`} className="text-link">
                    {a.device.name}
                  </Link>
                  <h3>
                    {names[a.kind]}
                    {a.resource ? ` · ${a.resource}` : ""}
                  </h3>
                </div>
                <div className="button-row">
                  <Status value={a.severity} />
                  <Status value={a.status} />
                </div>
              </div>
              <p>{a.summary}</p>
              <p className="footnote">
                Opened {date(a.opened_at)} · Last observation{" "}
                {a.observed_at ? date(a.observed_at) : "Not observed"} ·{" "}
                {a.occurrences} occurrence
                {a.occurrences === 1 ? "" : "s"}
              </p>
              {a.acknowledger && (
                <p className="footnote">
                  Acknowledged by {a.acknowledger.name} ·{" "}
                  {a.acknowledged_at ? date(a.acknowledged_at) : ""}
                </p>
              )}
              {a.recovered_at && (
                <p className="footnote">
                  {a.close_reason?.replaceAll("_", " ")} ·{" "}
                  {date(a.recovered_at)}
                </p>
              )}
              <div className="monitor-alert-actions">
                {a.ticket ? (
                  <Link to={`/tickets/${a.ticket.id}`} className="text-link">
                    {a.ticket.number} · {a.ticket.status.replaceAll("_", " ")} →
                  </Link>
                ) : (
                  <span className="footnote">No linked incident visible</span>
                )}
                {a.status === "open" &&
                  session.data?.permissions.includes(
                    "monitoring.acknowledge",
                  ) && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={ack.isPending}
                      onClick={() => ack.mutate(a.id)}
                    >
                      Acknowledge
                    </Button>
                  )}
              </div>
            </article>
          ))
        )}
        {q.data && (
          <Pagination result={q.data} page={page} onChange={setPage} />
        )}
      </section>
      <section className="panel monitor-rules">
        <div className="panel-header">
          <div>
            <h2>Monitoring rules</h2>
            <p className="footnote">
              Evaluated every minute. Critical severity is retained until
              recovery.
            </p>
          </div>
        </div>
        {rules.error ? (
          <ErrorNotice error={rules.error} />
        ) : rules.isPending ? (
          <Loading />
        ) : (
          <div className="monitor-rule-grid">
            {rules.data.data.map((r) => (
              <article key={r.kind}>
                <div className="monitor-alert-heading">
                  <h3>{names[r.kind]}</h3>
                  <Status value={r.enabled ? "enabled" : "disabled"} />
                </div>
                <strong>
                  {r.kind === "offline"
                    ? `After ${r.warning}s without a heartbeat`
                    : `Warning > ${r.warning}% · Critical > ${r.critical}%`}
                </strong>
                <p>
                  {r.sustain_seconds
                    ? `Sustained for ${r.sustain_seconds}s`
                    : "First qualifying observation"}{" "}
                  · {r.cooldown_seconds / 60} min cooldown
                </p>
                <p className="footnote">
                  Automatic incidents {r.auto_incident ? "on" : "off"}
                </p>
                {session.data?.permissions.includes("monitoring.manage") && (
                  <Button
                    icon="edit"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing(r)}
                  >
                    Edit {names[r.kind].toLowerCase()}
                  </Button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
      {editing && <RuleEditor rule={editing} close={() => setEditing(null)} />}
    </>
  );
}
