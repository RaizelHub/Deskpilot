import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Page } from "@/lib/types";
import { Empty, ErrorNotice, Loading, Pagination } from "@/components/shared";
import { date } from "./types";

type Software = {
  id: string;
  name: string;
  version: string | null;
  publisher: string | null;
  installed_on: string | null;
  last_detected_at: string;
  removed_at: string | null;
  device: {
    id: string;
    name: string;
    revoked_at: string | null;
    software_inventory_at: string | null;
    software_inventory_complete: boolean | null;
  };
};
export function SoftwareInventory() {
  const [params] = useSearchParams();
  const device = params.get("device_id") ?? "";
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    search: "",
    publisher: "",
    status: "present",
    sort: "name",
    direction: "asc",
  });
  const change = (key: keyof typeof filters, value: string) => {
    setFilters({ ...filters, [key]: value });
    setPage(1);
  };
  const rows = useQuery({
    queryKey: ["software", device, filters, page],
    queryFn: () =>
      api<Page<Software>>(
        `/software-inventory?${new URLSearchParams({ ...filters, device_id: device, page: String(page) })}`,
      ),
  });
  const coverage = useQuery({
    queryKey: ["software-coverage"],
    queryFn: () =>
      api<{
        devices: number;
        reported: number;
        fresh_complete: number;
        partial: number;
        scope: string;
      }>("/software-coverage"),
  });
  return (
    <>
      <div className="page-heading asset-heading">
        <div>
          <span className="eyebrow">REPORTED BY YOUR DEVICES</span>
          <h1>Software inventory</h1>
          <p>
            Find applications, compare versions and see where they were
            detected.
          </p>
        </div>
        <Link to="/assets">Hardware assets →</Link>
      </div>
      <section className="panel asset-section">
        <h2>Inventory coverage</h2>
        {coverage.error ? (
          <ErrorNotice error={coverage.error} />
        ) : coverage.isPending ? (
          <Loading />
        ) : (
          <>
            <p>
              <strong>
                {coverage.data.fresh_complete} of {coverage.data.devices}
              </strong>{" "}
              enrolled devices have a complete report from the last eight hours.{" "}
              {coverage.data.partial} latest reports are partial.
            </p>
            <small>
              {coverage.data.scope} Agent 0.7.0 reports at startup and every six
              hours. “Present” means last detected, not a live installation
              check.
            </small>
          </>
        )}
        {device && (
          <p>
            Filtered to one device. <Link to="/software">Show all devices</Link>{" "}
            · <Link to={`/devices/${device}`}>Open device</Link>
          </p>
        )}
      </section>
      <section className="panel">
        <div className="table-toolbar asset-filters">
          <input
            aria-label="Search software"
            placeholder="Application name…"
            value={filters.search}
            onChange={(e) => change("search", e.target.value)}
          />
          <input
            aria-label="Filter publisher"
            placeholder="Publisher…"
            value={filters.publisher}
            onChange={(e) => change("publisher", e.target.value)}
          />
          <select
            aria-label="Software presence"
            value={filters.status}
            onChange={(e) => change("status", e.target.value)}
          >
            <option value="present">Last detected as present</option>
            <option value="removed">No longer detected</option>
            <option value="all">All history</option>
          </select>
          <select
            aria-label="Sort software"
            value={filters.sort}
            onChange={(e) => change("sort", e.target.value)}
          >
            <option value="name">Application</option>
            <option value="publisher">Publisher</option>
            <option value="version">Version (text)</option>
            <option value="last_detected_at">Last detected</option>
          </select>
          <select
            aria-label="Software sort direction"
            value={filters.direction}
            onChange={(e) => change("direction", e.target.value)}
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </div>
        {rows.isPending ? (
          <Loading />
        ) : rows.error ? (
          <ErrorNotice error={rows.error} retry={() => void rows.refetch()} />
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Application</th>
                    <th>Version</th>
                    <th>Device</th>
                    <th>Install/service date</th>
                    <th>Last detected</th>
                    <th>Report</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.data.data.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.name}</strong>
                        <small>{s.publisher ?? "Publisher unknown"}</small>
                      </td>
                      <td>{s.version ?? "Unknown"}</td>
                      <td>
                        <Link to={`/devices/${s.device.id}`}>
                          {s.device.name}
                        </Link>
                        {s.device.revoked_at && <small>Device revoked</small>}
                      </td>
                      <td>{date(s.installed_on)}</td>
                      <td>
                        {date(s.last_detected_at)}
                        <small>
                          {s.removed_at
                            ? `Absent since ${date(s.removed_at)}`
                            : "Present in last observation"}
                        </small>
                      </td>
                      <td>
                        {s.device.software_inventory_complete
                          ? "Complete"
                          : "Partial"}
                        <small>{date(s.device.software_inventory_at)}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.data.data.length && (
              <Empty>
                No matching software reports. Enroll an agent running 0.7.0 or
                adjust your filters.
              </Empty>
            )}
            <Pagination result={rows.data} page={page} onChange={setPage} />
          </>
        )}
      </section>
    </>
  );
}
