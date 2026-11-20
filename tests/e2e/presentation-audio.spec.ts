import { test, expect, type Page } from "@playwright/test";

/** Transport doubles isolate lifecycle handling; the real renderer is unchanged. */
const fakeBridge = `
export const AUDIO_RENDERED='ardonia-cinematic/audio-rendered/v1';
export const AUDIO_STOP='ardonia-cinematic/audio-stop/v1';
window.backgroundTest={available:true,stops:[],throwOnStop:false};
const bridge={stop:id=>{
  if(window.backgroundTest.throwOnStop)throw new Error('Background restarted');
  window.backgroundTest.stops.push(id);
}};
export function findAudioBridge(){return window.backgroundTest.available?bridge:undefined}
`;
const fakeSdk = `
window.sdkTest={available:true,messages:[],fail:false};
export default {
  get isAvailable(){return window.sdkTest.available},
  broadcast:{sendMessage(channel,data,options){
    window.sdkTest.messages.push({channel,data,options});
    return window.sdkTest.fail?Promise.reject(new Error('Autoplay/transport blocked')):Promise.resolve();
  }}
};
`;

async function mount(
  page: Page,
  description = "O vento desaparece.",
  eventId = "test-event",
) {
  await page.evaluate(
    async ({ description, eventId }) => {
      const { renderPresentation } = await import("/src/presentation-view.ts");
      const { mountPresentationAudio } = await import(
        "/src/presentation-audio.ts"
      );
      const root = document.querySelector<HTMLElement>("main")!;
      const cleanupVisual = renderPresentation(root, {
        id: "scene",
        title: "Floresta dos Sussurros",
        description,
        imageUrl: "/cena-floresta.svg",
        durationSeconds: 14,
        updatedAt: "2026-11-14T00:00:00.000Z",
      });
      const cleanupAudio = mountPresentationAudio(
        root.querySelector<HTMLElement>(".cinematic-stage")!,
        eventId,
        { kind: "default" },
      );
      (window as any).disposeEffect = cleanupAudio;
      (window as any).disposeScene = () => {
        cleanupAudio();
        cleanupVisual();
      };
    },
    { description, eventId },
  );
}
async function renderedCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as any).sdkTest.messages.filter((m: any) =>
        m.channel.includes("audio-rendered"),
      ).length,
  );
}

test.beforeEach(async ({ page }) => {
  await page.route("**/src/audio-bridge.ts*", (route) =>
    route.fulfill({ contentType: "text/javascript", body: fakeBridge }),
  );
  await page.route("**/@owlbear-rodeo_sdk.js*", (route) =>
    route.fulfill({ contentType: "text/javascript", body: fakeSdk }),
  );
  await page.route("**/audio-controller-test.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}main{height:100dvh}</style></head><body><main></main></body></html>',
    }),
  );
  await page.goto("/audio-controller-test.html");
});

test("announced presentation shows image, title and description without controls while signalling audio once", async ({
  page,
}) => {
  const engineRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/src/audio-engine.ts"))
      engineRequests.push(request.url());
  });
  await mount(page);
  await expect.poll(() => renderedCount(page)).toBe(1);
  await expect(
    page.getByRole("heading", { name: "Floresta dos Sussurros" }),
  ).toBeVisible();
  await expect(page.locator(".cinematic-image")).toBeVisible();
  await expect(page.locator(".cinematic-description")).toHaveText(
    "O vento desaparece.",
  );
  await expect(page.getByRole("button")).toHaveCount(0);
  await expect(page.locator('[role="status"],.cinematic-audio')).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(
    /Ativar som|Desativar som|Ouvir só este anúncio/,
  );
  expect(engineRequests).toEqual([]);
  expect(
    await page.evaluate(() => (window as any).sdkTest.messages[0]),
  ).toEqual({
    channel: "ardonia-cinematic/audio-rendered/v1",
    data: { eventId: "test-event" },
    options: { destination: "LOCAL" },
  });
});

test("audio transport failure adds no controls or status and never prevents visual cleanup", async ({
  page,
}) => {
  await page.evaluate(async () => {
    await import("/src/audio-bridge.ts");
    await import("/src/presentation-audio.ts");
    (window as any).sdkTest.fail = true;
  });
  await mount(page);
  await expect.poll(() => renderedCount(page)).toBe(1);
  await expect(
    page.getByRole("heading", { name: "Floresta dos Sussurros" }),
  ).toBeVisible();
  await expect(page.locator('[role="status"],.cinematic-audio')).toHaveCount(0);
  await page.evaluate(() => (window as any).disposeScene());
  await expect(page.locator(".cinematic-stage")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as any).backgroundTest.stops),
  ).toEqual(["test-event"]);
});

test("cleanup cancels an unrendered frame and stops only its event without changing the DOM", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const { mountPresentationAudio } = await import(
      "/src/presentation-audio.ts"
    );
    document.querySelector("main")!.textContent = "Cena intacta";
    const dispose = mountPresentationAudio(
      document.querySelector("main")!,
      "closed-before-render",
      { kind: "default" },
    );
    dispose();
    dispose();
  });
  await expect(page.locator("main")).toHaveText("Cena intacta");
  expect(await renderedCount(page)).toBe(0);
  expect(
    await page.evaluate(() => (window as any).backgroundTest.stops),
  ).toEqual(["closed-before-render"]);
  expect(await page.evaluate(() => (window as any).sdkTest.messages)).toEqual([
    {
      channel: "ardonia-cinematic/audio-stop/v1",
      data: { eventId: "closed-before-render" },
      options: { destination: "LOCAL" },
    },
  ]);
});

test("an isolated or restarted bridge uses SDK stop without adding fallback audio UI", async ({
  page,
}) => {
  await mount(page);
  await expect.poll(() => renderedCount(page)).toBe(1);
  await page.evaluate(() => {
    (window as any).backgroundTest.throwOnStop = true;
    (window as any).disposeEffect();
  });
  await expect(
    page.getByRole("heading", { name: "Floresta dos Sussurros" }),
  ).toBeVisible();
  await expect(page.getByRole("button")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as any).sdkTest.messages.at(-1)),
  ).toEqual({
    channel: "ardonia-cinematic/audio-stop/v1",
    data: { eventId: "test-event" },
    options: { destination: "LOCAL" },
  });
});

test("standalone lifecycle stays inert and leaves empty-description presentation clean", async ({
  page,
}) => {
  await page.evaluate(async () => {
    await import("/src/presentation-audio.ts");
    (window as any).sdkTest.available = false;
  });
  await mount(page, "");
  await expect(page.locator(".cinematic-description")).toHaveCount(0);
  await expect(page.getByRole("button")).toHaveCount(0);
  await expect(page.locator('[role="status"],.cinematic-audio')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).sdkTest.messages)).toEqual(
    [],
  );
});
