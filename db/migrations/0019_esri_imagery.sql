-- 0019: Esri World Imagery as an aerial basemap (bundled plugin org.mobsimlab.esri-imagery). Esri's tiles need an
-- ArcGIS API key and acceptance of Esri's terms. An Admin saves the key here; the API fetches the tiles with it,
-- so browsers never see the key, and passes them on without storing them (docs/architecture/06-gis.md §8).
-- The key is never returned by the API, written to the audit log or logged.

ALTER TABLE iam.instance
  ADD COLUMN esri_api_key text CHECK (esri_api_key IS NULL OR length(esri_api_key) BETWEEN 20 AND 1000),
  ADD COLUMN esri_terms_accepted_at timestamptz,
  ADD COLUMN esri_terms_accepted_by uuid REFERENCES iam."user" (id) ON DELETE SET NULL,
  ADD CONSTRAINT esri_key_needs_terms CHECK (esri_api_key IS NULL OR esri_terms_accepted_at IS NOT NULL);
