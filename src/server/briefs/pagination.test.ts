import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  afterBriefPosition,
  beforeBriefPosition,
  briefNeighbors,
  paginateBriefPositions,
} from "./pagination";

const briefs = [
  { id: "00000000-0000-4000-8000-000000000005", date: "2026-10-18", title: "Today 5" },
  { id: "00000000-0000-4000-8000-000000000004", date: "2026-10-18", title: "Today 4" },
  { id: "00000000-0000-4000-8000-000000000003", date: "2026-10-18", title: "Today 3" },
  { id: "00000000-0000-4000-8000-000000000002", date: "2026-10-17", title: "Yesterday 2" },
  { id: "00000000-0000-4000-8000-000000000001", date: "2026-10-17", title: "Yesterday 1" },
];

describe("brief pagination with duplicate dates", () => {
  it("uses both the date and ID in the list and neighbor keyset predicates", () => {
    const position = {
      date: "2026-10-18",
      id: "00000000-0000-4000-8000-000000000004",
    };
    const dialect = new PgDialect();
    const older = dialect.sqlToQuery(afterBriefPosition(position));
    const newer = dialect.sqlToQuery(beforeBriefPosition(position));

    expect(older.sql).toContain('"brief_date" < $1');
    expect(older.sql).toContain('"brief_date" = $2');
    expect(older.sql).toContain('"id" < $3');
    expect(older.params).toEqual([position.date, position.date, position.id]);
    expect(newer.sql).toContain('"brief_date" > $1');
    expect(newer.sql).toContain('"brief_date" = $2');
    expect(newer.sql).toContain('"id" > $3');
    expect(newer.params).toEqual([position.date, position.date, position.id]);
  });

  it("pages through every record in a same-date group without gaps or repeats", () => {
    const first = paginateBriefPositions(briefs, null, 2);
    const second = paginateBriefPositions(briefs, first.nextCursor, 2);
    const third = paginateBriefPositions(briefs, second.nextCursor, 2);

    expect(first.items.map((brief) => brief.title)).toEqual(["Today 5", "Today 4"]);
    expect(second.items.map((brief) => brief.title)).toEqual(["Today 3", "Yesterday 2"]);
    expect(third.items.map((brief) => brief.title)).toEqual(["Yesterday 1"]);
    expect(third.nextCursor).toBeNull();
    expect([...first.items, ...second.items, ...third.items].map((brief) => brief.id)).toEqual(
      briefs.map((brief) => brief.id),
    );
  });

  it("navigates to adjacent records even when they share the current date", () => {
    expect(briefNeighbors(briefs, "00000000-0000-4000-8000-000000000004")).toEqual({
      previousId: "00000000-0000-4000-8000-000000000003",
      nextId: "00000000-0000-4000-8000-000000000005",
    });
    expect(briefNeighbors(briefs, "00000000-0000-4000-8000-000000000003")).toEqual({
      previousId: "00000000-0000-4000-8000-000000000002",
      nextId: "00000000-0000-4000-8000-000000000004",
    });
  });
});
