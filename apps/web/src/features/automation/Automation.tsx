import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, json } from "@/lib/api";
import { useSession } from "@/features/auth/session";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  ErrorNotice,
  Loading,
  Empty,
  Pagination,
  Field,
} from "@/components/shared";
import type { Page } from "@/lib/types";
type Hook = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  version: number;
  subscriptions: { event: string }[];
};
type Rule = {
  id: string;
  name: string;
  event: string;
  audience: string;
  priority: string | null;
  enabled: boolean;
  version: number;
};
type Delivery = {
  id: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  webhook: { name: string };
  event: { event: string; body?: string };
};
type Overview = {
  webhooks: Hook[];
  rules: Rule[];
  events: string[];
  counts: { pending: number; failed: number; succeeded: number };
  health: { last_dispatch_at: string | null; last_worker_at: string | null };
};
const audiences = (e: string) =>
  e.startsWith("ticket.")
    ? ["ticket_assignee", "ticket_requester", "it_team"]
    : e.startsWith("remote.")
      ? ["remote_customer", "remote_technician"]
      : ["it_team"];
export function Automation() {
  const client = useQueryClient();
  const can = useSession().data?.permissions.includes("automation.manage");
  const q = useQuery({
    queryKey: ["automation"],
    queryFn: () => api<Overview>("/automation"),
    refetchInterval: 30000,
  });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [hook, setHook] = useState<Hook | null | undefined>();
  const [rule, setRule] = useState<Rule | null | undefined>();
  const [secret, setSecret] = useState("");
  const [detail, setDetail] = useState<string | null>(null);
  const deliveries = useQuery({
    queryKey: ["deliveries", page, status],
    queryFn: () =>
      api<Page<Delivery>>(`/webhook-deliveries?page=${page}&status=${status}`),
    refetchInterval: 15000,
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["automation"] });
    void client.invalidateQueries({ queryKey: ["deliveries"] });
    void client.invalidateQueries({ queryKey: ["delivery"] });
  };
  const action = useMutation({
    mutationFn: ({
      path,
      body,
      method = "POST",
    }: {
      path: string;
      body?: unknown;
      method?: string;
    }) => api<{ secret?: string }>(path, json(method, body)),
    onSuccess: (r) => {
      if (r.secret) setSecret(r.secret);
      refresh();
    },
  });
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorNotice error={q.error} />;
  const data = q.data;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CONNECTED WORKFLOWS</span>
          <h1>Automation</h1>
          <p>Keep your team informed and connect the tools you use.</p>
        </div>
        <Link to="/alerts">Incident rules →</Link>
      </div>
      <div className="automation-summary">
        {Object.entries(data.counts).map(([k, v]) => (
          <section className="panel" key={k}>
            <span>{k}</span>
            <strong>{v}</strong>
          </section>
        ))}
      </div>
      {action.error && <ErrorNotice error={action.error} />}
      <section className="panel automation-section">
        <div className="table-toolbar">
          <div>
            <h2>Webhooks</h2>
            <p>Signed events for n8n and other receivers.</p>
          </div>
          {can && (
            <Button icon="add" onClick={() => setHook(null)}>
              Add webhook
            </Button>
          )}
        </div>
        {!data.webhooks.length ? (
          <Empty>No webhooks yet. Add a receiver to get started.</Empty>
        ) : (
          data.webhooks.map((h) => (
            <div className="automation-row" key={h.id}>
              <div>
                <strong>{h.name}</strong>
                <p className="wrap-anywhere">{h.url}</p>
                <small>
                  {h.enabled ? "Enabled" : "Disabled"} ·{" "}
                  {h.subscriptions.length} events
                </small>
              </div>
              {can && (
                <div className="button-row">
                  <Button
                    icon="edit"
                    variant="outline"
                    onClick={() => setHook(h)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!h.enabled || action.isPending}
                    onClick={() =>
                      action.mutate({ path: `/webhooks/${h.id}/test` })
                    }
                  >
                    Send test
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={action.isPending}
                    onClick={() =>
                      action.mutate({
                        path: `/webhooks/${h.id}/rotate`,
                        body: { version: h.version },
                      })
                    }
                  >
                    Rotate secret
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
        <p className="automation-note">
          Rotating a secret disables the webhook and cancels queued deliveries.
          Configure your receiver before enabling it again.
        </p>
      </section>
      <section className="panel automation-section">
        <div className="table-toolbar">
          <div>
            <h2>Notification rules</h2>
            <p>Send updates to the right people in their DeskPilot inbox.</p>
          </div>
          {can && (
            <Button icon="add" variant="outline" onClick={() => setRule(null)}>
              Add rule
            </Button>
          )}
        </div>
        {data.rules.map((r) => (
          <div className="automation-row" key={r.id}>
            <div>
              <strong>{r.name}</strong>
              <p>
                {r.event} → {r.audience.replaceAll("_", " ")}
                {r.priority ? ` · ${r.priority}` : ""}
              </p>
              <small>{r.enabled ? "Enabled" : "Disabled"}</small>
            </div>
            {can && (
              <Button icon="edit" variant="outline" onClick={() => setRule(r)}>
                Edit rule
              </Button>
            )}
          </div>
        ))}
      </section>
      <section className="panel automation-section">
        <div className="table-toolbar">
          <div>
            <h2>Delivery history</h2>
            <p>Inspect attempts and retry failed deliveries.</p>
          </div>
          <select
            aria-label="Delivery status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {["pending", "sending", "succeeded", "failed", "cancelled"].map(
              (s) => (
                <option key={s}>{s}</option>
              ),
            )}
          </select>
        </div>
        {deliveries.error ? (
          <ErrorNotice error={deliveries.error} />
        ) : deliveries.isPending ? (
          <Loading />
        ) : !deliveries.data.data.length ? (
          <Empty>No deliveries found.</Empty>
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Receiver / event</th>
                    <th>Status</th>
                    <th>Attempts</th>
                    <th>Created</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.data.data.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <strong>{d.webhook.name}</strong>
                        <div>{d.event.event}</div>
                      </td>
                      <td>{d.status}</td>
                      <td>{d.attempts}</td>
                      <td>{new Date(d.created_at).toLocaleString()}</td>
                      <td>
                        <Button variant="ghost" onClick={() => setDetail(d.id)}>
                          Inspect
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              result={deliveries.data}
              page={page}
              onChange={setPage}
            />
          </>
        )}
        <p className="automation-note">
          Last dispatch:{" "}
          {data.health.last_dispatch_at
            ? new Date(data.health.last_dispatch_at).toLocaleString()
            : "Not run yet"}{" "}
          · Last worker activity:{" "}
          {data.health.last_worker_at
            ? new Date(data.health.last_worker_at).toLocaleString()
            : "Not run yet"}
        </p>
      </section>
      {hook !== undefined && (
        <HookEditor
          hook={hook}
          events={data.events}
          close={() => setHook(undefined)}
          saved={(s) => {
            setSecret(s);
            setHook(undefined);
            refresh();
          }}
        />
      )}
      {rule !== undefined && (
        <RuleEditor
          rule={rule}
          events={data.events}
          close={() => setRule(undefined)}
          saved={() => {
            setRule(undefined);
            refresh();
          }}
        />
      )}
      <Dialog
        open={!!secret}
        onOpenChange={() => setSecret("")}
        title="Save your signing secret"
        description="Shown only once. Store this in your receiver’s secret configuration, then enable the webhook."
      >
        <Field label="Signing secret" htmlFor="signing-secret">
          <input id="signing-secret" readOnly value={secret} />
        </Field>
        <div className="dialog-actions">
          <Button onClick={() => setSecret("")}>I have saved the secret</Button>
        </div>
      </Dialog>
      {detail && (
        <DeliveryDetail
          id={detail}
          can={!!can}
          close={() => setDetail(null)}
          retry={() =>
            action.mutate({ path: `/webhook-deliveries/${detail}/retry` })
          }
          pending={action.isPending}
          error={action.error}
        />
      )}
    </>
  );
}
function HookEditor({
  hook,
  events,
  close,
  saved,
}: {
  hook: Hook | null;
  events: string[];
  close: () => void;
  saved: (s: string) => void;
}) {
  const [name, setName] = useState(hook?.name ?? "");
  const [url, setUrl] = useState(hook?.url ?? "");
  const [selected, setSelected] = useState(
    hook?.subscriptions.map((s) => s.event) ?? ["ticket.created"],
  );
  const [enabled, setEnabled] = useState(hook?.enabled ?? false);
  const save = useMutation({
    mutationFn: () =>
      api<{ secret?: string }>(
        hook ? `/webhooks/${hook.id}` : "/webhooks",
        json(hook ? "PATCH" : "POST", {
          name,
          url,
          events: selected,
          enabled,
          ...(hook ? { version: hook.version } : {}),
        }),
      ),
    onSuccess: (r) => saved(r.secret ?? ""),
  });
  return (
    <Dialog
      open
      onOpenChange={close}
      title={hook ? "Edit webhook" : "Add webhook"}
      description="Use a public HTTPS receiver. New webhooks start disabled. Changes cancel queued deliveries."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Name" htmlFor="hook-name">
          <input
            id="hook-name"
            required
            minLength={2}
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Receiver URL" htmlFor="hook-url">
          <input
            id="hook-url"
            type="url"
            required
            maxLength={2000}
            placeholder="https://automation.example.com/webhook/deskpilot"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <fieldset className="event-options">
          <legend>Events</legend>
          {events.map((event) => (
            <label key={event}>
              <input
                type="checkbox"
                checked={selected.includes(event)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, event]
                      : selected.filter((s) => s !== event),
                  )
                }
              />
              {event}
            </label>
          ))}
        </fieldset>
        {hook && (
          <label>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />{" "}
            Enable webhook
          </label>
        )}
        {save.error && <ErrorNotice error={save.error} />}
        <div className="dialog-actions">
          <Button variant="outline" type="button" onClick={close}>
            Cancel
          </Button>
          <Button icon="save" disabled={save.isPending || !selected.length}>
            Save webhook
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
function RuleEditor({
  rule,
  events,
  close,
  saved,
}: {
  rule: Rule | null;
  events: string[];
  close: () => void;
  saved: () => void;
}) {
  const [name, setName] = useState(rule?.name ?? "");
  const [event, setEvent] = useState(rule?.event ?? "ticket.assigned");
  const [audience, setAudience] = useState(rule?.audience ?? "ticket_assignee");
  const [priority, setPriority] = useState(rule?.priority ?? "");
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const save = useMutation({
    mutationFn: () =>
      api(
        rule ? `/notification-rules/${rule.id}` : "/notification-rules",
        json(rule ? "PATCH" : "POST", {
          name,
          event,
          audience,
          priority: priority || null,
          enabled,
          ...(rule ? { version: rule.version } : {}),
        }),
      ),
    onSuccess: saved,
  });
  return (
    <Dialog
      open
      onOpenChange={close}
      title={rule ? "Edit notification rule" : "Add notification rule"}
      description="Recipients must still have access to the affected record."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Rule name" htmlFor="rule-name">
          <input
            id="rule-name"
            required
            minLength={2}
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Event" htmlFor="rule-event">
          <select
            id="rule-event"
            value={event}
            onChange={(e) => {
              setEvent(e.target.value);
              setAudience(audiences(e.target.value)[0]);
              setPriority("");
            }}
          >
            {events.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
        </Field>
        <Field label="Recipients" htmlFor="rule-audience">
          <select
            id="rule-audience"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
          >
            {audiences(event).map((a) => (
              <option key={a} value={a}>
                {a.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </Field>
        {event.startsWith("ticket.") && (
          <Field label="Ticket priority" htmlFor="rule-priority">
            <select
              id="rule-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="">Any priority</option>
              {["low", "medium", "high", "critical"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Field>
        )}
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />{" "}
          Enabled
        </label>
        {save.error && <ErrorNotice error={save.error} />}
        <div className="dialog-actions">
          <Button variant="outline" type="button" onClick={close}>
            Cancel
          </Button>
          <Button icon="save" disabled={save.isPending}>
            Save rule
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
function DeliveryDetail({
  id,
  can,
  close,
  retry,
  pending,
  error,
}: {
  id: string;
  can: boolean;
  close: () => void;
  retry: () => void;
  pending: boolean;
  error: unknown;
}) {
  const q = useQuery({
    queryKey: ["delivery", id],
    queryFn: () =>
      api<{
        data: Delivery;
        attempts: {
          number: number;
          status: string;
          response_status: number | null;
          error: string | null;
        }[];
      }>(`/webhook-deliveries/${id}`),
    refetchInterval: 10000,
  });
  return (
    <Dialog
      open
      onOpenChange={close}
      title="Delivery details"
      description="Retries use the current receiver configuration and the original event payload."
    >
      {q.error ? (
        <ErrorNotice error={q.error} />
      ) : q.isPending ? (
        <Loading />
      ) : (
        <>
          <p>
            {q.data.data.event.event} · {q.data.data.status}
          </p>
          <code className="wrap-anywhere">{id}</code>
          <pre className="automation-payload">{q.data.data.event.body}</pre>
          {q.data.attempts.map((a) => (
            <p key={a.number}>
              Attempt {a.number}: {a.status} ·{" "}
              {a.response_status ?? a.error ?? "In progress"}
            </p>
          ))}
          {!q.data.attempts.length && <p>No attempts yet.</p>}
          {error && <ErrorNotice error={error} />}
          <div className="dialog-actions">
            {can && ["failed", "cancelled"].includes(q.data.data.status) && (
              <Button disabled={pending} onClick={retry}>
                Retry with current receiver
              </Button>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
