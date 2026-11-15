import { sign } from "node:crypto";
import { CHECKSUMS, sha256, SIGNATURE } from "../../src/plugins/signature";

/** A small third-party data plugin: one ferry-like mode on the water route kit. */
export function samplePlugin(over: Record<string, unknown> = {}, id = "org.example.water-taxi"): Map<string, Buffer> {
  const manifest = {
    id,
    name: "Water taxis",
    description: "Small on-demand boats.",
    version: "1.0.0",
    publisher: { name: "Example Transit Lab", url: "https://example.org" },
    license: "MIT",
    dataLicense: "CC-BY-4.0",
    engines: { mobsimlab: ">=0.1 <1", pluginApi: "1" },
    tiers: ["data"],
    contributes: {
      modes: [{ id: "water_taxi", file: "modes/water_taxi.json" }],
      parameters: [{ file: "assumptions/parameters.yaml" }],
      sources: [{ file: "assumptions/sources.yaml" }],
      tools: [{ id: "water-taxi", label: "Water taxi", kit: "water-route", modes: ["water_taxi"] }],
    },
    permissions: ["read:network"],
    ...over,
  };
  const mode = {
    id: "water_taxi",
    label: "Water taxi",
    family: "water",
    colour: "#0e7490",
    gtfsRouteType: 4,
    kit: "water-route",
    operation: "frequency",
  };
  const params = `- key: water_taxi.speed_kn
  label: Service speed
  group: Water taxis
  unit: kn
  used_by:
    - running time
  values:
    - context:
        mode: "*"
      low: 6
      central: 10
      high: 20
      basis: educated-guess
      sources:
        - example-survey
      check: unverified
      rationale: Small boats.
    - context:
        mode: water_taxi
      low: 8
      central: 12
      high: 20
      basis: educated-guess
      sources:
        - example-survey
      check: unverified
      rationale: Small boats in harbours.
`;
  const sources = `- id: example-survey
  title: Example survey of water taxis
  publisher: Example Transit Lab
  url: https://example.org/survey
  licence: CC-BY-4.0
  access: free
  retrieved: 2026-11-01
  checked_via: direct
`;
  return new Map([
    ["mobsimlab-plugin.json", Buffer.from(JSON.stringify(manifest))],
    ["modes/water_taxi.json", Buffer.from(JSON.stringify(mode))],
    ["assumptions/parameters.yaml", Buffer.from(params)],
    ["assumptions/sources.yaml", Buffer.from(sources)],
  ]);
}

/** Purpose: add SHA256SUMS and, with a private key, its signature. */
export function signed(files: Map<string, Buffer>, privateKey?: Parameters<typeof sign>[2]): Map<string, Buffer> {
  const out = new Map(files);
  const list = [...files].map(([p, b]) => `${sha256(b)}  ${p}\n`).join("");
  out.set(CHECKSUMS, Buffer.from(list));
  if (privateKey) {
    const ed = typeof privateKey === "object" && "asymmetricKeyType" in privateKey && privateKey.asymmetricKeyType === "ed25519";
    out.set(SIGNATURE, Buffer.from(sign(ed ? null : "sha256", Buffer.from(list), privateKey).toString("base64")));
  }
  return out;
}
