// Runnable self-check: node --experimental-strip-types src/lib/completion.check.ts
import assert from "node:assert/strict";
import {
  buildNamespace,
  contextKeywords,
  editorCompletions,
  ident,
  isSnippet,
  joinSuggestions,
  snippetTemplate,
  tableRefs,
} from "./completion.ts";

const catalog = {
  public: {
    columns: [
      { table: "orders", name: "id", data_type: "int" },
      { table: "orders", name: "customer_id", data_type: "int" },
      { table: "customers", name: "id", data_type: "int" },
      { table: "Order", name: "customerId", data_type: "uuid" },
    ],
    foreign_keys: [
      { table: "orders", columns: ["customer_id"], ref_schema: "public", ref_table: "customers", ref_columns: ["id"] },
      { table: "order_items", columns: ["order_id"], ref_schema: "public", ref_table: "orders", ref_columns: ["id"] },
      { table: "Order", columns: ["customerId"], ref_schema: "public", ref_table: "Customer", ref_columns: ["id"] },
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
// mixed-case columns get a quoted `apply` (lang-sql quotes table names itself, not custom column objects)
const orderNs = buildNamespace(
  { public: [{ schema: "public", name: "Order", kind: "table", row_estimate: null }] },
  catalog,
) as Record<string, { label: string; apply?: string }[]>;
const orderCols = orderNs.Order;
assert.deepEqual(orderCols, [{ label: "customerId", type: "property", detail: "uuid", apply: '"customerId"' }]);
const mysqlNs = buildNamespace({ public: tables.public }, catalog, "`") as Record<
  string,
  { label: string; apply?: string }[]
>;
assert.equal(mysqlNs.orders[0].apply, undefined);

// aliases: AS, bare, schema-qualified, keyword after the table is not an alias
assert.deepEqual(
  tableRefs("select * from orders o join public.customers as c on c.id = o.customer_id where o.id > 1"),
  [
    { schema: null, table: "orders", alias: "o" },
    { schema: "public", table: "customers", alias: "c" },
  ],
);
assert.deepEqual(tableRefs('select 1 from "Orders" where x'), [{ schema: null, table: "Orders", alias: '"Orders"' }]);
// a clause keyword is never consumed as an alias, so the next JOIN source is still found
assert.deepEqual(tableRefs("select * from orders join customers c on c.id = orders.customer_id join "), [
  { schema: null, table: "orders", alias: "orders" },
  { schema: null, table: "customers", alias: "c" },
]);
assert.deepEqual(tableRefs("select * from orders as o, customers"), [{ schema: null, table: "orders", alias: "o" }]);

// JOIN suggestions: forward FK (orders → customers) and reverse FK (order_items → orders)
const joins = joinSuggestions("select * from orders o join ", catalog).map((c) => c.label);
assert.deepEqual(joins, ["customers c ON c.id = o.customer_id", "order_items o2 ON o2.order_id = o.id"]);
assert.deepEqual(joinSuggestions("select 1", catalog), []);
// quoted identifiers survive; cross-schema reverse FKs are found and schema-qualified; MySQL uses backticks
assert.equal(ident("orders", '"'), "orders");
assert.equal(ident("Customer", '"'), '"Customer"');
assert.equal(ident('we"ird', '"'), '"we""ird"');
assert.deepEqual(
  joinSuggestions('select * from "Order" join ', catalog).map((c) => c.label),
  ['"Customer" c ON c.id = "Order"."customerId"'],
);
// a schema-qualified source keeps its join targets qualified (it is probably outside the search path)
assert.deepEqual(
  joinSuggestions("select * from public.customers c join ", catalog).map((c) => c.label),
  ["public.orders o ON o.customer_id = c.id", "audit.events e ON e.customer_id = c.id"],
);
assert.deepEqual(
  joinSuggestions("select * from customers c join ", catalog).map((c) => c.label),
  ["orders o ON o.customer_id = c.id", "audit.events e ON e.customer_id = c.id"],
);
assert.deepEqual(
  joinSuggestions("select * from Order join ", catalog, "`").map((c) => c.label),
  ["`Customer` c ON c.id = Order.`customerId`"],
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

// snippets are opt-in through numbered placeholders; shell-style or escaped braces are ordinary SQL
assert.ok(isSnippet("select * from ${1:table} limit ${2}"));
assert.ok(!isSnippet("select '${HOME}' as home"));
assert.ok(!isSnippet("select 1"));
assert.equal(
  snippetTemplate("select '${HOME}', #{x} from ${1:orders} limit ${2}"),
  "select '$\\{HOME\\}', #\\{x\\} from ${1:orders} limit ${2}",
);
console.log("completion.check ok");
