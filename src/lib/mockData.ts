/**
 * Demo dataset for the browser mock (`?mock=1`): a fictional online store. Everything is generated from a fixed
 * seed and a fixed clock so screen recordings are reproducible. No real people; emails are `@example.com`.
 */
import type {
  Cell,
  ChartSpec,
  ChatSession,
  ConnectionConfig,
  Dashboard,
  HistoryEntry,
  QueryResult,
  SavedQuery,
  SchemaCatalog,
  SchemaObject,
  TableDetails,
  TableInfo,
} from "./types.ts";

export const connections: ConnectionConfig[] = [
  {
    id: "pg",
    name: "shop (Postgres)",
    driver: "postgres",
    color: "#3b6cf6",
    group: "Local",
    environment: "production",
    host: "127.0.0.1",
    port: 5432,
    user: "shop_app",
    database: "shop",
    ssl_mode: "disable",
    read_only: false,
    options: {},
  },
  {
    id: "redis",
    name: "cache (Redis)",
    driver: "redis",
    color: "#d23f3f",
    group: "Local",
    host: "127.0.0.1",
    port: 6379,
    user: "",
    database: "0",
    read_only: true,
    options: {},
  },
  {
    id: "mongo",
    name: "events (Mongo)",
    driver: "mongodb",
    color: "#1f8f5a",
    group: "Staging",
    environment: "staging",
    host: "10.0.0.4",
    port: 27017,
    user: "analytics",
    database: "analytics",
    read_only: false,
    options: {},
  },
];

// ---------------------------------------------------------------------------------------------------------------
// Deterministic randomness: every row is generated from (table, index), so paging and reloads give the same data.

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
/** mulberry32: tiny seeded PRNG returning floats in [0, 1). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rand = () => number;
const pick = <T>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const int = (r: Rand, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const money = (n: number) => Math.round(n * 100) / 100;

export function uuidFor(ns: string, i: number): string {
  const r = rng(hash(ns) + i * 7919);
  const hex = Array.from({ length: 32 }, () => Math.floor(r() * 16).toString(16)).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The demo's "now": recordings never drift with the wall clock. */
const NOW = Date.UTC(2026, 9, 11, 18, 0, 0);
const DAY = 86_400_000;
const ts = (msAgo: number) =>
  new Date(NOW - msAgo)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "+00");

const FIRST = [
  "Maya",
  "Lucas",
  "Priya",
  "Tomás",
  "Elena",
  "Kenji",
  "Amara",
  "Jonas",
  "Sofia",
  "Daniel",
  "Noor",
  "Mateo",
  "Hana",
  "Oskar",
  "Leila",
  "Ravi",
  "Ines",
  "Felix",
  "Zara",
  "Theo",
];
const LAST = [
  "Okafor",
  "Brandt",
  "Raman",
  "Herrera",
  "Petrova",
  "Watanabe",
  "Nwosu",
  "Lindqvist",
  "Marino",
  "Cho",
  "Haddad",
  "Silva",
  "Novak",
  "Kowalski",
  "Moreau",
  "Iyer",
  "Duarte",
  "Becker",
  "Farouk",
  "Lund",
];
const COUNTRIES = ["US", "GB", "DE", "FR", "NL", "SE", "ES", "CA", "AU", "JP"];
export const CATEGORIES = [
  "Electronics",
  "Home & Kitchen",
  "Outdoor",
  "Apparel",
  "Beauty",
  "Books",
  "Toys",
  "Sports",
  "Garden",
  "Office",
  "Pet Supplies",
  "Grocery",
];
const ADJ = ["Classic", "Compact", "Ultra", "Eco", "Pro", "Everyday", "Travel", "Smart", "Studio", "Trail"];
const NOUN: Record<string, string[]> = {
  Electronics: ["Wireless Earbuds", "USB-C Hub", "Bluetooth Speaker", "4K Webcam", "Power Bank"],
  "Home & Kitchen": ["Chef Knife", "French Press", "Cast Iron Skillet", "Linen Towels", "Glass Jars"],
  Outdoor: ["Camping Lantern", "Daypack", "Water Filter", "Hammock", "Trekking Poles"],
  Apparel: ["Merino Tee", "Rain Jacket", "Wool Socks", "Canvas Cap", "Hoodie"],
  Beauty: ["Face Serum", "Hand Cream", "Shampoo Bar", "Lip Balm", "Sunscreen"],
  Books: ["Field Guide", "Cookbook", "Notebook Set", "Atlas", "Puzzle Book"],
};
const nounFor = (cat: string) => NOUN[cat] ?? ["Gift Set", "Starter Kit", "Refill Pack"];
/** Settled orders, weighted like ORDER_STATUS: mostly delivered, a few cancelled or refunded. */
const settled = (r: Rand) => {
  const x = r();
  return x < 0.9 ? "delivered" : x < 0.96 ? "cancelled" : "refunded";
};
const CITIES: [string, string][] = [
  ["Austin", "US"],
  ["Leeds", "GB"],
  ["Lyon", "FR"],
  ["Utrecht", "NL"],
  ["Malmö", "SE"],
  ["Osaka", "JP"],
  ["Toronto", "CA"],
];
const CARRIERS = ["UPS", "DHL", "FedEx", "USPS", "PostNL"];
const METHODS = ["card", "card", "card", "paypal", "apple_pay", "bank_transfer"];
const SUPPLIER = ["Northwind", "Bluebird", "Cedar & Co", "Lumen", "Harbor", "Fieldstone", "Orchard", "Kestrel"];

export const person = (i: number) => {
  const r = rng(hash("person") + i);
  const first = pick(r, FIRST);
  const last = pick(r, LAST);
  return { first, last, email: `${first.toLowerCase().replace("á", "a")}.${last.toLowerCase()}${i % 97}@example.com` };
};

// ---------------------------------------------------------------------------------------------------------------
// Schema. Foreign keys are real (the ERD, FK jump and completion read them); row counts are estimates.

interface TableSpec {
  schema: string;
  kind?: "view";
  rows: number;
  cols: [name: string, type: string, def?: string][];
  fks?: [col: string, refTable: string][];
  comments?: Record<string, string>;
  row: (i: number, r: Rand) => Cell[];
}

/** Orders the demo's agent has cancelled; the table view reflects them. */
export const cancelledOrders = new Set<number>();

const orderStatus = (i: number, r: Rand) => {
  const id = 1001 + i;
  // Recent orders are still moving; old ones have settled. Always draw, so overrides keep the other columns stable.
  const s = i > 182_000 ? pick(r, ["processing", "shipped"]) : settled(r);
  if (cancelledOrders.has(id)) return "cancelled";
  return id === 1042 ? "processing" : s; // the scripted write demo targets this order
};

export const SPECS: Record<string, TableSpec> = {
  customers: {
    schema: "public",
    rows: 48_210,
    cols: [
      ["id", "uuid", "gen_random_uuid()"],
      ["email", "text"],
      ["full_name", "text"],
      ["country", "char(2)"],
      ["segment", "text"],
      ["tags", "text[]"],
      ["marketing", "jsonb"],
      ["created_at", "timestamptz", "now()"],
    ],
    comments: { segment: "retail | wholesale | vip" },
    row: (i, r) => {
      const p = person(i);
      return [
        uuidFor("customers", i),
        p.email,
        `${p.first} ${p.last}`,
        pick(r, COUNTRIES),
        i % 23 === 0 ? "vip" : i % 9 === 0 ? "wholesale" : "retail",
        i % 4 === 0 ? ["newsletter", "early-access"] : ["newsletter"],
        { opt_in: r() > 0.3, source: pick(r, ["organic", "ads", "referral"]) },
        ts((48_210 - i) * 0.015 * DAY + r() * DAY),
      ];
    },
  },
  categories: {
    schema: "public",
    rows: CATEGORIES.length,
    cols: [
      ["id", "int4"],
      ["name", "text"],
      ["slug", "text"],
      ["created_at", "timestamptz", "now()"],
    ],
    row: (i) => [
      i + 1,
      CATEGORIES[i] ?? `Category ${i + 1}`,
      (CATEGORIES[i] ?? `c${i}`).toLowerCase().replace(/\W+/g, "-"),
      ts(900 * DAY),
    ],
  },
  suppliers: {
    schema: "public",
    rows: 86,
    cols: [
      ["id", "int4"],
      ["name", "text"],
      ["country", "char(2)"],
      ["contact_email", "text"],
      ["created_at", "timestamptz", "now()"],
    ],
    row: (i, r) => {
      const name = `${SUPPLIER[i % SUPPLIER.length]} ${pick(r, ["Goods", "Supply", "Trading", "Works"])}`;
      return [
        i + 1,
        name,
        pick(r, COUNTRIES),
        `orders@${name.split(" ")[0].toLowerCase().replace(/\W/g, "")}${i}.example.com`,
        ts((800 - i) * DAY),
      ];
    },
  },
  products: {
    schema: "public",
    rows: 1_840,
    cols: [
      ["id", "int4"],
      ["sku", "text"],
      ["name", "text"],
      ["category_id", "int4"],
      ["supplier_id", "int4"],
      ["price", "numeric(10,2)"],
      ["stock", "int4"],
      ["tags", "text[]"],
      ["attributes", "jsonb"],
      ["created_at", "timestamptz", "now()"],
    ],
    fks: [
      ["category_id", "categories"],
      ["supplier_id", "suppliers"],
    ],
    row: (i, r) => {
      const c = i % CATEGORIES.length;
      return [
        i + 1,
        `SKU-${(10_000 + i * 7).toString(36).toUpperCase()}`,
        `${pick(r, ADJ)} ${pick(r, nounFor(CATEGORIES[c]))}`,
        c + 1,
        int(r, 1, 86),
        money(4.99 + r() * 240),
        r() < 0.06 ? 0 : int(r, 1, 900),
        r() < 0.2 ? ["bestseller"] : [],
        { color: pick(r, ["black", "white", "sand", "olive", "navy"]), weight_g: int(r, 40, 4000) },
        ts((1_840 - i) * 0.4 * DAY),
      ];
    },
  },
  orders: {
    schema: "public",
    rows: 182_400,
    cols: [
      ["id", "int8"],
      ["customer_id", "uuid"],
      ["status", "text", "'processing'"],
      ["total", "numeric(12,2)"],
      ["currency", "char(3)", "'USD'"],
      ["shipping_address", "jsonb"],
      ["placed_at", "timestamptz", "now()"],
    ],
    fks: [["customer_id", "customers"]],
    comments: { status: "processing | shipped | delivered | cancelled | refunded" },
    row: (i, r) => [
      1001 + i,
      uuidFor("customers", int(r, 0, 48_209)),
      orderStatus(i, r),
      money(12 + r() * r() * 480),
      "USD",
      ((c) => (i % 5 === 0 ? bigAddress(i, r, c) : { city: c[0], country: c[1] }))(pick(r, CITIES)),
      ts((182_400 - i) * 0.0045 * DAY),
    ],
  },
  order_items: {
    schema: "public",
    rows: 512_300,
    cols: [
      ["id", "int8"],
      ["order_id", "int8"],
      ["product_id", "int4"],
      ["quantity", "int4"],
      ["unit_price", "numeric(10,2)"],
    ],
    fks: [
      ["order_id", "orders"],
      ["product_id", "products"],
    ],
    row: (i, r) => [
      i + 1,
      1001 + Math.floor(i / 2.81),
      int(r, 1, 1_840),
      r() < 0.8 ? 1 : int(r, 2, 4),
      money(4.99 + r() * 240),
    ],
  },
  shipments: {
    schema: "public",
    rows: 171_900,
    cols: [
      ["id", "int8"],
      ["order_id", "int8"],
      ["carrier", "text"],
      ["tracking_no", "text"],
      ["shipped_at", "timestamptz"],
      ["delivered_at", "timestamptz"],
    ],
    fks: [["order_id", "orders"]],
    row: (i, r) => {
      const ago = (171_900 - i) * 0.0047 * DAY;
      return [
        i + 1,
        1001 + i,
        pick(r, CARRIERS),
        `1Z${Math.floor(r() * 1e12)
          .toString(36)
          .toUpperCase()}`,
        ts(ago),
        i > 171_000 ? null : ts(ago - int(r, 1, 5) * DAY),
      ];
    },
  },
  payments: {
    schema: "public",
    rows: 179_800,
    cols: [
      ["id", "int8"],
      ["order_id", "int8"],
      ["method", "text"],
      ["amount", "numeric(12,2)"],
      ["status", "text"],
      ["paid_at", "timestamptz"],
    ],
    fks: [["order_id", "orders"]],
    row: (i, r) => [
      i + 1,
      1001 + i,
      pick(r, METHODS),
      money(12 + r() * r() * 480),
      r() < 0.02 ? "failed" : "captured",
      ts((179_800 - i) * 0.0046 * DAY),
    ],
  },
  reviews: {
    schema: "public",
    rows: 36_400,
    cols: [
      ["id", "int8"],
      ["product_id", "int4"],
      ["customer_id", "uuid"],
      ["rating", "int2"],
      ["body", "text"],
      ["created_at", "timestamptz", "now()"],
    ],
    fks: [
      ["product_id", "products"],
      ["customer_id", "customers"],
    ],
    comments: { rating: "1–5 stars" },
    row: (i, r) => {
      const rating = Math.min(5, int(r, 2, 6));
      const body =
        rating >= 4
          ? pick(r, ["Great quality, fast shipping.", "Exactly as described.", "Would buy again."])
          : pick(r, ["Smaller than expected.", "Arrived late.", "Okay for the price."]);
      return [
        i + 1,
        int(r, 1, 1_840),
        uuidFor("customers", int(r, 0, 48_209)),
        rating,
        body,
        ts((36_400 - i) * 0.02 * DAY),
      ];
    },
  },
  v_recent_orders: {
    schema: "public",
    kind: "view",
    rows: 500,
    cols: [
      ["id", "int8"],
      ["customer_email", "text"],
      ["status", "text"],
      ["total", "numeric(12,2)"],
      ["placed_at", "timestamptz"],
    ],
    row: (i) => {
      const o = rowAt("orders", 182_399 - i);
      return [o[0], person(i * 37).email, o[2], o[3], o[6]];
    },
  },
  audit_log: {
    schema: "audit",
    rows: 99_120,
    cols: [
      ["id", "int8"],
      ["table_name", "text"],
      ["action", "text"],
      ["row_id", "text"],
      ["changed_by", "text"],
      ["diff", "jsonb"],
      ["changed_at", "timestamptz", "now()"],
    ],
    row: (i, r) => {
      const t = pick(r, ["orders", "products", "customers"]);
      const diff: Cell =
        t === "products" ? { stock: [int(r, 1, 50), int(r, 0, 49)] } : { status: ["processing", "shipped"] };
      return [
        i + 1,
        t,
        pick(r, ["INSERT", "UPDATE", "UPDATE", "DELETE"]),
        String(int(r, 1, 9000)),
        pick(r, ["shop_app", "admin", "import_job"]),
        diff,
        ts((99_120 - i) * 0.008 * DAY),
      ];
    },
  },
};

/** Every fifth order carries a full carrier payload so the grid and inspector show deep, wide JSON. */
function bigAddress(i: number, r: () => number, c: readonly string[]): Cell {
  const events = Array.from({ length: 6 + (i % 7) }, (_, k) => ({
    seq: k + 1,
    at: ts((182_400 - i) * 0.0045 * DAY + k * 0.3 * DAY),
    status: pick(r, ["label_created", "picked_up", "in_transit", "customs", "out_for_delivery", "delivered"]),
    facility: {
      code: `${c[1]}-${int(r, 10, 99)}`,
      geo: { lat: +(r() * 180 - 90).toFixed(5), lng: +(r() * 360 - 180).toFixed(5) },
    },
    note: k % 3 === 0 ? null : pick(r, ["Left at reception", "Signature required", "Rerouted via hub", "Scanned"]),
  }));
  return {
    recipient: { name: `${pick(r, ADJ)} Recipient`, phone: `+1-555-${int(r, 1000, 9999)}`, email: null },
    line1: `${int(r, 1, 999)} ${pick(r, ["Market", "Oak", "Harbour", "Station"])} St`,
    line2: i % 10 === 0 ? `Apt ${int(r, 1, 40)}` : null,
    city: c[0],
    country: c[1],
    postal_code: String(int(r, 10_000, 99_999)),
    geo: { lat: +(r() * 180 - 90).toFixed(6), lng: +(r() * 360 - 180).toFixed(6), accuracy_m: int(r, 3, 120) },
    delivery_windows: [
      { day: "mon", from: "09:00", to: "12:00" },
      { day: "thu", from: "13:00", to: "18:00" },
    ],
    preferences: { leave_safe: r() < 0.5, signature: r() < 0.3, instructions: "Ring twice; gate code 4471#" },
    carrier: { name: pick(r, ["UPS", "DHL", "FedEx"]), service: "express", tracking: `1Z${int(r, 1e8, 9e8)}`, events },
    validated: { provider: "loqate", score: +r().toFixed(3), flags: ["normalized", "geocoded"] },
  };
}

function rowAt(table: string, i: number): Cell[] {
  return SPECS[table].row(i, rng(hash(table) + i));
}

export function tables(schema: string): TableInfo[] {
  return Object.entries(SPECS)
    .filter(([, s]) => s.schema === schema)
    .map(([name, s]) => ({ schema, name, kind: s.kind ?? "table", row_estimate: s.kind ? null : s.rows }));
}

export function tableDetails(table: string): TableDetails {
  const s = SPECS[table] ?? SPECS.orders;
  const pk = s.kind ? null : "id";
  const columns = s.cols.map(([name, data_type, def], i) => ({
    name,
    data_type,
    nullable: name !== pk && !/^(email|name|full_name|sku|status|total|order_id|product_id|quantity)$/.test(name),
    default: def ?? (name === pk && data_type !== "uuid" ? `nextval('${table}_id_seq'::regclass)` : null),
    is_primary: name === pk,
    position: i + 1,
    comment: s.comments?.[name] ?? null,
    extra: null,
  }));
  const fks = (s.fks ?? []).map(([col, ref]) => ({
    name: `${table}_${col}_fkey`,
    columns: [col],
    ref_schema: "public",
    ref_table: ref,
    ref_columns: ["id"],
  }));
  const q = `"${s.schema}"."${table}"`;
  const indexes = [
    ...(pk
      ? [
          {
            name: `${table}_pkey`,
            columns: ["id"],
            unique: true,
            primary: true,
            definition: `CREATE UNIQUE INDEX ${table}_pkey ON ${s.schema}.${table} USING btree (id)`,
          },
        ]
      : []),
    ...(s.fks ?? []).map(([col]) => ({
      name: `${table}_${col}_idx`,
      columns: [col],
      unique: false,
      primary: false,
      definition: `CREATE INDEX ${table}_${col}_idx ON ${s.schema}.${table} USING btree (${col})`,
    })),
  ];
  const body = [
    ...columns.map(
      (c) => `  "${c.name}" ${c.data_type}${c.nullable ? "" : " NOT NULL"}${c.default ? ` DEFAULT ${c.default}` : ""}`,
    ),
    ...(pk ? ['  PRIMARY KEY ("id")'] : []),
    ...fks.map((f) => `  FOREIGN KEY ("${f.columns[0]}") REFERENCES "public"."${f.ref_table}" ("id")`),
  ];
  const ddl = s.kind
    ? `CREATE VIEW ${q} AS\n  SELECT o.id, c.email AS customer_email, o.status, o.total, o.placed_at\n  FROM orders o JOIN customers c ON c.id = o.customer_id\n  ORDER BY o.placed_at DESC LIMIT 500;`
    : `CREATE TABLE ${q} (\n${body.join(",\n")}\n);`;
  return { columns, indexes, foreign_keys: fks, ddl };
}

export const schemaObjects = (schema: string): SchemaObject[] =>
  tables(schema).map((t) => ({ table: t, details: tableDetails(t.name) }));

export function catalog(schema: string): SchemaCatalog {
  const names = tables(schema).map((t) => t.name);
  return {
    columns: names.flatMap((t) => SPECS[t].cols.map(([name, data_type]) => ({ table: t, name, data_type }))),
    foreign_keys: names.flatMap((t) =>
      (SPECS[t].fks ?? []).map(([col, ref]) => ({
        table: t,
        columns: [col],
        ref_schema: "public",
        ref_table: ref,
        ref_columns: ["id"],
      })),
    ),
  };
}

export function qr(
  cols: [string, string][],
  rows: Cell[][],
  statement = "",
  extra: Partial<QueryResult> = {},
): QueryResult {
  return {
    columns: cols.map(([name, type_name]) => ({ name, type_name })),
    rows,
    affected: null,
    duration_ms: 14,
    truncated: false,
    statement,
    ...extra,
  };
}

/** A page of a table, fetching `limit + 1` so `truncated` is honest. */
export function tablePage(table: string, offset: number, limit: number, statement: string): QueryResult {
  const s = SPECS[table] ?? SPECS.orders;
  const end = Math.min(s.rows, offset + limit);
  const rows = Array.from({ length: Math.max(0, end - offset) }, (_, k) => rowAt(table, offset + k));
  return qr(
    s.cols.map(([n, t]) => [n, t]),
    rows,
    statement,
    { truncated: end < s.rows, duration_ms: 9 + (rows.length % 11) },
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Aggregates the charts and the scripted agent show. Hand-tuned so they tell a believable story.

export const ORDER_STATUS: [string, number][] = [
  ["delivered", 151_880],
  ["shipped", 12_310],
  ["processing", 8_940],
  ["cancelled", 5_620],
  ["refunded", 3_650],
];
export const TOP_CATEGORIES: [string, number][] = [
  ["Electronics", 1_284_500],
  ["Home & Kitchen", 842_300],
  ["Outdoor", 611_900],
  ["Apparel", 498_200],
  ["Beauty", 312_700],
  ["Books", 154_100],
];
export const REVENUE_DAYS: [string, number, number][] = Array.from({ length: 14 }, (_, k) => {
  const d = new Date(NOW - (13 - k) * DAY);
  const r = rng(hash("revenue") + k);
  const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
  const orders = Math.round((weekend ? 390 : 300) + k * 6 + r() * 60);
  return [d.toISOString().slice(0, 10), orders, money(orders * (61 + r() * 9))];
});
export const TOP_CUSTOMERS: Cell[][] = [
  [42, 18_940.5],
  [37, 16_212.8],
  [33, 14_877.25],
  [29, 12_034.9],
  [31, 11_760.0],
  [24, 10_418.35],
  [26, 9_982.1],
  [22, 9_315.75],
  [19, 8_890.4],
  [21, 8_412.65],
].map(([n, v], k) => {
  // Curated distinct names: the generator's random pairs can repeat a first or last name in a top 10.
  const [first, last] = [FIRST[k].replace("á", "a"), LAST[k]];
  return [`${first} ${last}`, `${first}.${last}@example.com`.toLowerCase(), n, v];
});

export const SQL = {
  revenue:
    "SELECT date_trunc('day', placed_at)::date AS day,\n       count(*) AS orders,\n       sum(total) AS revenue\nFROM orders\nWHERE status NOT IN ('cancelled', 'refunded')\n  AND placed_at >= now() - interval '14 days'\nGROUP BY 1\nORDER BY 1;",
  status: "SELECT status, count(*) AS orders\nFROM orders\nGROUP BY 1\nORDER BY 2 DESC;",
  categories:
    "SELECT c.name AS category, sum(oi.quantity * oi.unit_price) AS revenue\nFROM order_items oi\nJOIN products p ON p.id = oi.product_id\nJOIN categories c ON c.id = p.category_id\nGROUP BY 1\nORDER BY 2 DESC\nLIMIT 6;",
  customers:
    "SELECT c.full_name, c.email,\n       count(o.id) AS orders,\n       sum(o.total) AS lifetime_value\nFROM customers c\nJOIN orders o ON o.customer_id = c.id\nWHERE o.status NOT IN ('cancelled', 'refunded')\nGROUP BY c.id\nORDER BY lifetime_value DESC\nLIMIT 10;",
};

export const RESULTS = {
  revenue: () =>
    qr(
      [
        ["day", "date"],
        ["orders", "int8"],
        ["revenue", "numeric"],
      ],
      REVENUE_DAYS,
      SQL.revenue,
      { duration_ms: 48 },
    ),
  status: () =>
    qr(
      [
        ["status", "text"],
        ["orders", "int8"],
      ],
      ORDER_STATUS,
      SQL.status,
      { duration_ms: 31 },
    ),
  categories: () =>
    qr(
      [
        ["category", "text"],
        ["revenue", "numeric"],
      ],
      TOP_CATEGORIES,
      SQL.categories,
      { duration_ms: 112 },
    ),
  customers: () =>
    qr(
      [
        ["full_name", "text"],
        ["email", "text"],
        ["orders", "int8"],
        ["lifetime_value", "numeric"],
      ],
      TOP_CUSTOMERS,
      SQL.customers,
      { duration_ms: 87 },
    ),
};

/** Chart data for a spec's SQL, matched on the query it runs. */
export function chartDataFor(sql: string): QueryResult {
  if (/categor/i.test(sql)) return RESULTS.categories();
  if (/lifetime_value/i.test(sql)) return RESULTS.customers();
  if (/group by status|status, count/i.test(sql.replace(/\s+/g, " "))) return RESULTS.status();
  return RESULTS.revenue();
}

const spec = (
  id: string,
  title: string,
  chart_type: ChartSpec["chart_type"],
  x: string,
  y: string,
  sql: string,
  description?: string,
): ChartSpec => ({
  id,
  title,
  description,
  chart_type,
  x,
  y: [y],
  source: { kind: "sql", sql },
});
export const CHARTS = {
  revenue: spec("c-revenue", "Revenue per day", "area", "day", "revenue", SQL.revenue, "Net revenue, last 14 days"),
  status: spec("c-status", "Orders by status", "pie", "status", "orders", SQL.status),
  categories: spec(
    "c-categories",
    "Top categories",
    "bar",
    "category",
    "revenue",
    SQL.categories,
    "All-time revenue by category",
  ),
};

export const dashboards: Dashboard[] = [
  {
    id: "d1",
    connection_id: "pg",
    title: "Sales overview",
    description: "Daily revenue, order pipeline and best-selling categories",
    charts: [CHARTS.revenue, CHARTS.status, CHARTS.categories],
    created_at: "2026-10-01T09:00:00Z",
    updated_at: "2026-10-10T16:20:00Z",
  },
];

export const history: HistoryEntry[] = [
  {
    id: "h1",
    connection_id: "pg",
    sql: "SELECT * FROM orders ORDER BY placed_at DESC LIMIT 100",
    ts: "2026-10-11T08:12:00Z",
    duration_ms: 18,
    ok: true,
    rows: 100,
  },
  { id: "h2", connection_id: "pg", sql: SQL.status, ts: "2026-10-11T08:14:30Z", duration_ms: 31, ok: true, rows: 5 },
  {
    id: "h3",
    connection_id: "pg",
    sql: "SELECT sku, name, stock FROM products WHERE stock = 0",
    ts: "2026-10-11T08:20:05Z",
    duration_ms: 12,
    ok: true,
    rows: 108,
  },
];

export const savedQueries: SavedQuery[] = [
  {
    id: "q1",
    connection_id: "pg",
    name: "Revenue per day (14d)",
    sql: SQL.revenue,
    created_at: "2026-10-01T09:00:00Z",
  },
  {
    id: "q2",
    connection_id: "pg",
    name: "Out of stock products",
    sql: "SELECT sku, name, supplier_id\nFROM products\nWHERE stock = 0\nORDER BY name;",
    created_at: "2026-10-02T10:30:00Z",
  },
  {
    id: "q3",
    connection_id: null,
    name: "Orders for customer",
    sql: "SELECT * FROM orders WHERE customer_id = '${1:customer_id}' ORDER BY placed_at DESC;",
    trigger: "ordersfor",
    created_at: "2026-10-03T11:00:00Z",
  },
];

// ---------------------------------------------------------------------------------------------------------------
// Redis and Mongo.

export const redisKeys = [
  { key: "session:3f9a1c7e", kind: "hash", ttl: 1742 },
  { key: "session:b2e40d19", kind: "hash", ttl: 655 },
  { key: "cart:3f9a1c7e", kind: "hash", ttl: 86_100 },
  { key: "cart:7c11e2a0", kind: "hash", ttl: 41_870 },
  { key: "leaderboard:weekly", kind: "zset", ttl: 302_400 },
  { key: "queue:emails", kind: "list", ttl: -1 },
  { key: "rate:ip:203.0.113.24", kind: "string", ttl: 42 },
  { key: "rate:ip:198.51.100.7", kind: "string", ttl: 17 },
  { key: "product:1842:views", kind: "string", ttl: -1 },
  { key: "online:customers", kind: "set", ttl: 60 },
  { key: "stream:order-events", kind: "stream", ttl: -1 },
];

export function redisValue(key: string) {
  const k = redisKeys.find((x) => x.key === key) ?? { key, kind: "string", ttl: -1 };
  const p = person(11);
  const values: Record<string, unknown> = {
    hash: key.startsWith("cart:")
      ? { "SKU-7PS": "1", "SKU-8C3": "2", "SKU-A1Q": "1", currency: "USD", updated_at: "2026-10-11T17:41:09Z" }
      : {
          customer_id: uuidFor("customers", 11),
          email: p.email,
          cart: key.replace("session:", "cart:"),
          ip: "203.0.113.24",
          last_seen: "2026-10-11T17:58:22Z",
        },
    zset: Array.from({ length: 8 }, (_, i) => [
      `${person(i * 13).first} ${person(i * 13).last}`,
      String(9_800 - i * 870),
    ]).flat(),
    list: [1042, 1043, 1047, 1051, 1052].map((id) =>
      JSON.stringify({ template: "order_shipped", order_id: id, to: person(id).email }),
    ),
    set: [11, 204, 87, 512, 66].map((i) => uuidFor("customers", i)),
    stream: [
      { id: "1791748800000-0", fields: { type: "order.placed", order_id: "183398" } },
      { id: "1791748805123-0", fields: { type: "payment.captured", order_id: "183398" } },
    ],
    string: key.startsWith("rate:") ? "37" : "1284",
  };
  const value = values[k.kind];
  return {
    key,
    type: k.kind,
    ttl: k.ttl,
    size: Array.isArray(value)
      ? value.length / (k.kind === "zset" ? 2 : 1)
      : typeof value === "object"
        ? Object.keys(value as object).length
        : 1,
    value,
  };
}

export const mongoCollections = [
  { name: "events", count: 1_204_388 },
  { name: "sessions", count: 91_204 },
  { name: "users", count: 48_210 },
];

export function mongoDocs(collection: string, skip: number, limit: number) {
  return Array.from({ length: limit }, (_, k) => {
    const i = skip + k;
    const r = rng(hash(collection) + i);
    const oid = `66f1c2a3${(0x10_0000 + i).toString(16).padStart(16, "0")}`;
    const p = person(i);
    const at = { $date: new Date(NOW - i * 41_000).toISOString() };
    if (collection === "users")
      return {
        _id: { $oid: oid },
        customer_id: uuidFor("customers", i),
        email: p.email,
        plan: pick(r, ["free", "plus", "plus", "pro"]),
        locale: pick(r, ["en-US", "en-GB", "de-DE", "fr-FR", "ja-JP"]),
        created_at: at,
      };
    if (collection === "sessions")
      return {
        _id: { $oid: oid },
        user: p.email,
        device: pick(r, ["desktop", "mobile", "tablet"]),
        pages: int(r, 1, 24),
        duration_s: int(r, 5, 1_800),
        started_at: at,
      };
    const event = pick(r, [
      "page_view",
      "page_view",
      "page_view",
      "product_view",
      "add_to_cart",
      "checkout_started",
      "order_placed",
    ]);
    return {
      _id: { $oid: oid },
      user: p.email,
      event,
      path:
        event === "page_view"
          ? pick(r, ["/", "/new", "/sale", "/c/electronics", "/c/outdoor"])
          : `/p/${int(r, 1, 1_840)}`,
      ts: at,
      props: { ref: pick(r, ["google", "newsletter", "direct", "instagram"]), device: pick(r, ["desktop", "mobile"]) },
    };
  });
}

export const mongoFields: Record<string, Record<string, string>> = {
  events: { _id: "objectId", user: "string", event: "string", path: "string", ts: "date", props: "object" },
  sessions: { _id: "objectId", user: "string", device: "string", pages: "int", duration_s: "int", started_at: "date" },
  users: {
    _id: "objectId",
    customer_id: "string",
    email: "string",
    plan: "string",
    locale: "string",
    created_at: "date",
  },
};

// ---------------------------------------------------------------------------------------------------------------
// The seeded "What tables are here?" conversation.

export function seededSession(): ChatSession {
  const list = tables("public");
  return {
    id: "s1",
    connection_id: "pg",
    provider_id: "claude-cli",
    title: "What tables are here?",
    created_at: "2026-10-11T09:00:00Z",
    updated_at: "2026-10-11T09:00:14Z",
    messages: [
      {
        role: "user",
        ts: "2026-10-11T09:00:00Z",
        blocks: [{ type: "text", text: "What tables are here and how do they relate?" }],
      },
      {
        role: "assistant",
        ts: "",
        blocks: [{ type: "tool_use", id: "t1", name: "list_tables", input: { schema: "public" } }],
      },
      {
        role: "user",
        ts: "",
        blocks: [{ type: "tool_result", tool_use_id: "t1", content: tableListText(list), is_error: false }],
      },
      {
        role: "assistant",
        ts: "",
        blocks: [{ type: "tool_use", id: "t2", name: "run_sql", input: { sql: SQL.status } }],
      },
      {
        role: "user",
        ts: "",
        blocks: [
          {
            type: "tool_result",
            tool_use_id: "t2",
            content: markdownTable(RESULTS.status()),
            is_error: false,
            display: { type: "query_results", results: [RESULTS.status()] },
          },
        ],
      },
      {
        role: "assistant",
        ts: "2026-10-11T09:00:14Z",
        blocks: [
          {
            type: "text",
            text:
              "`public` holds **9 tables and 1 view** for the store:\n\n- `customers` → `orders` → `order_items` ← `products`\n- `products` belong to `categories` and `suppliers`\n- each order has `payments` and `shipments`; `reviews` link `products` and `customers`\n- `v_recent_orders` is the last 500 orders with the customer's email\n\nMost of the 182,400 orders are delivered:\n\n" +
              markdownTable(RESULTS.status()),
          },
        ],
      },
    ],
  };
}

export const tableListText = (list: TableInfo[]) =>
  list
    .map(
      (t) =>
        `${t.name} (${t.kind}${t.row_estimate === null ? "" : `, ~${t.row_estimate.toLocaleString("en-US")} rows`})`,
    )
    .join("\n");

export function markdownTable(r: QueryResult): string {
  const fmt = (v: Cell) => (typeof v === "number" ? v.toLocaleString("en-US") : String(v));
  return [
    `| ${r.columns.map((c) => c.name).join(" | ")} |`,
    `|${r.columns.map(() => "---").join("|")}|`,
    ...r.rows.map((row) => `| ${row.map(fmt).join(" | ")} |`),
  ].join("\n");
}
