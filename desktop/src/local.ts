import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  type WriteStream,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { delimiter, join } from "node:path";
import { pgProgram, type Runtime } from "./runtime";

/** Default ports; another free port is used when one is taken. */
export const DEFAULT_API_PORT = 47800;
export const DEFAULT_DB_PORT = 47801;

/** Secrets of a local install, created once with random values and kept in `<data>/secrets`. */
const SECRETS = {
  db_superuser_password: () => randomBytes(24).toString("hex"),
  db_migrator_password: () => randomBytes(24).toString("hex"),
  db_app_password: () => randomBytes(24).toString("hex"),
  db_worker_password: () => randomBytes(24).toString("hex"),
  master_key: () => randomBytes(32).toString("base64"),
  session_secret: () => randomBytes(32).toString("base64"),
};

/**
 * The system's keychain (Electron safeStorage: Keychain on macOS, DPAPI on Windows, the Secret Service on Linux).
 * With it, the master key that encrypts saved API keys is kept on disk only encrypted by the keychain.
 */
export interface Keychain {
  encrypt(text: string): Buffer;
  decrypt(data: Buffer): string;
}

export interface LocalOptions {
  runtime: Runtime;
  /** Absent when the system has no keychain: the master key is then a file readable only by this user. */
  keychain?: Keychain;
  /** Folder for the database, files, logs and secrets (the app's user-data folder). */
  dataDir: string;
  /** AI agents (MCP) switched on. */
  agents: boolean;
  /** Called with each status line ("Starting the database…"). */
  status?: (text: string) => void;
}

/**
 * The whole MobSimLab server on this computer, as the container runs it: PostgreSQL with PostGIS, the database
 * migrations, the API (which serves the web app) and one simulation worker. Everything listens on 127.0.0.1 only,
 * and the API signs in only requests that carry this launch's key (added by the desktop app).
 */
export class LocalStack {
  readonly launchKey = randomBytes(48).toString("base64url");
  apiPort = DEFAULT_API_PORT;
  dbPort = DEFAULT_DB_PORT;
  private readonly secretsDir: string;
  private readonly pgData: string;
  private readonly logDir: string;
  private api?: ChildProcess;
  private worker?: ChildProcess;
  private pgStarted = false;
  private stopping = false;
  /** The master key, when the keychain keeps it; given to the API on its standard input, never in a file. */
  private masterKey?: string;
  /** Called when the API or the worker stops by itself. */
  onCrash?: (what: string, code: number | null) => void;

  constructor(private readonly o: LocalOptions) {
    this.secretsDir = join(o.dataDir, "secrets");
    this.pgData = join(o.dataDir, "postgres");
    this.logDir = join(o.dataDir, "logs");
  }

  /** The address the app window opens. */
  get url(): string {
    return `http://127.0.0.1:${this.apiPort}`;
  }

  /** Folder of the log files, to show when something fails. */
  get logs(): string {
    return this.logDir;
  }

  /**
   * Purpose: start everything and wait until the API answers.
   * Side effects: creates the data folder, secrets and database on first start; starts child processes.
   */
  async start(): Promise<void> {
    const status = this.o.status ?? (() => {});
    for (const d of [this.o.dataDir, this.secretsDir, this.logDir, join(this.o.dataDir, "data")])
      mkdirSync(d, { recursive: true, mode: 0o700 });
    this.writeSecrets();
    this.protectMasterKey();
    this.apiPort = await freePort(DEFAULT_API_PORT);
    this.dbPort = await freePort(DEFAULT_DB_PORT, this.apiPort);

    const fresh = !existsSync(join(this.pgData, "PG_VERSION"));
    if (fresh) {
      status("Creating the database (first start only)…");
      await this.run("initdb", pgProgram(this.o.runtime, "initdb"), [
        "-D",
        this.pgData,
        "-U",
        "postgres",
        "-A",
        "scram-sha-256",
        `--pwfile=${join(this.secretsDir, "db_superuser_password")}`,
        "-E",
        "UTF8",
        "--locale=C",
      ]);
    }
    status("Starting the database…");
    await this.startPostgres();
    if (!existsSync(join(this.o.dataDir, "roles.done"))) {
      await this.createRoles();
      writeFileSync(join(this.o.dataDir, "roles.done"), new Date().toISOString());
    }
    status("Updating the database…");
    await this.run("migrate", this.o.runtime.node, [join(this.o.runtime.api, "dist", "cli", "migrate.js")], {
      env: this.apiEnv(),
    });
    status("Starting MobSimLab…");
    this.api = this.longRun("api", this.o.runtime.node, [join("dist", "main.js")], {
      cwd: this.o.runtime.api,
      env: this.masterKey ? { ...this.apiEnv(), MOBSIMLAB_MASTER_KEY_STDIN: "true" } : this.apiEnv(),
      input: this.masterKey,
    });
    this.worker = this.longRun("worker", this.o.runtime.python, ["-m", "mobsim_worker.main"], {
      env: this.workerEnv(),
    });
    await this.waitForApi();
  }

  /** Purpose: stop the worker, the API and the database (fast shutdown: running transactions roll back). */
  async stop(): Promise<void> {
    this.stopping = true;
    await Promise.all([stopChild(this.worker), stopChild(this.api)]);
    if (this.pgStarted) {
      await this.run("pg_ctl", pgProgram(this.o.runtime, "pg_ctl"), [
        "stop",
        "-D",
        this.pgData,
        "-m",
        "fast",
        "-w",
      ]).catch(() => {});
      this.pgStarted = false;
    }
  }

  /**
   * With a keychain, keeps the master key only as `master_key.keychain` (encrypted by the keychain): a plain
   * `master_key` from an earlier version is moved there and removed. A key the keychain can no longer open (the
   * system's keychain was reset) is kept aside as `master_key.keychain.unreadable` and a new key is made; saved
   * API keys must then be entered again.
   */
  private protectMasterKey(): void {
    const kc = this.o.keychain;
    if (!kc) return;
    const plain = join(this.secretsDir, "master_key");
    const sealed = join(this.secretsDir, "master_key.keychain");
    if (existsSync(sealed)) {
      try {
        this.masterKey = kc.decrypt(readFileSync(sealed)).trim();
      } catch {
        renameSync(sealed, `${sealed}.unreadable`);
      }
    }
    if (!this.masterKey) {
      const old = existsSync(plain) ? readFileSync(plain, "utf8").trim() : "";
      this.masterKey = old || SECRETS.master_key();
      writeFileSync(`${sealed}.tmp`, kc.encrypt(this.masterKey), { mode: 0o600 });
      renameSync(`${sealed}.tmp`, sealed);
    }
    rmSync(plain, { force: true });
  }

  /** Creates missing secrets (never overwrites one) and a new launch key for this start. */
  private writeSecrets(): void {
    for (const [name, make] of Object.entries(SECRETS)) {
      // The keychain keeps the master key (protectMasterKey); no plain file is made for it then.
      if (
        name === "master_key" &&
        this.o.keychain &&
        existsSync(join(this.secretsDir, "master_key.keychain"))
      )
        continue;
      const f = join(this.secretsDir, name);
      if (!existsSync(f) || !readFileSync(f, "utf8").trim()) writeFileSync(f, make(), { mode: 0o600 });
    }
    writeFileSync(join(this.secretsDir, "local_launch_key"), this.launchKey, { mode: 0o600 });
  }

  private secret(name: keyof typeof SECRETS): string {
    return readFileSync(join(this.secretsDir, name), "utf8").trim();
  }

  private async startPostgres(): Promise<void> {
    if (process.platform === "win32") return this.startPostgresWindows();
    const pg = this.longRun("postgres", pgProgram(this.o.runtime, "postgres"), [
      "-D",
      this.pgData,
      "-p",
      String(this.dbPort),
      "-c",
      "listen_addresses=127.0.0.1",
      "-c",
      "unix_socket_directories=",
      "-c",
      "max_connections=60",
    ]);
    this.pgStarted = true;
    const until = Date.now() + 90_000;
    for (;;) {
      if (pg.exitCode !== null)
        throw new Error(`the database stopped (code ${pg.exitCode}); see ${this.logDir}`);
      const ok = await this.run(
        "pg_isready",
        pgProgram(this.o.runtime, "pg_isready"),
        ["-h", "127.0.0.1", "-p", String(this.dbPort), "-U", "postgres"],
        { quiet: true },
      ).then(
        () => true,
        () => false,
      );
      if (ok) return;
      if (Date.now() > until) throw new Error(`the database did not start; see ${this.logDir}`);
      await sleep(500);
    }
  }

  /**
   * On Windows, postgres refuses to run with administrator rights, which many accounts have. pg_ctl starts it with
   * those rights removed, writes its output to postgres.log and waits until it accepts connections.
   */
  private async startPostgresWindows(): Promise<void> {
    this.pgStarted = true;
    const opts = `-p ${this.dbPort} -c listen_addresses=127.0.0.1 -c max_connections=60`;
    const args = [
      "start",
      "-D",
      this.pgData,
      "-l",
      join(this.logDir, "postgres.log"),
      "-o",
      opts,
      "-w",
      "-t",
      "90",
    ];
    // The server inherits pg_ctl's handles, so pg_ctl writes to a file (a pipe would stay open while it runs).
    const logFile = join(this.logDir, "pg_ctl.log");
    const fd = openSync(logFile, "a", 0o600);
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(pgProgram(this.o.runtime, "pg_ctl"), args, {
        env: this.commonEnv(),
        stdio: ["ignore", fd, fd],
        windowsHide: true,
      });
      child.on("error", (e) => reject(new Error(`pg_ctl could not start: ${e.message}`)));
      child.on("exit", resolve);
    }).finally(() => closeSync(fd));
    if (code !== 0) {
      const tail = readFileSync(logFile, "utf8").trim().split("\n").slice(-5).join(" ");
      throw new Error(`the database did not start (code ${code}): ${tail}; see ${this.logDir}`);
    }
  }

  /**
   * The database and the three MobSimLab roles, as db/init/10-roles.sh does in the container. Passwords go in as
   * psql variables quoted with format(%L), never as SQL text.
   */
  private async createRoles(): Promise<void> {
    const psql = pgProgram(this.o.runtime, "psql");
    const base = ["-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(this.dbPort), "-U", "postgres"];
    const env = { ...this.commonEnv(), PGPASSWORD: this.secret("db_superuser_password") };
    await this.run(
      "psql",
      psql,
      [
        ...base,
        "-d",
        "postgres",
        "-v",
        `migrator_pw=${this.secret("db_migrator_password")}`,
        "-v",
        `app_pw=${this.secret("db_app_password")}`,
        "-v",
        `worker_pw=${this.secret("db_worker_password")}`,
      ],
      {
        env,
        input: `SELECT format('CREATE ROLE mobsimlab_migrator LOGIN PASSWORD %L', :'migrator_pw')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mobsimlab_migrator') \\gexec
SELECT format('CREATE ROLE mobsimlab_app LOGIN PASSWORD %L', :'app_pw')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mobsimlab_app') \\gexec
SELECT format('CREATE ROLE mobsimlab_worker LOGIN PASSWORD %L', :'worker_pw')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mobsimlab_worker') \\gexec
SELECT 'CREATE DATABASE mobsimlab OWNER mobsimlab_migrator'
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'mobsimlab') \\gexec
REVOKE ALL ON DATABASE mobsimlab FROM PUBLIC;
GRANT CONNECT ON DATABASE mobsimlab TO mobsimlab_app, mobsimlab_worker;
`,
      },
    );
    await this.run("psql", psql, [...base, "-d", "mobsimlab"], {
      env,
      input: `CREATE EXTENSION IF NOT EXISTS postgis;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO mobsimlab_migrator;
GRANT USAGE ON SCHEMA public TO mobsimlab_app, mobsimlab_worker;
`,
    });
  }

  private commonEnv(): NodeJS.ProcessEnv {
    const r = this.o.runtime;
    const base = { ...process.env };
    // Electron sets these for its own helpers; the bundled Node and Python must not see them.
    for (const k of Object.keys(base)) if (k.startsWith("ELECTRON_")) delete base[k];
    // Windows spells it Path; one entry only, so the bundled tools come first.
    const pathKey = Object.keys(base).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
    const inherited = base[pathKey] ?? "";
    delete base[pathKey];
    return {
      ...base,
      PATH: [...r.path, inherited].join(delimiter),
      PROJ_DATA: r.projData,
      MOBSIMLAB_DB_HOST: "127.0.0.1",
      MOBSIMLAB_DB_PORT: String(this.dbPort),
      MOBSIMLAB_DB_NAME: "mobsimlab",
      MOBSIMLAB_SECRETS_DIR: this.secretsDir,
      MOBSIMLAB_DATA_DIR: join(this.o.dataDir, "data"),
      MOBSIMLAB_LOG_DIR: this.logDir,
    };
  }

  private apiEnv(): NodeJS.ProcessEnv {
    const r = this.o.runtime;
    return {
      ...this.commonEnv(),
      NODE_ENV: "production",
      MOBSIMLAB_PUBLIC_URL: this.url,
      MOBSIMLAB_PORT: String(this.apiPort),
      MOBSIMLAB_LISTEN_HOST: "127.0.0.1",
      MOBSIMLAB_LOCAL_MODE: "true",
      MOBSIMLAB_AGENTS_ENABLED: this.o.agents ? "true" : "false",
      MOBSIMLAB_WEB_DIR: r.web,
      MOBSIMLAB_WASM_DIR: join(r.api, "wasm"),
      MOBSIMLAB_MIGRATIONS_DIR: r.migrations,
      MOBSIMLAB_OSM_STYLE_DIR: r.osmStyle,
    };
  }

  private workerEnv(): NodeJS.ProcessEnv {
    return { ...this.commonEnv(), MOBSIMLAB_SIM_WORKERS: "1", PYTHONNOUSERSITE: "1", PYTHONUTF8: "1" };
  }

  private async waitForApi(): Promise<void> {
    const until = Date.now() + 120_000;
    for (;;) {
      if (this.api?.exitCode !== null && this.api?.exitCode !== undefined)
        throw new Error(`MobSimLab stopped while starting (code ${this.api.exitCode}); see ${this.logDir}`);
      try {
        const res = await fetch(`${this.url}/api/health`);
        if (res.ok) return;
      } catch {
        // not listening yet
      }
      if (Date.now() > until) throw new Error(`MobSimLab did not start in time; see ${this.logDir}`);
      await sleep(500);
    }
  }

  private logStream(name: string): WriteStream {
    return createWriteStream(join(this.logDir, `${name}.log`), { flags: "a", mode: 0o600 });
  }

  /** Starts a long-running process; its output goes to `<logs>/<name>.log`. `input` is written to its stdin. */
  private longRun(
    name: string,
    cmd: string,
    args: string[],
    o: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string } = {},
  ) {
    const log = this.logStream(name);
    log.write(`\n--- ${new Date().toISOString()} start ${name}\n`);
    const child = spawn(cmd, args, {
      cwd: o.cwd,
      env: o.env ?? this.commonEnv(),
      stdio: [o.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    if (o.input !== undefined) {
      // A child that stops at once closes its input; that shows in its own log, not as an error here.
      child.stdin?.on("error", () => {});
      child.stdin?.end(o.input);
    }
    child.stdout?.pipe(log, { end: false });
    child.stderr?.pipe(log, { end: false });
    child.on("exit", (code) => {
      log.end(`--- ${new Date().toISOString()} ${name} exited with ${code}\n`);
      if (!this.stopping && name !== "postgres") this.onCrash?.(name, code);
    });
    return child;
  }

  /** Runs a program to the end; rejects with the end of its output when it fails. */
  private run(
    name: string,
    cmd: string,
    args: string[],
    o: { env?: NodeJS.ProcessEnv; input?: string; quiet?: boolean } = {},
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const log = o.quiet ? null : this.logStream(name);
      let tail = "";
      const child = spawn(cmd, args, {
        env: o.env ?? this.commonEnv(),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const keep = (b: Buffer) => {
        tail = (tail + b.toString("utf8")).slice(-2000);
        log?.write(b);
      };
      child.stdout.on("data", keep);
      child.stderr.on("data", keep);
      child.on("error", (e) => reject(new Error(`${name} could not start: ${e.message}`)));
      child.on("close", (code) => {
        log?.end();
        if (code === 0) resolve();
        else
          reject(new Error(`${name} failed (code ${code}): ${tail.trim().split("\n").slice(-5).join(" ")}`));
      });
      child.stdin.end(o.input ?? "");
    });
  }
}

/** Purpose: stop a child process and wait for it (killed after 10 s). */
function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

/** Purpose: `preferred` when it is free on 127.0.0.1 (and not `avoid`), else a free port the system picks. */
export async function freePort(preferred: number, avoid?: number): Promise<number> {
  const tryPort = (port: number) =>
    new Promise<number | null>((resolve) => {
      const s = createServer();
      s.once("error", () => resolve(null));
      s.listen(port, "127.0.0.1", () => {
        const got = (s.address() as { port: number }).port;
        s.close(() => resolve(got));
      });
    });
  if (preferred !== avoid) {
    const p = await tryPort(preferred);
    if (p) return p;
  }
  for (;;) {
    const p = await tryPort(0);
    if (p && p !== avoid) return p;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
