import { useCallback, useEffect, useRef, useState } from "react";

const GOAL_DAYS = 14;
const MB = 1024 * 1024;

function ageLabel(iso, nowMs) {
  if (!iso) return "never";
  const secs = Math.max(0, Math.round((nowMs - new Date(iso)) / 1000));
  if (secs < 5) return "just now";
  if (secs < 90) return `${secs} s ago`;
  if (secs < 5400) return `${Math.round(secs / 60)} min ago`;
  return `${Math.round(secs / 3600)} h ago`;
}

function Stat({ value, label }) {
  return (
    <div>
      <div className="text-xl font-semibold tabular-nums" style={{ color: "var(--ink-1)" }}>
        {value}
      </div>
      <div className="text-[11px]" style={{ color: "var(--ink-3)" }}>
        {label}
      </div>
    </div>
  );
}

export default function CollectorView() {
  const [state, setState] = useState(null); // {payload, at} from /api/rt/status
  const [log, setLog] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([
        fetch("/api/rt/status").then((r) => r.json()),
        fetch("/api/rt/log").then((r) => r.text()),
      ]);
      setState({ payload: s, at: Date.now() });
      setLog(l);
    } catch {
      /* dev server unreachable; keep last known state */
    }
  }, []);

  useEffect(() => {
    const t0 = setTimeout(refresh, 0);
    const t = setInterval(refresh, 5000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [refresh]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  async function act(endpoint) {
    setBusy(true);
    setActionError("");
    try {
      const res = await fetch(`/api/rt/${endpoint}`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) setActionError(body.error || "Request failed.");
    } catch {
      setActionError("Could not reach the dev server.");
    } finally {
      setBusy(false);
      refresh();
    }
  }

  if (!state) {
    return (
      <div className="flex h-full items-center justify-center text-sm" style={{ color: "var(--ink-2)" }}>
        Checking collector status…
      </div>
    );
  }

  const { running, status, days } = state.payload;
  const now = state.at;
  const totalBytes = days.reduce((a, d) => a + d.bytes, 0);
  const maxDayBytes = Math.max(1, ...days.map((d) => d.bytes));
  const stale =
    running && status?.last_poll_at &&
    now - new Date(status.last_poll_at) > 3 * 60 * 1000;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        {/* status + control */}
        <section
          className="rounded-xl border p-4"
          style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
        >
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{
                background: running
                  ? stale
                    ? "var(--status-warning)"
                    : "var(--freq-1)"
                  : "var(--ink-3)",
              }}
              aria-hidden="true"
            />
            <div className="mr-auto">
              <div className="text-sm font-semibold" style={{ color: "var(--ink-1)" }}>
                {running ? (stale ? "Collecting — no recent poll" : "Collecting") : "Stopped"}
              </div>
              <div className="text-xs" style={{ color: "var(--ink-2)" }}>
                {running
                  ? `Last poll ${ageLabel(status?.last_poll_at, now)} · polling every ${status?.poll_secs ?? 60} s`
                  : status?.stopped_at
                    ? `Last ran ${ageLabel(status.stopped_at, now)}`
                    : "Not run yet on this machine"}
              </div>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => act(running ? "stop" : "start")}
              className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
              style={
                running
                  ? { background: "var(--surface-1)", color: "var(--ink-1)", border: "1px solid var(--border)" }
                  : { background: "var(--ink-1)", color: "var(--surface-1)" }
              }
            >
              {running ? "Stop collecting" : "Start collecting"}
            </button>
          </div>

          {actionError && (
            <p className="mt-2 text-xs" style={{ color: "var(--status-serious)" }}>
              {actionError}
            </p>
          )}
          {status?.last_error && running && (
            <p className="mt-2 text-xs" style={{ color: "var(--status-warning)" }}>
              Last poll problem: {status.last_error} — retrying automatically.
            </p>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat value={status?.last_vp_vehicles ?? "–"} label="buses in last poll" />
            <Stat value={status?.last_tu_trips ?? "–"} label="trip predictions in last poll" />
            <Stat value={status?.polls ?? "–"} label="polls this run" />
            <Stat
              value={(status?.rows_flushed_session ?? 0).toLocaleString()}
              label="rows saved this run"
            />
          </div>

          <p className="mt-3 text-[11px] leading-snug" style={{ color: "var(--ink-3)" }}>
            The collector is its own process on this Mac: it keeps running if
            you close this page and stops with the button above. While it
            runs, caffeinate (a built-in macOS tool that keeps the machine
            awake) blocks sleep, though closing the lid on battery power
            still sleeps the Mac and pauses collection. It polls Calgary
            Transit's realtime feeds and saves them under data/rt/.
          </p>
        </section>

        {/* progress toward the 2-week goal */}
        <section
          className="rounded-xl border p-4"
          style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
        >
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold" style={{ color: "var(--ink-1)" }}>
              {days.length} of {GOAL_DAYS} days collected
            </h2>
            <span className="text-xs tabular-nums" style={{ color: "var(--ink-2)" }}>
              {(totalBytes / MB).toFixed(1)} MB total
            </span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full"
            style={{ background: "var(--hairline)" }}
            role="progressbar"
            aria-valuenow={days.length}
            aria-valuemin={0}
            aria-valuemax={GOAL_DAYS}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, (days.length / GOAL_DAYS) * 100)}%`,
                background: "var(--fuel-2)",
              }}
            />
          </div>
          <p className="mt-1 text-[11px]" style={{ color: "var(--ink-3)" }}>
            Two weeks of weekday + weekend coverage is enough for the speed,
            delay, and bunching analysis. Gaps are fine.
          </p>

          {days.length > 0 && (
            <div className="mt-3 space-y-1">
              {days.map((d) => (
                <div key={d.date} className="flex items-center gap-2 text-xs tabular-nums">
                  <span className="w-20 shrink-0" style={{ color: "var(--ink-2)" }}>
                    {d.date.slice(5)}
                  </span>
                  <div className="h-3 flex-1">
                    <div
                      className="h-full rounded-sm"
                      style={{
                        width: `${Math.max(2, (d.bytes / maxDayBytes) * 100)}%`,
                        background: "var(--fuel-2)",
                      }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right" style={{ color: "var(--ink-2)" }}>
                    {(d.bytes / MB).toFixed(1)} MB
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* log */}
        <section
          className="rounded-xl border p-4"
          style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
        >
          <h2 className="mb-2 text-sm font-semibold" style={{ color: "var(--ink-1)" }}>
            Collector log
          </h2>
          <pre
            ref={logRef}
            className="max-h-56 overflow-y-auto rounded-lg p-3 text-[11px] leading-relaxed"
            style={{ background: "var(--surface-2)", color: "var(--ink-2)" }}
          >
            {log || "Nothing logged yet. Start the collector to see activity here."}
          </pre>
        </section>
      </div>
    </div>
  );
}
