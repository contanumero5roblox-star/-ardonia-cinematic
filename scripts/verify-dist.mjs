import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
const base = process.env.ARDONIA_BASE_PATH || "/-ardonia-cinematic/";
const m = JSON.parse(await readFile("dist/manifest.json", "utf8"));
assert.equal(m.manifest_version, 1);
assert.equal(m.name, "Ardonia Cinematic");
assert.match(m.version, /^\d+\.\d+\.\d+$/);
assert.ok(m.action.width >= 320 && m.action.height >= 400);
for (const url of [m.icon, m.background_url, m.action.icon, m.action.popover]) {
  assert.ok(url.startsWith(base), `Prefixo do manifesto inválido: ${url}`);
  const path = resolve("dist", url.slice(base.length));
  assert.ok(path.startsWith(resolve("dist") + sep));
  assert.ok((await stat(path)).isFile(), `${url} não existe`);
}
for (const file of ["index.html", "background.html", "presentation.html"]) {
  const html = await readFile(`dist/${file}`, "utf8");
  assert.ok(!html.includes("/src/"), "Build contém referência ao fonte");
  for (const [, url] of html.matchAll(/(?:src|href)="(\.\/assets\/[^\"]+)"/g)) {
    assert.ok(
      (await stat(resolve("dist", url))).isFile(),
      `Recurso faltante: ${url}`,
    );
  }
  assert.match(html, /type="module"/);
}
console.log(
  "Manifesto v1, três páginas e recursos locais de produção verificados. Base:",
  base,
);
