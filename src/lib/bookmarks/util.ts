/** Extract env bindings the same way the other API routes do. */
export function getEnv(locals: unknown): Record<string, unknown> {
  const l = locals as { runtime?: { env?: Record<string, unknown> } } | undefined;
  return l?.runtime?.env ?? (process.env as Record<string, unknown>);
}

/** Constant-time-ish comparison of the x-bookmark-token header. */
export function tokenOk(request: Request, env: Record<string, unknown>): boolean {
  const secret = env.BOOKMARKS_TOKEN as string | undefined;
  if (!secret) return false;
  const given = request.headers.get("x-bookmark-token") ?? "";
  if (given.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) {
    diff |= secret.charCodeAt(i) ^ given.charCodeAt(i);
  }
  return diff === 0;
}

export function jsonError(status: number, error: string, message?: string): Response {
  return new Response(JSON.stringify({ error, ...(message ? { message } : {}) }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
