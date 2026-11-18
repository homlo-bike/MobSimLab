-- 0023: WMS, WMTS and XYZ tile services as map layers (bundled plugin org.mobsimlab.ogc-layers). An Admin adds
-- a service (its address, and its sign-in details when it needs them) and picks its layers; members see them in
-- the map's layer control. The API fetches the tiles with the sign-in details, so browsers never see them, and
-- passes them on without storing them. `auth_secret` (a password or key) is never returned by the API, written to
-- the audit log or logged, and is not part of any project or export.

CREATE TABLE plugin.map_layer_service (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('wms', 'wmts', 'xyz')),
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  -- The address the Admin typed (https): the service (WMS, WMTS) or the tile template with {z}, {x}, {y} (XYZ).
  url         text NOT NULL CHECK (url ~ '^https://' AND length(url) <= 2000),
  auth_type   text NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none', 'basic', 'query', 'header')),
  -- User name (basic), query parameter name (query) or header name (header).
  auth_name   text CHECK (auth_name IS NULL OR length(auth_name) BETWEEN 1 AND 200),
  auth_secret text CHECK (auth_secret IS NULL OR length(auth_secret) BETWEEN 1 AND 2000),
  -- Drawn as a basemap (under the place names) or as an overlay over any basemap.
  show_as     text NOT NULL DEFAULT 'basemap' CHECK (show_as IN ('basemap', 'overlay')),
  attribution text NOT NULL CHECK (length(btrim(attribution)) BETWEEN 1 AND 300),
  -- The picked layers as read from the capabilities: [{id, title, tileSize, minzoom, maxzoom, bounds?, wms|wmts}].
  layers      jsonb NOT NULL CHECK (jsonb_typeof(layers) = 'array' AND jsonb_array_length(layers) BETWEEN 1 AND 20),
  -- Services MobSimLab comes with (apps/api/src/basemaps/builtin-layers.ts): their id, added on first start.
  builtin     text UNIQUE CHECK (builtin IS NULL OR builtin ~ '^[a-z0-9-]{1,64}$'),
  -- Hidden by an Admin: not offered on maps. Built-in services are hidden instead of removed, so they stay away.
  hidden      boolean NOT NULL DEFAULT false,
  added_by    uuid REFERENCES iam."user" (id) ON DELETE SET NULL,
  added_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT map_layer_auth_complete CHECK (
    (auth_type = 'none' AND auth_name IS NULL AND auth_secret IS NULL)
    OR (auth_type <> 'none' AND auth_name IS NOT NULL AND auth_secret IS NOT NULL)
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON plugin.map_layer_service TO mobsimlab_app;
