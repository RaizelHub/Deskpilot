import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Page } from "@/lib/types";
import { useSession } from "@/features/auth/session";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Empty, ErrorNotice, Loading, Pagination } from "@/components/shared";
import { AssetEditor } from "./AssetEditor";
import { AssignmentEditor } from "./AssignmentEditor";
import { label, date, type Asset, type Assignment, type Named } from "./types";

export function AssetDetail() {
  const { id } = useParams();
  const session = useSession();
  const [editor, setEditor] = useState<"details" | "assign" | "return" | null>(
    null,
  );
  const [assignmentPage, setAssignmentPage] = useState(1);
  const [eventPage, setEventPage] = useState(1);
  const detail = useQuery({
    queryKey: ["assets", id],
    queryFn: () => api<{ data: Asset }>(`/assets/${id}`),
  });
  const assignments = useQuery({
    queryKey: ["assets", id, "assignments", assignmentPage],
    queryFn: () =>
      api<Page<Assignment>>(`/assets/${id}/assignments?page=${assignmentPage}`),
  });
  const events = useQuery({
    queryKey: ["assets", id, "events", eventPage],
    queryFn: () =>
      api<
        Page<{
          id: number;
          action: string;
          detail: string;
          actor: Named;
          created_at: string;
        }>
      >(`/assets/${id}/history?page=${eventPage}`),
  });
  if (detail.isPending) return <Loading />;
  if (detail.error)
    return (
      <ErrorNotice error={detail.error} retry={() => void detail.refetch()} />
    );
  const a = detail.data.data;
  const canManage = session.data?.permissions.includes("assets.manage");
  return (
    <>
      <Link to="/assets">← All assets</Link>
      <div className="page-heading asset-heading">
        <div>
          <span className="eyebrow">{a.tag}</span>
          <h1>{a.name}</h1>
          <p>
            {label(a.category)} · {a.location ?? "Location not recorded"}
          </p>
        </div>
        <div className="button-row">
          <span className={`asset-state ${a.status}`}>{label(a.status)}</span>
          {canManage && (
            <Button
              icon="edit"
              variant="outline"
              onClick={() => setEditor("details")}
            >
              Edit asset
            </Button>
          )}
        </div>
      </div>
      <div className="asset-detail-grid">
        <section className="panel asset-section">
          <h2>Equipment details</h2>
          <dl className="asset-facts">
            {[
              ["Manufacturer", a.manufacturer],
              ["Model", a.model],
              ["Serial number", a.serial_number],
              ["Department", a.department?.name],
              ["Purchase date", date(a.purchased_on)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v ?? "Not recorded"}</dd>
              </div>
            ))}
          </dl>
          {a.device && (
            <p>
              Linked device:{" "}
              {session.data?.permissions.includes("devices.view") ? (
                <Link to={`/devices/${a.device.id}`}>{a.device.name}</Link>
              ) : (
                a.device.name
              )}
            </p>
          )}
          {a.device && session.data?.permissions.includes("devices.view") && (
            <Link to={`/software?device_id=${a.device.id}`}>
              View detected software →
            </Link>
          )}
          {a.notes && (
            <>
              <h3>Notes</h3>
              <p className="asset-notes">{a.notes}</p>
            </>
          )}
        </section>
        <div>
          <section className="panel asset-section">
            <h2>Current assignment</h2>
            <strong>{a.current_assignment?.user.name ?? "Unassigned"}</strong>
            <p>
              {a.current_assignment
                ? `Assigned ${date(a.current_assignment.assigned_at)}`
                : "Ready for an assignment when its status is Available."}
            </p>
            <div className="button-row">
              {canManage && ["available", "in_use"].includes(a.status) && (
                <Button onClick={() => setEditor("assign")}>
                  {a.current_assignment ? "Reassign asset" : "Assign asset"}
                </Button>
              )}
              {canManage && a.current_assignment && (
                <Button variant="outline" onClick={() => setEditor("return")}>
                  Return asset
                </Button>
              )}
            </div>
          </section>
          <section className="panel asset-section">
            <h2>Warranty</h2>
            <span className={`asset-state ${a.warranty_state}`}>
              {label(a.warranty_state)}
            </span>
            <p>Expiration: {date(a.warranty_expires_on)}</p>
            <small>
              Expiring means coverage ends within 30 days, including today.
            </small>
          </section>
        </div>
      </div>
      <section className="panel asset-section">
        <h2>Assignment history</h2>
        {assignments.isPending ? (
          <Loading />
        ) : assignments.error ? (
          <ErrorNotice error={assignments.error} />
        ) : (
          <>
            {assignments.data.data.length === 0 ? (
              <Empty>No assignments yet.</Empty>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Assigned</th>
                      <th>Returned</th>
                      <th>Handover notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.data.data.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <strong>{r.user.name}</strong>
                        </td>
                        <td>
                          {date(r.assigned_at)}
                          <small>By {r.assigner.name}</small>
                        </td>
                        <td>
                          {r.returned_at
                            ? date(r.returned_at)
                            : "Current assignment"}
                          {r.returner && <small>By {r.returner.name}</small>}
                        </td>
                        <td className="asset-notes">
                          {r.notes}
                          {r.return_notes && <small>{r.return_notes}</small>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination
              result={assignments.data}
              page={assignmentPage}
              onChange={setAssignmentPage}
            />
          </>
        )}
      </section>
      <section className="panel asset-section">
        <h2>Activity</h2>
        {events.isPending ? (
          <Loading />
        ) : events.error ? (
          <ErrorNotice error={events.error} />
        ) : (
          <>
            {events.data.data.map((e) => (
              <article className="support-row" key={e.id}>
                <div>
                  <strong>{e.detail}</strong>
                  <p>
                    {e.actor.name} · {label(e.action)}
                  </p>
                </div>
                <time>{new Date(e.created_at).toLocaleString()}</time>
              </article>
            ))}
            <Pagination
              result={events.data}
              page={eventPage}
              onChange={setEventPage}
            />
          </>
        )}
      </section>
      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
        title={
          editor === "details"
            ? "Edit asset"
            : editor === "return"
              ? "Return asset"
              : "Assign asset"
        }
        description={
          editor === "details"
            ? "Update equipment information. Existing assignments are preserved."
            : "Record the handover and retain an auditable assignment history."
        }
      >
        {editor === "details" ? (
          <AssetEditor asset={a} close={() => setEditor(null)} />
        ) : (
          editor && (
            <AssignmentEditor
              asset={a}
              returning={editor === "return"}
              close={() => setEditor(null)}
            />
          )
        )}
      </Dialog>
    </>
  );
}
