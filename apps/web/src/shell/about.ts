/** Where the source, documentation and policies live (shown in the About dialog and on the sign-in page). */
export const GITHUB_URL = "https://github.com/homlo-bike/MobSimLab";
export const DOCS_URL = `${GITHUB_URL}/tree/main/docs`;
export const ISSUES_URL = `${GITHUB_URL}/issues`;
export const SECURITY_URL = `${GITHUB_URL}/blob/main/SECURITY.md`;
export const LICENCE_URL = `${GITHUB_URL}/blob/main/LICENSE`;

/** Version and build, set by Vite at build time (`MOBSIMLAB_BUILD` names the build, for example a commit). */
export const APP_VERSION: string = __APP_VERSION__;
export const APP_BUILD: string = __APP_BUILD__;

/** Main open-source components and their licences. */
export const COMPONENTS = [
  ["MapLibre GL JS", "BSD-3-Clause"],
  ["React", "MIT"],
  ["NestJS", "MIT"],
  ["PostgreSQL", "PostgreSQL"],
  ["PostGIS", "GPL-2.0"],
  ["OpenStreetMap data", "ODbL"],
] as const;
