/**
 * Scripted agent runs for the browser mock: `ai_send` picks a canned run by keywords and plays it as real
 * `ai:event`s with human-paced delays, so the chat panel streams exactly as it does against the backend.
 */
import {
  CHARTS,
  RESULTS,
  SPECS,
  SQL,
  TOP_CUSTOMERS,
  cancelledOrders,
  markdownTable,
  qr,
  seededSession,
  tableDetails,
  tableListText,
  tables,
  tablePage,
} from "./mockData.ts";
import type { AgentEvent, Block, ChatSession, Message } from "./types.ts";

export type Emit = (event: string, payload: unknown) => void;
export type RunKind = "write" | "customers" | "revenue" | "fallback";

/** Which canned run a prompt plays. Write requests win so "cancel the order" never charts revenue. */
export function pickRun(text: string): RunKind {
  const t = text.toLowerCase();
  if (/\b(cancel\w*|mark|update|delete|refund\w*)\b/.test(t) && /\borders?\b/.test(t)) return "write";
  if (/customer|spend|buyer|vip/.test(t)) return "customers";
  if (/revenue|chart|sales|trend|plot|graph/.test(t)) return "revenue";
  return "fallback";
}

interface ToolOut {
  content: string;
  is_error?: boolean;
  display?: unknown;
}
interface Run {
  cancelled: boolean;
  approvalId?: string;
  /** Saves what the user has already seen (finished and half-streamed text) when the run is stopped. */
  keepPartial?: () => void;
}
class Cancelled extends Error {}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const now = () => new Date().toISOString();

export function createAgent(emit: Emit, allowWrites: () => boolean) {
  const sessions = new Map<string, ChatSession>([["s1", seededSession()]]);
  const running = new Map<string, Run>();
  const approvals = new Map<string, (ok: boolean) => void>();
  let seq = 0;
  const send = (sid: string, event: AgentEvent) => emit("ai:event", { session_id: sid, event });
  const get = (id: string) => {
    const s = sessions.get(id);
    if (!s) throw `chat session ${id} not found`;
    return s;
  };

  /** Step helpers for one run: each emits, waits a human beat, and records the transcript like the backend. */
  function steps(sid: string, run: Run) {
    const sleep = (ms: number) =>
      new Promise((r) => setTimeout(r, ms)).then(() => {
        if (run.cancelled) throw new Cancelled();
      });
    let pending: Block[] = [];
    /** Saves messages to the stored session as each step completes, like the backend, so a cancel keeps them. */
    const persist = (...msgs: Message[]) => {
      const cur = sessions.get(sid);
      if (cur) sessions.set(sid, { ...cur, updated_at: now(), messages: [...cur.messages, ...msgs] });
    };
    let streamed = false;
    let live = "";
    const flush = () => {
      if (pending.length) persist({ role: "assistant", ts: now(), blocks: pending });
      pending = [];
    };
    run.keepPartial = () => {
      if (live.trim()) pending.push({ type: "text", text: live.trim() });
      live = "";
      flush();
    };
    return {
      flush,
      status: async (text: string) => {
        send(sid, { kind: "status", text });
        await sleep(300);
      },
      say: async (text: string) => {
        for (const w of (streamed ? `\n\n${text}` : text).split(/(?<=\s)/)) {
          send(sid, { kind: "text_delta", text: w });
          live += w;
          await sleep(35);
        }
        streamed = true;
        live = "";
        pending.push({ type: "text", text });
      },
      tool: async (name: string, input: unknown, produce: () => ToolOut | Promise<ToolOut>) => {
        const id = `toolu_${++seq}`;
        const call: Message = {
          role: "assistant",
          ts: now(),
          blocks: [...pending, { type: "tool_use", id, name, input }],
        };
        send(sid, { kind: "tool_call", id, name, input });
        await sleep(700);
        const r = await produce();
        const block: Block = { type: "tool_result", tool_use_id: id, content: r.content, is_error: !!r.is_error };
        persist(call, { role: "user", ts: now(), blocks: [r.display ? { ...block, display: r.display } : block] });
        pending = [];
        send(sid, { kind: "tool_result", id, content: r.content, is_error: !!r.is_error, display: r.display ?? null });
        await sleep(250);
      },
      approve: async (statement: string) => {
        const id = `approval_${++seq}`;
        const ok = new Promise<boolean>((resolve) => approvals.set(id, resolve));
        run.approvalId = id;
        send(sid, {
          kind: "approval_request",
          id,
          approval_kind: "write",
          description: "The agent wants to run a write statement",
          statement,
        });
        const approved = await ok;
        approvals.delete(id);
        run.approvalId = undefined;
        if (run.cancelled) throw new Cancelled();
        return approved;
      },
    };
  }
  type Steps = ReturnType<typeof steps>;

  const listTables = (s: Steps) =>
    s.tool("list_tables", { schema: "public" }, () => ({ content: tableListText(tables("public")) }));

  const scripts: Record<RunKind, (s: Steps, text: string) => Promise<void>> = {
    revenue: async (s) => {
      await s.status("Inspecting schema");
      await listTables(s);
      await s.tool("describe_table", { schema: "public", table: "orders" }, () => ({
        content: "orders: id int8, customer_id uuid, status text, total numeric(12,2), placed_at timestamptz, …",
        display: { type: "table_details", schema: "public", table: "orders", details: tableDetails("orders") },
      }));
      await s.status("Querying revenue");
      const r = RESULTS.revenue();
      await s.tool("run_sql", { sql: SQL.revenue }, () => ({
        content: markdownTable(r),
        display: { type: "query_results", results: [r] },
      }));
      const rev = r.rows.map((x) => x[2] as number);
      const total = rev.reduce((a, b) => a + b, 0);
      const best = r.rows[rev.indexOf(Math.max(...rev))];
      await s.say(
        `Revenue over the last 14 days is **${usd(total)}**, about ${usd(total / 14)} a day. ` +
          `The best day was **${best[0]}** at ${usd(best[2] as number)}, and weekends run roughly 25% above weekdays. ` +
          "Cancelled and refunded orders are excluded.",
      );
      await s.tool(
        "create_chart",
        { title: "Daily revenue, last 2 weeks", chart_type: "bar", x: "day", y: ["revenue"], sql: SQL.revenue },
        () => ({
          content: "Chart ready",
          display: {
            type: "chart",
            spec: {
              ...CHARTS.revenue,
              id: `c-${Date.now()}`,
              title: "Daily revenue, last 2 weeks",
              description: "Excludes cancelled and refunded orders",
              chart_type: "bar",
            },
            data: r,
          },
        }),
      );
      await s.say("Use **Add to dashboard** on the chart to pin it to *Sales overview*.");
    },

    customers: async (s) => {
      await s.status("Planning query");
      const r = RESULTS.customers();
      await s.tool("run_sql", { sql: SQL.customers }, () => ({
        content: markdownTable(r),
        display: { type: "query_results", results: [r] },
      }));
      const top = TOP_CUSTOMERS.slice(0, 5)
        .map((c, i) => `| ${i + 1} | ${c[0]} | ${c[2]} | ${usd(c[3] as number)} |`)
        .join("\n");
      const sum = TOP_CUSTOMERS.reduce((a, c) => a + (c[3] as number), 0);
      const orders = TOP_CUSTOMERS.reduce((a, c) => a + (c[2] as number), 0);
      await s.say(
        `Your biggest spenders by lifetime value (cancelled and refunded orders excluded):\n\n| # | customer | orders | spent |\n|---|---|---|---|\n${top}\n\n` +
          `**${TOP_CUSTOMERS[0][0]}** leads with ${usd(TOP_CUSTOMERS[0][3] as number)}. The top 10 together spent **${usd(sum)}** across ${orders} orders.`,
      );
    },

    write: async (s, text) => {
      const id = Number(/\b(\d{3,})\b/.exec(text)?.[1] ?? 1042);
      const lookup = `SELECT id, status, total, placed_at\nFROM orders\nWHERE id = ${id};`;
      await s.status(`Looking up order ${id}`);
      const i = id - 1001;
      const found = i >= 0 && i < SPECS.orders.rows;
      const row = found ? tablePage("orders", i, 1, lookup).rows[0] : null;
      const r = qr(
        [
          ["id", "int8"],
          ["status", "text"],
          ["total", "numeric"],
          ["placed_at", "timestamptz"],
        ],
        row ? [[row[0], row[2], row[3], row[6]]] : [],
        lookup,
      );
      await s.tool("run_sql", { sql: lookup }, () => ({
        content: markdownTable(r),
        display: { type: "query_results", results: [r] },
      }));
      if (!row) return s.say(`I couldn't find order ${id}, so there is nothing to cancel.`);
      if (row[2] === "cancelled") return s.say(`Order ${id} is already cancelled; nothing to change.`);
      await s.say(`Order ${id} is **${row[2]}**. Cancelling it writes to production, so it needs your approval.`);
      const update = `UPDATE orders\nSET status = 'cancelled'\nWHERE id = ${id};`;
      let approved = false;
      await s.tool("run_sql", { sql: update }, async () => {
        if (!allowWrites())
          return {
            content:
              "This statement writes data. Writes by the agent are disabled (Settings → AI → allow writes), or the connection is read-only. Ask the user to run it themselves by giving them the SQL.",
            is_error: true,
          };
        approved = await s.approve(update);
        if (!approved) return { content: "The user declined to run this statement.", is_error: true };
        cancelledOrders.add(id);
        const done = qr([], [], update, { affected: 1, duration_ms: 6 });
        return { content: "1 row affected", display: { type: "query_results", results: [done] } };
      });
      if (approved) await s.say(`Done: order **${id}** is now \`cancelled\` (1 row updated).`);
      else if (!allowWrites())
        await s.say(
          `Writes by the assistant are turned off, so I didn't change anything. Run this yourself:\n\n\`\`\`sql\n${update}\n\`\`\``,
        );
      else await s.say(`Stopped. You declined the update, so order ${id} is unchanged and still **${row[2]}**.`);
    },

    fallback: async (s) => {
      await s.status("Inspecting schema");
      await listTables(s);
      const sql = "SELECT count(*) AS orders FROM orders;";
      const r = qr([["orders", "int8"]], [[SPECS.orders.rows]], sql);
      await s.tool("run_sql", { sql }, () => ({
        content: markdownTable(r),
        display: { type: "query_results", results: [r] },
      }));
      await s.say(
        "This is the `shop` database: customers, products and 182,400 orders, with their items, payments, shipments and reviews. " +
          "Try asking me to chart revenue per day, find the customers who spend the most, or change an order.",
      );
    },
  };

  /** Ends a run: its next step throws `Cancelled`, and a pending approval resolves as declined. */
  function stop(sid: string) {
    const run = running.get(sid);
    if (!run) return;
    run.cancelled = true;
    run.keepPartial?.();
    if (run.approvalId) approvals.get(run.approvalId)?.(false);
    running.delete(sid);
  }

  async function play(sid: string, text: string, run: Run) {
    const s = steps(sid, run);
    try {
      await scripts[pickRun(text)](s, text);
      s.flush();
      running.delete(sid);
      if (sessions.has(sid)) send(sid, { kind: "done", session: get(sid) });
    } catch (e) {
      if (e instanceof Cancelled) return; // ai_cancel already emitted error + done
      running.delete(sid);
      send(sid, { kind: "error", message: String(e) });
      if (sessions.has(sid)) send(sid, { kind: "done", session: get(sid) });
    }
  }

  return {
    list: (connectionId?: string) =>
      [...sessions.values()]
        .filter((s) => !connectionId || s.connection_id === connectionId)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .map((s) => ({ ...s, messages: [] })),
    get,
    create: (connectionId: string, providerId: string) => {
      const s: ChatSession = {
        id: `s${Date.now()}`,
        connection_id: connectionId,
        provider_id: providerId,
        title: "New chat",
        messages: [],
        created_at: now(),
        updated_at: now(),
      };
      sessions.set(s.id, s);
      return s;
    },
    remove: (id: string) => {
      stop(id);
      sessions.delete(id);
    },
    setProvider: (id: string, providerId: string) => void sessions.set(id, { ...get(id), provider_id: providerId }),
    send: (sid: string, text: string) => {
      if (running.has(sid)) throw "the agent is still working on the previous message";
      const s = get(sid);
      // Stored before the run starts, like the backend, so a cancel keeps the prompt.
      sessions.set(sid, {
        ...s,
        title: s.messages.length ? s.title : text.slice(0, 60).trim(),
        updated_at: now(),
        messages: [...s.messages, { role: "user", ts: now(), blocks: [{ type: "text", text }] }],
      });
      const run: Run = { cancelled: false };
      running.set(sid, run);
      void play(sid, text, run);
    },
    cancel: (sid: string) => {
      stop(sid);
      send(sid, { kind: "error", message: "cancelled" });
      if (sessions.has(sid)) send(sid, { kind: "done", session: get(sid) });
    },
    resolveApproval: (id: string, approved: boolean) => approvals.get(id)?.(approved),
  };
}
