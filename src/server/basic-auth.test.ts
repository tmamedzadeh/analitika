import { describe, expect, it } from "vitest";

import { basicAuthCredentialsMatch, demoAuthUnavailableResponse } from "./basic-auth";

describe("demo basic authentication safeguards", () => {
  it("matches exact credentials and rejects wrong values or lengths", () => {
    expect(basicAuthCredentialsMatch("analitika:secret", "analitika:secret")).toBe(true);
    expect(basicAuthCredentialsMatch("analitika:secret", "analitika:secreT")).toBe(false);
    expect(basicAuthCredentialsMatch("analitika:secret", "analitika:secret-extra")).toBe(false);
    expect(basicAuthCredentialsMatch("analitika:secret", "")).toBe(false);
  });

  it("returns a no-store JSON 503 when production authentication is unavailable", async () => {
    const response = demoAuthUnavailableResponse();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toHaveProperty("message");
  });
});
