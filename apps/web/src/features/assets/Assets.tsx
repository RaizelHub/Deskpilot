import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Page } from "@/lib/types";
import { useSession } from "@/features/auth/session";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Empty, ErrorNotice, Loading, Pagination } from "@/components/shared";
import { AssetEditor } from "./AssetEditor";
import { categories, statuses, label, date, type Asset } from "./types";

export function Assets() {
  const session = useSession();
  const [editor, setEditor] = useState(false);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    search: "",
    category: "",
    status: "",
    warranty: "",
    sort: "tag",
  });
  const change = (key: keyof typeof filters, value: string) => {
    setFilters({ ...filters, [key]: value });
    setPage(1);
  };
  const assets = useQuery({
    queryKey: ["assets", filters, page],
    queryFn: () =>
      api<Page<Asset>>(
        `/assets?${new URLSearchParams({ ...filters, page: String(page) })}`,
      ),
  });
  const stats = useQuery({
    queryKey: ["assets", "statistics"],
    queryFn: () =>
      api<{
        total: number;
        available: number;
        in_use: number;
        repair: number;
        warranty_expiring: number;
      }>("/asset-statistics"),
  });
  return (
    <>
      <div className="page-heading asset-heading">
        <div>
          <span className="eyebrow">KNOW WHAT YOU OWN</span>
          <h1>Assets</h1>
          <p>Hardware, ownership and warranties in one place.</p>
        </div>
        <div className="button-row">
          {session.data?.permissions.includes("devices.view") && (
            <Link to="/software">Software inventory →</Link>
          )}
          {session.data?.permissions.includes("assets.manage") && (
            <Button icon="add" onClick={() => setEditor(true)}>
              Add asset
            </Button>
          )}
        </div>
      </div>
      {stats.error && <ErrorNotice error={stats.error} />}
      <div className="asset-stats">
        {[
          { label: "Total assets", value: stats.data?.total },
          { label: "Available", value: stats.data?.available },
          { label: "In repair", value: stats.data?.repair },
          {
            label: "Warranty due · 30 days",
            value: stats.data?.warranty_expiring,
          },
        ].map((s) => (
          <section className="panel asset-stat" key={s.label}>
            <span>{s.label}</span>
            <strong>{s.value ?? "—"}</strong>
          </section>
        ))}
      </div>
      <section className="panel">
        <div className="table-toolbar asset-filters">
          <input
            aria-label="Search assets"
            placeholder="Search tag, name or serial…"
            value={filters.search}
            onChange={(e) => change("search", e.target.value)}
          />
          <select
            aria-label="Filter asset category"
            value={filters.category}
            onChange={(e) => change("category", e.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter asset status"
            value={filters.status}
            onChange={(e) => change("status", e.target.value)}
          >
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter warranty"
            value={filters.warranty}
            onChange={(e) => change("warranty", e.target.value)}
          >
            <option value="">All warranties</option>
            {["covered", "expiring", "expired", "unknown"].map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
          <select
            aria-label="Sort assets"
            value={filters.sort}
            onChange={(e) => change("sort", e.target.value)}
          >
            <option value="tag">Asset tag</option>
            <option value="name">Name</option>
            <option value="warranty_expires_on">Warranty date</option>
          </select>
        </div>
        {assets.isPending ? (
          <Loading />
        ) : assets.error ? (
          <ErrorNotice
            error={assets.error}
            retry={() => void assets.refetch()}
          />
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Assigned to</th>
                    <th>Department</th>
                    <th>Warranty</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.data.data.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <Link to={`/assets/${a.id}`}>
                          <strong>{a.tag}</strong>
                        </Link>
                        <small>{a.name}</small>
                      </td>
                      <td>{label(a.category)}</td>
                      <td>
                        <span className={`asset-state ${a.status}`}>
                          {label(a.status)}
                        </span>
                      </td>
                      <td>{a.current_assignment?.user.name ?? "Unassigned"}</td>
                      <td>{a.department?.name ?? "—"}</td>
                      <td>
                        <span className={`asset-state ${a.warranty_state}`}>
                          {label(a.warranty_state)}
                        </span>
                        <small>{date(a.warranty_expires_on)}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {assets.data.data.length === 0 && (
              <Empty>
                No matching assets. Add equipment or adjust your filters.
              </Empty>
            )}
            <Pagination result={assets.data} page={page} onChange={setPage} />
          </>
        )}
      </section>
      <Dialog
        open={editor}
        onOpenChange={setEditor}
        title="Add asset"
        description="Register equipment, purchase details and warranty coverage."
      >
        {editor && <AssetEditor asset={null} close={() => setEditor(false)} />}
      </Dialog>
    </>
  );
}
