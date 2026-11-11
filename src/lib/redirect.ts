/**
 * Only same-origin absolute paths may be used as a post-login destination.
 * `//host` and `/\host` are protocol-relative/backslash tricks that browsers
 * resolve to another origin, so a bare `startsWith("/")` is not enough.
 */
const SAFE_PATH = /^\/(?!\/|\\)[^\u0000-\u001f\u007f]*$/;

export function safeNextPath(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const path = value.trim();
  if (!path || path.length > 512) return undefined;
  return SAFE_PATH.test(path) ? path : undefined;
}
