import { createHash } from "node:crypto";
import { eq, or, sql } from "drizzle-orm";
import { dailyBriefs } from "../db/schema";

export function briefContentHash(brief: {
  title: string;
  body: string;
  briefDate: string;
}): string {
  return createHash("sha256")
    .update(
      `${Buffer.byteLength(brief.title, "utf8")}:${brief.title}${Buffer.byteLength(brief.body, "utf8")}:${brief.body}${brief.briefDate}`,
    )
    .digest("hex");
}

/** Retained chunks can serve unchanged content during a retry, never an older edited body. */
export function hasCommittedBriefIndex() {
  return or(
    eq(dailyBriefs.indexStatus, "ready"),
    sql`${dailyBriefs.indexProgress} ->> 'contentHash' = encode(sha256(convert_to(octet_length(${dailyBriefs.title})::text || ':' || ${dailyBriefs.title} || octet_length(${dailyBriefs.body})::text || ':' || ${dailyBriefs.body} || ${dailyBriefs.briefDate}::text, 'UTF8')), 'hex')`,
  );
}
