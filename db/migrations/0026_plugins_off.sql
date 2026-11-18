-- 0026: an Admin can turn a plugin off for the whole MobSimLab under Administration → Plugins. A plugin that is off
-- is not offered to any project (projects keep their own choice and what they drew) and its basemaps and map
-- layers are not offered on any map. Ids of plugins, bundled or installed.

ALTER TABLE iam.instance
  ADD COLUMN plugins_off text[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(plugins_off) <= 500);
