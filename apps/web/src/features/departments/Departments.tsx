import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, json } from "@/lib/api";
import type { Department, Page } from "@/lib/types";
import { useSession } from "@/features/auth/session";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  Empty,
  ErrorNotice,
  Field,
  Loading,
  Pagination,
} from "@/components/shared";

const schema = z.object({
  name: z.string().trim().min(1, "Enter a department name.").max(100),
  description: z.string().max(2000),
});
function Editor({
  department,
  close,
}: {
  department: Department | null;
  close: () => void;
}) {
  const client = useQueryClient();
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: department?.name ?? "",
      description: department?.description ?? "",
    },
  });
  const mutation = useMutation({
    mutationFn: (data: z.infer<typeof schema>) =>
      api(
        department ? `/departments/${department.id}` : "/departments",
        json(department ? "PATCH" : "POST", data),
      ),
    onSuccess: async () => {
      await client.invalidateQueries();
      close();
    },
  });
  return (
    <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
      <Field
        label="Department name"
        htmlFor="department-name"
        error={form.formState.errors.name?.message}
      >
        <input id="department-name" {...form.register("name")} />
      </Field>
      <Field
        label="Description"
        htmlFor="description"
        error={form.formState.errors.description?.message}
      >
        <textarea id="description" rows={3} {...form.register("description")} />
      </Field>
      {mutation.error && <ErrorNotice error={mutation.error} />}
      <div className="dialog-actions">
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button icon="save" disabled={mutation.isPending}>
          Save department
        </Button>
      </div>
    </form>
  );
}
export function Departments() {
  const session = useSession();
  const canManage = session.data?.permissions.includes("departments.manage");
  const client = useQueryClient();
  const [editor, setEditor] = useState<Department | null | undefined>(
    undefined,
  );
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["departments", page, search],
    queryFn: () =>
      api<Page<Department>>(
        `/departments?page=${page}&search=${encodeURIComponent(search)}`,
      ),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/departments/${id}`, json("DELETE")),
    onSuccess: async () => {
      setPage(1);
      await client.invalidateQueries();
    },
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">A PLACE FOR EVERY TEAM</span>
          <h1>Departments</h1>
          <p>Keep your organization organized as it grows.</p>
        </div>
        {canManage && (
          <Button icon="add" onClick={() => setEditor(null)}>
            Add department
          </Button>
        )}
      </div>
      <section className="panel">
        <div className="table-toolbar">
          <input
            aria-label="Search departments"
            placeholder="Search departments…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        {remove.error && <ErrorNotice error={remove.error} />}{" "}
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <ErrorNotice error={query.error} />
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Department</th>
                    <th>Description</th>
                    <th>People</th>
                    {canManage && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {query.data.data.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <div className="person-cell">
                          <span className="workspace-icon"></span>
                          <strong>{d.name}</strong>
                        </div>
                      </td>
                      <td className="description-cell">
                        {d.description || "—"}
                      </td>
                      <td>{d.users_count}</td>
                      {canManage && (
                        <td>
                          <div className="button-row">
                            <Button
                              icon="edit"
                              size="icon"
                              variant="ghost"
                              aria-label={`Edit ${d.name}`}
                              onClick={() => setEditor(d)}
                            ></Button>
                            <Button
                              icon="delete"
                              size="icon"
                              variant="ghost"
                              aria-label={`Delete ${d.name}`}
                              disabled={remove.isPending || d.users_count > 0}
                              title={
                                d.users_count
                                  ? "Move assigned users before deleting"
                                  : "Delete department"
                              }
                              onClick={() => {
                                if (window.confirm(`Delete ${d.name}?`))
                                  remove.mutate(d.id);
                              }}
                            ></Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!query.data.data.length && (
              <Empty>
                No departments yet. Add your first team to get started.
              </Empty>
            )}
            <Pagination result={query.data} page={page} onChange={setPage} />
          </>
        )}
      </section>
      <Dialog
        open={editor !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditor(undefined);
        }}
        title={editor ? "Edit department" : "Add department"}
        description="Give this team a clear name and a short description."
      >
        {editor !== undefined && (
          <Editor
            key={editor?.id ?? "new"}
            department={editor}
            close={() => setEditor(undefined)}
          />
        )}
      </Dialog>
    </>
  );
}
