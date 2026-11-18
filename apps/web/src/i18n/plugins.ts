/**
 * Plugin messages (ADR-0036 §9): the Plugins tab of Administration and the Plugins section of Project Preferences,
 * in English. The other languages are in ./plugins/<tag>.ts. Merged into each language's dictionary.
 */
export const pluginsEn = {
  "admin.plugins": "Plugins",
  "plugins.title": "Plugins",
  "plugins.intro":
    "Plugins add transport modes, tools and calculations. Turn on the ones this project uses; turning one off hides its tools and keeps what was drawn with it.",
  "plugins.bundled": "Comes with MobSimLab",
  "plugins.by": "By {publisher}",
  "plugins.versionN": "Version {version}",
  "plugins.adds": "Adds: {list}",
  "plugins.uses": "Uses: {list}",
  "plugins.parameters": "{count} assumption values",
  "plugins.missing":
    "Version {version} was removed from this MobSimLab. Pick another version to use it again.",
  "plugins.versionOf": "Version of {name}",
  "plugins.useIn": "Use {name} in this project",
  "plugins.ownerOnly": "Only the project's Owner can turn plugins on or off.",
  "plugins.perm.readNetwork": "the project's network",
  "plugins.perm.readTimetable": "the timetable",
  "plugins.perm.readFleet": "vehicles and fleet",
  "plugins.perm.readGeodata": "imported map data",
  "plugins.perm.readResults": "simulation results",
  "plugins.perm.writeResults": "saves its own results",
  "plugins.perm.writeScenario": "proposes changes to the scenario",
  "plugins.installTitle": "Install a plugin",
  "plugins.choose": "Choose a .msplugin file",
  "plugins.problems": "This plugin cannot be installed:",
  "plugins.install": "Install",
  "plugins.installed": "3rd party plugins",
  "plugins.none": "No 3rd party plugins installed yet.",
  "plugins.removeOne": "Remove {name} {version}",
  "plugins.inProjects": "Used in {count} projects",
  "plugins.bundledTitle": "Bundled with MobSimLab",
  "plugins.keys": "Trusted publishers",
  "plugins.keysIntro":
    "A plugin installs only when its publisher signed it with one of these keys (ECDSA P-256 or Ed25519, PEM).",
  "plugins.noKeys": "No trusted keys yet.",
  "plugins.removeKey": "Stop trusting {name}",
  "plugins.addKey": "Add key",
  "plugins.keyName": "Publisher name",
  "plugins.keyPem": "Public key",
  "plugins.allowUnsigned": "Allow unsigned plugins (development mode, Owners only)",
  "plugins.signedBy": "Signed by {name}",
  "plugins.untrusted": "Signed with a key this instance does not trust",
  "plugins.unsigned": "Not signed",
  "plugins.licences": "Licences: code {code}, data {data}",
  "plugins.removeConfirm":
    "{name} is turned on in {count} projects. Remove it anyway? It is turned off in them and their drawings are kept.",
} as const;

/** Keys of the plugin messages. */
export type PluginKey = keyof typeof pluginsEn;
