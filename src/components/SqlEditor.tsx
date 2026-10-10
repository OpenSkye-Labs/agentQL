import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  placeholder as cmPlaceholder,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { sql, PostgreSQL, MySQL, SQLite, type SQLNamespace } from "@codemirror/lang-sql";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  snippet,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { vim } from "@replit/codemirror-vim";
import { bracketMatching, syntaxHighlighting, indentOnInput } from "@codemirror/language";
import { classHighlighter } from "@lezer/highlight";
import type { Driver } from "../lib/types";
import { statementAt } from "../lib/sql";

export interface SqlEditorHandle {
  getValue: () => string;
  setValue: (v: string) => void;
  /** Selected text, or the statement under the cursor when nothing is selected. */
  getRunnable: () => string;
  insert: (text: string) => void;
  /** Replace the document with a snippet template; `${1:name}` placeholders become Tab stops. */
  loadSnippet: (template: string) => void;
  focus: () => void;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  driver: Driver;
  schema?: SQLNamespace;
  onRun: () => void;
  onRunAll?: () => void;
  placeholder?: string;
  readOnly?: boolean;
  /** Vim keybindings (Settings → Editor). */
  vim?: boolean;
  /** Extra completion source merged with the schema/keyword completion. */
  completions?: CompletionSource;
}

export const SqlEditor = forwardRef<SqlEditorHandle, Props>(function SqlEditor(
  { value, onChange, driver, schema, onRun, onRunAll, placeholder, readOnly, vim: vimOn, completions },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const langComp = useRef(new Compartment());
  const vimComp = useRef(new Compartment());
  const cbs = useRef({ onChange, onRun, onRunAll, completions });
  cbs.current = { onChange, onRun, onRunAll, completions };

  const langExt = (): Extension => {
    const lang = sql({
      dialect: driver === "postgres" ? PostgreSQL : driver === "sqlite" ? SQLite : MySQL,
      schema,
      upperCaseKeywords: true,
    });
    const extra: CompletionSource = (ctx) => cbs.current.completions?.(ctx) ?? null;
    return [lang, lang.language.data.of({ autocomplete: extra })];
  };

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        vimComp.current.of(vimOn ? vim() : []), // vim must come before the other keymaps
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        history(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        syntaxHighlighting(classHighlighter),
        langComp.current.of(langExt()),
        placeholder ? cmPlaceholder(placeholder) : [],
        EditorState.readOnly.of(!!readOnly),
        EditorView.lineWrapping,
        keymap.of([
          { key: "Mod-Enter", run: () => (cbs.current.onRun(), true) },
          { key: "Mod-Shift-Enter", run: () => (cbs.current.onRunAll?.(), true) },
          { key: "F5", run: () => (cbs.current.onRun(), true) },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cbs.current.onChange(u.state.doc.toString());
        }),
        EditorView.contentAttributes.of({ "aria-label": "SQL editor", role: "textbox", "aria-multiline": "true" }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value changes (e.g. inserted SQL)
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== value) v.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: langComp.current.reconfigure(langExt()) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver, schema]);

  useEffect(() => {
    view.current?.dispatch({ effects: vimComp.current.reconfigure(vimOn ? vim() : []) });
  }, [vimOn]);

  useImperativeHandle(ref, () => ({
    getValue: () => view.current?.state.doc.toString() ?? "",
    setValue: (text) => {
      const v = view.current;
      if (!v) return;
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
    },
    getRunnable: () => {
      const v = view.current;
      if (!v) return "";
      const sel = v.state.selection.main;
      if (!sel.empty) return v.state.sliceDoc(sel.from, sel.to);
      return statementAt(v.state.doc.toString(), sel.head);
    },
    insert: (text) => {
      const v = view.current;
      if (!v) return;
      const sel = v.state.selection.main;
      v.dispatch({
        changes: { from: sel.from, to: sel.to, insert: text },
        selection: { anchor: sel.from + text.length },
      });
      v.focus();
    },
    loadSnippet: (template) => {
      const v = view.current;
      if (!v) return;
      snippet(template)(v, null, 0, v.state.doc.length);
      v.focus();
    },
    focus: () => view.current?.focus(),
  }));

  return <div ref={host} className="h-full w-full overflow-hidden selectable" />;
});
