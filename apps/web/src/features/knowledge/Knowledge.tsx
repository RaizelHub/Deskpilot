import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, json } from "@/lib/api";
import { useSession } from "@/features/auth/session";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  Field,
  ErrorNotice,
  Loading,
  Empty,
  Pagination,
} from "@/components/shared";
import type { Page } from "@/lib/types";
type Article = {
  id: string;
  title: string;
  summary: string;
  body: string;
  category_id: string;
  category: { id: string; name: string };
  tags: { name: string }[];
  status: string;
  visibility: string;
  version: number;
  updated_at: string;
};
type Category = { id: string; name: string };
export function Knowledge() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [add, setAdd] = useState(false);
  const can = useSession().data?.permissions.includes("knowledge.manage");
  const c = useQueryClient();
  const q = useQuery({
    queryKey: ["knowledge", query, category, status, page],
    queryFn: () =>
      api<Page<Article>>(
        `/knowledge?${new URLSearchParams({ search: query, category, status, page: String(page) })}`,
      ),
  });
  const cats = useQuery({
    queryKey: ["knowledge-categories"],
    queryFn: () => api<{ data: Category[] }>("/knowledge-categories"),
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SHARED KNOW-HOW</span>
          <h1>Knowledge base</h1>
          <p>
            Find practical answers and keep your team’s guidance in one place.
          </p>
        </div>
        {can && <Button onClick={() => setAdd(true)}>Write article</Button>}
      </div>
      <section className="panel">
        <div className="table-toolbar">
          <input
            aria-label="Search knowledge"
            placeholder="Search articles…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <select
            aria-label="Knowledge category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All categories</option>
            {cats.data?.data.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {can && (
            <select
              aria-label="Article status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              {["draft", "published", "archived"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          )}
        </div>
        {q.error ? (
          <ErrorNotice error={q.error} />
        ) : q.isPending ? (
          <Loading />
        ) : !q.data.data.length ? (
          <Empty>
            No articles match.{" "}
            {can
              ? "Write an article to share a solution."
              : "Try another search or check back for published guidance."}
          </Empty>
        ) : (
          <>
            {q.data.data.map((a) => (
              <article className="automation-row" key={a.id}>
                <div>
                  <small>
                    {a.category.name} ·{" "}
                    {a.visibility === "staff" ? "Staff only" : "Everyone"} ·{" "}
                    {a.status}
                  </small>
                  <h2 className="knowledge-title">
                    <Link to={`/knowledge/${a.id}`}>{a.title}</Link>
                  </h2>
                  <p>{a.summary}</p>
                  <div className="button-row">
                    {a.tags.map((t) => (
                      <span className="pill" key={t.name}>
                        #{t.name}
                      </span>
                    ))}
                  </div>
                </div>
              </article>
            ))}
            <Pagination result={q.data} page={page} onChange={setPage} />
          </>
        )}
      </section>
      {cats.error && <ErrorNotice error={cats.error} />}{" "}
      {add && (
        <ArticleEditor
          close={() => setAdd(false)}
          saved={() => {
            setAdd(false);
            void c.invalidateQueries({ queryKey: ["knowledge"] });
          }}
        />
      )}
    </>
  );
}
export function KnowledgeDetail() {
  const { id } = useParams();
  const [edit, setEdit] = useState(false);
  const c = useQueryClient();
  const can = useSession().data?.permissions.includes("knowledge.manage");
  const q = useQuery({
    queryKey: ["knowledge", id],
    queryFn: () =>
      api<{
        data: Article;
        html: string;
        related: Pick<Article, "id" | "title" | "summary">[];
      }>(`/knowledge/${id}`),
  });
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorNotice error={q.error} />;
  const a = q.data.data;
  return (
    <>
      <Link to="/knowledge">← Knowledge base</Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{a.category.name}</span>
          <h1>{a.title}</h1>
          <p>
            {a.visibility === "staff" ? "Staff only" : "Everyone"} · {a.status}{" "}
            · Updated {new Date(a.updated_at).toLocaleDateString()}
          </p>
        </div>
        {can && (
          <Button icon="edit" variant="outline" onClick={() => setEdit(true)}>
            Edit article
          </Button>
        )}
      </div>
      <section className="panel ticket-card">
        <p>{a.summary}</p>
        <div
          className="knowledge-body"
          dangerouslySetInnerHTML={{ __html: q.data.html }}
        />
        <div className="button-row">
          {a.tags.map((t) => (
            <span className="pill" key={t.name}>
              #{t.name}
            </span>
          ))}
        </div>
      </section>
      {!!q.data.related.length && (
        <section className="panel ticket-card">
          <h2>Related articles</h2>
          {q.data.related.map((r) => (
            <p key={r.id}>
              <Link to={`/knowledge/${r.id}`}>{r.title}</Link>
            </p>
          ))}
        </section>
      )}
      {edit && (
        <ArticleEditor
          article={a}
          close={() => setEdit(false)}
          saved={() => {
            setEdit(false);
            void c.invalidateQueries({ queryKey: ["knowledge"] });
          }}
        />
      )}
    </>
  );
}
function ArticleEditor({
  article: a,
  close,
  saved,
}: {
  article?: Article;
  close: () => void;
  saved: () => void;
}) {
  const cats = useQuery({
    queryKey: ["knowledge-categories"],
    queryFn: () => api<{ data: Category[] }>("/knowledge-categories"),
  });
  const staff = useSession().data?.permissions.includes("knowledge.staff");
  const [title, setTitle] = useState(a?.title ?? "");
  const [summary, setSummary] = useState(a?.summary ?? "");
  const [body, setBody] = useState(a?.body ?? "");
  const [category, setCategory] = useState(a?.category_id ?? "");
  const [tags, setTags] = useState(a?.tags.map((t) => t.name).join(", ") ?? "");
  const [visibility, setVisibility] = useState(
    a?.visibility ?? (staff ? "staff" : "everyone"),
  );
  const [status, setStatus] = useState(a?.status ?? "draft");
  const save = useMutation({
    mutationFn: () =>
      api(
        a ? `/knowledge/${a.id}` : "/knowledge",
        json(a ? "PATCH" : "POST", {
          title,
          summary,
          body,
          category_id: category,
          visibility,
          status,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          ...(a ? { version: a.version } : {}),
        }),
      ),
    onSuccess: saved,
  });
  return (
    <Dialog
      open
      onOpenChange={close}
      title={a ? "Edit article" : "Write article"}
      description="Use Markdown for headings, steps and links. Raw HTML and embedded images are removed from the rendered article."
    >
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Article title" htmlFor="article-title">
          <input
            id="article-title"
            required
            minLength={3}
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="Summary" htmlFor="article-summary">
          <textarea
            id="article-summary"
            required
            minLength={3}
            maxLength={400}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </Field>
        <Field label="Category" htmlFor="article-category">
          <select
            id="article-category"
            required
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Choose category</option>
            {cats.data?.data.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Article content (Markdown)" htmlFor="article-body">
          <textarea
            className="knowledge-editor"
            id="article-body"
            required
            minLength={10}
            maxLength={30000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>
        <Field label="Tags (comma separated)" htmlFor="article-tags">
          <input
            id="article-tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </Field>
        <div className="form-grid">
          <Field label="Visibility" htmlFor="article-visibility">
            <select
              id="article-visibility"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
            >
              <option value="everyone">Everyone in the organization</option>
              {staff && <option value="staff">Support staff only</option>}
            </select>
          </Field>
          <Field label="Publication status" htmlFor="article-status">
            <select
              id="article-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {["draft", "published", "archived"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        </div>
        {cats.error && <ErrorNotice error={cats.error} />}{" "}
        {save.error && <ErrorNotice error={save.error} />}
        <div className="dialog-actions">
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button icon="save" disabled={save.isPending || !category}>
            Save article
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
