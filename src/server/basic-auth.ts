import { timingSafeEqual } from "node:crypto";

import { az } from "@/lib/i18n/az";

const MAX_CREDENTIAL_BYTES = 1024;

export function basicAuthCredentialsMatch(expected: string, supplied: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const suppliedBytes = Buffer.from(supplied, "utf8");
  const expectedPadded = Buffer.alloc(MAX_CREDENTIAL_BYTES);
  const suppliedPadded = Buffer.alloc(MAX_CREDENTIAL_BYTES);
  expectedBytes.copy(expectedPadded, 0, 0, MAX_CREDENTIAL_BYTES);
  suppliedBytes.copy(suppliedPadded, 0, 0, MAX_CREDENTIAL_BYTES);
  const equal = timingSafeEqual(expectedPadded, suppliedPadded);
  return (
    expectedBytes.length <= MAX_CREDENTIAL_BYTES &&
    suppliedBytes.length <= MAX_CREDENTIAL_BYTES &&
    expectedBytes.length === suppliedBytes.length &&
    equal
  );
}

export function demoAuthUnavailableResponse(): Response {
  return Response.json(
    { message: az.security.demoAuthUnavailable },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}
