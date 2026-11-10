#!/usr/bin/env node
// Dev supervisor: runs the Vite dev server and the Java web server together, and
// rebuilds + restarts the Java server whenever its sources (or the upstream engine
// modules it depends on) change. Vite handles frontend hot-reload by itself.
//
//   npm run dev:all                         (from web/)
//   PORT=8090 npm run dev:all -- --port 5180  (extra args go to vite)
//
// Env: PORT (Java server, default 8080), JAVA_HOME (default: Homebrew openjdk@17).
// No dependencies beyond Node itself.

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, watch } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(WEB, "..");
const SERVER = join(ROOT, "forge-web-server");
const RUN_DIR = join(SERVER, "target", "dev");
const RUN_JAR = join(RUN_DIR, "server.jar");

const env = { ...process.env };
if (!env.JAVA_HOME && existsSync("/opt/homebrew/opt/openjdk@17")) {
  env.JAVA_HOME = "/opt/homebrew/opt/openjdk@17";
}
if (env.PORT && !env.FORGE_SERVER) env.FORGE_SERVER = `http://localhost:${env.PORT}`;
const JAVA = env.JAVA_HOME ? join(env.JAVA_HOME, "bin", "java") : "java";

// Sources whose changes trigger a server rebuild. Never watch target/ (build output).
const WATCH = [
  "forge-web-server/src",
  "forge-web-server/pom.xml",
  "forge-web-server/reactor.xml",
  "forge-core/src",
  "forge-game/src",
  "forge-ai/src",
  "pom.xml",
];

const log = (tag, msg) => {
  const t = new Date().toTimeString().slice(0, 8);
  for (const line of String(msg).replace(/\n$/, "").split("\n")) {
    console.log(`${t} [${tag}] ${line}`);
  }
};

function pipe(child, tag) {
  child.stdout?.on("data", (d) => log(tag, d));
  child.stderr?.on("data", (d) => log(tag, d));
}

// ---- Vite -------------------------------------------------------------------
const vite = spawn(join(WEB, "node_modules", ".bin", "vite"), process.argv.slice(2), { cwd: WEB, env });
pipe(vite, "vite");
vite.on("exit", (code) => {
  log("dev", `vite exited (${code}); shutting down`);
  shutdown(1);
});

// ---- Java server ------------------------------------------------------------
let server = null;
let stopping = false;

function startServer() {
  stopping = false;
  server = spawn(JAVA, ["-jar", RUN_JAR], { cwd: ROOT, env });
  pipe(server, "server");
  const self = server;
  server.on("exit", (code, signal) => {
    if (server === self) server = null;
    if (!stopping && !shuttingDown) {
      log("dev", `server exited unexpectedly (${signal ?? code}); restarting in 2s`);
      setTimeout(() => !server && !building && startServer(), 2000);
    }
  });
}

function stopServer() {
  if (!server) return Promise.resolve();
  stopping = true;
  const s = server;
  return new Promise((done) => {
    const kill = setTimeout(() => s.kill("SIGKILL"), 5000);
    s.once("exit", () => {
      clearTimeout(kill);
      done();
    });
    s.kill("SIGTERM");
  });
}

// ---- Build loop -------------------------------------------------------------
let building = false;
let pending = false;

function mavenBuild() {
  return new Promise((done) => {
    const args = ["-B", "-q", "-f", "forge-web-server/reactor.xml", "package", "-DskipTests"];
    const mvn = spawn("mvn", args, { cwd: ROOT, env });
    let out = "";
    mvn.stdout.on("data", (d) => (out += d));
    mvn.stderr.on("data", (d) => (out += d));
    mvn.on("error", (e) => done({ ok: false, out: String(e) }));
    mvn.on("exit", (code) => done({ ok: code === 0, out }));
  });
}

async function rebuild(reason) {
  if (building) {
    pending = true;
    return;
  }
  building = true;
  log("dev", `building server (${reason})…`);
  const started = Date.now();
  const { ok, out } = await mavenBuild();
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (ok) {
    const jar = readdirSync(join(SERVER, "target")).find((f) => f.endsWith("-all.jar"));
    log("dev", `build ok in ${secs}s; restarting server`);
    await stopServer();
    // Run from a copy so the next build never overwrites the jar of a live JVM.
    mkdirSync(RUN_DIR, { recursive: true });
    copyFileSync(join(SERVER, "target", jar), RUN_JAR);
    startServer();
  } else {
    log("dev", `build FAILED in ${secs}s; ${server ? "keeping the previous server running" : "no server running"}`);
    const noise = /re-run Maven|\[Help 1\]|resume the build|mvn <args>|For more information|cwiki\.apache|^\[ERROR\]\s*$/;
    const errors = out.split("\n").filter((l) => /ERROR|error:|WARN/.test(l) && !noise.test(l));
    log("mvn", errors.slice(0, 30).join("\n") || out.slice(-3000));
  }
  building = false;
  if (pending) {
    pending = false;
    rebuild("changes during build");
  }
}

let debounce = null;
for (const rel of WATCH) {
  const path = join(ROOT, rel);
  if (!existsSync(path)) continue;
  watch(path, { recursive: true }, (_event, file) => {
    if (file && /(^|\/)(target|\.git)\//.test(file)) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => rebuild(`${rel}${file && file !== rel ? "/" + file : ""} changed`), 750);
  });
}

// ---- Shutdown ---------------------------------------------------------------
let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  vite.kill("SIGTERM");
  await stopServer();
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

log("dev", `watching ${WATCH.join(", ")}`);
rebuild("startup");
