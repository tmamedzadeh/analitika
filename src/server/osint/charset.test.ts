import { describe, expect, it } from "vitest";

import { decodeHtmlBytes } from "./charset";

describe("HTML charset detection and byte decoding", () => {
  it("decodes Windows-1256 Persian, GB18030 Chinese, and Windows-1251 Russian bytes", () => {
    expect(
      decodeHtmlBytes(new Uint8Array([0xd3, 0xe1, 0xc7, 0xe3]), "text/html; charset=windows-1256"),
    ).toBe("سلام");
    expect(
      decodeHtmlBytes(new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]), "text/html; charset=gb18030"),
    ).toBe("你好");
    expect(
      decodeHtmlBytes(
        new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]),
        "text/html; charset=windows-1251",
      ),
    ).toBe("Привет");
  });

  it("uses a charset meta tag from the first 4 KiB when the header has none", () => {
    const prefix = new TextEncoder().encode('<meta charset="windows-1251"><body>');
    const body = new Uint8Array([...prefix, 0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);

    expect(decodeHtmlBytes(body, "text/html")).toContain("Привет");
  });

  it("uses UTF-8 when neither header nor meta declares a supported charset", () => {
    expect(decodeHtmlBytes(new TextEncoder().encode("Salam dünya"), "text/html")).toBe(
      "Salam dünya",
    );
  });
});
