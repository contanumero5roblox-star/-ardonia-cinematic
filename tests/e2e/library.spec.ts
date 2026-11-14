import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const libraryKey = "com.ardonia.cinematic.library.v1";
async function create(page: Page, title: string, description = "", image = "") {
  await page
    .getByRole("button", { name: "+ Nova cinematic", exact: true })
    .click();
  await page.locator("#title").fill(title);
  await page.locator("#description").fill(description);
  await page.locator("#image").fill(image);
  await page.getByRole("button", { name: "Salvar cinematic" }).click();
  await expect(page.locator("#editor")).not.toBeVisible();
}
const preview = (page: Page) =>
  page.getByRole("dialog", { name: "Pré-visualização da cinematic" });
async function importFile(page: Page, data: string) {
  await page.locator("#import-file").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(data),
  });
}
function backup(entries: unknown[]) {
  return JSON.stringify({
    format: "ardonia-cinematic",
    version: 1,
    cinematics: entries,
  });
}
function scene(id: string, title: string) {
  return {
    id,
    title,
    description: "",
    imageUrl: "",
    updatedAt: "2026-11-14T00:00:00.000Z",
  };
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "+ Nova cinematic", exact: true }),
  ).toBeVisible();
});

test("creates, edits, searches, persists, previews and deletes scenes", async ({
  page,
}) => {
  await create(
    page,
    "Floresta dos Sussurros",
    "O vento desaparece entre as árvores.",
  );
  await expect(
    page.getByRole("button", { name: "Anunciar", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Floresta dos Sussurros", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await page.locator("#title").fill("Estação da Revelação");
  await page.getByRole("button", { name: "Salvar cinematic" }).click();
  await page.getByRole("searchbox").fill("REVELACAO");
  await expect(page.locator(".card")).toHaveCount(1);
  await page.getByRole("searchbox").fill("nada semelhante");
  await expect(page.locator(".card")).toHaveCount(0);
  await expect(page.getByText("Nenhuma cena encontrada")).toBeVisible();
  await page.getByRole("searchbox").fill("");
  await page
    .getByRole("button", { name: "Pré-visualizar", exact: true })
    .click();
  await expect(
    preview(page).getByRole("heading", {
      name: "Estação da Revelação",
      exact: true,
    }),
  ).toBeVisible();
  await expect(preview(page)).not.toContainText("Categoria");
  await expect(preview(page)).not.toContainText("Peso");
  await preview(page)
    .getByRole("button", { name: "Fechar apresentação" })
    .click();
  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Excluir cinematic?" })
    .getByRole("button", { name: "Cancelar", exact: true })
    .click();
  await expect(page.locator(".card")).toHaveCount(1);
  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Excluir cinematic?" })
    .getByRole("button", { name: "Excluir", exact: true })
    .click();
  await page.reload();
  await expect(page.locator(".card")).toHaveCount(0);
});

test("exports real JSON, imports merge, confirms conflicts and rejects invalid backup atomically", async ({
  page,
}) => {
  await create(page, "O rei sem coroa");
  const downloadPending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar backup" }).click();
  const download = await downloadPending;
  const downloaded = JSON.parse(
    await readFile((await download.path())!, "utf8"),
  );
  expect(downloaded.format).toBe("ardonia-cinematic");
  expect(downloaded.cinematics).toHaveLength(1);
  expect(downloaded.cinematics[0].title).toBe("O rei sem coroa");
  const source = { ...downloaded.cinematics[0], title: "O rei coroado" };
  await importFile(
    page,
    backup([source, scene("new-scene", "O trem desperta")]),
  );
  await expect(
    page.getByRole("dialog", { name: "Importar backup?" }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Importar backup?" })
    .getByRole("button", { name: "Importar", exact: true })
    .click();
  await expect(page.locator(".card")).toHaveCount(2);
  await expect(
    page.getByRole("heading", { name: "O rei coroado" }),
  ).toBeVisible();
  await importFile(
    page,
    backup([
      scene("valid", "Não deve aparecer"),
      { ...scene("bad", "Inválido"), imageUrl: "javascript:alert(1)" },
    ]),
  );
  await expect(page.locator("#notice")).toContainText("HTTPS");
  await expect(page.locator(".card")).toHaveCount(2);
  await expect(
    page.getByRole("heading", { name: "Não deve aparecer" }),
  ).toHaveCount(0);
  await importFile(page, "{invalid json");
  await expect(page.locator("#notice")).toContainText("JSON válido");
  await page.reload();
  await expect(page.locator(".card")).toHaveCount(2);
});

test("shows empty description without empty paragraph and renders hostile text literally", async ({
  page,
}) => {
  const title = '<img src=x onerror="window.pwned=1">';
  await create(page, title);
  await page
    .getByRole("button", { name: "Pré-visualizar", exact: true })
    .click();
  await expect(
    preview(page).getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await expect(preview(page).locator(".cinematic-description")).toHaveCount(0);
  await expect(preview(page).locator("img")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as Window & { pwned?: number }).pwned),
  ).toBeUndefined();
  await page.keyboard.press("Escape");
  await expect(preview(page)).not.toBeVisible();
});

test("preserves corrupt existing data and reports failed storage without false success", async ({
  page,
}) => {
  await page.evaluate(
    (key) => localStorage.setItem(key, "corrupt"),
    libraryKey,
  );
  await page.reload();
  await expect(page.locator("#notice")).toContainText("corrompida");
  await page
    .getByRole("button", { name: "+ Nova cinematic", exact: true })
    .click();
  await page.locator("#title").fill("Não substituir");
  await page.getByRole("button", { name: "Salvar cinematic" }).click();
  await expect(page.locator("#form-error")).toContainText("corrompida");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), libraryKey),
  ).toBe("corrupt");
});

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 375, height: 812 },
  { width: 812, height: 375 },
  { width: 320, height: 568 },
]) {
  test(`fits long cinematic and usable close at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const title = "A".repeat(180);
    const description = "Uma história que atravessa eras. "
      .repeat(200)
      .slice(0, 6000);
    await create(page, title, description);
    await page
      .getByRole("button", { name: "Pré-visualizar", exact: true })
      .click();
    const dialog = preview(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".cinematic-title")).toHaveText(title);
    await expect(dialog.locator(".cinematic-description")).toHaveText(
      description.trim(),
    );
    const close = dialog.getByRole("button", { name: "Fechar apresentação" });
    const rect = await close.boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.width).toBeGreaterThanOrEqual(44);
    expect(rect!.height).toBeGreaterThanOrEqual(44);
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.y).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewport.width);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(viewport.height);
    expect(
      await dialog
        .locator(".cinematic-scroll")
        .evaluate((e) => e.scrollWidth <= e.clientWidth),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      await dialog
        .locator(".cinematic-scene")
        .evaluate((e) => getComputedStyle(e).animationName),
    ).toBe("none");
    await page.screenshot({
      path: testInfo.outputPath(
        `cinematic-${viewport.width}x${viewport.height}.png`,
      ),
    });
    await dialog.locator(".cinematic-scroll").evaluate((e) => {
      e.scrollTop = e.scrollHeight;
    });
    await expect(close).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(
        `cinematic-scrolled-${viewport.width}x${viewport.height}.png`,
      ),
    });
    await close.click();
    await expect(dialog).not.toBeVisible();
  });
}

test("image renders contained without distortion and invalid image uses visible fallback", async ({
  page,
}) => {
  await page.route("https://example.test/art.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="500"><rect width="1000" height="500" fill="#71522e"/></svg>',
    }),
  );
  await page.route("https://example.test/missing.png", (route) =>
    route.fulfill({ status: 404, body: "missing" }),
  );
  await create(page, "Arte segura", "", "https://example.test/art.svg");
  await page
    .getByRole("button", { name: "Pré-visualizar", exact: true })
    .click();
  const img = preview(page).locator(".cinematic-image");
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((e) => (e as HTMLImageElement).naturalWidth))
    .toBe(1000);
  const bounds = await img.boundingBox();
  expect(bounds!.width / bounds!.height).toBeCloseTo(2, 1);
  expect(await img.evaluate((e) => getComputedStyle(e).objectFit)).toBe(
    "contain",
  );
  await preview(page)
    .getByRole("button", { name: "Fechar apresentação" })
    .click();
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await page.locator("#image").fill("https://example.test/missing.png");
  await page.getByRole("button", { name: "Salvar cinematic" }).click();
  await page
    .getByRole("button", { name: "Pré-visualizar", exact: true })
    .click();
  await expect(
    preview(page).getByText("Imagem indisponível", { exact: true }),
  ).toBeVisible();
  await preview(page)
    .getByRole("button", { name: "Fechar apresentação" })
    .click();
});

test("rejects non-HTTPS image and keeps draft available for correction", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "+ Nova cinematic", exact: true })
    .click();
  await page.locator("#title").fill("Imagem insegura");
  await page.locator("#image").fill("http://example.test/image.png");
  await page.locator("#image").blur();
  await page.getByRole("button", { name: "Salvar cinematic" }).click();
  await expect(page.locator("#form-error")).toContainText("HTTPS");
  await expect(page.locator("#editor")).toBeVisible();
  await expect(page.locator(".card")).toHaveCount(0);
});

test("reports quota failure and does not display unsaved cinematic as saved", async ({
  page,
}) => {
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "com.ardonia.cinematic.library.v1")
        throw new DOMException("quota exceeded", "QuotaExceededError");
      original.call(this, key, value);
    };
  });
  await page
    .getByRole("button", { name: "+ Nova cinematic", exact: true })
    .click();
  await page.locator("#title").fill("Não foi salva");
  await page.getByRole("button", { name: "Salvar cinematic" }).click();
  await expect(page.locator("#form-error")).toContainText(
    "Não foi possível salvar",
  );
  await expect(page.locator("#editor")).toBeVisible();
  await expect(page.locator(".card")).toHaveCount(0);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), libraryKey),
  ).toBeNull();
});
