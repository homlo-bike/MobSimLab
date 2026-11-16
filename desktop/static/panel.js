// The app's own page: onboarding, start-up progress, errors and settings. Talks to the main process only
// through the fixed calls in preload.ts.
"use strict";
(async () => {
  const api = window.mobsimlab;
  const $ = (id) => document.getElementById(id);
  const message = $("message");
  const say = (text) => {
    message.textContent = text || "";
    message.hidden = !text;
  };
  const busy = async (button, f) => {
    button.disabled = true;
    say("");
    try {
      const r = await f();
      if (r && r.error) say(r.error);
    } catch (e) {
      say(String((e && e.message) || e));
    } finally {
      button.disabled = false;
    }
  };

  const s = await api.state();
  $("version").textContent = s.version ? `Version ${s.version}` : "";
  for (const id of ["onboarding", "starting", "error", "settings"]) $(id).hidden = id !== s.phase;
  for (const el of document.querySelectorAll(".local-only")) el.hidden = s.mode !== "local";
  for (const el of document.querySelectorAll(".server-only")) el.hidden = s.mode !== "server";

  api.onStatus((text) => {
    $("status").textContent = text;
  });

  $("use-local").addEventListener("click", (e) => busy(e.currentTarget, () => api.useLocal()));
  $("connect-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const button = e.currentTarget.querySelector("button");
    busy(button, () => api.connect($("server-url").value));
  });

  $("error-text").textContent = s.error || "";
  $("retry").addEventListener("click", (e) => busy(e.currentTarget, () => api.retry()));
  $("change").addEventListener("click", () => {
    for (const id of ["onboarding", "starting", "error", "settings"]) $(id).hidden = id !== "onboarding";
  });
  $("logs").addEventListener("click", () => api.openLogs());

  $("mode-text").textContent =
    s.mode === "local"
      ? "MobSimLab runs on this computer, without an account."
      : s.mode === "server"
        ? `Connected to ${s.serverUrl}.`
        : "Not chosen yet.";
  $("settings-server-url").value = s.serverUrl || "";
  $("switch-local").addEventListener("click", (e) => busy(e.currentTarget, () => api.useLocal()));
  $("settings-connect-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const button = e.currentTarget.querySelector("button");
    busy(button, () => api.connect($("settings-server-url").value));
  });

  const snippet = (port) =>
    JSON.stringify(
      {
        mcpServers: {
          mobsimlab: {
            command: "npx",
            args: [
              "-y",
              "mcp-remote",
              `http://127.0.0.1:${port}/mcp`,
              "--header",
              "Authorization:${MOBSIMLAB_TOKEN}",
            ],
            env: { MOBSIMLAB_TOKEN: "Bearer YOUR_TOKEN" },
          },
        },
      },
      null,
      2,
    );
  const showAgents = (on, port) => {
    $("agents").checked = on;
    $("agents-help").hidden = !on || !port;
    if (port) $("snippet").textContent = snippet(port);
  };
  showAgents(s.agents, s.apiPort);
  $("agents").addEventListener("change", (e) => {
    const on = e.currentTarget.checked;
    busy(e.currentTarget, async () => {
      const r = await api.setAgents(on);
      showAgents(on, r && r.apiPort);
      return r;
    });
  });
  $("copy").addEventListener("click", () => navigator.clipboard.writeText($("snippet").textContent || ""));
  $("close").addEventListener("click", () => api.close());
})();
