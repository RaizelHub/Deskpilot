import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, json } from "./api";
afterEach(() => vi.unstubAllGlobals());
describe("same-origin API client", () => {
  it("sends the CSRF cookie value as a header on mutations", async () => {
    document.cookie = "XSRF-TOKEN=test%2Btoken; path=/";
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetch);
    await api("/users", json("POST", { name: "Maria" }));
    const options = fetch.mock.calls.at(-1)?.[1] as RequestInit;
    expect(new Headers(options.headers).get("X-XSRF-TOKEN")).toBe("test+token");
    expect(options.credentials).toBe("same-origin");
  });
  it("surfaces permission errors without retrying mutations", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: "Access denied" }), {
          status: 403,
        }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(api("/users")).rejects.toEqual(
      expect.objectContaining<ApiError>({
        status: 403,
        message: "Access denied",
        errors: {},
        name: "Error",
      }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
