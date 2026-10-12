import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, json } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ErrorNotice, Loading } from "@/components/shared";
import { label } from "./types";
interface Policy {
  priority: string;
  response_minutes: number;
  resolution_minutes: number;
}
function Editor({ initial }: { initial: Policy[] }) {
  const [policies, setPolicies] = useState(initial);
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: () => api("/sla-policies", json("PUT", { policies })),
    onSuccess: () => client.invalidateQueries({ queryKey: ["sla-policies"] }),
  });
  return (
    <form
      className="panel ticket-card form-stack"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      {save.error && <ErrorNotice error={save.error} />}{" "}
      {save.isSuccess && <p role="status">Service targets saved.</p>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Priority</th>
              <th>First response (minutes)</th>
              <th>Resolution (minutes)</th>
            </tr>
          </thead>
          <tbody>
            {policies.map((p, i) => (
              <tr key={p.priority}>
                <td>{label(p.priority)}</td>
                {(["response_minutes", "resolution_minutes"] as const).map(
                  (k) => (
                    <td key={k}>
                      <input
                        aria-label={`${p.priority} ${label(k)}`}
                        required
                        type="number"
                        min={
                          k === "resolution_minutes" ? p.response_minutes : 1
                        }
                        max={43200}
                        value={p[k]}
                        onChange={(e) =>
                          setPolicies((old) =>
                            old.map((v, j) =>
                              i === j
                                ? { ...v, [k]: Number(e.target.value) }
                                : v,
                            ),
                          )
                        }
                      />
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button icon="save" disabled={save.isPending}>
        Save service targets
      </Button>
    </form>
  );
}
export function SlaPolicies() {
  const q = useQuery({
    queryKey: ["sla-policies"],
    queryFn: () => api<{ data: Policy[] }>("/sla-policies"),
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CLEAR EXPECTATIONS</span>
          <h1>Service targets</h1>
          <p>
            Wall-clock targets apply to new tickets, priority changes, and
            reopened tickets. Existing deadlines stay unchanged.
          </p>
        </div>
      </div>
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorNotice error={q.error} />
      ) : (
        <Editor initial={q.data.data} />
      )}
    </>
  );
}
