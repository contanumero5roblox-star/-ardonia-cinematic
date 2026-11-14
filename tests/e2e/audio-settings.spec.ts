import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const preferencesKey = "com.ardonia.cinematic.audio.v1";
const masterKey = "com.ardonia.cinematic.master-sound.v1";
test("real user click starts the original Web Audio effect, persists individual controls and allows a manual test while muted", async ({
  page,
}) => {
  await page.addInitScript(() => {
    // Instrument native scheduling, preserving real decoder, context and autoplay policy.
    (window as any).scheduledEffects = [];
    const original = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = original.call(this);
      const start = source.start.bind(source);
      source.start = ((...args: Parameters<AudioBufferSourceNode["start"]>) => {
        (window as any).scheduledEffects.push({
          state: this.state,
          duration: source.buffer?.duration,
          loop: source.loop,
        });
        start(...args);
      }) as AudioBufferSourceNode["start"];
      return source;
    };
  });
  await page.goto("/");
  expect(
    await page.evaluate(() => (window as any).scheduledEffects.length),
  ).toBe(0);
  await page.getByText("Som de entrada", { exact: false }).first().click();
  await page.locator(".audio-settings-toggle").click();
  await expect(page.locator(".audio-settings-status")).toContainText(
    "Efeito testado",
  );
  const first = await page.evaluate(() => (window as any).scheduledEffects);
  expect(first).toHaveLength(1);
  expect(first[0].state).toBe("running");
  expect(first[0].duration).toBeCloseTo(0.95, 2);
  expect(first[0].loop).toBe(false);
  await page.locator(".audio-settings-toggle").click();
  await expect(page.locator(".audio-settings-toggle")).toHaveText("Ativar som");
  await page
    .getByRole("slider", { name: "Volume dos efeitos sonoros" })
    .fill("23");
  await page
    .getByRole("button", { name: "Testar efeito", exact: true })
    .click();
  await expect(page.locator(".audio-settings-status")).toContainText(
    "Efeito testado",
  );
  expect(
    await page.evaluate(() => (window as any).scheduledEffects.length),
  ).toBe(2);
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      preferencesKey,
    ),
  ).toEqual({ enabled: false, volume: 0.23 });
  await page.reload();
  await page.locator(".audio-settings-details summary").click();
  await expect(page.locator(".audio-settings-toggle")).toHaveText("Ativar som");
  await expect(
    page.getByRole("slider", { name: "Volume dos efeitos sonoros" }),
  ).toHaveValue("23");
  expect(
    await page.evaluate(() => (window as any).scheduledEffects.length),
  ).toBe(0);
});

test("master selects, tests, saves and resets a custom effect, with per-scene overrides preserved in backups", async ({
  page,
}) => {
  const wav = await readFile("public/sounds/impact.wav");
  await page.route("https://audio.example.test/impact.wav", (route) =>
    route.fulfill({
      contentType: "audio/wav",
      body: wav,
      headers: { "Access-Control-Allow-Origin": "*" },
    }),
  );
  await page.goto("/");
  await page.locator(".audio-settings-details summary").click();
  await page.locator("#master-sound-kind").selectOption("url");
  await page
    .locator("#master-sound-url")
    .fill("https://audio.example.test/impact.wav");
  await page
    .getByRole("button", { name: "Testar efeito", exact: true })
    .click();
  await expect(page.locator(".audio-settings-status")).toContainText(
    "Efeito testado",
  );
  await page
    .getByRole("button", { name: "Salvar efeito geral", exact: true })
    .click();
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      masterKey,
    ),
  ).toEqual({ kind: "url", url: "https://audio.example.test/impact.wav" });
  await page
    .getByRole("button", { name: "+ Nova cinematic", exact: true })
    .click();
  await page.locator("#title").fill("Uma cena silenciosa");
  await page.locator("#scene-sound-kind").selectOption("none");
  await page
    .getByRole("button", { name: "Testar efeito da cinematic" })
    .click();
  await expect(page.locator("#form-error")).toContainText("sem efeito");
  await page.getByRole("button", { name: "Salvar cinematic" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await expect(page.locator("#scene-sound-kind")).toHaveValue("none");
  await page
    .getByRole("button", { name: "Fechar editor", exact: true })
    .click();
  await page.locator(".audio-settings-details summary").click();
  await page
    .getByRole("button", { name: "Voltar ao efeito padrão", exact: true })
    .click();
  await expect(page.locator("#master-sound-kind")).toHaveValue("default");
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      masterKey,
    ),
  ).toEqual({ kind: "default" });
});

test("invalid custom audio reports an error without affecting saved cinematics", async ({
  page,
}) => {
  await page.route("https://audio.example.test/broken.mp3", (route) =>
    route.fulfill({
      status: 200,
      contentType: "audio/mpeg",
      body: "not audio",
    }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "+ Nova cinematic", exact: true })
    .click();
  await page.locator("#title").fill("A cena continua");
  await page.locator("#scene-sound-kind").selectOption("url");
  await page
    .locator("#scene-sound-url")
    .fill("https://audio.example.test/broken.mp3");
  await page
    .getByRole("button", { name: "Testar efeito da cinematic" })
    .click();
  await expect(page.locator("#form-error")).toContainText("Áudio inválido");
  await page.getByRole("button", { name: "Salvar cinematic" }).click();
  await page
    .getByRole("button", { name: "Pré-visualizar", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "Pré-visualização da cinematic" })
      .getByRole("heading", { name: "A cena continua" }),
  ).toBeVisible();
});
