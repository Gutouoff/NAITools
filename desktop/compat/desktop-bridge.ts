import type { AppSettings, NaiDesktopApi, SettingKey } from "../langbai/src/types.ts";
import { createLocalImageMethods, LOCAL_IMAGE_METHODS } from "./local-images.ts";
import type { Invoke } from "../src/platform/desktop-api.ts";
import { DesktopError, normalizeError } from "../src/platform/types.ts";
import membersInventory from "./langbai-api-members.json" with { type: "json" };

export const IMPLEMENTED_METHODS = [
  "getSettings", "getSetting", "setSetting", "isFirstRun", "completeSetup",
  "accountCached", "hasToken", "minimize", "maximize", "close",
  "getReverseTemplateDefaults", ...LOCAL_IMAGE_METHODS,
] as const;

// Callback registration works, but native producers are not connected yet.
// Do not count these registrations as generation/update/agent service parity.
export const SUBSCRIPTIONS = membersInventory
  .filter(member => member.kind === "subscription" && !member.optional)
  .map(member => member.name);

export interface LangbaiBridge {
  api: NaiDesktopApi;
  dispose(): void;
  startDragging(): Promise<void>;
}

export function createLangbaiBridge(invoke: Invoke): LangbaiBridge {
  const listeners = new Map<string, Set<(value: unknown) => void>>();

  async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    try {
      return await invoke<T>(command, args);
    } catch (error) {
      throw normalizeError(error);
    }
  }

  const unsupported = (method: string) => new DesktopError(
    "langbai_api_unavailable",
    method === "generateCompatible"
      ? "暂不支持 OpenAI Images 接口；请使用 NovelAI 原生格式。"
      : `该功能尚未接入 Rust 服务（${method}）；未执行操作，也未发送付费请求。`,
    false,
  );
  const members: Record<string, unknown> = {};

  for (const member of membersInventory) {
    // Optional APIs remain absent so the original feature-detection logic works.
    if (member.name === "platform" || member.optional) continue;
    if (SUBSCRIPTIONS.includes(member.name)) {
      members[member.name] = (callback: (value: unknown) => void) => {
        if (typeof callback !== "function") throw new TypeError("Invalid event listener");
        const set = listeners.get(member.name) ?? new Set();
        listeners.set(member.name, set);
        set.add(callback);
        return () => {
          set.delete(callback);
          if (!set.size) listeners.delete(member.name);
        };
      };
    } else if (member.kind === "promise") {
      members[member.name] = async () => { throw unsupported(member.name); };
    } else {
      members[member.name] = () => { throw unsupported(member.name); };
    }
  }

  const getSettings = () => call<AppSettings>("langbai_settings_get");
  const setSetting = <K extends SettingKey>(key: K, value: AppSettings[K]) =>
    call<AppSettings[K]>("langbai_setting_set", { key, value });
  const account = async () => ({ hasToken: await call<boolean>("credentials_status"), stale: true });
  const windowAction = (action: string) => call<void>("langbai_window_action", { action });

  const implemented = {
    ...createLocalImageMethods(call),
    platform: "win32",
    getSettings,
    setSetting,
    getSetting: async <K extends SettingKey>(key: K) => (await getSettings())[key],
    isFirstRun: async () => !(await getSettings()).hasOnboarded,
    completeSetup: async () => {
      await setSetting("hasOnboarded", true);
      return { ok: true };
    },
    accountCached: account,
    hasToken: account,
    minimize: () => windowAction("minimize"),
    maximize: () => windowAction("maximize"),
    close: () => windowAction("close"),
    // Versioned original application resources, not a native-service fallback.
    // Load only when Settings requests them; never inflate startup with templates.
    getReverseTemplateDefaults: async () =>
      (await import("./reverse-templates.ts")).getBuiltInReverseTemplates(),
  } satisfies Partial<NaiDesktopApi>;

  // Required unported operations fail locally. Only explicit typed methods can
  // reach the Rust host; there is no arbitrary command router or success proxy.
  const api = Object.freeze(Object.assign(members, implemented)) as unknown as NaiDesktopApi;
  return { api, dispose: () => listeners.clear(), startDragging: () => windowAction("startDragging") };
}
