import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Login, PasswordRecovery } from "./AuthPages";
const fetchMock = vi.fn();
function renderPage(page = <Login />) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <MemoryRouter>{page}</MemoryRouter>
    </QueryClientProvider>,
  );
}
describe("Account workflows", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());
  it("validates required fields before submitting a login", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ message: "Unauthenticated" }), {
          status: 401,
        }),
    );
    renderPage();
    await userEvent.click(
      await screen.findByRole("button", { name: /^Sign in$/ }),
    );
    expect(await screen.findByText("Enter your password.")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([path]) => path === "/api/v1/auth/login"),
    ).toHaveLength(0);
  });
  it("submits credentials and shows a useful API error", async () => {
    document.cookie = "XSRF-TOKEN=test; path=/";
    fetchMock.mockImplementation(async (path: string) =>
      path.endsWith("/csrf")
        ? new Response(null, { status: 204 })
        : new Response(
            JSON.stringify({ message: "The email or password is incorrect." }),
            { status: path.endsWith("/me") ? 401 : 422 },
          ),
    );
    renderPage();
    await userEvent.type(
      await screen.findByLabelText("Email address"),
      "employee@example.test",
    );
    await userEvent.type(screen.getByLabelText("Password"), "incorrect");
    await userEvent.click(screen.getByRole("button", { name: /^Sign in$/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The email or password is incorrect.",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/login",
      expect.objectContaining({ method: "POST" }),
    );
  });
  it("shows the neutral reset-password confirmation", async () => {
    fetchMock.mockImplementation(async (path: string) =>
      path.endsWith("/csrf")
        ? new Response(null, { status: 204 })
        : new Response(
            JSON.stringify({
              message:
                "If that active account exists, a password reset email will be sent.",
            }),
            { status: 200 },
          ),
    );
    renderPage(<PasswordRecovery />);
    await userEvent.type(
      screen.getByLabelText("Email"),
      "employee@example.test",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Send reset link" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "If that active account exists",
    );
  });
});
