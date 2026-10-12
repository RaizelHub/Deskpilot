import { TicketAi } from "@/features/ai/TicketAi";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, json } from "@/lib/api";
import type { Page } from "@/lib/types";
import { date } from "@/lib/utils";
import { useSession } from "@/features/auth/session";
import { Button } from "@/components/ui/button";
import {
  Empty,
  ErrorNotice,
  Field,
  Loading,
  Pagination,
} from "@/components/shared";
import {
  label,
  type Ticket,
  type Comment,
  type Attachment,
  type History,
} from "./types";
import { PersonSelect, TicketEditor } from "./Tickets";

function Workflow({ ticket: live }: { ticket: Ticket }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<{
    base: Ticket;
    status: string;
    assignee: string;
    notes: string;
    reason: string;
  } | null>(null);
  const t = draft?.base ?? live;
  const status = draft?.status ?? t.status;
  const assignee = draft?.assignee ?? t.assignee_id ?? "";
  const notes = draft?.notes ?? t.resolution_notes ?? "";
  const reason = draft?.reason ?? "";
  const edit = (
    key: "status" | "assignee" | "notes" | "reason",
    value: string,
  ) =>
    setDraft((previous) => ({
      ...previous,
      base: t,
      status,
      assignee,
      notes,
      reason,
      [key]: value,
    }));
  const change = useMutation({
    mutationFn: (reopen: boolean) =>
      api(
        `/tickets/${t.id}${reopen ? "/reopen" : ""}`,
        json(
          reopen ? "POST" : "PATCH",
          reopen
            ? { version: t.version, reason }
            : {
                version: t.version,
                ...(t.permissions.assign && assignee !== (t.assignee_id ?? "")
                  ? { assignee_id: assignee || null }
                  : {}),
                ...(status !== t.status ? { status } : {}),
                ...(status === "resolved" ? { resolution_notes: notes } : {}),
              },
        ),
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["tickets"] });
      await client.invalidateQueries({ queryKey: ["dashboard"] });
      setDraft(null);
    },
  });
  const finished = ["resolved", "closed"].includes(t.status);
  const states =
    t.status === "resolved"
      ? ["resolved", "closed"]
      : [
          "open",
          "assigned",
          "in_progress",
          "waiting_for_user",
          "waiting_for_vendor",
          ...(t.permissions.resolve ? ["resolved"] : []),
        ];
  return (
    <section className="panel ticket-card">
      <h2>Workflow</h2>
      {change.error && (
        <ErrorNotice
          error={change.error}
          retry={() => {
            setDraft(null);
            void client.invalidateQueries({ queryKey: ["tickets"] });
          }}
        />
      )}
      {(!finished &&
        (t.permissions.assign ||
          t.permissions.update ||
          t.permissions.resolve)) ||
      (t.status === "resolved" && t.permissions.resolve) ? (
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate(false);
          }}
        >
          {t.permissions.assign && !finished && (
            <PersonSelect
              kind="assignee"
              value={assignee}
              onChange={(value) => edit("assignee", value)}
              current={t.assignee}
            />
          )}
          {(t.permissions.update || t.permissions.resolve) && (
            <Field label="Status" htmlFor="workflow-status">
              <select
                id="workflow-status"
                value={status}
                onChange={(e) => edit("status", e.target.value)}
              >
                {states.map((s) => (
                  <option key={s} value={s}>
                    {label(s)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {status === "resolved" && !finished && (
            <Field label="Resolution notes" htmlFor="resolution-notes">
              <textarea
                id="resolution-notes"
                required
                minLength={3}
                maxLength={5000}
                value={notes}
                onChange={(e) => edit("notes", e.target.value)}
              />
            </Field>
          )}
          <Button icon="save" disabled={change.isPending}>
            Save workflow
          </Button>
        </form>
      ) : (
        <p>{label(t.status)}</p>
      )}
      {finished && t.permissions.reopen && (
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate(true);
          }}
        >
          <Field label="Reason to reopen" htmlFor="reopen-reason">
            <textarea
              id="reopen-reason"
              required
              minLength={3}
              maxLength={2000}
              value={reason}
              onChange={(e) => edit("reason", e.target.value)}
            />
          </Field>
          <Button variant="outline" disabled={change.isPending}>
            Reopen ticket
          </Button>
        </form>
      )}
    </section>
  );
}
export function TicketDetail() {
  const { id } = useParams();
  const client = useQueryClient();
  const session = useSession();
  const [edit, setEdit] = useState(false);
  const [tab, setTab] = useState("conversation");
  const [page, setPage] = useState(1);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [fileInternal, setFileInternal] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const base = `/tickets/${id}`;
  const q = useQuery({
    queryKey: ["tickets", id],
    queryFn: () => api<{ data: Ticket }>(base),
    refetchInterval: 30000,
  });
  const comments = useQuery({
    queryKey: ["tickets", id, "comments", page],
    queryFn: () => api<Page<Comment>>(`${base}/comments?page=${page}`),
    enabled: tab === "conversation",
    refetchInterval: 30000,
  });
  const history = useQuery({
    queryKey: ["tickets", id, "history", page],
    queryFn: () => api<Page<History>>(`${base}/history?page=${page}`),
    enabled: tab === "history",
    refetchInterval: 30000,
  });
  const files = useQuery({
    queryKey: ["tickets", id, "attachments"],
    queryFn: () => api<{ data: Attachment[] }>(`${base}/attachments`),
    refetchInterval: 30000,
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["tickets"] });
    await client.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const reply = useMutation({
    mutationFn: () =>
      api(`${base}/comments`, json("POST", { body, is_internal: internal })),
    onSuccess: async () => {
      setBody("");
      await refresh();
      setPage(comments.data?.last_page ?? 1);
    },
  });
  const upload = useMutation({
    mutationFn: () => {
      const data = new FormData();
      if (file) data.append("file", file);
      data.append("is_internal", fileInternal ? "1" : "0");
      return api(`${base}/attachments`, { method: "POST", body: data });
    },
    onSuccess: async () => {
      setFile(null);
      setFileKey((k) => k + 1);
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (attachment: string) =>
      api(`${base}/attachments/${attachment}`, json("DELETE")),
    onSuccess: refresh,
  });
  if (q.isPending) return <Loading />;
  if (q.error)
    return <ErrorNotice error={q.error} retry={() => void q.refetch()} />;
  const t = q.data.data;
  return (
    <>
      <Link className="text-link" to="/tickets">
        ← Back to tickets
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{t.number}</span>
          <h1>{t.title}</h1>
          <p>
            Requested by {t.requester?.name ?? "DeskPilot monitoring"} ·{" "}
            {date(t.created_at)}
          </p>
        </div>
        {t.permissions.update && !["resolved", "closed"].includes(t.status) && (
          <Button icon="edit" variant="outline" onClick={() => setEdit(true)}>
            Edit ticket
          </Button>
        )}
      </div>
      <div className="ticket-detail-grid">
        <div className="ticket-main">
          <section className="panel ticket-card">
            <div className="button-row">
              <span className={`pill status-${t.status}`}>
                {label(t.status)}
              </span>
              <span className={`priority priority-${t.priority}`}>
                {label(t.priority)} priority
              </span>
              {t.tags.map((tag) => (
                <span className="pill" key={tag.id}>
                  #{tag.name}
                </span>
              ))}
            </div>
            <h2>Description</h2>
            <p className="preserve-text">{t.description}</p>
            {t.resolution_notes && (
              <div className="resolution-box">
                <h3>Resolution</h3>
                <p className="preserve-text">{t.resolution_notes}</p>
              </div>
            )}
          </section>
          {session.data?.permissions.includes("ai.use") && (
            <TicketAi ticketId={t.id} />
          )}
          <section className="panel ticket-card">
            <div className="ticket-queues">
              {["conversation", "history"].map((s) => (
                <Button
                  key={s}
                  variant={tab === s ? "default" : "ghost"}
                  onClick={() => {
                    setTab(s);
                    setPage(1);
                  }}
                >
                  {label(s)}
                </Button>
              ))}
            </div>
            {tab === "conversation" ? (
              <>
                {comments.isPending ? (
                  <Loading />
                ) : comments.error ? (
                  <ErrorNotice error={comments.error} />
                ) : (
                  <>
                    {!comments.data.data.length && (
                      <Empty>No replies yet. Start the conversation.</Empty>
                    )}
                    {comments.data.data.map((c) => (
                      <article
                        className={`ticket-comment ${c.is_internal ? "internal-note" : ""}`}
                        key={c.id}
                      >
                        <div>
                          <strong>{c.author.name}</strong>
                          <span>
                            {c.is_internal ? "Internal note · " : ""}
                            {date(c.created_at)}
                          </span>
                        </div>
                        <p className="preserve-text">{c.body}</p>
                      </article>
                    ))}
                    <Pagination
                      result={comments.data}
                      page={page}
                      onChange={setPage}
                    />
                  </>
                )}
                {t.status !== "closed" &&
                  (t.permissions.reply || t.permissions.notes) && (
                    <form
                      className="form-stack"
                      onSubmit={(e) => {
                        e.preventDefault();
                        reply.mutate();
                      }}
                    >
                      {reply.error && <ErrorNotice error={reply.error} />}
                      <Field
                        label={internal ? "Internal note" : "Reply"}
                        htmlFor="reply-body"
                      >
                        <textarea
                          id="reply-body"
                          disabled={reply.isPending}
                          required
                          minLength={1}
                          maxLength={10000}
                          rows={4}
                          value={body}
                          onChange={(e) => setBody(e.target.value)}
                        />
                      </Field>
                      {t.permissions.notes && (
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={internal}
                            onChange={(e) => setInternal(e.target.checked)}
                          />
                          Internal note — visible to support staff
                        </label>
                      )}
                      <Button
                        disabled={
                          reply.isPending ||
                          !body.trim() ||
                          (!internal && !t.permissions.reply)
                        }
                      >
                        {internal ? "Add internal note" : "Send reply"}
                      </Button>
                    </form>
                  )}
              </>
            ) : history.isPending ? (
              <Loading />
            ) : history.error ? (
              <ErrorNotice error={history.error} />
            ) : (
              <>
                {history.data.data.map((h) => (
                  <article className="ticket-comment" key={h.id}>
                    <div>
                      <strong>{label(h.action)}</strong>
                      <span>
                        {h.actor?.name ?? "System"} · {date(h.created_at)}
                      </span>
                    </div>
                    <dl className="history-details">
                      {Object.entries(h.details).map(([key, value]) => (
                        <div key={key}>
                          <dt>{label(key)}</dt>
                          <dd>
                            {typeof value === "object"
                              ? JSON.stringify(value)
                              : String(value ?? "—")}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </article>
                ))}
                <Pagination
                  result={history.data}
                  page={page}
                  onChange={setPage}
                />
              </>
            )}
          </section>
          <section className="panel ticket-card">
            <h2>Attachments</h2>
            <p className="footnote">
              Screenshots (PNG/JPEG) and UTF-8 text. Up to 5 MB each, 20 MB
              total.
            </p>
            {files.error && <ErrorNotice error={files.error} />}{" "}
            {remove.error && <ErrorNotice error={remove.error} />}
            <div className="attachment-list">
              {files.data?.data.map((a) => (
                <div key={a.id}>
                  <a href={`/api/v1${base}/attachments/${a.id}`} download>
                    {a.filename}
                  </a>
                  <small>
                    {Math.ceil(a.size / 1024)} KB ·{" "}
                    {a.is_internal ? "Internal · " : ""}
                    {a.uploader.name}
                  </small>
                  {(a.uploader.id === session.data?.user.id ||
                    t.permissions.update) && (
                    <Button
                      icon="delete"
                      variant="ghost"
                      size="sm"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm(`Delete ${a.filename}?`))
                          remove.mutate(a.id);
                      }}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {t.status !== "closed" &&
              (t.permissions.reply || t.permissions.notes) && (
                <form
                  className="form-stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    upload.mutate();
                  }}
                >
                  {upload.error && <ErrorNotice error={upload.error} />}
                  <input
                    key={fileKey}
                    aria-label="Choose attachment"
                    type="file"
                    accept=".txt,.png,.jpg,.jpeg"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  {t.permissions.notes && (
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={fileInternal}
                        onChange={(e) => setFileInternal(e.target.checked)}
                      />
                      Internal attachment
                    </label>
                  )}
                  <Button
                    icon="upload"
                    variant="outline"
                    disabled={!file || upload.isPending}
                  >
                    Upload attachment
                  </Button>
                </form>
              )}
          </section>
        </div>
        <aside className="ticket-side">
          <Workflow key={t.id} ticket={t} />
          <section className="panel ticket-card">
            <h2>Ticket details</h2>
            <dl className="ticket-facts">
              {[
                ["Requester", t.requester?.name ?? "DeskPilot monitoring"],
                ["Assignee", t.assignee?.name ?? "Unassigned"],
                ["Department", t.department?.name ?? "Not assigned"],
                ["Category", t.category.name],
                ["Reported device", t.reported_device ?? "Not provided"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="panel ticket-card">
            <h2>Service targets</h2>
            <dl className="ticket-facts">
              <div>
                <dt>First response due</dt>
                <dd className={t.sla.response_breached ? "overdue-text" : ""}>
                  {date(t.first_response_due_at)}
                </dd>
                <small>
                  {t.first_response_at
                    ? `Responded ${date(t.first_response_at)}`
                    : t.sla.response_breached
                      ? "Response target missed"
                      : "Awaiting support response"}
                </small>
              </div>
              <div>
                <dt>Resolution due</dt>
                <dd className={t.sla.resolution_breached ? "overdue-text" : ""}>
                  {date(t.resolution_due_at)}
                </dd>
                <small>
                  {t.resolved_at
                    ? `Resolved ${date(t.resolved_at)}`
                    : t.sla.resolution_breached
                      ? "Resolution overdue"
                      : "Within resolution target"}
                </small>
              </div>
            </dl>
            <p className="footnote">
              Elapsed time includes weekends and waiting periods.
            </p>
          </section>
        </aside>
      </div>
      {edit && <TicketEditor ticket={t} close={() => setEdit(false)} />}
    </>
  );
}
