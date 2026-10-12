import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { api, json } from "@/lib/api";
import type { Department, Page, Role, User } from "@/lib/types";
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
  name: z.string().trim().min(1, "Enter a name.").max(100),
  email: z.email(),
  password: z.string(),
  department_id: z.string(),
  is_active: z.boolean(),
  role_ids: z.array(z.string()).min(1, "Select at least one role."),
});
type Values = z.infer<typeof schema>;
function Editor({
  user,
  roles,
  departments,
  close,
}: {
  user: User | null;
  roles: Role[];
  departments: Department[];
  close: () => void;
}) {
  const client = useQueryClient();
  const session = useSession();
  const manageRoles = session.data?.permissions.includes("roles.manage");
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: user?.name ?? "",
      email: user?.email ?? "",
      password: "",
      department_id: user?.department_id ?? "",
      is_active: user?.is_active ?? true,
      role_ids:
        user?.roles.map((r) => r.id) ??
        roles.filter((r) => r.slug === "employee").map((r) => r.id),
    },
  });
  const mutation = useMutation({
    mutationFn: (v: Values) => {
      const { password, ...rest } = v;
      return api(
        user ? `/users/${user.id}` : "/users",
        json(user ? "PATCH" : "POST", {
          ...rest,
          department_id: rest.department_id || null,
          ...(!user ? { password } : {}),
        }),
      );
    },
    onSuccess: async () => {
      await client.invalidateQueries();
      close();
    },
  });
  return (
    <form
      onSubmit={form.handleSubmit((v) => {
        if (
          !user &&
          (v.password.length < 12 ||
            !/[a-zA-Z]/.test(v.password) ||
            !/[0-9]/.test(v.password))
        ) {
          form.setError("password", {
            message: "Use at least 12 characters with letters and numbers.",
          });
          return;
        }
        mutation.mutate(v);
      })}
    >
      <div className="form-grid">
        <Field
          label="Full name"
          htmlFor="user-name"
          error={form.formState.errors.name?.message}
        >
          <input id="user-name" {...form.register("name")} />
        </Field>
        <Field
          label="Email address"
          htmlFor="user-email"
          error={form.formState.errors.email?.message}
        >
          <input id="user-email" type="email" {...form.register("email")} />
        </Field>
      </div>
      {!user && (
        <Field
          label="Initial password"
          htmlFor="initial-password"
          error={form.formState.errors.password?.message}
        >
          <input
            id="initial-password"
            type="password"
            autoComplete="new-password"
            {...form.register("password")}
          />
          <small>
            12+ characters with letters and numbers. Share through an approved
            channel.
          </small>
        </Field>
      )}
      <Field label="Department" htmlFor="user-department">
        <select id="user-department" {...form.register("department_id")}>
          <option value="">No department</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </Field>
      <fieldset className="role-options">
        <legend>Roles</legend>
        {roles.map((role) => (
          <label key={role.id}>
            <input
              type="checkbox"
              value={role.id}
              disabled={!manageRoles}
              {...form.register("role_ids")}
            />
            <span>{role.name}</span>
          </label>
        ))}
        {!manageRoles && (
          <small>
            Role changes require role-administration access. New accounts start
            as employees.
          </small>
        )}
        {form.formState.errors.role_ids && (
          <span className="field-error">
            {form.formState.errors.role_ids.message}
          </span>
        )}
      </fieldset>
      <label className="checkbox-label">
        <input type="checkbox" {...form.register("is_active")} />
        Account enabled
      </label>
      {mutation.error && <ErrorNotice error={mutation.error} />}
      <div className="dialog-actions">
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button disabled={mutation.isPending}>
          {mutation.isPending
            ? "Saving…"
            : user
              ? "Save changes"
              : "Create account"}
        </Button>
      </div>
    </form>
  );
}
export function Users() {
  const session = useSession();
  const client = useQueryClient();
  const canManage = session.data?.permissions.includes("users.manage");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [active, setActive] = useState("all");
  const [sort, setSort] = useState("name");
  const [showDepartment, setShowDepartment] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [editor, setEditor] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const query = useQuery({
    queryKey: ["users", page, debounced, active, sort],
    queryFn: () =>
      api<Page<User>>(
        `/users?page=${page}&search=${encodeURIComponent(debounced)}&active=${active}&sort=${sort}`,
      ),
  });
  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: () => api<{ data: Role[] }>("/roles"),
    enabled: !!canManage,
  });
  const departments = useQuery({
    queryKey: ["department-options"],
    queryFn: async () => {
      let page = 1;
      const result: Department[] = [];
      let last: number;
      do {
        const response = await api<Page<Department>>(
          `/departments?per_page=100&page=${page}`,
        );
        result.push(...response.data);
        last = response.last_page ?? 1;
        page++;
      } while (page <= last);
      return result;
    },
    enabled: !!canManage,
  });
  const bulk = useMutation({
    mutationFn: (is_active: boolean) =>
      api("/users/bulk-status", json("POST", { ids: selected, is_active })),
    onSuccess: async () => {
      setSelected([]);
      await client.invalidateQueries();
    },
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE PEOPLE BEHIND THE WORK</span>
          <h1>People</h1>
          <p>
            Give your team a place to connect, and the right access to get
            started.
          </p>
        </div>
        {canManage && (
          <Button
            icon="add"
            onClick={() => setEditor(null)}
            disabled={!roles.data || !departments.data}
          >
            Add person
          </Button>
        )}
      </div>
      {(roles.error || departments.error) && (
        <ErrorNotice error={roles.error ?? departments.error} />
      )}
      <section className="panel">
        <div className="table-toolbar">
          <label className="search-input">
            <input
              aria-label="Search people"
              placeholder="Search name or email…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
                setSelected([]);
              }}
            />
          </label>
          <select
            aria-label="Filter account status"
            value={active}
            onChange={(e) => {
              setActive(e.target.value);
              setPage(1);
              setSelected([]);
            }}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select
            aria-label="Sort people"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(1);
            }}
          >
            <option value="name">Sort: Name</option>
            <option value="email">Sort: Email</option>
            <option value="created_at">Sort: Created</option>
          </select>
          <label className="checkbox-label column-toggle">
            <input
              type="checkbox"
              checked={showDepartment}
              onChange={(e) => setShowDepartment(e.target.checked)}
            />
            Department
          </label>
        </div>
        {selected.length > 0 && (
          <div className="bulk-bar">
            <span>{selected.length} selected</span>
            <Button
              size="sm"
              variant="outline"
              disabled={bulk.isPending}
              onClick={() => bulk.mutate(true)}
            >
              Enable
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={bulk.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `Disable ${selected.length} selected accounts? They will lose access to the workspace.`,
                  )
                )
                  bulk.mutate(false);
              }}
            >
              Disable
            </Button>
          </div>
        )}
        {bulk.error && <ErrorNotice error={bulk.error} />}{" "}
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <ErrorNotice error={query.error} retry={() => void query.refetch()} />
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {canManage && (
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Select this page"
                          checked={
                            query.data.data.length > 0 &&
                            query.data.data.every((u) =>
                              selected.includes(u.id),
                            )
                          }
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? query.data.data.map((u) => u.id)
                                : [],
                            )
                          }
                        />
                      </th>
                    )}
                    <th>Person</th>
                    {showDepartment && <th>Department</th>}
                    <th>Role</th>
                    <th>Status</th>
                    {canManage && (
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {query.data.data.map((user) => (
                    <tr key={user.id}>
                      {canManage && (
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select ${user.name}`}
                            checked={selected.includes(user.id)}
                            onChange={(e) =>
                              setSelected(
                                e.target.checked
                                  ? [...selected, user.id]
                                  : selected.filter((id) => id !== user.id),
                              )
                            }
                          />
                        </td>
                      )}
                      <td>
                        <div className="person-cell">
                          <span className="avatar">
                            {user.name.slice(0, 2).toUpperCase()}
                          </span>
                          <div>
                            <strong>{user.name}</strong>
                            <small>{user.email}</small>
                          </div>
                        </div>
                      </td>
                      {showDepartment && (
                        <td>{user.department?.name ?? "Unassigned"}</td>
                      )}
                      <td>{user.roles.map((r) => r.name).join(", ")}</td>
                      <td>
                        <span
                          className={`status ${user.is_active ? "active" : "inactive"}`}
                        >
                          {user.is_active ? "Active" : "Inactive"}
                        </span>
                        {!user.email_verified_at && (
                          <small>Awaiting verification</small>
                        )}
                      </td>
                      {canManage && (
                        <td>
                          <Button
                            icon="edit"
                            variant="ghost"
                            size="icon"
                            aria-label={`Edit ${user.name}`}
                            onClick={() => setEditor(user)}
                          ></Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!query.data.data.length && (
              <Empty>No people match your filters.</Empty>
            )}
            <Pagination
              result={query.data}
              page={page}
              onChange={(v) => {
                setPage(v);
                setSelected([]);
              }}
            />
          </>
        )}
      </section>
      <Dialog
        open={editor !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditor(undefined);
        }}
        title={editor ? "Edit person" : "Add a person"}
        description="Manage the account, department and access permissions."
      >
        {editor !== undefined && roles.data && departments.data && (
          <Editor
            key={editor?.id ?? "new"}
            user={editor}
            roles={roles.data.data}
            departments={departments.data}
            close={() => setEditor(undefined)}
          />
        )}
      </Dialog>
    </>
  );
}
