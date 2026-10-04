import type {DesktopApi} from "../platform/desktop-api.ts";

// A failed journal read must not erase a successfully loaded credential status,
// nor be treated as a successfully loaded empty task list.
export function loadConnectionStatus(api: Pick<DesktopApi, "credentialsStatus" | "listTasks">) {
  return Promise.allSettled([api.credentialsStatus(), api.listTasks()] as const);
}
