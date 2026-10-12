export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public errors: Record<string, string[]> = {},
  ) {
    super(message);
  }
}
let csrfReady = false;
const csrf = () =>
  document.cookie
    .split("; ")
    .find((row) => row.startsWith("XSRF-TOKEN="))
    ?.split("=")
    .slice(1)
    .join("=");

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? "GET";
  if (!["GET", "HEAD"].includes(method) && (!csrfReady || !csrf())) {
    const response = await fetch("/api/v1/auth/csrf", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!response.ok)
      throw new ApiError(
        response.status,
        "Could not initialize a secure session. Refresh and try again.",
      );
    csrfReady = true;
  }
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const token = csrf();
  if (token) headers.set("X-XSRF-TOKEN", decodeURIComponent(token));
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...init,
      credentials: "same-origin",
      headers,
    });
  } catch {
    throw new ApiError(
      0,
      "Cannot reach DeskPilot. Check that the API is running, then try again.",
    );
  }
  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const body = payload as {
      message?: string;
      errors?: Record<string, string[]>;
    } | null;
    if (response.status === 419) {
      csrfReady = false;
      throw new ApiError(
        419,
        "Your security session expired. Please submit again.",
      );
    }
    throw new ApiError(
      response.status,
      body?.message ?? `Request failed (${response.status}). Please try again.`,
      body?.errors,
    );
  }
  return payload as T;
}
export const json = (method: string, value?: unknown): RequestInit => ({
  method,
  ...(value === undefined ? {} : { body: JSON.stringify(value) }),
});
export const errorText = (error: unknown) =>
  error instanceof ApiError && Object.keys(error.errors).length
    ? Object.values(error.errors).flat().join(" ")
    : error instanceof Error
      ? error.message
      : "Unable to complete the request.";
