/** Only same-site paths are allowed as post-login destinations (no open redirects). */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/dashboard";
}
