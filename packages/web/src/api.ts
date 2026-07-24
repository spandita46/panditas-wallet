// Always same-origin/relative: in dev the Vite proxy forwards /api to the API;
// in the single-port LAN/NAS deploy the API serves this app itself. This is what
// lets any device on the network reach the API without CORS or hardcoded hosts.
const BASE = "";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    // Full parsed JSON error body, when there was one — for callers that need
    // more than the message, e.g. the `candidates` list on a 409 duplicate.
    public body?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  // Only send a JSON content-type when there's actually a body — Fastify rejects
  // an empty body with `Content-Type: application/json` (breaks body-less POSTs).
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${BASE}/api${path}`, {
    ...options,
    credentials: "include",
    headers,
  });
  if (!res.ok) {
    let message = res.statusText;
    let body: unknown;
    try {
      body = await res.json();
      const parsed = body as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
