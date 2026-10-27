/** Browser-side JSON helper for the admin API. Adds the CSRF marker header to every request. */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: { path: string; message: string }[];

  constructor(status: number, code: string, message: string, fields: { path: string; message: string }[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string; fields?: { path: string; message: string }[] };
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: {
      "X-Requested-With": "fetch",
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : null,
    credentials: "same-origin",
    cache: "no-store",
  });

  if (response.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth/")) {
    window.location.href = "/login";
  }

  const data = (await response.json().catch(() => ({}))) as T & ErrorBody;
  if (!response.ok) {
    const fieldText = data.error?.fields?.map((field) => `${field.path}: ${field.message}`).join("; ");
    throw new ApiError(
      response.status,
      data.error?.code ?? "ERROR",
      [data.error?.message ?? `Request failed (${response.status})`, fieldText].filter(Boolean).join(" "),
      data.error?.fields ?? [],
    );
  }
  return data;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
