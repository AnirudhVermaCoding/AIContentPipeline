/**
 * Browser-side client for the studio API. JSON goes through the Next rewrite (/api → API
 * server); media URLs point straight at the API origin so <video> and <img> stream directly.
 */

export const API_ORIGIN =
  typeof window === "undefined"
    ? (process.env.STUDIO_API_URL ?? "http://127.0.0.1:4747")
    : (process.env.NEXT_PUBLIC_STUDIO_API_URL ?? "http://127.0.0.1:4747");

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

function base(): string {
  return typeof window === "undefined" ? API_ORIGIN : "";
}

async function handle<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `${res.status} ${res.statusText}`;
    throw new ApiError(msg, res.status, body);
  }
  return body as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  return handle<T>(res);
}

export async function apiSend<T>(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Studio-Client": "1",
      Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handle<T>(res);
}

export const apiPost = <T>(path: string, body?: unknown) => apiSend<T>("POST", path, body);
export const apiPut = <T>(path: string, body?: unknown) => apiSend<T>("PUT", path, body);
export const apiPatch = <T>(path: string, body?: unknown) => apiSend<T>("PATCH", path, body);

export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method: "POST",
    headers: { "X-Studio-Client": "1" },
    body: form,
  });
  return handle<T>(res);
}

/** Absolute URL for a /files/... path returned by the API. */
export function fileUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:/.test(path)) return path;
  return `${API_ORIGIN}${path}`;
}
