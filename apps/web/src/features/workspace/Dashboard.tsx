import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Role, AuditEntry, Page } from "@/lib/types";
import type { Ticket as TicketType } from "@/features/tickets/types";
import { label } from "@/features/tickets/types";
import { date } from "@/lib/utils";
import { useSession } from "@/features/auth/session";
import { Empty, ErrorNotice, Loading, Pagination } from "@/components/shared";
import { MonitoringSummary } from "@/features/devices/Monitoring";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Stats {
  open: number;
  in_progress: number;
  overdue: number;
  resolved_today: number;
  critical: number;
  unassigned: number;
  average_resolution_minutes: number | null;
  volume: { date: string; count: number }[];
  recent: TicketType[];
}

export function Dashboard() {
  const session = useSession();
  const navigate = useNavigate();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const devices = useQuery({
    queryKey: ["devices", "stats"],
    queryFn: () =>
      api<{ total: number; online: number; offline: number; pending: number }>(
        "/device-statistics",
      ),
    enabled: session.data?.permissions.includes("devices.view") ?? false,
    refetchInterval: 30000,
  });

  const q = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<{ tickets: Stats }>("/dashboard"),
    refetchInterval: 30000,
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([q.refetch(), devices.refetch()]);
    setTimeout(() => setIsRefreshing(false), 500);
  };

  if (q.isPending) return <Loading />;
  if (q.error)
    return <ErrorNotice error={q.error} retry={() => void q.refetch()} />;

  const s = q.data.tickets;
  const maxVolume = Math.max(1, ...s.volume.map((v) => v.count));
  const userName = session.data?.user.name.split(" ")[0] ?? "Technician";

  return (
    <div className="dashboard-container">
      {/* Overview Top Header */}
      <div className="dashboard-header-bar">
        <div className="dashboard-header-title">
          <div className="eyebrow-chip">
            <span className="eyebrow-dot" /> IT SERVICE DESK & OPERATIONS
          </div>
          <h1 className="dashboard-headline">Welcome back, {userName}</h1>
          <p className="dashboard-subheadline">
            Real-time status of support tickets, endpoint telemetry, and
            customer assistance.
          </p>
        </div>

        <div className="dashboard-header-actions">
          <Button
            icon="refresh"
            variant="outline"
            size="sm"
            className="action-btn"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <span>Refresh</span>
          </Button>

          {session.data?.permissions.includes("tickets.create") && (
            <Button
              icon="add"
              size="sm"
              className="action-btn-primary"
              onClick={() => navigate("/tickets?new=1")}
            >
              <span>New Ticket</span>
            </Button>
          )}
        </div>
      </div>

      {/* KPI Cards Row (Panze / Linear Style) */}
      <div className="dashboard-kpi-grid">
        {/* Open Tickets */}
        <div className="kpi-card" onClick={() => navigate("/tickets")}>
          <div className="kpi-header">
            <span className="kpi-title">Open Tickets</span>
          </div>
          <div className="kpi-body">
            <span className="kpi-value">{s.open}</span>
            <div className="kpi-meta">
              <span className="kpi-tag tone-primary">Active queue</span>
              <span className="kpi-hint">{s.unassigned} unassigned</span>
            </div>
          </div>
        </div>

        {/* In Progress */}
        <div className="kpi-card" onClick={() => navigate("/tickets")}>
          <div className="kpi-header">
            <span className="kpi-title">In Progress</span>
          </div>
          <div className="kpi-body">
            <span className="kpi-value">{s.in_progress}</span>
            <div className="kpi-meta">
              <span className="kpi-tag tone-info">Underway</span>
              <span className="kpi-hint">Technicians assigned</span>
            </div>
          </div>
        </div>

        {/* Overdue */}
        <div className="kpi-card" onClick={() => navigate("/tickets")}>
          <div className="kpi-header">
            <span className="kpi-title">Overdue</span>
            <div
              className={`kpi-icon-box ${s.overdue > 0 ? "tone-danger" : "tone-neutral"}`}
            ></div>
          </div>
          <div className="kpi-body">
            <span className={`kpi-value ${s.overdue > 0 ? "text-danger" : ""}`}>
              {s.overdue}
            </span>
            <div className="kpi-meta">
              <span
                className={`kpi-tag ${s.overdue > 0 ? "tone-danger" : "tone-neutral"}`}
              >
                {s.overdue > 0 ? "SLA Breached" : "SLA on track"}
              </span>
              <span className="kpi-hint">{s.critical} critical priority</span>
            </div>
          </div>
        </div>

        {/* Resolved Today */}
        <div className="kpi-card" onClick={() => navigate("/tickets")}>
          <div className="kpi-header">
            <span className="kpi-title">Resolved Today</span>
          </div>
          <div className="kpi-body">
            <span className="kpi-value">{s.resolved_today}</span>
            <div className="kpi-meta">
              <span className="kpi-tag tone-success">Closed today</span>
              <span className="kpi-hint">
                {s.average_resolution_minutes !== null
                  ? `Avg ${s.average_resolution_minutes}m`
                  : "No data"}
              </span>
            </div>
          </div>
        </div>

        {/* Online Endpoints */}
        {devices.data && (
          <div className="kpi-card" onClick={() => navigate("/devices")}>
            <div className="kpi-header">
              <span className="kpi-title">Online Endpoints</span>
            </div>
            <div className="kpi-body">
              <span className="kpi-value">{devices.data.online}</span>
              <div className="kpi-meta">
                <span className="kpi-tag tone-success">
                  {devices.data.total > 0
                    ? `${Math.round((devices.data.online / devices.data.total) * 100)}% online`
                    : "0 registered"}
                </span>
                <span className="kpi-hint">{devices.data.total} total</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Main 2-Column Analytical Section */}
      <div className="dashboard-main-grid">
        {/* Left Column: Weekly Volume Chart */}
        <div className="chart-panel">
          <div className="panel-title-row">
            <div>
              <h2 className="panel-heading">Ticket Inflow & Volume</h2>
              <p className="panel-subheading">
                Number of support requests opened each day this week
              </p>
            </div>
            <div className="chart-legend">
              <span className="legend-indicator" />
              <span className="legend-label">Daily Volume</span>
            </div>
          </div>

          <div className="bar-chart-container">
            {s.volume.map((item) => {
              const heightPct = Math.max(8, (item.count / maxVolume) * 100);
              return (
                <div key={item.date} className="bar-column">
                  <span className="bar-count-tooltip">{item.count}</span>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ height: `${heightPct}%` }}
                    />
                  </div>
                  <span className="bar-date-label">
                    {item.date.slice(5).replace("-", "/")}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="chart-footer-metrics">
            <div className="footer-metric-pill">
              <span className="footer-metric-label">
                Average Resolution Time:
              </span>
              <strong>
                {s.average_resolution_minutes !== null
                  ? `${s.average_resolution_minutes} minutes`
                  : "No completed tickets"}
              </strong>
            </div>
            <div className="footer-metric-pill">
              <span className="footer-metric-label">Critical Incidents:</span>
              <strong className={s.critical > 0 ? "text-danger" : ""}>
                {s.critical}
              </strong>
            </div>
          </div>
        </div>

        {/* Right Column: Operational Snapshot & Endpoint Health */}
        <div className="snapshot-panel">
          <div className="panel-title-row">
            <div>
              <h2 className="panel-heading">Operational Status</h2>
              <p className="panel-subheading">
                Infrastructure & service targets
              </p>
            </div>
          </div>

          <div className="operational-checklist">
            <div className="op-item">
              <div className="op-content">
                <strong>Ticket Queue Allocation</strong>
                <p>{s.unassigned} requests awaiting technician assignment</p>
              </div>
              <Link to="/tickets" className="op-link">
                View
              </Link>
            </div>

            {devices.data && (
              <div className="op-item">
                <div className="op-content">
                  <strong>Endpoint Availability</strong>
                  <p>
                    {devices.data.online} online · {devices.data.offline}{" "}
                    offline · {devices.data.pending} pending enrollment
                  </p>
                </div>
                <Link to="/devices" className="op-link">
                  Manage
                </Link>
              </div>
            )}

            <div className="op-item">
              <div className="op-content">
                <strong>Consent-Based Remote Support</strong>
                <p>Customer requests and recorded approvals</p>
              </div>
              <Link to="/remote-support" className="op-link">
                Sessions
              </Link>
            </div>
          </div>

          <div className="roadmap-callout-box">
            <div className="callout-header">
              <strong>Automated Diagnostics Ready</strong>
            </div>
            <p>
              Gather hardware inventory, CPU loads, memory usage, and execute
              authorized diagnostic checks across Windows endpoints.
            </p>
            <Link to="/devices" className="callout-link">
              Explore diagnostics
            </Link>
          </div>
        </div>
      </div>

      {/* Recent Support Tickets Table Panel */}
      <div className="recent-tickets-panel">
        <div className="panel-title-row">
          <div>
            <h2 className="panel-heading">Recent Support Tickets</h2>
            <p className="panel-subheading">
              Latest requests received across departments
            </p>
          </div>
          <Link to="/tickets" className="panel-action-link">
            Open full queue
          </Link>
        </div>

        {s.recent.length > 0 ? (
          <div className="recent-table-wrap">
            <table className="recent-table">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Category</th>
                  <th>Requester</th>
                  <th>Last Updated</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {s.recent.map((t) => (
                  <tr key={t.id} onClick={() => navigate(`/tickets/${t.id}`)}>
                    <td>
                      <div className="ticket-title-cell">
                        <span className="ticket-number-badge">{t.number}</span>
                        <span className="ticket-subject">{t.title}</span>
                      </div>
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
                                : "secondary"
                        }
                        dot
                      >
                        {label(t.status)}
                      </Badge>
                    </td>
                    <td>
                      <span className={`priority-pill priority-${t.priority}`}>
                        {t.priority}
                      </span>
                    </td>
                    <td>
                      <span className="category-text">
                        {t.category?.name ?? "General"}
                      </span>
                    </td>
                    <td>
                      <span className="requester-name">
                        {t.requester?.name ?? "Staff"}
                      </span>
                    </td>
                    <td>
                      <span className="updated-time">{date(t.updated_at)}</span>
                    </td>
                    <td>
                      <Link
                        to={`/tickets/${t.id}`}
                        className="table-view-btn"
                        onClick={(e) => e.stopPropagation()}
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>
            <div className="empty-dashboard-tickets">
              <p>
                No active requests found. Create your first ticket to get
                started.
              </p>
              <Button
                icon="add"
                size="sm"
                onClick={() => navigate("/tickets?new=1")}
              >
                Create Ticket
              </Button>
            </div>
          </Empty>
        )}
      </div>

      {/* Monitoring Summary & Device Alert Section */}
      <MonitoringSummary />
    </div>
  );
}

export function Roles() {
  const q = useQuery({
    queryKey: ["roles"],
    queryFn: () => api<{ data: Role[] }>("/roles"),
  });

  return (
    <div className="roles-page-container">
      <div className="page-heading">
        <div>
          <span className="eyebrow">ACCESS CONTROL & GOVERNANCE</span>
          <h1>Roles & Permissions</h1>
          <p>
            RBAC permission templates defining operational authorities across
            DeskPilot.
          </p>
        </div>
      </div>

      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorNotice error={q.error} />
      ) : (
        <div className="roles-grid">
          {q.data.data.map((r) => (
            <div className="role-card" key={r.id}>
              <div className="role-card-header">
                <div>
                  <h2 className="role-name">{r.name}</h2>
                  <span className="role-slug-code">{r.slug}</span>
                </div>
                <Badge variant="primary">
                  {r.permissions?.length ?? 0} grants
                </Badge>
              </div>

              <div className="permissions-badge-wrap">
                {r.permissions?.map((p) => (
                  <span key={p.id} className="permission-tag">
                    {p.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Audit() {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["audit-logs", page],
    queryFn: () => api<Page<AuditEntry>>(`/audit-logs?page=${page}`),
  });

  return (
    <div className="audit-page-container">
      <div className="page-heading">
        <div>
          <span className="eyebrow">IMMUTABLE COMPLIANCE RECORDS</span>
          <h1>Security Audit Log</h1>
          <p>
            Chronological record of logins, administrative mutations, and remote
            support authorizations.
          </p>
        </div>
      </div>

      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorNotice error={q.error} />
      ) : (
        <div className="audit-table-panel">
          <div className="recent-table-wrap">
            <table className="recent-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Actor</th>
                  <th>IP Address</th>
                  <th>Resource</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {q.data.data.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <span className="audit-event-badge">{e.action}</span>
                    </td>
                    <td>
                      <span className="audit-actor">
                        {e.actor?.name ?? "System"}
                      </span>
                    </td>
                    <td>
                      <code className="audit-ip">{e.ip_address ?? "—"}</code>
                    </td>
                    <td>
                      <span className="audit-resource">
                        {e.target_type
                          ? `${e.target_type.split("\\").pop()} #${e.target_id?.slice(0, 8)}`
                          : "—"}
                      </span>
                    </td>
                    <td>
                      <span className="updated-time">{date(e.created_at)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination result={q.data} page={page} onChange={setPage} />
        </div>
      )}
    </div>
  );
}

export function Roadmap() {
  return (
    <div className="roadmap-container">
      <div className="page-heading">
        <div>
          <span className="eyebrow">PRODUCT EVOLUTION</span>
          <h1>DeskPilot Architectural Roadmap</h1>
          <p>
            Planned capabilities for enterprise IT technical support and fleet
            management.
          </p>
        </div>
      </div>

      <div className="roadmap-grid">
        <div className="roadmap-card completed">
          <div className="roadmap-badge-row">
            <Badge variant="success">Completed · Active</Badge>
          </div>
          <h3>Foundation, RBAC & Helpdesk</h3>
          <p>
            Full session authentication, 6 seeded roles, 30+ permissions, ticket
            workflows, SLA policies, and internal notes.
          </p>
        </div>

        <div className="roadmap-card completed">
          <div className="roadmap-badge-row">
            <Badge variant="success">Completed · Active</Badge>
          </div>
          <h3>Endpoint Telemetry & RMM Inventory</h3>
          <p>
            Windows agent enrollment, hardware detection, CPU/RAM/Disk gauge
            monitoring, and alert threshold evaluation.
          </p>
        </div>

        <div className="roadmap-card active-phase">
          <div className="roadmap-badge-row">
            <Badge variant="info">In Development · Phase 6</Badge>
          </div>
          <h3>Consent-Based Remote Assistance</h3>
          <p>
            Audited invitation approval workflow, 5-minute timed sessions, view
            vs control permissions, and RustDesk protocol integration.
          </p>
        </div>
      </div>
    </div>
  );
}
