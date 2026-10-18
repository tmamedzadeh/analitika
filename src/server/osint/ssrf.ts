import { lookup as lookupHost } from "node:dns";
import type { LookupAddress } from "node:dns";

import ipaddr from "ipaddr.js";

export function isPublicIpAddress(value: string): boolean {
  try {
    const address = ipaddr.parse(value.replace(/^\[|\]$/g, ""));
    if (address instanceof ipaddr.IPv6 && address.isIPv4MappedAddress()) {
      return address.toIPv4Address().range() === "unicast";
    }
    return address.range() === "unicast";
  } catch {
    return false;
  }
}

export async function resolvePublicHost(
  hostname: string,
  timeoutMs = 1800,
): Promise<{
  address: string;
  family: 4 | 6;
}> {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".test")
  ) {
    throw new Error("Private host blocked");
  }

  if (ipaddr.isValid(host)) {
    if (!isPublicIpAddress(host)) throw new Error("Private address blocked");
    return { address: host, family: ipaddr.IPv4.isValid(host) ? 4 : 6 };
  }

  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  let records: LookupAddress[];
  try {
    records = await Promise.race([
      new Promise<LookupAddress[]>((resolve, reject) => {
        lookupHost(host, { all: true, verbatim: true }, (error, addresses) => {
          if (error) reject(error);
          else resolve(addresses);
        });
      }),
      new Promise<never>((_, reject) => {
        dnsTimer = setTimeout(() => reject(new Error("DNS timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (dnsTimer) clearTimeout(dnsTimer);
  }
  if (records.length === 0 || records.some((record) => !isPublicIpAddress(record.address))) {
    throw new Error("Host resolves to a non-public address");
  }
  const record = records[0]!;
  return { address: record.address, family: record.family as 4 | 6 };
}
