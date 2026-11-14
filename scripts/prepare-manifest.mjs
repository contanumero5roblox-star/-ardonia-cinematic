import { readFile, writeFile, copyFile } from "node:fs/promises";
const base = process.env.ARDONIA_BASE_PATH || "/-ardonia-cinematic/";
if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base))
  throw new Error(
    "ARDONIA_BASE_PATH deve ser um caminho como / ou /-ardonia-cinematic/.",
  );
const manifest = JSON.parse(await readFile("public/manifest.json", "utf8"));
manifest.icon = `${base}icon.svg`;
manifest.background_url = `${base}background.html`;
manifest.action.icon = manifest.icon;
manifest.action.popover = `${base}index.html`;
await writeFile("dist/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
await writeFile("dist/.nojekyll", "");

await copyFile("LICENSE", "dist/LICENSE");
await copyFile("THIRD_PARTY_NOTICES.md", "dist/THIRD_PARTY_NOTICES.md");
