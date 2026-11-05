import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, json } from "@/lib/api";
import { date } from "@/lib/utils";
import type { Page } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Empty,
  ErrorNotice,
  Field,
  Loading,
  Pagination,
} from "@/components/shared";

interface Check {
  name: string;
  status: string;
  detail: string;
  duration_ms?: number;
}
interface Run {
  id: string;
  command: string;
  reason: string;
  status: string;
  summary: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  attempts: number;
  ticket_id: string | null;
  requester: { name: string };
  result: Check[] | null;
}
interface CatalogItem {
  command: string;
  name: string;
  description: string;
}
const active = ["requested", "accepted", "running"];
export function Diagnostics() {
  const { id } = useParams();
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [command, setCommand] = useState("network.ping_gateway");
  const [reason, setReason] = useState("");
  const [ticket, setTicket] = useState("");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [filter, setFilter] = useState<"all" | "attention" | "passed">("all");
  const [copied, setCopied] = useState(false);
  const device = useQuery({
    queryKey: ["device", id],
    queryFn: () =>
      api<{ data: { name: string; state: string; agent_version: string } }>(
        `/devices/${id}`,
      ),
    refetchInterval: 15000,
  });
  const catalog = useQuery({
    queryKey: ["diagnostic-catalog"],
    queryFn: () => api<{ data: CatalogItem[] }>("/diagnostic-catalog"),
  });
  const runs = useQuery({
    queryKey: ["diagnostics", id, page],
    queryFn: () => api<Page<Run>>(`/devices/${id}/diagnostics?page=${page}`),
    refetchInterval: 5000,
  });
  const refresh = () =>
    client.invalidateQueries({ queryKey: ["diagnostics", id] });
  const request = useMutation({
    mutationFn: () =>
      api<{ data: Run }>(
        `/devices/${id}/diagnostics`,
        json("POST", {
          command,
          reason: reason.trim(),
          ticket_id: ticket.trim() || null,
          request_key: requestKey,
        }),
      ),
    onSuccess: (r) => {
      setSelected(r.data.id);
      setPage(1);
      setRequestKey(crypto.randomUUID());
      void refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: (runId: string) =>
      api(`/devices/${id}/diagnostics/${runId}/cancel`, json("POST")),
    onSuccess: refresh,
  });
  const change = () => {
    setRequestKey(crypto.randomUUID());
    request.reset();
  };
  if (device.isPending || catalog.isPending) return <Loading />;
  if (device.error || catalog.error)
    return <ErrorNotice error={device.error || catalog.error} />;
  const d = device.data!.data;
  const items = catalog.data!.data;
  const current =
    runs.data?.data.find((r) => r.id === selected) ?? runs.data?.data[0];
  const title = (key: string) =>
    items.find((c) => c.command === key)?.name ?? key;
  const currentChecks = current?.result ?? [];
  const failCount = currentChecks.filter((c) => c.status === "fail").length;
  const warningCount = currentChecks.filter((c) => c.status === "warning").length;
  const filteredChecks = currentChecks.filter((c) => {
    if (filter === "attention") return c.status === "fail" || c.status === "warning";
    if (filter === "passed") return c.status === "pass" || c.status === "info";
    return true;
  });
  const sortedChecks = [...filteredChecks].sort((a, b) => {
    const score = (s: string) => (s === "fail" ? 0 : s === "warning" ? 1 : 2);
    return score(a.status) - score(b.status);
  });
  const copySummary = () => {
    if (!current) return;
    const lines = [
      "DeskPilot Diagnostic Report",
      `Device: ${d.name}`,
      `Check: ${title(current.command)} (${current.command})`,
      `Status: ${current.status.toUpperCase()}`,
      `Summary: ${current.summary}`,
      `Reason: ${current.reason}`,
      `Requested by: ${current.requester.name} on ${date(current.created_at)}`,
      current.duration_ms !== null ? `Duration: ${(current.duration_ms / 1000).toFixed(2)}s` : null,
      current.ticket_id ? `Ticket: ${current.ticket_id}` : null,
      "",
      `Checks (${currentChecks.length} total):`,
      ...currentChecks.map((c) => `[${c.status.toUpperCase()}] ${c.name}: ${c.detail}`),
    ].filter((line) => line !== null).join("\n");

    void navigator.clipboard.writeText(lines).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  const ready =
    d.state === "online" &&
    /^\d+\.\d+\.\d+$/.test(d.agent_version) &&
    (Number(d.agent_version.split(".")[0]) > 0 ||
      Number(d.agent_version.split(".")[1]) >= 4);
  return (
    <>
      <div className="page-heading">
        <div>
          <Link to={`/devices/${id}`} className="eyebrow">
            ← {d.name}
          </Link>
          <h1>Diagnostics</h1>
          <p>Run a focused check and review what the device reports.</p>
        </div>
        <span
          className={`diagnostic-status ${d.state === "online" ? "succeeded" : "failed"}`}
        >
          {d.state}
        </span>
      </div>
      <div className="diagnostic-layout">
        <section className="panel ticket-card diagnostic-request">
          <h2>Run a check</h2>
          <p className="footnote">
            Read-only checks · Usually under 30 seconds
          </p>
          {!ready && (
            <p role="status" className="error-notice">
              An online device with agent 0.4.0 or later is required.
            </p>
          )}
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              request.mutate();
            }}
          >
            <Field label="Diagnostic check" htmlFor="diagnostic-command">
              <select
                id="diagnostic-command"
                value={command}
                disabled={request.isPending}
                onChange={(e) => {
                  setCommand(e.target.value);
                  change();
                }}
              >
                {items.map((c) => (
                  <option key={c.command} value={c.command}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <p className="diagnostic-description">
              {items.find((c) => c.command === command)?.description}
            </p>
            <Field label="Reason for this check" htmlFor="diagnostic-reason">
              <textarea
                id="diagnostic-reason"
                required
                minLength={3}
                maxLength={500}
                value={reason}
                disabled={request.isPending}
                placeholder="What are you investigating?"
                onChange={(e) => {
                  setReason(e.target.value);
                  change();
                }}
              />
            </Field>
            <Field label="Ticket ID (optional)" htmlFor="diagnostic-ticket">
              <input
                id="diagnostic-ticket"
                value={ticket}
                disabled={request.isPending}
                placeholder="Ticket UUID"
                pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
                onChange={(e) => {
                  setTicket(e.target.value);
                  change();
                }}
              />
            </Field>
            {request.error && <ErrorNotice error={request.error} />}
            {request.isSuccess && (
              <p role="status">
                Check queued. Results will appear automatically.
              </p>
            )}
            <Button
              disabled={!ready || request.isPending || reason.trim().length < 3}
            >
              {request.isPending ? "Queuing…" : "Run diagnostic"}
            </Button>
          </form>
          <p className="footnote">
            The agent checks for requests every 10–12 seconds. Queued requests
            expire after five minutes.
          </p>
        </section>
        <section className="panel diagnostic-history">
          <div className="panel-header">
            <h2>Recent checks</h2>
            <Button
              icon="refresh"
              variant="ghost"
              size="sm"
              onClick={() => void refresh()}
            >
              Refresh
            </Button>
          </div>
          {runs.isPending ? (
            <Loading />
          ) : runs.error ? (
            <ErrorNotice error={runs.error} retry={() => void refresh()} />
          ) : !runs.data?.data.length ? (
            <Empty>
              No checks yet. Start with the symptom you’re investigating.
            </Empty>
          ) : (
            <>
              <div className="diagnostic-run-list">
                {runs.data.data.map((r) => (
                  <button
                    type="button"
                    key={r.id}
                    aria-pressed={current?.id === r.id}
                    className="diagnostic-run"
                    onClick={() => setSelected(r.id)}
                  >
                    <span>
                      <strong>{title(r.command)}</strong>
                      <small>
                        {r.requester.name} · {date(r.created_at)}
                      </small>
                    </span>
                    <span className={`diagnostic-status ${r.status}`}>
                      {r.status}
                    </span>
                  </button>
                ))}
              </div>
              <Pagination
                result={runs.data}
                page={page}
                onChange={(p) => {
                  setPage(p);
                  setSelected(null);
                }}
              />
            </>
          )}
        </section>
      </div>
      {current && (
        <section
          className="panel ticket-card diagnostic-result"
          aria-label="Diagnostic result"
        >
          <div className="panel-header">
            <div>
              <p className="eyebrow">Check details</p>
              <h2>{title(current.command)}</h2>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              {currentChecks.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  icon="copy"
                  onClick={copySummary}
                >
                  {copied ? "Copied!" : "Copy summary"}
                </Button>
              )}
              <span className={`diagnostic-status ${current.status}`}>
                {current.status}
              </span>
            </div>
          </div>
          <p>{current.summary}</p>
          <p className="footnote">
            Requested by {current.requester.name} · {date(current.created_at)}
            {current.duration_ms !== null
              ? ` · ${(current.duration_ms / 1000).toFixed(2)} seconds`
              : ""}{" "}
            · Delivery attempts: {current.attempts}
          </p>
          <p>
            <strong>Reason:</strong> {current.reason}
          </p>
          {current.ticket_id && (
            <p>
              Ticket:{" "}
              <Link to={`/tickets/${current.ticket_id}`}>
                {current.ticket_id}
              </Link>
            </p>
          )}
          {cancel.error && <ErrorNotice error={cancel.error} />}
          {["requested", "accepted"].includes(current.status) && (
            <Button
              variant="outline"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate(current.id)}
            >
              Cancel queued check
            </Button>
          )}
          {current.status === "running" && (
            <p role="status" className="footnote">
              The device is running this check. Results refresh automatically.
            </p>
          )}
          {failCount > 0 && (
            <div
              style={{
                padding: "12px 16px",
                background: "#fce9e8",
                border: "1px solid #f09597",
                borderRadius: "8px",
                color: "#a52e31",
                margin: "16px 0",
                fontSize: "13px",
              }}
            >
              <strong>Diagnostic attention:</strong> {failCount} check{failCount > 1 ? "s" : ""} failed. Issues have been prioritized at the top of the list below.
            </div>
          )}
          {currentChecks.length > 0 && (
            <div style={{ display: "flex", gap: "8px", margin: "16px 0 8px", alignItems: "center" }}>
              <span style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 500 }}>Filter:</span>
              <button
                type="button"
                className={`button button-small ${filter === "all" ? "button-primary" : "button-ghost"}`}
                onClick={() => setFilter("all")}
              >
                All ({currentChecks.length})
              </button>
              {(failCount > 0 || warningCount > 0) && (
                <button
                  type="button"
                  className={`button button-small ${filter === "attention" ? "button-primary" : "button-ghost"}`}
                  onClick={() => setFilter("attention")}
                >
                  Issues ({failCount + warningCount})
                </button>
              )}
              <button
                type="button"
                className={`button button-small ${filter === "passed" ? "button-primary" : "button-ghost"}`}
                onClick={() => setFilter("passed")}
              >
                Passed ({currentChecks.length - failCount - warningCount})
              </button>
            </div>
          )}
          {sortedChecks.map((check, i) => (
            <div className="diagnostic-check" key={i}>
              <div>
                <strong>{check.name}</strong>
                <span className={`diagnostic-status ${check.status}`}>
                  {check.status}
                </span>
              </div>
              <p>{check.detail}</p>
            </div>
          ))}
          {!current.result && !active.includes(current.status) && (
            <p className="footnote">
              No diagnostic measurements were received for this request.
            </p>
          )}
        </section>
      )}
    </>
  );
}
