import { clsx } from "clsx";
import { Dialog as RDialog, DropdownMenu as RMenu, Tooltip as RTooltip, ContextMenu as RContext } from "radix-ui";
import { X } from "lucide-react";
import type { Environment } from "../../lib/types";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

export function Button({
  variant = "default",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "sm" | "md" | "icon";
}) {
  return (
    <button
      type="button"
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none select-none whitespace-nowrap",
        size === "sm" && "h-7 px-2.5 text-xs",
        size === "md" && "h-8 px-3 text-[13px]",
        size === "icon" && "h-7 w-7 p-0",
        variant === "default" && "border-border bg-elev hover:bg-hover active:bg-active",
        variant === "primary" &&
          "border-transparent bg-accent text-accent-fg hover:brightness-110 active:brightness-95",
        variant === "ghost" && "border-transparent hover:bg-hover active:bg-active",
        variant === "danger" && "border-transparent bg-danger text-white hover:brightness-110",
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        "h-8 w-full rounded-md border border-border bg-elev px-2.5 text-[13px] placeholder:text-faint focus:border-accent disabled:opacity-50 selectable",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={clsx(
        "w-full rounded-md border border-border bg-elev px-2.5 py-1.5 text-[13px] placeholder:text-faint focus:border-accent disabled:opacity-50 selectable",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={clsx(
        "h-8 rounded-md border border-border bg-elev px-2 text-[13px] focus:border-accent disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Field({
  label,
  children,
  hint,
  className,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={clsx("flex flex-col gap-1 text-xs text-muted", className)}>
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-faint">{hint}</span>}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx(
          "mt-0.5 relative h-5 w-9 shrink-0 rounded-full border transition-colors",
          checked ? "bg-accent border-accent" : "bg-sunken border-border-strong",
        )}
      >
        <span
          className={clsx(
            "absolute left-0 top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </button>
      <span className="flex flex-col">
        <span className="text-[13px]">{label}</span>
        {description && <span className="text-xs text-muted">{description}</span>}
      </span>
    </label>
  );
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = "max-w-xl",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <RDialog.Content
          className={clsx(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-elev shadow-[var(--shadow)] flex flex-col max-h-[90vh]",
            width,
          )}
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 border-b border-border">
            <div>
              <RDialog.Title className="text-[15px] font-semibold">{title}</RDialog.Title>
              {description ? (
                <RDialog.Description className="text-xs text-muted mt-0.5">{description}</RDialog.Description>
              ) : (
                <RDialog.Description className="sr-only">{title}</RDialog.Description>
              )}
            </div>
            <RDialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X size={15} />
              </Button>
            </RDialog.Close>
          </div>
          <div className="px-5 py-4 overflow-auto scroll flex-1">{children}</div>
          {footer && (
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">{footer}</div>
          )}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function Tooltip({
  label,
  children,
  side = "bottom",
}: {
  label: string;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <RTooltip.Root delayDuration={400}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          className="z-[60] rounded-md border border-border bg-elev px-2 py-1 text-xs shadow-[var(--shadow)] max-w-xs"
        >
          {label}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export const TooltipProvider = RTooltip.Provider;

export interface MenuItem {
  label: string;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
  icon?: ReactNode;
  separator?: boolean;
}

const menuContentCls =
  "z-[70] min-w-[180px] rounded-lg border border-border bg-elev p-1 shadow-[var(--shadow)] text-[13px]";
const menuItemCls = (danger?: boolean) =>
  clsx(
    "flex items-center gap-2 rounded-md px-2 py-1.5 outline-none cursor-default select-none data-[highlighted]:bg-hover data-[disabled]:opacity-40",
    danger && "text-danger",
  );

export function Menu({
  trigger,
  items,
  align = "end",
}: {
  trigger: ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
}) {
  return (
    <RMenu.Root>
      <RMenu.Trigger asChild>{trigger}</RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content align={align} sideOffset={4} className={menuContentCls}>
          {items.map((it, i) =>
            it.separator ? (
              <RMenu.Separator key={i} className="my-1 h-px bg-border" />
            ) : (
              <RMenu.Item key={i} disabled={it.disabled} onSelect={it.onSelect} className={menuItemCls(it.danger)}>
                {it.icon}
                <span className="flex-1">{it.label}</span>
                {it.shortcut && <span className="text-xs text-faint">{it.shortcut}</span>}
              </RMenu.Item>
            ),
          )}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  );
}

export function ContextMenu({ children, items }: { children: ReactNode; items: MenuItem[] }) {
  return (
    <RContext.Root>
      <RContext.Trigger asChild>{children}</RContext.Trigger>
      <RContext.Portal>
        <RContext.Content className={menuContentCls}>
          {items.map((it, i) =>
            it.separator ? (
              <RContext.Separator key={i} className="my-1 h-px bg-border" />
            ) : (
              <RContext.Item key={i} disabled={it.disabled} onSelect={it.onSelect} className={menuItemCls(it.danger)}>
                {it.icon}
                <span className="flex-1">{it.label}</span>
                {it.shortcut && <span className="text-xs text-faint">{it.shortcut}</span>}
              </RContext.Item>
            ),
          )}
        </RContext.Content>
      </RContext.Portal>
    </RContext.Root>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={clsx(
        "inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-border-strong border-t-accent",
        className,
      )}
    />
  );
}

const ENV_CLASS: Record<Environment, string> = {
  dev: "bg-success/15 text-success",
  staging: "bg-warning/20 text-warning",
  production: "bg-danger/15 text-danger",
};

/** Small environment tag (dev / staging / production). Renders nothing when unset. */
export function EnvBadge({ env, className }: { env?: Environment | null; className?: string }) {
  if (!env) return null;
  return (
    <span
      className={clsx("rounded px-1 text-[10px] font-medium uppercase tracking-wide", ENV_CLASS[env], className)}
      title={`Environment: ${env}`}
    >
      {env}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-sunken px-1 py-px text-[10px] font-mono text-muted">{children}</kbd>
  );
}

export function Empty({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-muted">
      {icon && <div className="text-faint">{icon}</div>}
      <div className="text-[14px] font-medium text-fg">{title}</div>
      {hint && <div className="max-w-sm text-xs">{hint}</div>}
      {action}
    </div>
  );
}
