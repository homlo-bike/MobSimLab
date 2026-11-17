# Desktop app (Windows, macOS, Linux)

The desktop app is MobSimLab in its own window. On first start it asks how you want to use it:

- **Use on this computer.** Everything runs on your computer: the database (PostgreSQL with PostGIS), the API, the
  simulation worker (with SUMO) and your projects. There is no account and no sign-in. Nothing leaves the computer
  unless you export it, or unless you use features that fetch public data (map tiles, OpenStreetMap, elevation).
- **Connect to a server.** Enter your organisation's MobSimLab address (for example `https://mobsimlab.example.org`).
  The app checks that it is a MobSimLab server, then opens it. You sign in with the server's single sign-on in the
  app window, the same as in a browser.

You can change this later under **Settings** (File menu on Windows and Linux, MobSimLab menu on macOS, or
Ctrl+, / ⌘,). Projects move between the two by exporting the project file (`.mslab`) and opening it on the other
side; there is no automatic sync.

## Download and install

Each release on GitHub (for example `v2026.11.1-alpha`) has these files. Each comes with a `.sha256` file to check the
download.

| System | File | Notes |
|--------|------|-------|
| Windows 10 and 11 (64-bit) | `MobSimLab-<version>-windows-x64-setup.exe` | Installs for your user only; no administrator rights needed. |
| Windows, no installation | `MobSimLab-<version>-windows-x64-portable.exe` | Starts more slowly, because it unpacks itself each time. |
| macOS 14 or later, Apple Silicon | `MobSimLab-<version>-macos-arm64.dmg` | Drag MobSimLab to Applications. |
| Linux (x86-64) | `MobSimLab-<version>-linux-x86_64.AppImage` | Make it executable (`chmod +x`) and run it. |
| Debian, Ubuntu | `MobSimLab-<version>-linux-amd64.deb` | `sudo apt install ./MobSimLab-<version>-linux-amd64.deb` |
| Fedora, RHEL, openSUSE | `MobSimLab-<version>-linux-x86_64.rpm` | `sudo dnf install ./MobSimLab-<version>-linux-x86_64.rpm` |

The installers are large (several hundred MB) because they contain the whole server, PostgreSQL, Python and SUMO.
Intel Macs are not supported yet, because SUMO publishes no build for them.

### The apps are not signed yet

Until the project has code-signing certificates, your system warns the first time you open the app:

- **Windows:** SmartScreen shows "Windows protected your PC". Choose **More info**, then **Run anyway**.
- **macOS:** the first start is blocked. Open **System Settings → Privacy & Security**, scroll to the message about
  MobSimLab, and choose **Open Anyway**. If macOS says the app "is damaged", run
  `xattr -dr com.apple.quarantine /Applications/MobSimLab.app` once in Terminal.
- **Linux:** no warning.

## Where your data is

On this computer, everything is in the app's data folder, in `local/`:

| System | Folder |
|--------|--------|
| Windows | `%APPDATA%\MobSimLab\local` |
| macOS | `~/Library/Application Support/MobSimLab/local` |
| Linux | `~/.config/MobSimLab/local` |

It holds the database (`postgres/`), downloaded and generated files (`data/`), log files (`logs/`, also under
**Help → Open log folder**) and the random passwords and keys of this installation (`secrets/`). Back up the folder
while the app is closed. Uninstalling the app does not delete it.

The local server listens on `127.0.0.1` only (port 47800, or another free port), so other computers cannot reach it.
Only the desktop app can sign in to it: it adds a key, new at each start, to its own requests, which a browser on the
same computer does not have.

## AI agents (Claude Desktop and other MCP apps)

On this computer, AI agents are off until you turn them on under **Settings → AI agents**. The app then restarts its
local server with the MCP endpoint on. Next:

1. In MobSimLab, open the account menu, then **Connected agents**, and create a personal access token.
2. In Claude Desktop, open **Settings → Developer → Edit Config** and add the configuration shown in MobSimLab's
   Settings to `claude_desktop_config.json`, with your token in place of `YOUR_TOKEN`. It uses
   [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) through `npx`, so Node.js must be installed.
3. Restart Claude Desktop.

When connected to a server, AI agents work as described in [AI agents](ai-agents.md).

## Building the app yourself

The release workflow (`.github/workflows/release-desktop.yml`) shows every step. In short, on the system you build for:
build the API and web app, assemble `desktop/runtime` with `desktop/scripts/assemble-runtime.mjs` (after creating
`desktop/runtime/conda` with PostgreSQL, PostGIS, osmium and osm2pgsql from conda-forge, and on Windows
`desktop/runtime/pgsql`), check it with `npm run smoke`, then run `npm run dist` in `desktop/`. On Linux and macOS,
create the conda environment in a folder whose path is exactly 255 characters long and then move it to
`desktop/runtime/conda`, as the workflow does: otherwise the bundled PostgreSQL only works in the folder it was
installed in, and the app fails to start on other computers.
