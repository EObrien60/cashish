/**
 * The public origin of this deployment.
 *
 * OAuth metadata, redirect validation and invite links all have to agree on it,
 * and the request host is not trustworthy for that (a Host header can be
 * spoofed, and Vercel serves the same deployment on several hostnames). APP_URL
 * is the declared answer; the request origin is only a development fallback.
 */
export function appOrigin(request?: Request): string {
  const declared = process.env.APP_URL;
  if (declared) return declared.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (request) return new URL(request.url).origin;
  return "http://localhost:3000";
}
