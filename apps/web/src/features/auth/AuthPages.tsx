import { useState } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { api, json } from "@/lib/api";
import { useSession } from "./session";
import { Button } from "@/components/ui/button";
import { ErrorNotice, Field, Loading } from "@/components/shared";
import type { Session } from "@/lib/types";

const loginSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});
type LoginValues = z.infer<typeof loginSchema>;

export function Login() {
  const session = useSession();
  const client = useQueryClient();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const login = useMutation({
    mutationFn: (data: LoginValues) =>
      api<Session>("/auth/login", json("POST", data)),
    onSuccess: (value) => {
      client.clear();
      client.setQueryData(["session"], value);
    },
  });

  if (session.isPending) return <Loading />;
  if (session.data)
    return (
      <Navigate
        to={
          location.state?.from === "/verify-email"
            ? `/verify-email${location.state.search ?? ""}`
            : "/"
        }
        replace
      />
    );

  return (
    <div className="login-premium">
      <section className="login-visual" aria-label="DeskPilot introduction">
        <img src="/login-hero.jpg" alt="" className="login-image" fetchPriority="high" />
        <div className="login-image-shade" />
        <div className="login-visual-top"><span className="login-wordmark">DeskPilot<span>.</span></span><span className="login-edition">IT SERVICE WORKSPACE</span></div>
        <div className="login-story">
          <span className="login-overline">LESS FRICTION. MORE FOCUS.</span>
          <h1>Great support.<br />A clearer perspective.</h1>
          <p>Bring your requests, devices, and people together.<br className="login-desktop-break" /> Make room for the work that matters.</p>
          <div className="login-capabilities"><span>Ticket management</span><span>Device health</span><span>Team workflows</span></div>
        </div>
        <div className="login-visual-bottom"><span>One workspace. A shared direction.</span><span>DESKPILOT</span></div>
      </section>
      <main className="login-form-side">
        <div className="login-mobile-brand">DeskPilot<span>.</span></div>
        <div className="login-form-inner">
          <div className="login-form-heading">
            <span className="login-overline">YOUR WORKSPACE AWAITS</span>
            <h2>Sign in to DeskPilot</h2>
            <p>Welcome back. Let’s get your day in focus.</p>
          </div>
          <form
            className="auth-input-form"
            onSubmit={form.handleSubmit((values) => login.mutate(values))}
          >
            <Field
              label="Email address"
              htmlFor="email"
              error={form.formState.errors.email?.message}
            >
              <div className="input-with-icon-wrap">
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="name@company.com"
                  className="auth-text-input"
                  {...form.register("email")}
                />
              </div>
            </Field>

            <Field
              label="Password"
              htmlFor="password"
              error={form.formState.errors.password?.message}
            >
              <div className="input-with-icon-wrap">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  className="auth-text-input password-input"
                  {...form.register("password")}
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword((p) => !p)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </Field>

            <div className="login-recovery-row">
              <Link className="forgot-password-link" to="/forgot-password">Forgot your password?</Link>
            </div>

            {login.error && <ErrorNotice error={login.error} />}

            <Button
              type="submit"
              className="auth-submit-btn login-submit"
              disabled={login.isPending}
            >
              <span>{login.isPending ? "Authenticating…" : "Sign in"}</span>
            </Button>
          </form>

          <p className="login-access-note">Need an account? <span>Contact your workspace administrator.</span></p>
        </div>
        <footer className="login-form-footer"><span>DeskPilot workspace</span><span>Support starts here.</span></footer>
      </main>
    </div>
  );
}

const resetSchema = z
  .object({
    email: z.email(),
    password: z
      .string()
      .min(12)
      .max(128)
      .regex(/[a-zA-Z]/, "Include a letter.")
      .regex(/[0-9]/, "Include a number."),
    password_confirmation: z.string(),
  })
  .refine((v) => v.password === v.password_confirmation, {
    path: ["password_confirmation"],
    message: "Passwords must match.",
  });

export function PasswordRecovery({ reset = false }: { reset?: boolean }) {
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const form = useForm<z.infer<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
    defaultValues: { email: params.get("email") ?? "" },
  });
  const mutation = useMutation({
    mutationFn: (data: unknown) =>
      api<{ message: string }>(
        reset ? "/auth/reset-password" : "/auth/forgot-password",
        json("POST", data),
      ),
  });

  return (
    <div className="centered-auth-page">
      <section className="auth-card-modern">
        <div className="auth-brand-badge" style={{ marginBottom: 20 }}>
          <div className="auth-bolt-box"></div>
          <span className="auth-brand-name">DeskPilot</span>
        </div>

        <h1 className="auth-form-title">
          {reset ? "Choose a new password" : "Reset your password"}
        </h1>
        <p className="auth-form-desc">
          {reset
            ? "Use at least 12 characters with uppercase, lowercase, and numbers."
            : "We’ll email you a secure recovery link if your active account exists."}
        </p>

        {mutation.data ? (
          <div className="success-notice" role="status">
            <span>{mutation.data.message}</span>
          </div>
        ) : (
          <form
            className="form-stack"
            onSubmit={
              reset
                ? form.handleSubmit((v) =>
                    mutation.mutate({ ...v, token: params.get("token") }),
                  )
                : (e) => {
                    e.preventDefault();
                    mutation.mutate({ email });
                  }
            }
          >
            <Field label="Email" htmlFor="recovery-email">
              <input
                id="recovery-email"
                type="email"
                required
                placeholder="name@company.com"
                {...(reset
                  ? form.register("email")
                  : {
                      value: email,
                      onChange: (e) => setEmail(e.target.value),
                    })}
              />
            </Field>

            {reset && (
              <>
                <Field
                  label="New password"
                  htmlFor="new-password"
                  error={form.formState.errors.password?.message}
                >
                  <input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="At least 12 characters"
                    {...form.register("password")}
                  />
                </Field>
                <Field
                  label="Confirm password"
                  htmlFor="confirm-password"
                  error={form.formState.errors.password_confirmation?.message}
                >
                  <input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Repeat new password"
                    {...form.register("password_confirmation")}
                  />
                </Field>
              </>
            )}

            {mutation.error && <ErrorNotice error={mutation.error} />}

            <Button
              className="action-btn-primary full-width"
              disabled={mutation.isPending}
            >
              {mutation.isPending
                ? "Processing…"
                : reset
                  ? "Update password"
                  : "Send reset link"}
            </Button>
          </form>
        )}

        <div style={{ marginTop: 20, textAlign: "center" }}>
          <Link className="text-link" to="/login">
            ← Back to sign in
          </Link>
        </div>
      </section>
    </div>
  );
}

export function Verification() {
  const [params] = useSearchParams();
  const client = useQueryClient();
  const session = useSession();

  const verify = useMutation({
    mutationFn: async () => {
      const url = new URL(params.get("url") ?? "", window.location.origin);
      if (
        url.origin !== window.location.origin ||
        !url.pathname.startsWith("/api/v1/auth/verify-email/")
      )
        throw new Error(
          "This verification link is invalid. Request a new one.",
        );
      return api<{ message: string }>(
        url.pathname.replace("/api/v1", "") + url.search,
      );
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["session"] }),
  });

  const resend = useMutation({
    mutationFn: () =>
      api<{ message: string }>("/auth/verification-notification", json("POST")),
  });

  const logout = useMutation({
    mutationFn: () => api("/auth/logout", json("POST")),
    onSuccess: () => {
      client.clear();
      client.setQueryData(["session"], null);
    },
  });

  if (session.isPending) return <Loading />;
  if (!session.data)
    return (
      <Navigate
        to="/login"
        state={{ from: "/verify-email", search: window.location.search }}
        replace
      />
    );

  return (
    <div className="centered-auth-page">
      <section className="auth-card-modern">
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: 16,
          }}
        >
          <div
            className="auth-bolt-box"
            style={{ width: 48, height: 48 }}
          ></div>
        </div>

        <h1 className="auth-form-title" style={{ textAlign: "center" }}>
          Verify your email
        </h1>
        <p className="auth-form-desc" style={{ textAlign: "center" }}>
          Signed in as <strong>{session.data.user.email}</strong>. Verify your
          email address to unlock your full support workspace.
        </p>

        <div className="form-stack">
          {params.has("url") && !verify.isSuccess && (
            <Button
              className="action-btn-primary full-width"
              onClick={() => verify.mutate()}
              disabled={verify.isPending}
            >
              Verify this email address
            </Button>
          )}

          {verify.error && <ErrorNotice error={verify.error} />}

          <Button
            variant="outline"
            className="full-width"
            onClick={() => resend.mutate()}
            disabled={resend.isPending}
          >
            Send a new verification email
          </Button>

          {resend.error && <ErrorNotice error={resend.error} />}
          {logout.error && <ErrorNotice error={logout.error} />}

          {(verify.data?.message || resend.data?.message) && (
            <p role="status" className="success-notice">
              {verify.data?.message ?? resend.data?.message}
            </p>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 12,
            }}
          >
            <Link className="text-link" to="/">
              Open workspace
            </Link>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
            >
              Sign out
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
