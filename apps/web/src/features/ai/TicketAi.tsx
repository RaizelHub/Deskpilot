import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, json } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ErrorNotice, Loading, Field, Pagination } from "@/components/shared";
import type { Page } from "@/lib/types";
type Settings = {
  ready: boolean;
  enabled: boolean;
  provider: string;
  model: string;
};
type Analysis = {
  summary: string;
  category_id: string;
  priority: string;
  likely_cause: string;
  diagnostic_interpretation: string;
  steps: string[];
  diagnostic_commands: string[];
  article_ids: string[];
  limitations: string[];
};
type Run = {
  id: string;
  status: string;
  model: string;
  provider: string;
  created_at: string;
  error_code: string | null;
  analysis: Analysis | null;
  restricted: boolean;
  stale: boolean;
  sources: { id: string; title: string }[];
};
type Preview = {
  context: { categories: { id: string; name: string }[] };
  settings: Settings;
  token: string;
  expires_at: number;
};
const errors: Record<string, string> = {
  provider_configuration:
    "AI settings changed or are incomplete. Ask your administrator.",
  context_changed:
    "The ticket or knowledge context changed. Review a new preview.",
  access_changed:
    "Access to part of the context changed. Review a new preview.",
  provider_authentication:
    "The provider rejected the configured key. Ask your administrator.",
  provider_rate_limit: "The provider’s request limit was reached. Try later.",
  provider_unavailable:
    "The provider could not complete the request. Try again later.",
  invalid_output:
    "The provider returned an invalid result. No suggestions were saved.",
  incomplete_output:
    "The provider did not finish a usable response. Try again later.",
  queue_unavailable:
    "The analysis could not be queued. Ask your administrator to check the queue.",
  worker_timeout:
    "The queued analysis expired. Check the worker before retrying.",
  worker_failed: "The worker stopped before completing the analysis.",
};
export function TicketAi({ ticketId }: { ticketId: string }) {
  const c = useQueryClient();
  const [page, setPage] = useState(1);
  const [diagnostic, setDiagnostic] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [requestKey, setRequestKey] = useState("");
  const q = useQuery({
    queryKey: ["ticket-ai", ticketId, page],
    queryFn: () =>
      api<{
        runs: Page<Run>;
        settings: Settings;
        diagnostics: {
          id: string;
          command: string;
          status: string;
          finished_at: string;
        }[];
      }>(`/tickets/${ticketId}/ai?page=${page}`),
    refetchInterval: (q) =>
      q.state.data?.runs.data.some((r) =>
        ["queued", "running"].includes(r.status),
      )
        ? 5000
        : false,
  });
  const categories = useQuery({
    queryKey: ["ticket-options"],
    queryFn: () =>
      api<{ categories: { id: string; name: string }[] }>("/ticket-options"),
  });
  const review = useMutation({
    mutationFn: () =>
      api<Preview>(
        `/tickets/${ticketId}/ai/preview`,
        json("POST", { diagnostic_id: diagnostic || null }),
      ),
    onSuccess: (p) => {
      setPreview(p);
      setRequestKey(crypto.randomUUID());
    },
  });
  const send = useMutation({
    mutationFn: () =>
      api(
        `/tickets/${ticketId}/ai`,
        json("POST", { token: preview?.token, request_key: requestKey }),
      ),
    onSuccess: () => {
      setPreview(null);
      setPage(1);
      void c.invalidateQueries({ queryKey: ["ticket-ai", ticketId] });
    },
  });
  return (
    <section className="panel ticket-card ai-panel">
      <div className="table-toolbar">
        <div>
          <span className="eyebrow">TECHNICIAN ASSISTANT</span>
          <h2>AI analysis</h2>
        </div>
        <span className="pill">Optional</span>
      </div>
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorNotice error={q.error} />
      ) : (
        <>
          <p>
            {q.data.settings.ready
              ? `Uses ${q.data.settings.provider} · ${q.data.settings.model}. Review the context before sending.`
              : "AI is not configured. Your helpdesk and knowledge base remain available. Ask an administrator to configure Groq or Gemini."}
          </p>
          <p className="ai-note">
            Analysis is private to you. Suggestions may be incorrect; verify
            them before editing a ticket or taking action.
          </p>
          {q.data.settings.ready && (
            <>
              <Field
                label="Include diagnostic result"
                htmlFor={`ai-diagnostic-${ticketId}`}
              >
                <select
                  id={`ai-diagnostic-${ticketId}`}
                  value={diagnostic}
                  onChange={(e) => setDiagnostic(e.target.value)}
                >
                  <option value="">Ticket context only</option>
                  {q.data.diagnostics.map((d) => (
                    <option value={d.id} key={d.id}>
                      {d.command} · {d.status} ·{" "}
                      {new Date(d.finished_at).toLocaleString()}
                    </option>
                  ))}
                </select>
              </Field>
              <Button
                variant="outline"
                disabled={
                  review.isPending ||
                  q.data.runs.data.some((r) =>
                    ["queued", "running"].includes(r.status),
                  )
                }
                onClick={() => review.mutate()}
              >
                Review context for AI
              </Button>
            </>
          )}
          {review.error && <ErrorNotice error={review.error} />}
          <Link className="text-link" to="/knowledge">
            Browse knowledge base →
          </Link>
          {q.data.runs.data.map((r) => (
            <article className="ai-result" key={r.id}>
              <small>
                {r.provider} · {r.model} ·{" "}
                {new Date(r.created_at).toLocaleString()}
              </small>
              {r.restricted ? (
                <p>
                  This result is unavailable because access or source content
                  changed.
                </p>
              ) : r.status === "failed" ? (
                <p role="status">
                  {errors[r.error_code ?? ""] ??
                    "Analysis failed. Review a new preview to try again."}
                </p>
              ) : r.analysis ? (
                <>
                  {r.stale && (
                    <p className="ai-note">
                      This analysis is based on an older ticket version.
                    </p>
                  )}
                  <h3>Summary</h3>
                  <p className="preserve-text">{r.analysis.summary}</p>
                  <div className="button-row">
                    <span className="pill">
                      Suggested category:{" "}
                      {categories.data?.categories.find(
                        (cat) => cat.id === r.analysis?.category_id,
                      )?.name ?? "Unavailable"}
                    </span>
                    <span className="pill">
                      Suggested priority: {r.analysis.priority}
                    </span>
                  </div>
                  <h3>Possible cause</h3>
                  <p>{r.analysis.likely_cause}</p>
                  <h3>Diagnostic interpretation</h3>
                  <p>{r.analysis.diagnostic_interpretation}</p>
                  <h3>Suggested next steps</h3>
                  <ol>
                    {r.analysis.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                  {!!r.analysis.diagnostic_commands.length && (
                    <>
                      <h3>Recommended diagnostics</h3>
                      <ul>
                        {r.analysis.diagnostic_commands.map((d) => (
                          <li key={d}>{d.replaceAll("_", " ")}</li>
                        ))}
                      </ul>
                      <p className="ai-note">
                        Run diagnostics from the device’s Diagnostics page
                        through the existing approval workflow.
                      </p>
                    </>
                  )}
                  {!!r.analysis.article_ids.length && (
                    <>
                      <h3>Referenced articles</h3>
                      {r.sources
                        .filter((s) => r.analysis?.article_ids.includes(s.id))
                        .map((s) => (
                          <p key={s.id}>
                            <Link to={`/knowledge/${s.id}`}>{s.title}</Link>
                          </p>
                        ))}
                    </>
                  )}
                  <h3>Limitations</h3>
                  <ul>
                    {r.analysis.limitations.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p role="status">
                  {r.status === "queued"
                    ? "Queued — waiting for the analysis worker."
                    : "Analyzing the reviewed context…"}
                </p>
              )}
            </article>
          ))}
          {!!q.data.runs.data.length && (
            <Pagination result={q.data.runs} page={page} onChange={setPage} />
          )}
        </>
      )}
      <Dialog
        open={!!preview}
        onOpenChange={() => setPreview(null)}
        title="Review what AI will receive"
        description={`Send the context below to ${preview?.settings.provider ?? "your provider"}. Obvious credentials and email addresses are filtered, but redaction is not exhaustive. Review all content for sensitive information before sending.`}
      >
        <p>
          Includes bounded ticket text, recent public replies, selected
          diagnostic checks and relevant published articles. Attachments,
          internal notes and account details are excluded.
        </p>
        <pre className="ai-context">
          {JSON.stringify(preview?.context, null, 2)}
        </pre>
        {send.error && <ErrorNotice error={send.error} />}
        <div className="dialog-actions">
          <Button
            variant="outline"
            disabled={send.isPending}
            onClick={() => setPreview(null)}
          >
            Cancel
          </Button>
          <Button disabled={send.isPending} onClick={() => send.mutate()}>
            Send reviewed context
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
