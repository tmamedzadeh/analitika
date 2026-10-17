import { createHmac } from "node:crypto";

import { requireServerEnv } from "../env";

const signatureHeader = "x-inngest-signature";

/**
 * Allow a browser health check to read Inngest's non-mutating endpoint metadata.
 * Function execution and registration still require Inngest-signed requests.
 */
export function signReadOnlyGetForIntrospection(request: Request): Request {
  if (request.headers.has(signatureHeader)) return request;

  const signingKey = requireServerEnv("INNGEST_SIGNING_KEY");
  const rawKey = signingKey.replace(/^signkey-[\w]+-/, "");
  const timestamp = Math.round(Date.now() / 1000).toString();
  const signature = createHmac("sha256", rawKey).update(timestamp).digest("hex");
  const headers = new Headers(request.headers);
  headers.set(signatureHeader, `t=${timestamp}&s=${signature}`);

  return new Request(request.url, { method: "GET", headers });
}
