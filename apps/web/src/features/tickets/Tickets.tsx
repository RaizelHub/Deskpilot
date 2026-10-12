import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { api, json } from "@/lib/api";
import type { Page } from "@/lib/types";
import { date } from "@/lib/utils";
import { useSession } from "@/features/auth/session";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  ErrorNotice,
  Field,
  Loading,
  Pagination,
} from "@/components/shared";
import { label, type Options, type Person, type Ticket } from "./types";

export function PersonSelect({
  kind,
  value,
  onChange,
  current,
}: {
  kind: "requester" | "assignee";
  value: string;
  onChange: (id: string) => void;
  current?: Person | null;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["ticket-people", kind, search, page],
    queryFn: () =>
      api<Page<Person>>(
        `/ticket-people?kind=${kind}&search=${encodeURIComponent(search)}&page=${page}`,
      ),
  });
  return (
    <div className="field">
      <input
        aria-label={`Search ${kind}`}
        placeholder={`Find ${kind} by name…`}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
      />
      <select
        aria-label={label(kind)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">
          {kind === "requester" ? "Myself" : "Unassigned"}
        </option>
        {current && !q.data?.data.some((p) => p.id === current.id) && (
          <option value={current.id}>{current.name}</option>
        )}
        {q.data?.data.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {q.error && <ErrorNotice error={q.error} />}{" "}
      {q.data && (q.data.last_page ?? 1) > 1 && (
        <Pagination result={q.data} page={page} onChange={setPage} />
      )}
    </div>
  );
}

export const ticketSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(5).max(15000),
  category_id: z.string().min(1, "Please select a category"),
  priority: z.enum(["low", "medium", "high", "critical"]),
  reported_device: z.string().max(100),
  tags: z.string(),
});
type Values = z.infer<typeof ticketSchema>;

export function TicketEditor({
  ticket: initialTicket,
  close,
}: {
  ticket?: Ticket;
  close: () => void;
}) {
  const [ticket] = useState(initialTicket);
  const navigate = useNavigate();
  const client = useQueryClient();
  const session = useSession();
  const [requester, setRequester] = useState("");
  const q = useQuery({
    queryKey: ["ticket-options"],
    queryFn: () => api<Options>("/ticket-options"),
  });
  const form = useForm<Values>({
    resolver: zodResolver(ticketSchema),
    defaultValues: {
      title: ticket?.title ?? "",
      description: ticket?.description ?? "",
      category_id: ticket?.category_id ?? "",
      priority: (ticket?.priority as Values["priority"]) ?? "medium",
      reported_device: ticket?.reported_device ?? "",
      tags: ticket?.tags.map((t) => t.name).join(", ") ?? "",
    },
  });
  const save = useMutation({
    mutationFn: (v: Values) =>
      api<{ data: Ticket }>(
        ticket ? `/tickets/${ticket.id}` : "/tickets",
        json(ticket ? "PATCH" : "POST", {
          ...v,
          tags: v.tags
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean),
          reported_device: v.reported_device || null,
          ...(ticket
            ? { version: ticket.version }
            : requester
              ? { requester_id: requester }
              : {}),
        }),
      ),
    onSuccess: async (r) => {
      await client.invalidateQueries({ queryKey: ["tickets"] });
      await client.invalidateQueries({ queryKey: ["dashboard"] });
      close();
      navigate(`/tickets/${r.data.id}`);
    },
  });

  return (
    <Dialog
      open
      onOpenChange={close}
      title={ticket ? `Edit Ticket ${ticket.number}` : "Create Support Ticket"}
      description="Record an IT issue, service request, or incident with operational SLA targets."
    >
      <form
        className="form-stack"
        onSubmit={form.handleSubmit((values) => save.mutate(values))}
      >
        <Field
          label="Subject summary"
          htmlFor="ticket-title"
          error={form.formState.errors.title?.message}
        >
          <input
            id="ticket-title"
            placeholder="e.g. Outlook connection failing after certificate renewal"
            {...form.register("title")}
          />
        </Field>

        <Field
          label="Category"
          htmlFor="ticket-category"
          error={form.formState.errors.category_id?.message}
        >
          <select id="ticket-category" {...form.register("category_id")}>
            <option value="">Select an operational category</option>
            {q.data?.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid-2-col">
          <Field
            label="Priority"
            htmlFor="ticket-priority"
            error={form.formState.errors.priority?.message}
          >
            <select id="ticket-priority" {...form.register("priority")}>
              {q.data?.priorities.map((p) => (
                <option key={p} value={p}>
                  {label(p)}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Reported Device / Host"
            htmlFor="ticket-device"
            error={form.formState.errors.reported_device?.message}
          >
            <input
              id="ticket-device"
              placeholder="e.g. DESKTOP-HQ-892"
              {...form.register("reported_device")}
            />
          </Field>
        </div>

        {!ticket &&
          session.data?.permissions.includes("tickets.create_for_others") && (
            <Field label="Requester" htmlFor="ticket-requester">
              <PersonSelect
                kind="requester"
                value={requester}
                onChange={setRequester}
              />
            </Field>
          )}

        <Field
          label="Detailed Description & Steps"
          htmlFor="ticket-desc"
          error={form.formState.errors.description?.message}
        >
          <textarea
            id="ticket-desc"
            rows={5}
            placeholder="Provide diagnostic steps, observed behavior, and affected users…"
            {...form.register("description")}
          />
        </Field>

        <Field
          label="Tags (comma-separated)"
          htmlFor="ticket-tags"
          error={form.formState.errors.tags?.message}
        >
          <input
            id="ticket-tags"
            placeholder="network, windows, vpn, outlook"
            {...form.register("tags")}
          />
        </Field>

        {save.error && <ErrorNotice error={save.error} />}

        <div className="modal-actions-bar">
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button icon="save" type="submit" disabled={save.isPending}>
            {save.isPending
              ? "Submitting…"
              : ticket
                ? "Save Changes"
                : "Create Ticket"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function Tickets() {
  const [searchParams] = useSearchParams();
  const session = useSession();
  const client = useQueryClient();
  const [create, setCreate] = useState(() => searchParams.get("new") === "1");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [bulkPriority, setBulkPriority] = useState("medium");
  const [filters, setFilters] = useState({
    queue: "all",
    search: "",
    status: "",
    priority: "",
    category_id: "",
    tag: "",
    sort: "created_at",
    direction: "desc",
  });

  const options = useQuery({
    queryKey: ["ticket-options"],
    queryFn: () => api<Options>("/ticket-options"),
  });

  const queryParams = new URLSearchParams({
    page: String(page),
    queue: filters.queue,
    search: filters.search,
    status: filters.status,
    priority: filters.priority,
    category_id: filters.category_id,
    tag: filters.tag,
    sort: filters.sort,
    direction: filters.direction,
  });

  const q = useQuery({
    queryKey: ["tickets", queryParams.toString()],
    queryFn: () => api<Page<Ticket>>(`/tickets?${queryParams.toString()}`),
  });

  const bulk = useMutation({
    mutationFn: () =>
      api(
        "/tickets/bulk",
        json("POST", {
          tickets: Object.entries(selected).map(([id, version]) => ({
            id,
            version,
            priority: bulkPriority,
          })),
        }),
      ),
    onSuccess: async () => {
      setSelected({});
      await client.invalidateQueries({ queryKey: ["tickets"] });
    },
  });

  const filter = (key: string, value: string) => {
    setFilters({ ...filters, [key]: value });
    setPage(1);
    setSelected({});
  };

  const queueOptions = [
    { key: "all", label: "All Tickets" },
    { key: "mine", label: "My Requests" },
    { key: "assigned", label: "Assigned to Me" },
    { key: "unassigned", label: "Unassigned Queue" },
    { key: "overdue", label: "Overdue SLA" },
  ];

  return (
    <div className="tickets-page-container">
      {/* Top Header */}
      <div className="page-heading">
        <div>
          <div className="eyebrow-chip">
            <span className="eyebrow-dot" /> IT SERVICE MANAGEMENT
          </div>
          <h1>Support Tickets</h1>
          <p>
            Triage, prioritize, and manage customer issues through structured
            resolution workflows.
          </p>
        </div>

        {session.data?.permissions.includes("tickets.create") && (
          <Button
            icon="add"
            onClick={() => setCreate(true)}
            className="action-btn-primary"
          >
            <span>New Ticket</span>
          </Button>
        )}
      </div>

      {/* Queue Tabs (Linear / Panze style) */}
      <div className="ticket-queue-tabs">
        {queueOptions.map((opt) => (
          <button
            key={opt.key}
            className={`queue-tab-item ${filters.queue === opt.key ? "active" : ""}`}
            onClick={() => filter("queue", opt.key)}
          >
            <span>{opt.label}</span>
          </button>
        ))}
      </div>

      {/* Filter and Search Bar */}
      <div className="ticket-filter-bar">
        <div className="filter-search-box">
          <input
            aria-label="Search tickets"
            placeholder="Search by subject, ticket number (#T-), or description…"
            maxLength={100}
            value={filters.search}
            onChange={(e) => filter("search", e.target.value)}
          />
        </div>

        <div className="filter-selects-row">
          <select
            aria-label="Filter status"
            value={filters.status}
            onChange={(e) => filter("status", e.target.value)}
            className="filter-select"
          >
            <option value="">All Statuses</option>
            {options.data?.statuses.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter priority"
            value={filters.priority}
            onChange={(e) => filter("priority", e.target.value)}
            className="filter-select"
          >
            <option value="">All Priorities</option>
            {options.data?.priorities.map((p) => (
              <option key={p} value={p}>
                {label(p)}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter category"
            value={filters.category_id}
            onChange={(e) => filter("category_id", e.target.value)}
            className="filter-select"
          >
            <option value="">All Categories</option>
            {options.data?.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            aria-label="Sort tickets"
            value={filters.sort}
            onChange={(e) => filter("sort", e.target.value)}
            className="filter-select"
          >
            <option value="created_at">Created Date</option>
            <option value="updated_at">Updated Date</option>
            <option value="priority">Priority Level</option>
            <option value="resolution_due_at">SLA Due Date</option>
          </select>
        </div>
      </div>

      {/* Bulk Operations Toolbar */}
      {Object.keys(selected).length > 0 && (
        <div className="bulk-actions-toolbar">
          <span className="bulk-count-badge">
            {Object.keys(selected).length} selected
          </span>
          <span className="bulk-label">Bulk Update Priority:</span>
          <select
            aria-label="Bulk priority"
            value={bulkPriority}
            onChange={(e) => setBulkPriority(e.target.value)}
            className="bulk-select"
          >
            {options.data?.priorities.map((p) => (
              <option key={p} value={p}>
                {label(p)}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            disabled={bulk.isPending}
            onClick={() => bulk.mutate()}
          >
            {bulk.isPending ? "Applying…" : "Apply to Selected"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected({})}>
            Deselect All
          </Button>
        </div>
      )}

      {bulk.error && <ErrorNotice error={bulk.error} />}

      {/* Main Tickets Table */}
      <div className="tickets-table-panel">
        {q.isPending ? (
          <Loading />
        ) : q.error ? (
          <ErrorNotice error={q.error} retry={() => void q.refetch()} />
        ) : (
          <>
            <div className="table-responsive-container">
              <table className="tickets-data-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }} aria-label="Selection" />
                    <th>Ticket</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Category</th>
                    <th>Requester</th>
                    <th>Assignee</th>
                    <th>SLA Target</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.data.map((t) => {
                    const isSelected = t.id in selected;
                    const canSelect =
                      t.permissions.update &&
                      !["closed", "resolved"].includes(t.status);

                    return (
                      <tr
                        key={t.id}
                        className={`ticket-table-row ${isSelected ? "selected-row" : ""}`}
                      >
                        <td className="checkbox-cell">
                          {canSelect && (
                            <input
                              type="checkbox"
                              aria-label={`Select ${t.number}`}
                              checked={isSelected}
                              onChange={(e) =>
                                setSelected((old) => {
                                  const next = { ...old };
                                  if (e.target.checked) next[t.id] = t.version;
                                  else delete next[t.id];
                                  return next;
                                })
                              }
                            />
                          )}
                        </td>
                        <td className="ticket-main-cell">
                          <Link
                            to={`/tickets/${t.id}`}
                            className="ticket-link-block"
                          >
                            <div className="ticket-number-tag">{t.number}</div>
                            <div className="ticket-info-text">
                              <span className="ticket-title-text">
                                {t.title}
                              </span>
                              {t.reported_device && (
                                <span className="ticket-device-hint">
                                  Device: {t.reported_device}
                                </span>
                              )}
                            </div>
                          </Link>
                        </td>
                        <td>
                          <Badge
                            variant={
                              t.status === "open"
                                ? "default"
                                : t.status === "in_progress"
                                  ? "info"
                                  : t.status === "resolved"
                                    ? "success"
                                    : t.status === "closed"
                                      ? "secondary"
                                      : "warning"
                            }
                            dot
                          >
                            {label(t.status)}
                          </Badge>
                        </td>
                        <td>
                          <span
                            className={`priority-tag priority-${t.priority}`}
                          >
                            {t.priority}
                          </span>
                        </td>
                        <td>
                          <span className="category-pill-label">
                            {t.category?.name ?? "General"}
                          </span>
                        </td>
                        <td>
                          <div className="person-avatar-cell">
                            <span className="mini-avatar">
                              {t.requester?.name?.[0] ?? "U"}
                            </span>
                            <span>{t.requester?.name ?? "System"}</span>
                          </div>
                        </td>
                        <td>
                          <div className="person-avatar-cell">
                            {t.assignee ? (
                              <>
                                <span className="mini-avatar tone-primary">
                                  {t.assignee.name[0]}
                                </span>
                                <span>{t.assignee.name}</span>
                              </>
                            ) : (
                              <span className="unassigned-badge">
                                Unassigned
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div
                            className={`sla-status-pill ${
                              t.sla.resolution_breached ? "breached" : ""
                            }`}
                          >
                            <span>
                              {t.resolution_due_at
                                ? date(t.resolution_due_at)
                                : "No SLA"}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {!q.data.data.length && (
              <Empty>
                <div className="empty-tickets-view">
                  <h3>No tickets match this filter</h3>
                  <p>Try adjusting your search criteria or switch queues.</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => filter("queue", "all")}
                  >
                    Clear Filters
                  </Button>
                </div>
              </Empty>
            )}

            <Pagination
              result={q.data}
              page={page}
              onChange={(p) => {
                setPage(p);
                setSelected({});
              }}
            />
          </>
        )}
      </div>

      {create && <TicketEditor close={() => setCreate(false)} />}
    </div>
  );
}
