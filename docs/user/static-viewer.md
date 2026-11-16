# Static viewer

The static viewer is a website with no server that shows MobSimLab projects read-only. You can host it on
Cloudflare Pages (or any static web host). Visitors pick a project and see four tabs:

- **Simulator**: the system test and the journey planner run in the browser. Runs saved in the project file
  (capacity tests, sweeps, road runs with their replays, calendar runs) show in the simulator's saved runs, as
  they do for a viewer on a MobSimLab server. New runs on the server's worker (road, calendar and demand runs)
  cannot be started here.
- **Schematic**: the network map and strip maps, with SVG, PNG and print export.
- **Tables**: every table of the Tables tab, computed from the project.
- **Project preferences**: the values the project chose, read-only.

Nothing a visitor does is saved or sent anywhere. Place search and terrain profiles need a server and are not
available.

## 1. Save the projects

In MobSimLab, open each project's menu on the projects home and choose **Save as .mslab file**. Tick:

- **Include saved simulation runs** to show the saved runs, and
- **Include map data for the static viewer** so the viewer has the streets, buildings, population and country
  figures of the project area. Without it, the map shows only the basemap and the project's own lines, and the
  tables that need population or country figures say they are missing.

See [Project files](project-files.md).

## 2. Build the site

From the repository, with the WebAssembly engines built (`tools/wasm/build-*.sh`, as for `pnpm build`):

```bash
mkdir -p static-projects && cp ~/Downloads/*.mslab static-projects/
pnpm build:static                       # or: pnpm build:static --projects <folder with .mslab files>
```

This writes the site to `apps/web/dist-static/` and the same as `apps/web/mobsimlab-static.zip`:

```
index.html, assets/          the app
projects/index.json          the list of projects the viewer shows
projects/<file>.mslab        the project files you added
projects/<project id>/       each file unpacked (what the viewer reads)
tools/add-projects.mjs       adds or removes projects without this repository
```

## 3. Upload to Cloudflare Pages

1. In the Cloudflare dashboard open **Workers & Pages**, choose **Create**, then **Pages** and
   **Upload assets** (direct upload).
2. Name the project and upload `mobsimlab-static.zip` (or the `dist-static` folder).
3. Deploy. The site is at `https://<name>.pages.dev`; add your own domain under **Custom domains**.

Or with Wrangler: `npx wrangler pages deploy apps/web/dist-static --project-name <name>`.

The site has no `404.html`, so Cloudflare Pages serves it as a single-page app: addresses such as
`/projects/<id>/schematic` open the app. On another host, send every path that is not a file to `index.html`.

## Add or remove projects later

Unzip the site, put the `.mslab` files in its `projects/` folder (or delete one), then run the script that came
with it (Node.js 18 or later):

```bash
node tools/add-projects.mjs
```

It checks each file (safe names, size limits and the checksum of every file inside), unpacks it to
`projects/<project id>/` and rewrites `projects/index.json`. Upload the folder again.

Cloudflare Pages serves files of up to 25 MiB. The unpacked files are small, but a large `.mslab` file (with
many runs or map tiles) can be over the limit: keep it outside the site and pass it to the script instead,
`node tools/add-projects.mjs ~/big-project.mslab`. The script warns about any file over the limit.

## Licences

The site is MobSimLab (AGPL-3.0-or-later); its source is this repository. Map data in a project file is
OpenStreetMap data © OpenStreetMap contributors under the ODbL; each project's `ATTRIBUTION.md` lists the
sources of what it holds. The basemap is OpenFreeMap, as in MobSimLab.
