/** Tiny typed fetch wrapper for the browser. Same-origin only; cookies are httpOnly. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly fields?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (init.idempotencyKey) headers.set("idempotency-key", init.idempotencyKey);
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, credentials: "same-origin" });
  } catch {
    throw new ApiError("Sem conexão. Verifique sua internet e tente de novo.", "NETWORK", 0);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = json?.error ?? {};
    throw new ApiError(err.message ?? "Erro inesperado.", err.code ?? "UNKNOWN", res.status, err.fields);
  }
  return json as T;
}

export function newIdempotencyKey(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}
