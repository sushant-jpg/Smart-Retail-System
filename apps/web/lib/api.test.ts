import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, apiRequestBlob, setAccessToken } from "./api";

const jsonResponse = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

describe("authenticated API refresh", () => {
  afterEach(() => {
    setAccessToken(null);
    vi.unstubAllGlobals();
  });

  it("shares one refresh request across simultaneous expired-token responses", async () => {
    let refreshRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) {
        refreshRequests += 1;
        await new Promise((resolve) => setTimeout(resolve, 15));
        return jsonResponse(200, { success: true, data: { accessToken: "fresh-access" } });
      }
      const authorization = new Headers(init?.headers).get("authorization");
      if (authorization === "Bearer stale-access") {
        return jsonResponse(401, { success: false, error: { code: "TOKEN_INVALID", message: "Unauthorized" } });
      }
      return jsonResponse(200, { success: true, data: { path: new URL(url).pathname } });
    });
    vi.stubGlobal("fetch", fetchMock);
    setAccessToken("stale-access");

    const responses = await Promise.all([
      apiRequest<{ path: string }>("/first"),
      apiRequest<{ path: string }>("/second"),
    ]);

    expect(refreshRequests).toBe(1);
    expect(responses.map((response) => response.path)).toEqual(["/api/v1/first", "/api/v1/second"]);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/auth/refresh"))).toHaveLength(1);
  });

  it("refreshes the session before retrieving a protected QR image", async () => {
    let labelRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) return jsonResponse(200, { success: true, data: { accessToken: "fresh-access" } });
      labelRequests += 1;
      if (labelRequests === 1) return jsonResponse(401, { success: false, error: { code: "TOKEN_INVALID", message: "Unauthorized" } });
      return new Response("<svg />", { status: 200, headers: { "content-type": "image/svg+xml" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    setAccessToken("stale-access");

    const image = await apiRequestBlob("/products/507f1f77bcf86cd799439011/label");

    expect(image.type).toBe("image/svg+xml");
    expect(await image.text()).toBe("<svg />");
    expect(labelRequests).toBe(2);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/auth/refresh"))).toHaveLength(1);
  });
});
