// Browser-only public-host adapter. This file is excluded from the plugin package.

import type { LucideIcon } from "lucide-react";
import * as icons from "lucide-react";
import { type CSSProperties, type ReactNode, useState, useSyncExternalStore } from "react";
import { ScrollView } from "react-native";
import { defaultAppearance } from "../../../shared/conversation/appearance";
import { syntheticHostTheme } from "../host-theme";

let values = { ...defaultAppearance };
let revision = 1;
const listeners = new Set<() => void>();
let observer: { snapshot(value: unknown): void; update(value: unknown): void } | undefined;
export const fixture = {
  copyFailure: false,
  settingsFailure: false,
  copied: "",
  theme: syntheticHostTheme,
  get values() {
    return values;
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  reset() {
    values = { ...defaultAppearance };
    revision++;
    emit();
  },
  patch(patch: Partial<typeof values>) {
    values = { ...values, ...patch };
    revision++;
    emit();
  },
  observe(value: typeof observer) {
    observer = value;
    return () => {
      observer = undefined;
    };
  },
  reconnect() {
    observer?.snapshot({ subscriptionId: "fixture-reconnect" });
  },
};
function emit() {
  for (const listener of listeners) listener();
  observer?.update({
    type: "status",
    payload: { status: "plugin_settings_changed", settingsId: "appearance" },
  });
}
export function useSettings() {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => revision,
  );
  const [saveError, error] = useState<string | null>(null);
  return {
    status: "ready" as const,
    values,
    revision: String(revision),
    saving: false,
    saveError,
    async save(next: typeof values, expected: string) {
      if (fixture.settingsFailure) {
        error("设置保存失败，请重新读取后重试。");
        return false;
      }
      if (expected !== String(revision)) {
        error("设置已在另一客户端更新，请重新读取。");
        return false;
      }
      error(null);
      values = next;
      revision++;
      emit();
      return true;
    },
    async reset() {
      fixture.reset();
      return true;
    },
    async reload() {
      error(null);
      emit();
    },
  };
}
export async function copyText(text: string) {
  if (fixture.copyFailure) throw Error("Synthetic clipboard denial");
  fixture.copied = text;
}
export async function openExternalUrl(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}
export function useRevealedText(text: string) {
  return text;
}
export { ScrollView };
export function Icon({ name, size = 16, color }: { name: string; size?: number; color?: string }) {
  const Component = (icons as unknown as Record<string, LucideIcon | undefined>)[name];
  if (!Component) throw Error(`Unknown Lucide icon: ${name}`);
  return <Component size={size} color={color} aria-hidden />;
}
const row: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 20,
  padding: "13px 0",
};
export function SettingsSection({
  title,
  info,
  children,
}: {
  title: string;
  info?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>{title}</h2>
      {info ? (
        <div style={{ fontSize: 13, opacity: 0.7, lineHeight: 1.6, marginBottom: 6 }}>{info}</div>
      ) : null}
      {children}
    </section>
  );
}
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={row}>
      <div>
        <div style={{ fontSize: 14 }}>{label}</div>
        {hint ? (
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 5, maxWidth: 500, lineHeight: 1.6 }}>
            {hint}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
type RowProps = { label: string; hint?: string; disabled?: boolean };
export function SettingsSwitch({
  label,
  hint,
  value,
  disabled,
  onValueChange,
}: RowProps & { value: boolean; onValueChange(value: boolean): void }) {
  return (
    <Row label={label} hint={hint}>
      <input
        aria-label={label}
        role="switch"
        aria-checked={value}
        type="checkbox"
        checked={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.checked)}
      />
    </Row>
  );
}
export function SettingsSelect<Value extends string>({
  label,
  hint,
  value,
  disabled,
  options,
  onValueChange,
}: RowProps & {
  value: Value;
  options: readonly { label: string; value: Value }[];
  onValueChange(value: Value): void;
}) {
  return (
    <Row label={label} hint={hint}>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value as Value)}
      >
        {options.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    </Row>
  );
}
export function SettingsAction({
  label,
  hint,
  actionLabel,
  disabled,
  onPress,
}: RowProps & { actionLabel: string; onPress(): void }) {
  return (
    <Row label={label} hint={hint}>
      <button type="button" disabled={disabled} onClick={onPress}>
        {actionLabel}
      </button>
    </Row>
  );
}
