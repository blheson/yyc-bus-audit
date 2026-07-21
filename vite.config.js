import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const RT_DIR = path.join(ROOT, "data", "rt");
const PID_FILE = path.join(RT_DIR, "archiver.pid");
const LOG_FILE = path.join(RT_DIR, "archiver.log");
const STATUS_FILE = path.join(RT_DIR, "status.json");
const PYTHON = path.join(ROOT, "pipeline", ".venv", "bin", "python");
const SCRIPT = path.join(ROOT, "pipeline", "archive_rt.py");

function readPid() {
  try {
    return parseInt(fs.readFileSync(PID_FILE, "utf8"), 10) || null;
  } catch {
    return null;
  }
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function dayTotals() {
  try {
    return fs
      .readdirSync(RT_DIR)
      .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n))
      .sort()
      .map((date) => {
        const dir = path.join(RT_DIR, date);
        let bytes = 0;
        let files = 0;
        for (const f of fs.readdirSync(dir)) {
          if (!f.endsWith(".parquet")) continue;
          bytes += fs.statSync(path.join(dir, f)).size;
          files += 1;
        }
        return { date, files, bytes };
      });
  } catch {
    return [];
  }
}

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

// Dev-only control plane for the GTFS-RT collector. The collector is
// spawned detached (own process group, output to archiver.log) so Vite
// restarts/HMR don't kill a run; the Stop button sends SIGTERM, which
// the python side catches to flush and exit cleanly.
function archiverApi() {
  return {
    name: "archiver-api",
    configureServer(server) {
      server.middlewares.use("/api/rt", (req, res) => {
        const url = req.url.split("?")[0];

        if (url === "/status") {
          const pid = readPid();
          let status = null;
          try {
            status = JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
          } catch {
            /* no run yet */
          }
          sendJson(res, 200, {
            running: isAlive(pid),
            pid,
            status,
            days: dayTotals(),
            pythonReady: fs.existsSync(PYTHON),
          });
          return;
        }

        if (url === "/log") {
          let text = "";
          try {
            const stat = fs.statSync(LOG_FILE);
            const start = Math.max(0, stat.size - 8192);
            const fd = fs.openSync(LOG_FILE, "r");
            const buf = Buffer.alloc(stat.size - start);
            fs.readSync(fd, buf, 0, buf.length, start);
            fs.closeSync(fd);
            text = buf.toString("utf8");
          } catch {
            /* no log yet */
          }
          res.setHeader("Content-Type", "text/plain");
          res.end(text);
          return;
        }

        if (req.method !== "POST") {
          sendJson(res, 405, { error: "POST required" });
          return;
        }

        if (url === "/start") {
          if (isAlive(readPid())) {
            sendJson(res, 409, { error: "Collector is already running." });
            return;
          }
          if (!fs.existsSync(PYTHON)) {
            sendJson(res, 500, {
              error:
                "Python environment not found. Run: cd pipeline && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt",
            });
            return;
          }
          fs.mkdirSync(RT_DIR, { recursive: true });
          const out = fs.openSync(LOG_FILE, "a");
          const child = spawn(PYTHON, [SCRIPT], {
            cwd: path.join(ROOT, "pipeline"),
            detached: true,
            stdio: ["ignore", out, out],
          });
          child.unref();
          fs.closeSync(out);
          fs.writeFileSync(PID_FILE, String(child.pid));
          if (process.platform === "darwin") {
            // -w ties the sleep assertion to the collector pid, so this
            // exits on its own when the run stops; -i blocks idle sleep,
            // -s blocks system sleep while on AC power. A closed lid on
            // battery still sleeps the machine.
            const caffeinate = spawn(
              "/usr/bin/caffeinate",
              ["-i", "-s", "-w", String(child.pid)],
              { detached: true, stdio: "ignore" },
            );
            caffeinate.unref();
          }
          sendJson(res, 200, { started: true, pid: child.pid });
          return;
        }

        if (url === "/stop") {
          const pid = readPid();
          if (!isAlive(pid)) {
            sendJson(res, 409, { error: "Collector is not running." });
            return;
          }
          process.kill(pid, "SIGTERM");
          sendJson(res, 200, { stopped: true });
          return;
        }

        sendJson(res, 404, { error: "Unknown endpoint" });
      });
    },
  };
}

export default defineConfig(({ command, isPreview }) => ({
  // Deployed at https://blheson.github.io/yyc-bus-audit/ (GitHub Pages);
  // dev stays at "/" so the collector workflow is unchanged.
  base: command === "build" || isPreview ? "/yyc-bus-audit/" : "/",
  plugins: [react(), tailwindcss(), archiverApi()],
}));
