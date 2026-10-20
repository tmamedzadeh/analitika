import { inArray, sql } from "drizzle-orm";

import { getDb } from "../db";
import { osintDomainClassifications } from "../db/schema";
import type { ClassificationStore } from "./domain-classification";

export function createDbClassificationStore(): ClassificationStore {
  return {
    async read(domains) {
      if (!domains.length) return [];
      return getDb()
        .select({
          domain: osintDomainClassifications.domain,
          type: osintDomainClassifications.type,
          source: osintDomainClassifications.source,
          classifiedAt: osintDomainClassifications.classifiedAt,
        })
        .from(osintDomainClassifications)
        .where(inArray(osintDomainClassifications.domain, domains))
        .then((rows) =>
          rows.flatMap((row) =>
            row.source === "registry" || row.source === "manual" || row.source === "model"
              ? [{ ...row, source: row.source }]
              : [],
          ),
        );
    },
    async writeModel(rows) {
      if (!rows.length) return;
      await getDb()
        .insert(osintDomainClassifications)
        .values(rows.map((row) => ({ domain: row.domain, type: row.type, source: "model" })))
        .onConflictDoUpdate({
          target: osintDomainClassifications.domain,
          set: {
            type: sql`excluded.type`,
            source: sql`excluded.source`,
            classifiedAt: sql`now()`,
          },
          // A manual correction must never be overwritten by a later model answer.
          setWhere: sql`${osintDomainClassifications.source} <> 'manual'`,
        });
    },
  };
}
