import { useState, type FormEvent } from "react";
import { currentDaemon, setDaemon } from "./webClient.js";

/** Trims a typed origin into something fetchable, or null when it is not a URL at all. */
function asOrigin(value: string): string | null {
  const text = value.trim().replace(/\/$/, "");
  if (!text) {
    return "";
  }
  try {
    const parsed = new URL(text);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

/**
 * Where a browser points itself at a daemon on another machine. The token is checked here before it
 * is stored, so a wrong one says so now rather than turning into an app that fails at every call.
 */
export function Connect(props: { onDone: () => void }) {
  const existing = currentDaemon();
  const [base, setBase] = useState(existing.base);
  const [token, setToken] = useState(existing.token ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const origin = asOrigin(base);
    if (origin === null) {
      setError("That does not look like a URL. It should read like https://box.example:3127");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // The same handshake the app makes on every load, so a daemon that refuses now would refuse later.
      const response = await fetch(`${origin}/api/auth`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token.trim() || null }),
        credentials: "include",
      });
      if (response.status === 401) {
        setError("That daemon did not accept the token.");
        return;
      }
      if (!response.ok) {
        setError(`That daemon answered with ${response.status}.`);
        return;
      }
      setDaemon({ base: origin, token: token.trim() || null });
      props.onDone();
    } catch {
      setError(
        origin && origin.startsWith("http://") && window.location.protocol === "https:"
          ? "A page served over HTTPS cannot reach a daemon over plain HTTP. Put the daemon behind TLS or a tunnel."
          : "Could not reach that daemon. Check the address, and that it was started with --allow-origin for this page.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center px-6">
      <h1 className="text-lg font-semibold text-fg">Connect to a daemon</h1>
      <p className="mt-1 text-xs text-pretty text-muted">
        Leave the address empty to use the server that served this page. A daemon elsewhere has to be started with
        <code className="mx-1 rounded bg-sunken px-1 py-0.5 font-mono text-2xs">--allow-origin {window.location.origin}</code>
        and, unless it is on this machine, reached over HTTPS.
      </p>
      <form className="mt-5 flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-fg">Address</span>
          <input
            autoFocus
            value={base}
            onChange={(event) => setBase(event.target.value)}
            placeholder="https://box.example:3127"
            className="h-9 rounded-lg bg-sunken px-3 text-sm text-fg shadow-[0_0_0_1px_var(--border-strong)] outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-fg">Token</span>
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Only if the daemon was started with --token"
            className="h-9 rounded-lg bg-sunken px-3 text-sm text-fg shadow-[0_0_0_1px_var(--border-strong)] outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]"
          />
        </label>
        {error ? <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-pretty text-danger-text">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="mt-1 h-9 rounded-lg bg-accent text-sm font-medium text-white transition-opacity duration-100 disabled:opacity-60"
        >
          {busy ? "Checking" : "Connect"}
        </button>
      </form>
    </main>
  );
}
