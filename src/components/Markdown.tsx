import { Fragment, type ReactNode } from "react";
import { Copy, Play, ArrowDownToLine } from "lucide-react";
import { useStore } from "../lib/store";
import { openUrl } from "@tauri-apps/plugin-opener";

/** Minimal, dependency-free Markdown → React. Never renders raw HTML (LLM output is untrusted). */
export function Markdown({ text, connectionId }: { text: string; connectionId?: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="md text-[13px] leading-relaxed selectable">
      {blocks.map((b, i) => {
        if (b.type === "code") return <CodeBlock key={i} lang={b.lang} code={b.text} connectionId={connectionId} />;
        if (b.type === "heading") return <h3 key={i}>{inline(b.text)}</h3>;
        if (b.type === "list")
          return b.ordered ? (
            <ol key={i}>
              {b.items.map((it, j) => (
                <li key={j}>{inline(it)}</li>
              ))}
            </ol>
          ) : (
            <ul key={i}>
              {b.items.map((it, j) => (
                <li key={j}>{inline(it)}</li>
              ))}
            </ul>
          );
        if (b.type === "table")
          return (
            <div key={i} className="overflow-auto scroll">
              <table>
                <thead>
                  <tr>
                    {b.head.map((h, j) => (
                      <th key={j}>{inline(h)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, j) => (
                    <tr key={j}>
                      {r.map((c, k) => (
                        <td key={k}>{inline(c)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        if (b.type === "quote")
          return (
            <blockquote key={i} className="border-l-2 border-border pl-2 text-muted">
              {inline(b.text)}
            </blockquote>
          );
        return <p key={i}>{inline(b.text)}</p>;
      })}
    </div>
  );
}

function CodeBlock({ lang, code, connectionId }: { lang: string; code: string; connectionId?: string }) {
  const openTab = useStore((s) => s.openTab);
  const toast = useStore((s) => s.toast);
  const isSql =
    /sql|postgres|mysql|sqlite/i.test(lang) ||
    (!lang && /^\s*(select|with|insert|update|delete|create|alter|explain)\b/i.test(code));
  return (
    <div className="group relative my-1.5">
      <pre>
        <code>{code}</code>
      </pre>
      <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        <button
          className="rounded border border-border bg-elev p-1 hover:bg-hover"
          title="Copy"
          aria-label="Copy code"
          onClick={() => {
            void navigator.clipboard.writeText(code);
            toast("Copied", "success");
          }}
        >
          <Copy size={12} />
        </button>
        {isSql && connectionId && (
          <>
            <button
              className="rounded border border-border bg-elev p-1 hover:bg-hover"
              title="Insert into current query tab"
              aria-label="Insert into editor"
              onClick={() => window.dispatchEvent(new CustomEvent("agentql:insert-sql", { detail: code.trim() }))}
            >
              <ArrowDownToLine size={12} />
            </button>
            <button
              className="rounded border border-border bg-elev p-1 hover:bg-hover"
              title="Open in a new query tab"
              aria-label="Open in new query tab"
              onClick={() => openTab({ kind: "query", connectionId, title: "From assistant", sql: code.trim() })}
            >
              <Play size={12} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

type Block =
  | { type: "p"; text: string }
  | { type: "code"; lang: string; text: string }
  | { type: "heading"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "quote"; text: string };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r/g, "").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = line.match(/^\s*```\s*(\w*)/);
    if (fence) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push({ type: "code", lang: fence[1], text: buf.join("\n") });
      continue;
    }
    const h = line.match(/^\s*#{1,6}\s+(.*)/);
    if (h) {
      out.push({ type: "heading", text: h[1] });
      i++;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      out.push({ type: "quote", text: line.replace(/^\s*>\s?/, "") });
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const cells = (l: string) =>
        l
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push({ type: "table", head, rows });
      continue;
    }
    const li = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)/);
    if (li) {
      const ordered = /\d/.test(li[1]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)/);
        if (!m) break;
        items.push(m[2]);
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]))
          items[items.length - 1] += " " + lines[i++].trim();
      }
      out.push({ type: "list", ordered, items });
      continue;
    }
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\|)/.test(lines[i]))
      buf.push(lines[i++]);
    out.push({ type: "p", text: buf.join(" ") });
  }
  return out;
}

function inline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) parts.push(<code key={k++}>{m[1].slice(1, -1)}</code>);
    else if (m[2]) parts.push(<strong key={k++}>{m[2].slice(2, -2)}</strong>);
    else if (m[3] || m[4]) parts.push(<em key={k++}>{(m[3] ?? m[4]).slice(1, -1)}</em>);
    else if (m[5]) {
      const href = m[7];
      parts.push(
        <a
          key={k++}
          href={href}
          className="underline text-accent"
          onClick={(e) => {
            e.preventDefault();
            if (/^https?:\/\//.test(href)) void openUrl(href).catch(() => {});
          }}
        >
          {m[6]}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <Fragment>{parts}</Fragment>;
}
