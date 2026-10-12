import { useEffect, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, json } from "@/lib/api";
import { useSession } from "@/features/auth/session";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  ErrorNotice,
  Field,
  Loading,
  Pagination,
} from "@/components/shared";
import type { Page } from "@/lib/types";

type Support = {
  id: string;
  customer_id: string;
  status: string;
  reason: string;
  requested_mode: string;
  approved_mode: string | null;
  expires_at: string;
  delivered_at: string | null;
  end_reason: string | null;
  technician: { name: string };
  customer: { name: string };
  device: { name: string };
  ticket: { number: string; title: string };
  events?: { id: number; detail: string; created_at: string }[];
};

const notice =
  "Consent and identity authorization workflow is fully active and audited. Real-time screen capture streaming is scheduled in the Phase 6 RustDesk client gateway.";
const label = (value: string) => value.replaceAll("_", " ");

export function RemoteSupport({ mine = false }: { mine?: boolean }) {
  const [searchParams] = useSearchParams();
  const preselectedDevice = searchParams.get("device_id") ?? "";

  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("all");
  const [deviceSearch, setDeviceSearch] = useState("");
  const [device, setDevice] = useState(preselectedDevice);
  const [ticket, setTicket] = useState("");
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState("view");
  const [requestKey] = useState(() => crypto.randomUUID());
  const session = useSession();
  const navigate = useNavigate();

  const requests = useQuery({
    queryKey: ["remote-support", mine, page, filter],
    queryFn: () =>
      api<Page<Support>>(
        `/${mine ? "my-support-requests" : "remote-sessions"}?page=${page}&status=${filter}`,
      ),
    refetchInterval: 10000,
  });

  const devices = useQuery({
    queryKey: ["remote-devices", deviceSearch],
    queryFn: () =>
      api<Page<{ id: string; name: string }>>(
        `/devices?state=online&search=${encodeURIComponent(deviceSearch)}`,
      ),
    enabled: !mine,
  });

  const tickets = useQuery({
    queryKey: ["remote-tickets", search],
    queryFn: () =>
      api<
        Page<{
          id: string;
          number: string;
          title: string;
          status: string;
          requester: unknown;
        }>
      >(`/tickets?search=${encodeURIComponent(search)}`),
    enabled: !mine,
  });

  const create = useMutation({
    mutationFn: () =>
      api<{ data: Support }>(
        "/remote-sessions",
        json("POST", {
          device_id: device,
          ticket_id: ticket,
          mode,
          reason,
          request_key: requestKey,
        }),
      ),
    onSuccess: ({ data }) => navigate(`/support-requests/${data.id}`),
  });

  return (
    <div className="remote-support-page">
      {/* Header */}
      <div className="page-heading">
        <div>
          <div className="eyebrow-chip">
            <span className="eyebrow-dot" /> CONSENT-BASED ASSISTANCE
          </div>
          <h1>{mine ? "My Support Invitations" : "Remote Assistance"}</h1>
          <p>
            {mine
              ? "Review and authorize temporary screen view or control permissions requested by your IT staff."
              : "Request short-lived, transparent technical support on an enrolled client computer."}
          </p>
        </div>
      </div>

      {/* Security Architecture Notice */}
      <div className="remote-security-banner">
        <div className="security-banner-text">
          <strong>Zero Silent Access · Mandatory User Consent</strong>
          <p>
            {notice} All sessions expire strictly after 5 minutes and generate
            permanent cryptographic audit logs.
          </p>
        </div>
      </div>

      <div className="remote-two-col-layout">
        {/* Left Column: Request Form (for technicians) */}
        {!mine && (
          <div className="remote-request-card">
            <div className="card-header-styled">
              <div>
                <h2>Request Customer Approval</h2>
                <p>
                  Authorize access linked directly to an active support ticket.
                </p>
              </div>
            </div>

            <form
              className="form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
            >
              {devices.error && <ErrorNotice error={devices.error} />}
              {tickets.error && <ErrorNotice error={tickets.error} />}

              <Field label="Target Online Endpoint" htmlFor="remote-device">
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <input
                    placeholder="Filter online devices…"
                    value={deviceSearch}
                    onChange={(e) => setDeviceSearch(e.target.value)}
                    style={{ fontSize: 12, padding: "6px 10px" }}
                  />
                  <select
                    id="remote-device"
                    required
                    value={device}
                    onChange={(e) => setDevice(e.target.value)}
                  >
                    <option value="">Select an online Windows computer</option>
                    {devices.data?.data.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} (Online)
                      </option>
                    ))}
                  </select>
                </div>
              </Field>

              <Field label="Associated Support Ticket" htmlFor="remote-ticket">
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <input
                    placeholder="Filter tickets by subject or number…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{ fontSize: 12, padding: "6px 10px" }}
                  />
                  <select
                    id="remote-ticket"
                    required
                    value={ticket}
                    onChange={(e) => setTicket(e.target.value)}
                  >
                    <option value="">Select active customer ticket</option>
                    {tickets.data?.data
                      .filter(
                        (t) =>
                          t.requester &&
                          !["resolved", "closed"].includes(t.status),
                      )
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.number} · {t.title}
                        </option>
                      ))}
                  </select>
                </div>
              </Field>

              <Field label="Requested Permissions" htmlFor="remote-mode">
                <select
                  id="remote-mode"
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                >
                  <option value="view">View Only (Inspect Screen)</option>
                  {session.data?.permissions.includes("remote.control") && (
                    <option value="control">Keyboard & Mouse Control</option>
                  )}
                </select>
              </Field>

              <Field label="Reason for Session" htmlFor="remote-reason">
                <textarea
                  id="remote-reason"
                  required
                  rows={3}
                  minLength={3}
                  maxLength={500}
                  placeholder="Explain why assistance is required (shown clearly to user on screen)…"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>

              {create.error && <ErrorNotice error={create.error} />}

              <Button
                icon="add"
                type="submit"
                className="action-btn-primary"
                disabled={create.isPending}
              >
                <span>
                  {create.isPending ? "Sending…" : "Send Approval Request"}
                </span>
              </Button>
            </form>
          </div>
        )}

        {/* Right Column: Sessions History & Status Queue */}
        <div className="remote-sessions-list-panel">
          <div className="panel-title-row">
            <div>
              <h2 className="panel-heading">Session Invitations</h2>
              <p className="panel-subheading">
                Active and concluded remote approvals
              </p>
            </div>

            <select
              aria-label="Request status filter"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(1);
              }}
              className="filter-select"
            >
              <option value="all">All Sessions</option>
              <option value="pending">Awaiting Approval</option>
              <option value="approved">Approved</option>
              <option value="finished">Finished / Expired</option>
            </select>
          </div>

          {requests.isPending ? (
            <Loading />
          ) : requests.error ? (
            <ErrorNotice error={requests.error} />
          ) : (
            <>
              {requests.data?.data.length === 0 ? (
                <Empty>
                  <div className="empty-sessions-box">
                    <p>No remote assistance sessions found.</p>
                  </div>
                </Empty>
              ) : (
                <div className="sessions-list-feed">
                  {requests.data?.data.map((s) => (
                    <Link
                      to={`/support-requests/${s.id}`}
                      key={s.id}
                      className="session-feed-item"
                    >
                      <div className="session-feed-meta">
                        <div className="session-title-line">
                          <strong>{s.device.name}</strong>
                          <span className="session-ticket-ref">
                            {s.ticket.number}
                          </span>
                        </div>
                        <p className="session-participants">
                          Technician: {s.technician.name} → Client:{" "}
                          {s.customer.name}
                        </p>
                        <small className="session-reason">
                          "{s.reason.slice(0, 75)}
                          {s.reason.length > 75 ? "…" : ""}"
                        </small>
                      </div>

                      <div className="session-feed-status">
                        <Badge
                          variant={
                            s.status === "approved"
                              ? "success"
                              : s.status === "requested" ||
                                  s.status === "waiting_for_user"
                                ? "warning"
                                : "secondary"
                          }
                          dot
                        >
                          {label(s.status)}
                        </Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              )}

              {requests.data && (
                <Pagination
                  result={requests.data}
                  page={page}
                  onChange={setPage}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function SupportRequest() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const { id } = useParams();
  const session = useSession();
  const client = useQueryClient();

  const result = useQuery({
    queryKey: ["remote-support", id],
    queryFn: () => api<{ data: Support }>(`/remote-sessions/${id}`),
    refetchInterval: 3000,
  });

  const action = useMutation({
    mutationFn: (value: string) =>
      api(`/remote-sessions/${id}/actions`, json("POST", { action: value })),
    onSettled: () => {
      client.invalidateQueries({ queryKey: ["remote-support"] });
      client.invalidateQueries({ queryKey: ["remote-support", id] });
    },
  });

  const isCustomer = session.data?.user.id === result.data?.data.customer_id;
  const requestStatus = result.data?.data.status;

  useEffect(() => {
    if (!isCustomer || requestStatus !== "requested") return;
    void api(
      `/remote-sessions/${id}/actions`,
      json("POST", { action: "viewed" }),
    )
      .then(() =>
        client.invalidateQueries({ queryKey: ["remote-support", id] }),
      )
      .catch(() => {});
  }, [id, isCustomer, requestStatus, client]);

  if (result.isPending) return <Loading />;
  if (result.error) return <ErrorNotice error={result.error} />;

  const s = result.data.data;
  const customer = session.data?.user.id === s.customer_id;
  const pending = ["requested", "waiting_for_user"].includes(s.status);
  const active = pending || s.status === "approved";
  const expireEpoch = Date.parse(s.expires_at);
  const remainingSeconds = Math.max(0, Math.floor((expireEpoch - now) / 1000));
  const expired = remainingSeconds <= 0;

  const minutesLeft = Math.floor(remainingSeconds / 60);
  const secondsLeft = remainingSeconds % 60;

  return (
    <div className="session-room-container">
      <Link
        to={customer ? "/support-requests" : "/remote-support"}
        className="back-link"
      >
        ← Back to Support Sessions
      </Link>

      {/* Session Title Header */}
      <div className="page-heading">
        <div>
          <div className="eyebrow-chip">
            <span className="eyebrow-dot" /> SESSION IDENTIFIER:{" "}
            {s.id.slice(0, 8)}
          </div>
          <h1>Assistance Request for {s.device.name}</h1>
          <p>
            Technician <strong>{s.technician.name}</strong> requesting access
            for Ticket <strong>{s.ticket.number}</strong>.
          </p>
        </div>

        <Badge
          variant={
            s.status === "approved"
              ? "success"
              : pending && !expired
                ? "warning"
                : "secondary"
          }
          dot
        >
          {label(s.status)}
        </Badge>
      </div>

      {/* Live Countdown & Access Card */}
      <div className="session-status-card">
        <div className="session-timer-row">
          <div className="timer-badge">
            {active && !expired ? (
              <span>
                Session expires in{" "}
                <strong>
                  {minutesLeft}m{" "}
                  {secondsLeft < 10 ? `0${secondsLeft}` : secondsLeft}s
                </strong>
              </span>
            ) : (
              <span>Session expired or finalized</span>
            )}
          </div>

          <div className="session-mode-badge">
            <strong>Requested:</strong>{" "}
            {s.requested_mode === "view" ? "View Only" : "Keyboard & Mouse"}
          </div>
        </div>

        <div className="session-meta-grid">
          <div>
            <span className="meta-label">Associated Ticket:</span>
            <strong>{s.ticket.title}</strong>
          </div>
          <div>
            <span className="meta-label">Customer User:</span>
            <strong>{s.customer.name}</strong>
          </div>
          <div>
            <span className="meta-label">Target Endpoint:</span>
            <strong>{s.device.name}</strong>
          </div>
          <div>
            <span className="meta-label">Delivery Status:</span>
            <strong>
              {s.delivered_at
                ? "Delivered to device agent"
                : "Awaiting agent check-in"}
            </strong>
          </div>
        </div>

        <div className="session-reason-box">
          <span className="meta-label">Support Reason:</span>
          <p>"{s.reason}"</p>
        </div>

        {s.approved_mode && (
          <div className="approved-notice-pill">
            <span>
              Customer approved{" "}
              <strong>
                {s.approved_mode === "view"
                  ? "view only"
                  : "keyboard and mouse"}
              </strong>{" "}
              access.
            </span>
          </div>
        )}

        {s.end_reason && (
          <div className="end-reason-pill">
            <span>Termination details: {s.end_reason}</span>
          </div>
        )}

        {action.error && <ErrorNotice error={action.error} />}

        {/* Customer Interaction Action Buttons */}
        <div className="session-actions-bar">
          {customer && pending && !expired && (
            <>
              <Button
                variant="destructive"
                disabled={action.isPending}
                onClick={() => action.mutate("decline")}
              >
                <span>Decline Request</span>
              </Button>

              <Button
                variant="outline"
                disabled={action.isPending}
                onClick={() => action.mutate("view")}
              >
                <span>Approve View Only</span>
              </Button>

              {s.requested_mode === "control" && (
                <Button
                  className="action-btn-primary"
                  disabled={action.isPending}
                  onClick={() => action.mutate("control")}
                >
                  <span>Approve Keyboard & Mouse</span>
                </Button>
              )}
            </>
          )}

          {active && !expired && (
            <Button
              variant="outline"
              disabled={action.isPending}
              onClick={() => action.mutate("cancel")}
            >
              {customer ? "Withdraw Permission" : "Cancel Request"}
            </Button>
          )}
        </div>
      </div>

      {/* Session Audit Activity Feed */}
      <div className="session-audit-panel">
        <h2 className="panel-heading">Session Audit Trail</h2>
        <div className="audit-feed-list">
          {s.events?.map((e) => (
            <div key={e.id} className="audit-feed-item">
              <div className="feed-dot" />
              <div className="feed-content">
                <span className="feed-detail">{e.detail}</span>
                <time className="feed-time">
                  {new Date(e.created_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </time>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
