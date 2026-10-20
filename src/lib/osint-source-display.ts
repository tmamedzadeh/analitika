import ipaddr from "ipaddr.js";

export function safeOriginalSourceUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.port
    ) {
      return null;
    }

    const hostname = url.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .replace(/\.$/, "");
    if (
      !hostname ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".test") ||
      hostname.endsWith(".invalid") ||
      hostname.endsWith(".example")
    ) {
      return null;
    }

    if (ipaddr.isValid(hostname)) {
      let address = ipaddr.parse(hostname);
      if (address instanceof ipaddr.IPv6 && address.isIPv4MappedAddress()) {
        address = address.toIPv4Address();
      }
      if (address.range() !== "unicast") return null;
    } else if (!hostname.includes(".")) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}
