const BASE = import.meta.env.VITE_API_BASE_URL || "";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
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
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message);
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
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
