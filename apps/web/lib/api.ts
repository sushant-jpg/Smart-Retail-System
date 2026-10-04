export type ApiErrorShape = { code: string; message: string; requestId?: string; details?: unknown };

export class ApiError extends Error {
  constructor(public status: number, public detail: ApiErrorShape) {
    super(detail.message);
    this.name = "ApiError";
  }
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
  if (typeof window !== "undefined") {
    if (token) sessionStorage.setItem("smartretail-access", token);
    else sessionStorage.removeItem("smartretail-access");
  }
}

export function getAccessToken() {
  if (!accessToken && typeof window !== "undefined") accessToken = sessionStorage.getItem("smartretail-access");
  return accessToken;
}

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown; retryAuth?: boolean };

function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_URL}/auth/refresh`, { method: "POST", credentials: "include" })
      .then(async (response) => {
        if (!response.ok) return null;
        const payload = await response.json() as { data: { accessToken: string } };
        return payload.data.accessToken;
      })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = getAccessToken();
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${API_URL}${path}`, {
    ...options, headers, credentials: "include", body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (response.status === 401 && options.retryAuth !== false && path !== "/auth/refresh") {
    const refreshedToken = await refreshAccessToken();
    if (refreshedToken) {
      setAccessToken(refreshedToken);
      return apiRequest<T>(path, { ...options, retryAuth: false });
    }
    setAccessToken(null);
  }
  const payload = await response.json().catch(() => null) as { success: boolean; data?: T; error?: ApiErrorShape } | null;
  if (!response.ok || !payload?.success) throw new ApiError(response.status, payload?.error ?? { code: "REQUEST_FAILED", message: "The request could not be completed" });
  return payload.data as T;
}

export async function apiRequestBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  const token = getAccessToken();
  const headers = new Headers(options.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: "include",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (response.status === 401 && options.retryAuth !== false && path !== "/auth/refresh") {
    const refreshedToken = await refreshAccessToken();
    if (refreshedToken) {
      setAccessToken(refreshedToken);
      return apiRequestBlob(path, { ...options, retryAuth: false });
    }
    setAccessToken(null);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: ApiErrorShape } | null;
    throw new ApiError(response.status, payload?.error ?? { code: "REQUEST_FAILED", message: "The request could not be completed" });
  }
  return response.blob();
}

export const newIdempotencyKey = () => typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-smartretail`;
