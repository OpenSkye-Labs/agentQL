// Runnable self-check: node --experimental-strip-types src/lib/completion.check.ts
import assert from "node:assert/strict";
import { buildNamespace, contextKeywords, editorCompletions, ident, joinSuggestions, tableRefs } from "./completion.ts";

const catalog = {
  public: {
    columns: [
      { table: "orders", name: "id", data_type: "int" },
      { table: "orders", name: "customer_id", data_type: "int" },
      { table: "customers", name: "id", data_type: "int" },
    ],
    foreign_keys: [
      { table: "orders", columns: ["customer_id"], ref_schema: "public", ref_table: "customers", ref_columns: ["id"] },
      { table: "order_items", columns: ["order_id"], ref_schema: "public", ref_table: "orders", ref_columns: ["id"] },
      { table: "Claim", columns: ["candidateId"], ref_schema: "public", ref_table: "Candidate", ref_columns: ["id"] },
    ],
  },
  audit: {
    columns: [],
    foreign_keys: [
      { table: "events", columns: ["customer_id"], ref_schema: "public", ref_table: "customers", ref_columns: ["id"] },
    ],
  },
};
const tables = {
  public: ["orders", "customers", "order_items"].map((name) => ({
    schema: "public",
    name,
    kind: "table",
    row_estimate: null,
  })),
};

// namespace: bare and qualified keys share the column list lang-sql needs for `o.`
const ns = buildNamespace(tables, catalog) as Record<string, { label: string }[]>;
assert.deepEqual(
  ns.orders.map((c) => c.label),
  ["id", "customer_id"],
);
assert.equal(ns["public.orders"], ns.orders);
assert.deepEqual(ns.order_items, []);

// aliases: AS, bare, schema-qualified, keyword after the table is not an alias
assert.deepEqual(
  tableRefs("select * from orders o join public.customers as c on c.id = o.customer_id where o.id > 1"),
  [
    { schema: null, table: "orders", alias: "o" },
    { schema: "public", table: "customers", alias: "c" },
  ],
);
assert.deepEqual(tableRefs('select 1 from "Orders" where x'), [{ schema: null, table: "Orders", alias: '"Orders"' }]);

// JOIN suggestions: forward FK (orders → customers) and reverse FK (order_items → orders)
const joins = joinSuggestions("select * from orders o join ", catalog).map((c) => c.label);
assert.deepEqual(joins, ["customers c ON c.id = o.customer_id", "order_items o2 ON o2.order_id = o.id"]);
assert.deepEqual(joinSuggestions("select 1", catalog), []);
// quoted identifiers survive; cross-schema reverse FKs are found and schema-qualified; MySQL uses backticks
assert.equal(ident("orders", '"'), "orders");
assert.equal(ident("Candidate", '"'), '"Candidate"');
assert.equal(ident('we"ird', '"'), '"we""ird"');
assert.deepEqual(
  joinSuggestions('select * from "Claim" join ', catalog).map((c) => c.label),
  ['"Candidate" c ON c.id = "Claim"."candidateId"'],
);
assert.deepEqual(
  joinSuggestions("select * from public.customers c join ", catalog).map((c) => c.label),
  ["orders o ON o.customer_id = c.id", "audit.events e ON e.customer_id = c.id"],
);
assert.deepEqual(
  joinSuggestions("select * from Claim join ", catalog, "`").map((c) => c.label),
  ["`Candidate` c ON c.id = Claim.`candidateId`"],
);

// the completion source at the very end of the document still sees the JOIN context
const fakeCtx = (text: string) => ({
  pos: text.length,
  explicit: true,
  state: { doc: { toString: () => text } },
  matchBefore: (re: RegExp) => {
    const m = text.match(new RegExp(`(?:${re.source})$`));
    return m ? { from: text.length - m[0].length, to: text.length, text: m[0] } : null;
  },
});
const source = editorCompletions({
  catalog: () => catalog,
  snippets: () => [],
  postgres: () => true,
  quote: () => '"',
});
const atEnd = source(fakeCtx("select * from orders o join ") as never);
assert.equal(atEnd?.options[0]?.label, "customers c ON c.id = o.customer_id");
const afterWhere = source(fakeCtx("select 1; select * from orders where id = 1 ") as never);
assert.ok(afterWhere?.options.some((o) => o.label === "AND"));
assert.equal(source(fakeCtx("select o. ") as never), null);

// context keywords follow the last clause
assert.ok(contextKeywords("").includes("SELECT"));
assert.ok(contextKeywords("select id ").includes("FROM"));
assert.ok(contextKeywords("select * from orders o ").includes("WHERE"));
assert.ok(contextKeywords("select * from orders where id = 1 ").includes("AND"));
assert.ok(contextKeywords("select * from t order by id ").includes("DESC"));
assert.ok(contextKeywords("update t set a = 1 ", true).includes("RETURNING"));
assert.ok(!contextKeywords("update t set a = 1 ", false).includes("RETURNING"));
assert.ok(contextKeywords("delete from t ").includes("WHERE"));
console.log("completion.check ok");
