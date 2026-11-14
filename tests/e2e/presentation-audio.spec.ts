import { test, expect, type Page } from "@playwright/test";

/** This fake isolates the controller; audio-engine tests cover Web Audio details. */
const fakePlayer = `
window.effectTest={attempts:0,unlocks:0,stops:0,disposed:0,mode:'played',volumes:[]};
export class EffectPlayer {
  preload(){return Promise.resolve()}
  unlock(){window.effectTest.unlocks++;return Promise.resolve(true)}
  play(choice,volume){
    window.effectTest.attempts++;window.effectTest.volumes.push(volume);
    if(window.effectTest.mode==='pending')return new Promise(resolve=>window.resolveEffect=resolve);
    return Promise.resolve(window.effectTest.mode);
  }
  setVolume(){}
  stop(){window.effectTest.stops++}
  dispose(){window.effectTest.disposed++}
}`;

async function mount(
  page: Page,
  enabled: boolean,
  mode = "played",
  kind = "default",
) {
  await page.evaluate(
    async ({ enabled, mode, kind }) => {
      localStorage.setItem(
        "com.ardonia.cinematic.audio.v1",
        JSON.stringify({ enabled, volume: 0.4 }),
      );
      const { mountPresentationAudio } = await import(
        "/src/presentation-audio.ts"
      );
      (window as any).effectTest.mode = mode;
      (window as any).disposeEffect = mountPresentationAudio(
        document.querySelector("main")!,
        "test-event",
        { kind },
      );
    },
    { enabled, mode, kind },
  );
}

test.beforeEach(async ({ page }) => {
  await page.route("**/src/audio-engine.ts*", (route) =>
    route.fulfill({ contentType: "text/javascript", body: fakePlayer }),
  );
  await page.route("**/audio-controller-test.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body><main><h1>Cena visível</h1></main></body></html>',
    }),
  );
  await page.goto("/audio-controller-test.html");
});

test("plays once and changing the preference does not replay a consumed event", async ({
  page,
}) => {
  await mount(page, true);
  await expect(page.locator(".cinematic-audio-status")).toHaveText("");
  expect(await page.evaluate(() => (window as any).effectTest.attempts)).toBe(
    1,
  );
  await page
    .getByRole("button", { name: "Desativar som", exact: true })
    .click();
  await page.getByRole("button", { name: "Ativar som", exact: true }).click();
  await expect(page.locator(".cinematic-audio-status")).toContainText(
    "próximos anúncios",
  );
  expect(await page.evaluate(() => (window as any).effectTest.attempts)).toBe(
    1,
  );
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("com.ardonia.cinematic.audio.v1")!)
          .enabled,
    ),
  ).toBe(true);
  await page.evaluate(() => (window as any).disposeEffect());
  await expect(page.locator(".cinematic-audio")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).effectTest.disposed)).toBe(
    1,
  );
});

test("blocked autoplay preserves the scene and retries only after explicit interaction", async ({
  page,
}) => {
  await mount(page, true, "blocked");
  await expect(
    page.getByRole("heading", { name: "Cena visível" }),
  ).toBeVisible();
  await expect(page.locator(".cinematic-audio-status")).toContainText(
    "Som bloqueado",
  );
  expect(await page.evaluate(() => (window as any).effectTest.attempts)).toBe(
    1,
  );
  await page.evaluate(() => {
    (window as any).effectTest.mode = "played";
  });
  await page.getByRole("button", { name: "Ativar som", exact: true }).click();
  await expect(page.locator(".cinematic-audio-status")).toHaveText("");
  expect(await page.evaluate(() => (window as any).effectTest.attempts)).toBe(
    2,
  );
  expect(await page.evaluate(() => (window as any).effectTest.unlocks)).toBe(1);
});

test("muting cancels a loading effect and ignores its late result", async ({
  page,
}) => {
  await mount(page, true, "pending");
  await expect(page.locator(".cinematic-audio-status")).toContainText(
    "Preparando",
  );
  await page
    .getByRole("button", { name: "Desativar som", exact: true })
    .click();
  await page.evaluate(() => (window as any).resolveEffect("played"));
  await expect(page.locator(".cinematic-audio-status")).toContainText(
    "Som desativado",
  );
  await expect(
    page.getByRole("button", { name: "Ativar som", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).effectTest.stops),
  ).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).effectTest.attempts)).toBe(
    1,
  );
});

test("automatic audio has a deadline and never hides or closes the presentation", async ({
  page,
}) => {
  await mount(page, true, "pending");
  await expect(page.locator(".cinematic-audio-status")).toContainText(
    "demorou",
    { timeout: 2500 },
  );
  expect(
    await page.evaluate(() => (window as any).effectTest.stops),
  ).toBeGreaterThan(0);
  await page.evaluate(() => (window as any).resolveEffect("played"));
  await expect(page.locator(".cinematic-audio-status")).toContainText(
    "demorou",
  );
  await expect(
    page.getByRole("heading", { name: "Cena visível" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ativar som", exact: true }),
  ).toBeVisible();
});

test("silent cinematic does not play even when sound is enabled", async ({
  page,
}) => {
  await mount(page, true, "played", "none");
  await expect(page.locator(".cinematic-audio-status")).toContainText(
    "não usa efeito sonoro",
  );
  expect(await page.evaluate(() => (window as any).effectTest.attempts)).toBe(
    0,
  );
});

test("cross-frame preference updates never start an old scene late", async ({
  page,
}) => {
  await mount(page, false);
  await page.evaluate(() => {
    localStorage.setItem(
      "com.ardonia.cinematic.audio.v1",
      JSON.stringify({ enabled: true, volume: 0.8 }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key: "com.ardonia.cinematic.audio.v1" }),
    );
  });
  expect(await page.evaluate(() => (window as any).effectTest.attempts)).toBe(
    0,
  );
  await expect(
    page.getByRole("heading", { name: "Cena visível" }),
  ).toBeVisible();
});
