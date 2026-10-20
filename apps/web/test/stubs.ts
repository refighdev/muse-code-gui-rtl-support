// Shared test doubles for browser and Tauri globals. The name has no ".test" in it, so node --test skips this file.

export type Respond = (cmd: string, args: Record<string, any>) => unknown;

export interface IpcCall {
  cmd: string;
  args: Record<string, any>;
}

/** Replaces one global for a single test. The returned function puts the previous value back, or removes it. */
export function stubGlobal(name: string, value: unknown): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  return () => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete (globalThis as Record<string, unknown>)[name];
  };
}

/**
 * A stand-in for the Tauri webview window: the IPC bridge `@tauri-apps/api` calls into, with every
 * command recorded. `respond` answers each command; `fire` delivers a message to a callback that the
 * app registered (an event listener or a Channel), using the id the app passed to the backend.
 */
export function tauriWindow(respond: Respond) {
  const calls: IpcCall[] = [];
  const callbacks = new Map<number, (message: unknown) => void>();
  let nextId = 1;
  const window = Object.assign(new EventTarget(), {
    __TAURI_INTERNALS__: {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback(callback: (message: unknown) => void) {
        const id = nextId++;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback(id: number) {
        callbacks.delete(id);
      },
      async invoke(cmd: string, args: Record<string, any> = {}) {
        calls.push({ cmd, args });
        return respond(cmd, args);
      },
    },
    __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
  }) as EventTarget & Record<string, any>;
  return {
    window,
    calls,
    fire(id: number, message: unknown) {
      callbacks.get(id)?.(message);
    },
  };
}

/** Lets pending promise callbacks run. */
export function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Captures console.error for one test. */
export function captureConsoleError() {
  const original = console.error;
  const messages: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    messages.push(args);
  };
  return {
    messages,
    restore() {
      console.error = original;
    },
  };
}
