import type postgres from "postgres";
import type { generateDrizzleJson } from "drizzle-kit/api";

type Snapshot = ReturnType<typeof generateDrizzleJson>;
type Row = Record<string, unknown>;
const identifier = (value: string) => '"' + value.replaceAll('"', '""') + '"';
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}

/**
 * Compare native catalog definitions, using empty transaction-local TEMP tables to canonicalize
 * repository expressions through PostgreSQL itself. No user rows, persistent objects, or grants change.
 * This avoids Drizzle Kit's lossy CHECK/opclass/unique-column introspection and interactive push planner.
 */
export async function verifyLiveSchema(client: ReturnType<typeof postgres>, snapshot: Snapshot) {
  const tables = Object.values(snapshot.tables);
  const prefix = `rc_${crypto.randomUUID().slice(0, 8)}_`;
  const expectedIndexNames = new Map<string, { table: string; name: string }>();
  const mismatches: Array<{ table: string; category: string; expected: unknown; actual: unknown }> =
    [];
  return client.begin(async (tx) => {
    await tx.unsafe("SET LOCAL statement_timeout = '30s'");
    const ddl: string[] = [];
    let indexNumber = 0;
    for (const table of tables) {
      const tempName = prefix + table.name;
      const columns = Object.values(table.columns).map((column) => {
        const type = column.typeSchema
          ? `${identifier(column.typeSchema)}.${identifier(column.type)}`
          : column.type;
        return `${identifier(column.name)} ${type}${
          column.generated
            ? ` GENERATED ALWAYS AS (${column.generated.as}) STORED`
            : column.default !== undefined
              ? ` DEFAULT ${String(column.default)}`
              : ""
        }${column.notNull ? " NOT NULL" : ""}`;
      });
      for (const check of Object.values(table.checkConstraints))
        columns.push(`CONSTRAINT ${identifier(check.name)} CHECK (${check.value})`);
      ddl.push(`CREATE TEMP TABLE ${identifier(tempName)} (${columns.join(", ")}) ON COMMIT DROP`);
      for (const index of Object.values(table.indexes)) {
        const indexName = `${prefix}idx_${indexNumber++}`;
        expectedIndexNames.set(indexName, { table: table.name, name: index.name });
        const expressions = index.columns.map(
          (column) =>
            `${column.isExpression ? `(${column.expression})` : identifier(column.expression)}${column.opclass ? ` ${column.opclass}` : ""}${index.method === "btree" ? ` ${column.asc ? "ASC" : "DESC"} NULLS ${column.nulls === "first" ? "FIRST" : "LAST"}` : ""}`,
        );
        ddl.push(
          `CREATE ${index.isUnique ? "UNIQUE " : ""}INDEX ${identifier(indexName)} ON ${identifier(tempName)} USING ${index.method} (${expressions.join(", ")})`,
        );
      }
    }
    await tx.unsafe(ddl.join(";\n")).simple();
    const namespaces = "(n.nspname = 'public' OR n.oid = pg_my_temp_schema())";
    const columnRows = await tx.unsafe<
      Row[]
    >(`SELECT c.relname AS table_name, n.nspname = 'public' AS live,
      a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null,
      nullif(a.attgenerated, '') AS generated, pg_get_expr(d.adbin, d.adrelid) AS expression
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
      WHERE ${namespaces} AND c.relkind = 'r' ORDER BY a.attname`);
    const checkRows = await tx.unsafe<
      Row[]
    >(`SELECT c.relname AS table_name, n.nspname = 'public' AS live,
      con.conname AS name, pg_get_constraintdef(con.oid) AS definition, con.convalidated AS validated
      FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace WHERE ${namespaces} AND con.contype = 'c' ORDER BY con.conname`);
    const indexRows = await tx.unsafe<
      Row[]
    >(`SELECT c.relname AS table_name, n.nspname = 'public' AS live,
      ci.relname AS name, am.amname AS method, i.indisunique AS unique, i.indnullsnotdistinct AS nulls_not_distinct,
      i.indisvalid AND i.indisready AS valid, pg_get_expr(i.indpred, i.indrelid) AS predicate,
      ARRAY(SELECT pg_get_indexdef(i.indexrelid, key, true) FROM generate_series(1, i.indnkeyatts) AS key) AS keys
      FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_class ci ON ci.oid = i.indexrelid
      JOIN pg_am am ON am.oid = ci.relam JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE ${namespaces} AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = i.indexrelid)
      ORDER BY ci.relname`);
    const constraints = await tx.unsafe<Row[]>(`SELECT c.relname AS table_name, con.conname AS name,
      con.contype AS type, con.convalidated AS validated, con.condeferrable AS deferrable, con.condeferred AS deferred,
      ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum ORDER BY k.ord) AS columns,
      CASE WHEN con.contype = 'f' THEN ref.relname ELSE NULL END AS reference_table,
      CASE WHEN con.contype = 'f' THEN rn.nspname ELSE NULL END AS reference_schema,
      CASE WHEN con.contype = 'f' THEN ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = ref.oid AND a.attnum = k.attnum ORDER BY k.ord) ELSE NULL END AS reference_columns,
      CASE WHEN con.contype = 'f' THEN con.confdeltype::text ELSE NULL END AS on_delete,
      CASE WHEN con.contype = 'f' THEN con.confupdtype::text ELSE NULL END AS on_update
      FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_class ref ON ref.oid = con.confrelid
      LEFT JOIN pg_namespace rn ON rn.oid = ref.relnamespace
      WHERE n.nspname = 'public' AND con.contype IN ('p','u','f') ORDER BY con.conname`);
    const liveTables = await tx.unsafe<Row[]>(
      "SELECT tablename AS name, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    const compare = (table: string, category: string, expected: unknown, actual: unknown) => {
      if (stable(expected) !== stable(actual))
        mismatches.push({ table, category, expected, actual });
    };
    compare(
      "public",
      "tables",
      tables.map((table) => table.name).sort(),
      liveTables.map((table) => table["name"]).sort(),
    );
    for (const table of tables) {
      const select = (rows: Row[], live: boolean) =>
        rows
          .filter(
            (row) =>
              row["live"] === live &&
              row["table_name"] === (live ? table.name : prefix + table.name),
          )
          .map(({ table_name: _table, live: _live, ...row }) => row);
      compare(
        table.name,
        "columns/defaults/generated expressions",
        select(columnRows, false),
        select(columnRows, true),
      );
      compare(table.name, "CHECK constraints", select(checkRows, false), select(checkRows, true));
      const expectedIndexes = indexRows
        .filter((row) => row["live"] === false && row["table_name"] === prefix + table.name)
        .map(({ table_name: _table, live: _live, ...row }) => ({
          ...row,
          name: expectedIndexNames.get(String(row["name"]))!.name,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const actualIndexes = select(indexRows, true).sort((a, b) =>
        String(a["name"]).localeCompare(String(b["name"])),
      );
      compare(table.name, "indexes/methods/opclasses/order", expectedIndexes, actualIndexes);
      compare(
        table.name,
        "RLS",
        table.isRLSEnabled,
        liveTables.find((row) => row["name"] === table.name)?.["rowsecurity"],
      );
      const expectedConstraints: Row[] = [];
      const base = {
        table_name: table.name,
        validated: true,
        deferrable: false,
        deferred: false,
        reference_table: null,
        reference_schema: null,
        reference_columns: null,
        on_delete: null,
        on_update: null,
      };
      const primaryColumns = Object.values(table.columns)
        .filter((column) => column.primaryKey)
        .map((column) => column.name);
      if (primaryColumns.length)
        expectedConstraints.push({
          ...base,
          name: `${table.name}_pkey`,
          type: "p",
          columns: primaryColumns,
        });
      for (const constraint of Object.values(table.uniqueConstraints))
        expectedConstraints.push({
          ...base,
          name: constraint.name,
          type: "u",
          columns: constraint.columns,
        });
      const action = (value: string | undefined) =>
        ({ cascade: "c", restrict: "r", "set null": "n", "set default": "d", "no action": "a" })[
          value ?? "no action"
        ];
      for (const key of Object.values(table.foreignKeys))
        expectedConstraints.push({
          ...base,
          name: key.name,
          type: "f",
          columns: key.columnsFrom,
          reference_table: key.tableTo,
          reference_schema: key.schemaTo ?? "public",
          reference_columns: key.columnsTo,
          on_delete: action(key.onDelete),
          on_update: action(key.onUpdate),
        });
      expectedConstraints.sort((a, b) => String(a["name"]).localeCompare(String(b["name"])));
      compare(
        table.name,
        "PK/UNIQUE/FK constraints",
        expectedConstraints,
        constraints
          .filter((row) => row["table_name"] === table.name)
          .sort((a, b) => String(a["name"]).localeCompare(String(b["name"]))),
      );
    }
    const enums = await tx.unsafe<Row[]>(
      "SELECT t.typname AS name, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS values FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace JOIN pg_enum e ON e.enumtypid = t.oid WHERE n.nspname = 'public' GROUP BY t.typname ORDER BY t.typname",
    );
    compare(
      "public",
      "enums",
      Object.values(snapshot.enums)
        .map((item) => ({ name: item.name, values: item.values }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      enums,
    );
    return {
      checkedAt: new Date().toISOString(),
      tableCount: tables.length,
      indexCount: expectedIndexNames.size,
      mismatches,
    };
  });
}
