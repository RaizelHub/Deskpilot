import { DeviceHealth } from "./Monitoring";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, json } from "@/lib/api";
import { date } from "@/lib/utils";
import type { Page, Department } from "@/lib/types";
import { useSession } from "@/features/auth/session";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { MiniBar } from "@/components/ui/gauge";
import {
  Empty,
  EmptyState,
  ErrorNotice,
  Field,
  Loading,
  Pagination,
  TableSkeleton,
  ZeroSearchResults,
} from "@/components/shared";

interface Hardware {
  os_name: string | null;
  os_version: string | null;
  os_build: string | null;
  cpu_name: string | null;
  cpu_cores: number | null;
  ram_total_bytes: number | null;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  motherboard: string | null;
  gpu: string | null;
  boot_time: string | null;
}

interface Device {
  id: string;
  name: string;
  hostname: string;
  state: string;
  department_id: string | null;
  department: { id: string; name: string } | null;
  agent_version: string;
  last_seen_at: string | null;
  inventory_at: string | null;
  created_at: string;
  revoked_at: string | null;
  revocation_reason: string | null;
  version: number;
  cpu_percent: number | null;
  ram_available_bytes: number | null;
  uptime_seconds: number | null;
  network_connected: boolean | null;
  hardware: Hardware | null;
  disks?: {
    id: string;
    name: string;
    file_system: string | null;
    total_bytes: number;
    free_bytes: number;
  }[];
  interfaces?: {
    id: string;
    name: string;
    mac_address: string | null;
    is_up: boolean;
    addresses: string[];
    gateways: string[];
    dns_servers: string[];
  }[];
}

interface Grant {
  id: string;
  label: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  device_id: string | null;
}

const bytes = (value: number | null | undefined) =>
  value == null ? "Not reported" : `${(value / 1024 ** 3).toFixed(1)} GB`;
const time = (value: string | null) => (value ? date(value) : "Never received");
const title = (v: string) => v[0].toUpperCase() + v.slice(1);

function State({ value }: { value: string }) {
  return (
    <Badge
      variant={
        value === "online"
          ? "success"
          : value === "offline"
            ? "secondary"
            : value === "pending"
              ? "warning"
              : "destructive"
      }
      dot
    >
      {title(value)}
    </Badge>
  );
}

function Enrollment({ close }: { close: () => void }) {
  const [label, setLabel] = useState("");
  const [minutes, setMinutes] = useState(15);
  const client = useQueryClient();
  const create = useMutation({
    mutationFn: () =>
      api<{ data: Grant; token: string }>(
        "/enrollment-grants",
        json("POST", { label, expires_minutes: minutes }),
      ),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["enrollment-grants"] }),
  });

  return (
    <Dialog
      open
      onOpenChange={close}
      title="Enroll Windows Endpoint"
      description="Create a single-use authorization token for the DeskPilot agent service."
    >
      {create.data ? (
        <div className="form-stack">
          <p>
            Grant token created for <strong>{create.data.data.label}</strong>.
            Expires {date(create.data.data.expires_at)}.
          </p>
          <Field
            label="Enrollment Token (shown once)"
            htmlFor="enrollment-token"
          >
            <textarea
              id="enrollment-token"
              readOnly
              rows={3}
              value={create.data.token}
              onFocus={(e) => e.target.select()}
            />
          </Field>
          <p>
            On the target Windows computer, run the installed agent CLI with
            your server address:
          </p>
          <code className="agent-command">
            DeskPilot.Agent.Service.exe enroll --server https://deskpilot-server
          </code>
          <p className="footnote">
            Paste this token at the prompt. Keep it private until consumed.
          </p>
          <div className="modal-actions-bar">
            <Button onClick={close}>Done</Button>
          </div>
        </div>
      ) : (
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Computer / Location Identifier" htmlFor="grant-label">
            <input
              id="grant-label"
              required
              placeholder="e.g. Accounting Workstation 04"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <Field label="Token Expiration (minutes)" htmlFor="grant-minutes">
            <input
              id="grant-minutes"
              type="number"
              min={5}
              max={1440}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
          </Field>
          {create.error && <ErrorNotice error={create.error} />}
          <div className="modal-actions-bar">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button icon="add" type="submit" disabled={create.isPending}>
              {create.isPending ? "Generating…" : "Generate Grant Token"}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function Grants() {
  const [page, setPage] = useState(1);
  const client = useQueryClient();
  const q = useQuery({
    queryKey: ["enrollment-grants", page],
    queryFn: () => api<Page<Grant>>(`/enrollment-grants?page=${page}`),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/enrollment-grants/${id}`, json("DELETE")),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["enrollment-grants"] }),
  });

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Enrollment Grants</h2>
          <p className="footnote">
            Single-use tokens issued for agent provisioning
          </p>
        </div>
      </div>
      {q.isPending ? (
            <TableSkeleton columns={10} rows={7} />
          ) : q.error ? (
        <ErrorNotice error={q.error} />
      ) : (
        <>
          <div className="table-responsive-container">
            <table className="tickets-data-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Status</th>
                  <th>Expires</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {q.data.data.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <strong>{g.label}</strong>
                    </td>
                    <td>
                      <Badge
                        variant={
                          g.used_at
                            ? "success"
                            : g.revoked_at
                              ? "destructive"
                              : "warning"
                        }
                      >
                        {g.used_at
                          ? "Consumed"
                          : g.revoked_at
                            ? "Revoked"
                            : "Awaiting use"}
                      </Badge>
                    </td>
                    <td>{date(g.expires_at)}</td>
                    <td>
                      {!g.used_at && !g.revoked_at && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={revoke.isPending}
                          onClick={() => revoke.mutate(g.id)}
                        >
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!q.data.data.length && (
            <Empty>No active enrollment grants found.</Empty>
          )}
          <Pagination result={q.data} page={page} onChange={setPage} />
        </>
      )}
    </section>
  );
}

export function Devices() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const session = useSession();
  const manage = session.data?.permissions.includes("devices.manage");
  const [enroll, setEnroll] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [state, setState] = useState("");
  const [grants, setGrants] = useState(false);

  const q = useQuery({
    queryKey: ["devices", "list", page, search, state],
    queryFn: () =>
      api<Page<Device>>(
        `/devices?page=${page}&search=${encodeURIComponent(search)}&state=${state}`,
      ),
    refetchInterval: 30000,
  });

  const stats = useQuery({
    queryKey: ["devices", "stats"],
    queryFn: () =>
      api<{
        total: number;
        online: number;
        offline: number;
        pending: number;
        revoked: number;
        offline_seconds: number;
      }>("/device-statistics"),
    refetchInterval: 30000,
  });

  return (
    <div className="devices-page-container">
      {/* Page Header */}
      <div className="page-heading">
        <div>
          <div className="eyebrow-chip">
            <span className="eyebrow-dot" /> ENDPOINT TELEMETRY & INVENTORY
          </div>
          <h1>Computers & Endpoints</h1>
          <p>
            Live health metrics, hardware specs, and consent-based assistance
            for enrolled Windows devices.
          </p>
        </div>

        {manage && (
          <Button
            onClick={() => setEnroll(true)}
            className="action-btn-primary"
          >
            <span>Enroll Computer</span>
          </Button>
        )}
      </div>

      {/* RMM Summary Ribbon (Matching Reference Image #3) */}
      {stats.data && (
        <div className="rmm-summary-ribbon">
          <div className="rmm-ribbon-badge">
            <span className="ribbon-label">All:</span>
            <strong>{stats.data.total}</strong>
          </div>
          <div className="rmm-ribbon-badge tone-success">
            <span className="ribbon-dot success" />
            <span className="ribbon-label">Online:</span>
            <strong>{stats.data.online}</strong>
          </div>
          <div className="rmm-ribbon-badge tone-neutral">
            <span className="ribbon-dot neutral" />
            <span className="ribbon-label">Offline:</span>
            <strong>{stats.data.offline}</strong>
          </div>
          <div className="rmm-ribbon-badge tone-warning">
            <span className="ribbon-dot warning" />
            <span className="ribbon-label">Pending:</span>
            <strong>{stats.data.pending}</strong>
          </div>
          {stats.data.revoked > 0 && (
            <div className="rmm-ribbon-badge tone-danger">
              <span className="ribbon-dot danger" />
              <span className="ribbon-label">Revoked:</span>
              <strong>{stats.data.revoked}</strong>
            </div>
          )}
        </div>
      )}

      {/* Navigation View Switcher (Inventory vs Grants) */}
      <div className="device-view-tabs">
        <button
          className={`queue-tab-item ${!grants ? "active" : ""}`}
          onClick={() => setGrants(false)}
        >
          <span>Device Inventory</span>
        </button>
        {manage && (
          <button
            className={`queue-tab-item ${grants ? "active" : ""}`}
            onClick={() => setGrants(true)}
          >
            <span>Enrollment Grants</span>
          </button>
        )}
      </div>

      {grants ? (
        <Grants />
      ) : (
        <div className="tickets-table-panel">
          {/* Search & Filter Bar */}
          <div className="ticket-filter-bar">
            <div className="filter-search-box">
              <input
                aria-label="Search devices"
                placeholder="Search computer name, hostname, or serial…"
                maxLength={100}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>

            <div className="filter-selects-row">
              <select
                aria-label="Filter device state"
                value={state}
                onChange={(e) => {
                  setState(e.target.value);
                  setPage(1);
                }}
                className="filter-select"
              >
                <option value="">All States</option>
                <option value="online">Online</option>
                <option value="offline">Offline</option>
                <option value="pending">Pending</option>
                <option value="revoked">Revoked</option>
              </select>

              <Button
                icon="refresh"
                variant="outline"
                size="sm"
                onClick={() =>
                  void client.invalidateQueries({ queryKey: ["devices"] })
                }
              >
                <span>Refresh</span>
              </Button>
            </div>
          </div>

          {/* RMM Computer Table (Datto / NinjaOne style) */}
          {q.isPending ? (
            <Loading />
          ) : q.error ? (
            <ErrorNotice error={q.error} retry={() => void q.refetch()} />
          ) : (
            <>
              <div className="table-responsive-container">
                <table className="tickets-data-table rmm-table">
                  <thead>
                    <tr>
                      <th style={{ width: 44 }}>OS</th>
                      <th>Computer & Hostname</th>
                      <th>Status</th>
                      <th>Agent Version</th>
                      <th>RMM Disk</th>
                      <th>RMM CPU</th>
                      <th>RMM Memory</th>
                      <th>Department</th>
                      <th>Last Seen</th>
                      <th style={{ textAlign: "right" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.data.map((d) => {
                      // Calculate disk usage if available
                      const primaryDisk = d.disks?.[0];
                      const diskPct =
                        primaryDisk && primaryDisk.total_bytes > 0
                          ? ((primaryDisk.total_bytes -
                              primaryDisk.free_bytes) /
                              primaryDisk.total_bytes) *
                            100
                          : null;

                      // Calculate RAM usage if available
                      const totalRam = d.hardware?.ram_total_bytes;
                      const availRam = d.ram_available_bytes;
                      const ramPct =
                        totalRam && availRam != null && totalRam > 0
                          ? ((totalRam - availRam) / totalRam) * 100
                          : null;

                      return (
                        <tr
                          key={d.id}
                          className="device-table-row"
                          onClick={() => navigate(`/devices/${d.id}`)}
                        >
                          <td className="os-icon-cell">
                            <div
                              className="os-badge-box"
                              title={d.hardware?.os_name ?? "OS not reported"}
                            >{d.hardware?.os_name?.includes("Windows") ? "Win" : "OS"}</div>
                          </td>

                          <td className="device-info-cell">
                            <div className="device-name-stack">
                              <span className="device-name-bold">{d.name}</span>
                              <span className="device-hostname-code">
                                {d.hostname}
                              </span>
                            </div>
                          </td>

                          <td>
                            <State value={d.state} />
                          </td>

                          <td>
                            <span className="agent-version-tag">
                              v{d.agent_version}
                            </span>
                          </td>

                          {/* RMM Gauges (Disk, CPU, RAM) */}
                          <td className="rmm-gauge-cell">
                            <MiniBar
                              value={diskPct}
                              title={diskPct == null ? "Disk not reported" : `Disk: ${Math.round(diskPct)}% used`}
                            />
                          </td>

                          <td className="rmm-gauge-cell">
                            <MiniBar
                              value={d.cpu_percent}
                              title={d.cpu_percent == null ? "CPU not reported" : `CPU: ${Math.round(d.cpu_percent)}%`}
                            />
                          </td>

                          <td className="rmm-gauge-cell">
                            <MiniBar
                              value={ramPct}
                              title={ramPct == null ? "Memory not reported" : `Memory: ${Math.round(ramPct)}% used`}
                            />
                          </td>

                          <td>
                            <span className="department-name-pill">
                              {d.department?.name ?? "Unassigned"}
                            </span>
                          </td>

                          <td>
                            <span className="heartbeat-timestamp">
                              {time(d.last_seen_at)}
                            </span>
                          </td>

                          <td
                            style={{ textAlign: "right" }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="device-action-buttons">
                              {session.data?.permissions.includes(
                                "remote.request",
                              ) &&
                                d.state === "online" && (
                                  <Button
                                    size="sm"
                                    className="connect-btn"
                                    onClick={() =>
                                      navigate(
                                        `/remote-support?device_id=${d.id}`,
                                      )
                                    }
                                  >
                                    <span>Connect</span>
                                  </Button>
                                )}

                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => navigate(`/devices/${d.id}`)}
                              >
                                View
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {!q.data.data.length && (
                search || state !== "all" ? (
                  <ZeroSearchResults
                    query={search}
                    title={search ? `No endpoints matching “${search}”` : "No endpoints match the selected filters"}
                    suggestions={["computer name", "hostname", "serial number"]}
                    onClear={() => {
                      setSearch("");
                      setState("all");
                      setPage(1);
                    }}
                  />
                ) : (
                  <EmptyState
                    title="No registered endpoints yet"
                    description="Enroll a Windows agent service on client computers to start monitoring real-time metrics, disks, health, and remote control."
                    action={
                      manage ? (
                        <Button size="sm" onClick={() => setEnroll(true)}>
                          Enroll Endpoint
                        </Button>
                      ) : undefined
                    }
                  />
                )
              )}

              <Pagination result={q.data} page={page} onChange={setPage} />
            </>
          )}
        </div>
      )}

      {enroll && <Enrollment close={() => setEnroll(false)} />}
    </div>
  );
}

function DeviceEditor({
  device,
  close,
}: {
  device: Device;
  close: () => void;
}) {
  const [initial] = useState(device);
  const [name, setName] = useState(initial.name);
  const [department, setDepartment] = useState(initial.department_id ?? "");
  const client = useQueryClient();
  const q = useQuery({
    queryKey: ["device-departments"],
    queryFn: () => api<Page<Department>>("/departments?per_page=100"),
  });
  const save = useMutation({
    mutationFn: () =>
      api(
        `/devices/${initial.id}`,
        json("PATCH", {
          name,
          department_id: department || null,
          version: initial.version,
        }),
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["devices"] });
      close();
    },
  });

  return (
    <Dialog
      open
      onOpenChange={close}
      title="Edit Computer Details"
      description="Update device display label and assigned organizational department."
    >
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Device Display Name" htmlFor="device-name">
          <input
            id="device-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Department" htmlFor="device-department">
          <select
            id="device-department"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          >
            <option value="">Unassigned</option>
            {q.data?.data.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        {save.error && <ErrorNotice error={save.error} />}
        <div className="modal-actions-bar">
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button icon="save" type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function DeviceDetail() {
  const { id } = useParams();
  const [edit, setEdit] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [reason, setReason] = useState("");
  const session = useSession();
  const client = useQueryClient();
  const manage = session.data?.permissions.includes("devices.manage");
  const q = useQuery({
    queryKey: ["devices", id],
    queryFn: () => api<{ data: Device }>(`/devices/${id}`),
    refetchInterval: 15000,
  });
  const revoke = useMutation({
    mutationFn: () => api(`/devices/${id}/revoke`, json("POST", { reason })),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["devices"] });
      setRevokeOpen(false);
    },
  });

  if (q.isPending) return <Loading />;
  if (q.error)
    return <ErrorNotice error={q.error} retry={() => void q.refetch()} />;

  const d = q.data.data;
  const h = d.hardware;

  return (
    <div className="device-detail-container">
      <Link className="back-link" to="/devices">
        ← Back to Computers
      </Link>

      <div className="device-detail-header">
        <div>
          <div className="eyebrow-chip">
            <span className="eyebrow-dot" /> HOSTNAME: {d.hostname}
          </div>
          <h1>{d.name}</h1>
          <p>
            Enrolled {date(d.created_at)} · Agent version {d.agent_version} ·{" "}
            {d.department?.name ?? "No department assigned"}
          </p>
        </div>

        <div className="detail-action-buttons">
          <State value={d.state} />

          {session.data?.permissions.includes("remote.request") &&
            d.state === "online" && (
              <Button
                className="action-btn-primary"
                onClick={() =>
                  (window.location.href = `/remote-support?device_id=${d.id}`)
                }
              >
                <span>Start Remote Session</span>
              </Button>
            )}

          {session.data?.permissions.includes("devices.diagnostics") && (
            <Link
              to={`/devices/${d.id}/diagnostics`}
              className="action-btn-outline"
            >
              <span>Run Diagnostics</span>
            </Link>
          )}

          {manage && (
            <Button icon="edit" variant="outline" onClick={() => setEdit(true)}>
              <span>Edit</span>
            </Button>
          )}

          {manage && !d.revoked_at && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setRevokeOpen(true)}
            >
              <span>Revoke</span>
            </Button>
          )}
        </div>
      </div>

      <DeviceHealth id={d.id} />

      {/* Real-time Telemetry Metrics Grid */}
      <div className="telemetry-metrics-grid">
        <div className="telemetry-card">
          <div className="telemetry-header">
            <span>CPU Usage</span>
          </div>
          <strong className="telemetry-value">
            {d.cpu_percent == null ? "—" : `${d.cpu_percent.toFixed(1)}%`}
          </strong>
          <MiniBar value={d.cpu_percent} />
        </div>

        <div className="telemetry-card">
          <div className="telemetry-header">
            <span>Available RAM</span>
          </div>
          <strong className="telemetry-value">
            {bytes(d.ram_available_bytes)}
          </strong>
          <small className="telemetry-hint">
            Total: {bytes(h?.ram_total_bytes)}
          </small>
        </div>

        <div className="telemetry-card">
          <div className="telemetry-header">
            <span>System Uptime</span>
          </div>
          <strong className="telemetry-value">
            {d.uptime_seconds == null
              ? "—"
              : `${Math.floor(d.uptime_seconds / 3600)}h ${Math.floor((d.uptime_seconds % 3600) / 60)}m`}
          </strong>
          <small className="telemetry-hint">
            Last seen: {time(d.last_seen_at)}
          </small>
        </div>

        <div className="telemetry-card">
          <div className="telemetry-header">
            <span>Network Status</span>
          </div>
          <strong className="telemetry-value">
            {d.network_connected == null
              ? "Unknown"
              : d.network_connected
                ? "Connected"
                : "Disconnected"}
          </strong>
          <small className="telemetry-hint">
            Interfaces: {d.interfaces?.length ?? 0}
          </small>
        </div>
      </div>

      {/* Hardware Specifications Panel */}
      <div className="specs-section-grid">
        <div className="specs-card">
          <h2 className="specs-card-title">Hardware Specifications</h2>
          {h ? (
            <dl className="specs-list">
              <div>
                <dt>Processor</dt>
                <dd>
                  {h.cpu_name ?? "Not reported"} ({h.cpu_cores ?? "—"} cores)
                </dd>
              </div>
              <div>
                <dt>Operating System</dt>
                <dd>
                  {h.os_name ?? "Windows"} {h.os_version ?? ""} (Build{" "}
                  {h.os_build ?? "—"})
                </dd>
              </div>
              <div>
                <dt>Motherboard</dt>
                <dd>{h.motherboard ?? "Not reported"}</dd>
              </div>
              <div>
                <dt>Manufacturer / Model</dt>
                <dd>
                  {h.manufacturer ?? "Generic"} · {h.model ?? "Workstation"}
                </dd>
              </div>
              <div>
                <dt>Serial Number</dt>
                <dd>
                  <code>{h.serial_number ?? "Not reported"}</code>
                </dd>
              </div>
              <div>
                <dt>GPU / Graphics</dt>
                <dd>{h.gpu ?? "Standard display adapter"}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-muted">
              Awaiting initial hardware inventory scan from agent.
            </p>
          )}
        </div>

        {/* Disks & Storage Panel */}
        <div className="specs-card">
          <h2 className="specs-card-title">Storage Drives</h2>
          {d.disks?.length ? (
            <div className="disks-list">
              {d.disks.map((disk) => {
                const used = disk.total_bytes - disk.free_bytes;
                const pct =
                  disk.total_bytes > 0 ? (used / disk.total_bytes) * 100 : 0;
                return (
                  <div key={disk.id} className="disk-item">
                    <div className="disk-header">
                      <strong>
                        {disk.name} ({disk.file_system ?? "NTFS"})
                      </strong>
                      <span>
                        {bytes(disk.free_bytes)} free of{" "}
                        {bytes(disk.total_bytes)}
                      </span>
                    </div>
                    <MiniBar value={pct} />
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-muted">No disk inventory reported yet.</p>
          )}
        </div>
      </div>

      {/* Dialogs */}
      {edit && <DeviceEditor device={d} close={() => setEdit(false)} />}

      {revokeOpen && (
        <Dialog
          open
          onOpenChange={() => setRevokeOpen(false)}
          title="Revoke Device Authorization"
          description="Revoking this computer will invalidate its agent credentials and prevent further check-ins."
        >
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              revoke.mutate();
            }}
          >
            <Field label="Revocation Reason" htmlFor="revoke-reason">
              <textarea
                id="revoke-reason"
                required
                rows={3}
                placeholder="e.g. Decommissioned asset or transferred to another department"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            {revoke.error && <ErrorNotice error={revoke.error} />}
            <div className="modal-actions-bar">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRevokeOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={revoke.isPending}
              >
                {revoke.isPending ? "Revoking…" : "Confirm Revocation"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
