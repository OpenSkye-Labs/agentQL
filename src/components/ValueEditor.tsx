import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  foldAll,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
  unfoldAll,
} from "@codemirror/language";
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { json } from "@codemirror/lang-json";
import { classHighlighter } from "@lezer/highlight";

export interface ValueEditorHandle {
  foldAll: () => void;
  unfoldAll: () => void;
  search: () => void;
  /** Replace the document (fires onChange). */
  setValue: (v: string) => void;
}

interface Props {
  value: string;
  onChange?: (v: string) => void;
  /** JSON syntax, folding and bracket matching; plain text otherwise. */
  json?: boolean;
  readOnly?: boolean;
  onSubmit?: () => void;
  onCancel?: () => void;
  ariaLabel: string;
  className?: string;
}

/** CodeMirror-backed multi-line value viewer/editor for the cell inspector (JSON folds per nesting level). */
export const ValueEditor = forwardRef<ValueEditorHandle, Props>(function ValueEditor(
  { value, onChange, json: isJson, readOnly, onSubmit, onCancel, ariaLabel, className },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cbs = useRef({ onChange, onSubmit, onCancel });
  cbs.current = { onChange, onSubmit, onCancel };

  useImperativeHandle(ref, () => ({
    foldAll: () => void (view.current && foldAll(view.current)),
    unfoldAll: () => void (view.current && unfoldAll(view.current)),
    search: () => void (view.current && openSearchPanel(view.current)),
    setValue: (v) => {
      const cur = view.current;
      if (cur) cur.dispatch({ changes: { from: 0, to: cur.state.doc.length, insert: v } });
    },
  }));

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        foldGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        indentOnInput(),
        bracketMatching(),
        search({ top: true }),
        highlightSelectionMatches(),
        syntaxHighlighting(classHighlighter),
        isJson ? json() : [],
        EditorState.readOnly.of(!!readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.lineWrapping,
        keymap.of([
          { key: "Mod-Enter", run: () => (cbs.current.onSubmit?.(), true) },
          { key: "Escape", run: () => (cbs.current.onCancel?.(), true) },
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cbs.current.onChange?.(u.state.doc.toString());
        }),
        EditorView.contentAttributes.of({
          "aria-label": ariaLabel,
          role: "textbox",
          "aria-multiline": "true",
          // Read-only content is not contenteditable, so it needs tabindex to take focus for Ctrl+F and arrows.
          ...(readOnly ? { tabindex: "0", "aria-readonly": "true" } : {}),
        }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    if (!readOnly) v.focus();
    return () => v.destroy();
    // Recreate on mode switch; the doc is re-synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isJson, readOnly]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== value) v.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
  }, [value]);

  return <div ref={host} className={className ?? "min-h-0 flex-1 overflow-hidden selectable"} />;
});
