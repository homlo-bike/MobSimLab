-- 0024: stored API keys and map service passwords are encrypted at rest (ADR-0016, apps/api/src/config/
-- credential-vault.ts). The API encrypts the values saved before this release at its next start. An encrypted value
-- is longer than the key it holds, so the length checks of 0019 and 0023 make room for it; the API still checks
-- the length of the key an Admin types.

ALTER TABLE iam.instance DROP CONSTRAINT instance_esri_api_key_check;
ALTER TABLE iam.instance
  ADD CONSTRAINT instance_esri_api_key_check CHECK (esri_api_key IS NULL OR length(esri_api_key) BETWEEN 20 AND 4000);

ALTER TABLE plugin.map_layer_service DROP CONSTRAINT map_layer_service_auth_secret_check;
ALTER TABLE plugin.map_layer_service
  ADD CONSTRAINT map_layer_service_auth_secret_check
  CHECK (auth_secret IS NULL OR length(auth_secret) BETWEEN 1 AND 4000);
