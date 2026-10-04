// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth, type AuthUser } from "./auth-provider";

const { apiRequest, setAccessToken } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  setAccessToken: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ apiRequest, setAccessToken }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function StrictAuthProvider({ children }: { children: ReactNode }) {
  return <StrictMode><AuthProvider>{children}</AuthProvider></StrictMode>;
}

describe("AuthProvider session restoration", () => {
  afterEach(() => vi.clearAllMocks());

  it("does not let a stale startup refresh overwrite a completed login", async () => {
    const startupRefresh = deferred<{ user: AuthUser; accessToken: string }>();
    const loggedInUser: AuthUser = {
      id: "login-user", email: "customer@example.test", firstName: "New", lastName: "Login", role: "CUSTOMER", storeIds: [],
    };
    const staleUser: AuthUser = {
      id: "stale-user", email: "stale@example.test", firstName: "Old", lastName: "Session", role: "CUSTOMER", storeIds: [],
    };
    apiRequest.mockImplementation((path: string) => path === "/auth/refresh"
      ? startupRefresh.promise
      : Promise.resolve({ user: loggedInUser, accessToken: "login-access" }));

    const { result } = renderHook(() => useAuth(), { wrapper: StrictAuthProvider });
    await act(async () => { await result.current.login("customer@example.test", "password"); });
    await act(async () => { startupRefresh.resolve({ user: staleUser, accessToken: "stale-access" }); });

    expect(result.current.user).toEqual(loggedInUser);
    expect(apiRequest.mock.calls.filter(([path]) => path === "/auth/refresh")).toHaveLength(1);
    expect(setAccessToken).toHaveBeenCalledTimes(1);
    expect(setAccessToken).toHaveBeenCalledWith("login-access");
    expect(result.current.loading).toBe(false);
  });
});
