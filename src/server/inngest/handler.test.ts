import { createHmac } from "node:crypto";

import { Inngest } from "inngest";
import { describe, expect, it } from "vitest";

import { createSignedInngestHandler } from "./handler";

const signingKey = "signkey-test-secret";
const handler = createSignedInngestHandler({
  client: new Inngest({ id: "signature-check", isDev: false, signingKey }),
  functions: [],
});

function signedHeaders(body: string): HeadersInit {
  const timestamp = Math.round(Date.now() / 1000).toString();
  const signature = createHmac("sha256", "secret").update(body).update(timestamp).digest("hex");
  return { "x-inngest-signature": `t=${timestamp}&s=${signature}` };
}

describe("Inngest request signature handling", () => {
  it("returns JSON for an unsigned GET and allows an authenticated GET", async () => {
    const unsigned = await handler(
      new Request("https://app.test/api/inngest", {
        method: "GET",
        headers: { host: "app.test" },
      }),
    );
    expect(unsigned.status).toBe(401);
    expect(unsigned.headers.get("content-type")).toContain("application/json");

    const signed = await handler(
      new Request("https://app.test/api/inngest", {
        method: "GET",
        headers: { ...signedHeaders(""), host: "app.test" },
      }),
    );
    expect(signed.status).toBe(200);
    expect(await signed.json()).toMatchObject({ authentication_succeeded: true });
  });

  it("rejects unsigned execution and accepts a signed trust probe", async () => {
    const url = "https://app.test/api/inngest?probe=trust";
    const unsigned = await handler(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json", host: "app.test" },
        body: "{}",
      }),
    );
    expect(unsigned.status).toBe(401);

    const signed = await handler(
      new Request(url, {
        method: "POST",
        headers: {
          ...signedHeaders("{}"),
          "content-type": "application/json",
          host: "app.test",
        },
        body: "{}",
      }),
    );
    expect(signed.status).toBe(200);
  });

  it("requires a signature for function registration", async () => {
    const url = "https://app.test/api/inngest?deployId=test";
    const body = '{"url":"https://app.test/api/inngest"}';
    const response = await handler(
      new Request(url, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-inngest-sync-kind": "in_band",
          host: "app.test",
        },
        body,
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");

    const signed = await handler(
      new Request(url, {
        method: "PUT",
        headers: {
          ...signedHeaders(body),
          "content-type": "application/json",
          "x-inngest-sync-kind": "in_band",
          host: "app.test",
        },
        body,
      }),
    );
    expect(signed.status).toBe(200);
    expect(signed.headers.get("content-type")).toContain("application/json");
  });
});
