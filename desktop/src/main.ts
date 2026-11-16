import { join } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  Menu,
  type MenuItemConstructorOptions,
  net,
  session,
  shell,
} from "electron";
import { LocalStack } from "./local";
import { runtimeAt } from "./runtime";
import { normaliseServerUrl, probeServer, readSettings, type Settings, writeSettings } from "./settings";

/** Header the local API checks before it signs in the local Owner (apps/api: POST /api/auth/local). */
const LOCAL_KEY_HEADER = "X-MobSimLab-Local-Key";

type Phase = "onboarding" | "starting" | "error" | "settings";

const settingsFile = () => join(app.getPath("userData"), "settings.json");
let settings: Settings;
let stack: LocalStack | null = null;
let appWindow: BrowserWindow | null = null;
let panel: BrowserWindow | null = null;
let phase: Phase = "onboarding";
let lastError: string | null = null;
let instanceName: string | null = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  // One copy at a time: two would share one database folder.
  app.quit();
} else {
  app.on("second-instance", () => {
    const w = appWindow ?? panel;
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });
  void app.whenReady().then(ready);
}

async function ready(): Promise<void> {
  settings = readSettings(settingsFile());
  lockDown();
  registerIpc();
  buildMenu();
  if (settings.mode === null) showPanel("onboarding");
  else await open();
}

/** Purpose: open MobSimLab in the chosen mode: start the local server, or check and open the server. */
async function open(): Promise<void> {
  lastError = null;
  if (settings.mode === "local") {
    showPanel("starting");
    try {
      const runtime = runtimeAt(join(process.resourcesPath, "runtime"));
      stack = new LocalStack({
        runtime,
        dataDir: join(app.getPath("userData"), "local"),
        agents: settings.agents,
        status: (text) => panel?.webContents.send("desktop:status", text),
      });
      stack.onCrash = (what, code) => {
        if (quitting) return;
        void dialog.showMessageBox({
          type: "error",
          message: `MobSimLab's ${what === "worker" ? "simulation worker" : "server"} stopped (code ${code}).`,
          detail: `Restart the app to continue. The log files are in ${stack?.logs ?? "the app's data folder"}.`,
        });
      };
      await stack.start();
    } catch (e) {
      await stack?.stop().catch(() => {});
      stack = null;
      lastError = (e as Error).message;
      showPanel("error");
      return;
    }
    openApp(stack.url);
  } else if (settings.mode === "server" && settings.serverUrl) {
    const probe = await probeServer(settings.serverUrl, (u) => net.fetch(u));
    if ("error" in probe) {
      lastError = `${settings.serverUrl}: ${probe.error}`;
      showPanel("error");
      return;
    }
    instanceName = probe.name;
    openApp(settings.serverUrl);
  } else {
    showPanel("onboarding");
  }
}

/** Purpose: the window that shows MobSimLab's web app (local or a server). No Node access, no preload. */
function openApp(url: string): void {
  const origin = new URL(url).origin;
  if (!appWindow) {
    appWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 900,
      minHeight: 600,
      show: false,
      title: "MobSimLab",
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
    });
    appWindow.once("ready-to-show", () => appWindow?.show());
    appWindow.on("closed", () => {
      appWindow = null;
      if (process.platform !== "darwin") app.quit();
    });
    // New windows (links with target=_blank, the provider's help pages) open in the person's browser.
    appWindow.webContents.setWindowOpenHandler(({ url: to }) => {
      if (/^https?:\/\//i.test(to)) void shell.openExternal(to);
      return { action: "deny" };
    });
  }
  const contents = appWindow.webContents;
  contents.removeAllListeners("will-navigate");
  contents.on("will-navigate", (e, to) => {
    let target: URL;
    try {
      target = new URL(to);
    } catch {
      e.preventDefault();
      return;
    }
    if (target.origin === origin) return;
    // A server signs in through its identity provider (SSO), which needs the window to go there and back.
    if (settings.mode === "server" && (target.protocol === "https:" || target.protocol === "http:")) return;
    e.preventDefault();
    if (target.protocol === "https:" || target.protocol === "http:") void shell.openExternal(to);
  });
  void appWindow.loadURL(url);
  appWindow.setTitle(
    settings.mode === "server" && instanceName ? `MobSimLab · ${instanceName}` : "MobSimLab",
  );
  if (panel && phase !== "settings") panel.close();
}

/** Purpose: the app's own page for onboarding, start-up progress, errors and settings. */
function showPanel(p: Phase): void {
  phase = p;
  if (panel) {
    panel.webContents.reload();
    panel.show();
    panel.focus();
    return;
  }
  panel = new BrowserWindow({
    width: 720,
    height: 640,
    resizable: true,
    title: "MobSimLab",
    parent: p === "settings" && appWindow ? appWindow : undefined,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: join(__dirname, "preload.js"),
    },
  });
  panel.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  panel.webContents.on("will-navigate", (e) => e.preventDefault());
  panel.on("closed", () => {
    panel = null;
    if (!appWindow && !stack && phase !== "starting" && process.platform !== "darwin") app.quit();
  });
  void panel.loadFile(join(__dirname, "..", "static", "panel.html"));
}

/** Purpose: browser-level rules for every window: the launch key header, permissions, no webviews. */
function lockDown(): void {
  const ses = session.defaultSession;
  // The local API signs in only requests carrying this launch's key. Only the app adds it, and only to its own
  // local address; page scripts never see it.
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    if (stack && new URL(details.url).origin === new URL(stack.url).origin)
      headers[LOCAL_KEY_HEADER] = stack.launchKey;
    callback({ requestHeaders: headers });
  });
  // The web app only copies links to the clipboard; it never needs the camera, location or notifications.
  ses.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(permission === "clipboard-sanitized-write"),
  );
  app.on("web-contents-created", (_e, contents) => {
    contents.on("will-attach-webview", (e) => e.preventDefault());
  });
}

/** Purpose: answer the panel page. Only the app's own panel page may call. */
function registerIpc(): void {
  const own = (e: IpcMainInvokeEvent) => {
    if (!panel || e.sender !== panel.webContents || !e.senderFrame?.url.startsWith("file:"))
      throw new Error("not allowed");
  };
  ipcMain.handle("desktop:state", (e) => {
    own(e);
    return {
      phase,
      mode: settings.mode,
      serverUrl: settings.serverUrl ?? "",
      agents: settings.agents,
      error: lastError,
      apiPort: stack?.apiPort ?? null,
      version: app.getVersion(),
      platform: process.platform,
    };
  });
  ipcMain.handle("desktop:use-local", async (e) => {
    own(e);
    await switchTo({ ...settings, mode: "local" });
    return { ok: true };
  });
  ipcMain.handle("desktop:connect", async (e, input: string) => {
    own(e);
    const n = normaliseServerUrl(String(input));
    if ("error" in n) return n;
    const probe = await probeServer(n.url, (u) => net.fetch(u));
    if ("error" in probe) return probe;
    instanceName = probe.name;
    await switchTo({ ...settings, mode: "server", serverUrl: n.url });
    return { ok: true, name: probe.name };
  });
  ipcMain.handle("desktop:set-agents", async (e, on: boolean) => {
    own(e);
    settings = { ...settings, agents: Boolean(on) };
    writeSettings(settingsFile(), settings);
    // The local server reads the switch when it starts.
    if (settings.mode === "local" && stack) {
      await restartLocal();
      showPanel("settings");
    }
    return { ok: true, apiPort: stack?.apiPort ?? null };
  });
  ipcMain.handle("desktop:retry", async (e) => {
    own(e);
    await open();
    return { ok: true };
  });
  ipcMain.handle("desktop:open-logs", async (e) => {
    own(e);
    await shell.openPath(join(app.getPath("userData"), "local", "logs"));
  });
  ipcMain.handle("desktop:close-settings", (e) => {
    own(e);
    panel?.close();
  });
}

/** Purpose: save a new mode and open it, stopping the local server when leaving local mode. */
async function switchTo(next: Settings): Promise<void> {
  const leavingLocal = settings.mode === "local" && next.mode !== "local";
  settings = next;
  writeSettings(settingsFile(), settings);
  if (leavingLocal && stack) {
    await stack.stop();
    stack = null;
  }
  if (appWindow && settings.mode === "local" && stack) {
    openApp(stack.url);
    panel?.close();
    return;
  }
  appWindow?.destroy();
  appWindow = null;
  panel?.destroy();
  panel = null;
  await open();
}

async function restartLocal(): Promise<void> {
  appWindow?.destroy();
  appWindow = null;
  await stack?.stop();
  stack = null;
  await open();
}

function buildMenu(): void {
  const settingsItem: MenuItemConstructorOptions = {
    label: "Settings…",
    accelerator: "CmdOrCtrl+,",
    click: () => showPanel(settings.mode === null ? "onboarding" : "settings"),
  };
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              settingsItem,
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          } as MenuItemConstructorOptions,
        ]
      : [
          {
            label: "&File",
            submenu: [settingsItem, { type: "separator" }, { role: "quit" }],
          } as MenuItemConstructorOptions,
        ]),
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Open log folder",
          click: () => void shell.openPath(join(app.getPath("userData"), "local", "logs")),
        },
        {
          label: "MobSimLab on GitHub",
          click: () => void shell.openExternal("https://github.com/homlo-bike/MobSimLab"),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Stop the local server (and with it the database) before the app exits, so the database shuts down cleanly.
app.on("before-quit", (e) => {
  if (quitting || !stack) return;
  e.preventDefault();
  quitting = true;
  const s = stack;
  stack = null;
  void s.stop().finally(() => app.quit());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (!appWindow && !panel && settings) void open();
});
