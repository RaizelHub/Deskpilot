import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, json } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ErrorNotice, Field, Loading } from "@/components/shared";
import {
  statuses,
  label,
  type Asset,
  type AssetOptions,
  type Named,
} from "./types";

export function AssignmentEditor({
  asset,
  returning,
  close,
}: {
  asset: Asset;
  returning: boolean;
  close: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Named | null>(null);
  const client = useQueryClient();
  const people = useQuery({
    queryKey: ["asset-options", search],
    queryFn: () =>
      api<AssetOptions>(`/asset-options?search=${encodeURIComponent(search)}`),
    enabled: !returning,
    placeholderData: (previous) => previous,
  });
  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api(
        `/assets/${asset.id}/${returning ? "return" : "assign"}`,
        json("POST", { ...data, version: asset.version }),
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["assets"] });
      close();
    },
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.currentTarget));
        save.mutate(data);
      }}
    >
      {returning ? (
        <Field label="Status after return" htmlFor="return-status">
          <select id="return-status" name="status">
            {statuses
              .filter((s) => s !== "in_use")
              .map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
          </select>
        </Field>
      ) : (
        <>
          <Field label="Find employee" htmlFor="assignee-search">
            <input
              id="assignee-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employee name"
            />
          </Field>
          {people.isPending ? (
            <Loading />
          ) : people.error ? (
            <ErrorNotice error={people.error} />
          ) : (
            <Field label="Assign to" htmlFor="assignee">
              <select
                id="assignee"
                name="user_id"
                required
                value={selected?.id ?? ""}
                onChange={(e) =>
                  setSelected(
                    people.data!.users.find((p) => p.id === e.target.value) ??
                      (selected?.id === e.target.value ? selected : null),
                  )
                }
              >
                <option value="">Choose an employee</option>
                {selected &&
                  !people.data!.users.some((p) => p.id === selected.id) && (
                    <option value={selected.id}>{selected.name}</option>
                  )}
                {people.data!.users.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {asset.current_assignment && (
            <p>
              This will close {asset.current_assignment.user.name}’s current
              assignment and retain its history.
            </p>
          )}
        </>
      )}
      <Field label="Assignment notes" htmlFor="assignment-notes">
        <textarea
          id="assignment-notes"
          name="notes"
          required
          minLength={3}
          maxLength={900}
          rows={3}
          placeholder={
            returning
              ? "Condition and reason for return"
              : "Reason for assignment or handover"
          }
        />
      </Field>
      {save.error && <ErrorNotice error={save.error} />}
      <div className="dialog-actions">
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button disabled={save.isPending || (!returning && !selected)}>
          {returning ? "Confirm return" : "Confirm assignment"}
        </Button>
      </div>
    </form>
  );
}
