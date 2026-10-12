import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, json } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ErrorNotice, Loading, Empty, Pagination } from "@/components/shared";
import type { Page } from "@/lib/types";
type Notice = {
  id: string;
  title: string;
  message: string;
  target_type: string;
  target_id: string;
  read_at: string | null;
  created_at: string;
};
type Inbox = Page<Notice> & { unread_count: number };
export function InboxLink() {
  const q = useQuery({
    queryKey: ["notifications", "badge"],
    queryFn: () => api<Inbox>("/notifications?unread=1"),
    refetchInterval: 30000,
  });
  return (
    <Link
      to="/notifications"
      aria-label={`Inbox${q.data ? `, ${q.data.unread_count} unread` : ""}`}
    >
      Inbox{q.data?.unread_count ? ` (${q.data.unread_count})` : ""}
    </Link>
  );
}
export function Notifications() {
  const [page, setPage] = useState(1);
  const [unread, setUnread] = useState(false);
  const c = useQueryClient();
  const q = useQuery({
    queryKey: ["notifications", page, unread],
    queryFn: () =>
      api<Inbox>(`/notifications?page=${page}&unread=${unread ? 1 : 0}`),
    refetchInterval: 30000,
  });
  const read = useMutation({
    mutationFn: (id?: string) =>
      api(
        id ? `/notifications/${id}/read` : "/notifications/read-all",
        json("POST"),
      ),
    onSuccess: () => void c.invalidateQueries({ queryKey: ["notifications"] }),
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR UPDATES</span>
          <h1>Inbox</h1>
          <p>Ticket and support updates, all in one place.</p>
        </div>
        <Button
          variant="outline"
          disabled={read.isPending || !q.data?.unread_count}
          onClick={() => read.mutate(undefined)}
        >
          Mark all as read
        </Button>
      </div>
      <section className="panel automation-section">
        <div className="table-toolbar">
          <strong>{q.data?.unread_count ?? 0} unread</strong>
          <label>
            <input
              type="checkbox"
              checked={unread}
              onChange={(e) => {
                setUnread(e.target.checked);
                setPage(1);
              }}
            />{" "}
            Unread only
          </label>
        </div>
        {read.error && <ErrorNotice error={read.error} />}{" "}
        {q.error ? (
          <ErrorNotice error={q.error} />
        ) : q.isPending ? (
          <Loading />
        ) : !q.data.data.length ? (
          <Empty>You’re all caught up.</Empty>
        ) : (
          <>
            {q.data.data.map((n) => (
              <div className="automation-row" key={n.id}>
                <div>
                  <strong>
                    {!n.read_at && "Unread: "}
                    {n.title}
                  </strong>
                  <p>{n.message}</p>
                  <small>{new Date(n.created_at).toLocaleString()}</small>
                </div>
                <div className="button-row">
                  <Link
                    to={
                      n.target_type === "ticket"
                        ? `/tickets/${n.target_id}`
                        : n.target_type === "remote"
                          ? `/support-requests/${n.target_id}`
                          : n.target_type === "device"
                            ? `/devices/${n.target_id}`
                            : "/alerts"
                    }
                  >
                    Open record
                  </Link>
                  {!n.read_at && (
                    <Button
                      variant="ghost"
                      disabled={read.isPending}
                      onClick={() => read.mutate(n.id)}
                    >
                      Mark read
                    </Button>
                  )}
                </div>
              </div>
            ))}
            <Pagination result={q.data} page={page} onChange={setPage} />
          </>
        )}
      </section>
    </>
  );
}
