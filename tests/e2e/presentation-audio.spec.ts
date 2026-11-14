import { test, expect, type Page } from "@playwright/test";

/** Controller/transport doubles isolate modal state. Native persistence has a separate regression. */
const fakeBridge = `
export const AUDIO_RENDERED='ardonia-cinematic/audio-rendered/v1';
export const AUDIO_STOP='ardonia-cinematic/audio-stop/v1';
export const AUDIO_STATUS='ardonia-cinematic/audio-status/v1';
window.backgroundTest={available:true,consumed:false,activations:0,activationWasReal:false,stops:[],volumeUpdates:[],auto:'ready',state:{enabled:true,volume:.4,ready:true,phase:'ready',message:''}};
const bridge={version:1,scope:location.origin+'/',
  status:()=>({...window.backgroundTest.state}),
  consumed:()=>window.backgroundTest.consumed,
  stop:id=>{window.backgroundTest.stops.push(id)},
  activate:()=>{window.backgroundTest.activations++;window.backgroundTest.activationWasReal=navigator.userActivation.isActive;window.backgroundTest.state={enabled:true,volume:.4,ready:true,phase:'ready',message:'Pronto nesta sessão.'};return Promise.resolve(bridge.status())},
  test:()=>Promise.resolve(bridge.status()),
  updatePreferences:p=>{window.backgroundTest.state={...window.backgroundTest.state,...p};window.backgroundTest.volumeUpdates.push(p.volume);return bridge.status()},
  subscribe:()=>()=>{},
};
export function findAudioBridge(){return window.backgroundTest.available?bridge:undefined}
`;
const fakeSdk = `
const listeners=new Map();
window.sdkTest={messages:[],stopAck:true};
window.emitAudioStatus=(data,sender='self')=>{for(const listener of listeners.values())listener({connectionId:sender,data})};
export default {isAvailable:true,player:{getConnectionId:()=>Promise.resolve('self')},broadcast:{
  onMessage(channel,callback){listeners.set(channel,callback);return()=>listeners.delete(channel)},
  sendMessage(channel,data,options){
    window.sdkTest.messages.push({channel,data,options});
    const state=window.backgroundTest;
    if(channel.includes('audio-rendered')){
      state.consumed=state.auto==='ready';
      window.emitAudioStatus({eventId:data.eventId,consumed:state.consumed,status:state.state});
    }
    if(channel.includes('audio-stop')&&window.sdkTest.stopAck){
      window.emitAudioStatus({eventId:data.eventId,requestId:data.requestId,stopped:true,consumed:state.consumed,status:state.state});
    }
    return Promise.resolve();
  }
}};
`;
const fakePlayer = `
window.effectTest={created:0,attempts:0,unlocks:0,stops:0,disposed:0};
export class EffectPlayer {
  constructor(){window.effectTest.created++}
  unlock(){window.effectTest.unlocks++;return Promise.resolve(true)}
  play(){window.effectTest.attempts++;return Promise.resolve('played')}
  setVolume(){}
  stop(){window.effectTest.stops++}
  dispose(){window.effectTest.disposed++}
}
`;

async function mount(
  page: Page,
  mode: "ready" | "blocked" = "ready",
  sound = "default",
) {
  await page.evaluate(
    async ({ mode, sound }) => {
      const module = await import("/src/presentation-audio.ts");
      const bg = (window as any).backgroundTest;
      bg.auto = mode;
      bg.state = {
        enabled: true,
        volume: 0.4,
        ready: mode === "ready",
        phase: mode,
        message:
          mode === "ready"
            ? ""
            : "Som bloqueado pelo navegador. A sessão não foi liberada.",
      };
      (window as any).disposeEffect = module.mountPresentationAudio(
        document.querySelector("main")!,
        "test-event",
        { kind: sound },
      );
    },
    { mode, sound },
  );
}
test.beforeEach(async ({ page }) => {
  await page.route("**/src/audio-bridge.ts*", (route) =>
    route.fulfill({ contentType: "text/javascript", body: fakeBridge }),
  );
  await page.route("**/src/audio-engine.ts*", (route) =>
    route.fulfill({ contentType: "text/javascript", body: fakePlayer }),
  );
  await page.route("**/@owlbear-rodeo_sdk.js*", (route) =>
    route.fulfill({ contentType: "text/javascript", body: fakeSdk }),
  );
  await page.route("**/audio-controller-test.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body><main><h1>Cena visível</h1></main></body></html>',
    }),
  );
  await page.goto("/audio-controller-test.html");
});

test("normal presentation signals the persistent owner and never creates a modal AudioContext", async ({
  page,
}) => {
  await mount(page);
  await expect(
    page.getByRole("button", { name: "Desativar som", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).sdkTest.messages.filter((m: any) =>
            m.channel.includes("audio-rendered"),
          ).length,
      ),
    )
    .toBe(1);
  expect(await page.evaluate(() => (window as any).effectTest.created)).toBe(0);
  await page.evaluate(() => (window as any).disposeEffect());
  expect(
    await page.evaluate(() => (window as any).backgroundTest.stops),
  ).toEqual(["test-event"]);
  expect(await page.evaluate(() => (window as any).effectTest.disposed)).toBe(
    0,
  );
  await expect(
    page.getByRole("heading", { name: "Cena visível" }),
  ).toBeVisible();
  await mount(page);
  expect(await page.evaluate(() => (window as any).effectTest.created)).toBe(0);
});

test("blocked autoplay is truthful and a real activation click targets the persistent bridge", async ({
  page,
}) => {
  await mount(page, "blocked");
  await expect(page.locator(".cinematic-audio-status")).toContainText(
    "não foi liberada",
  );
  await page.getByRole("button", { name: "Ativar som", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Desativar som", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).backgroundTest.activations),
  ).toBe(1);
  expect(
    await page.evaluate(() => (window as any).backgroundTest.activationWasReal),
  ).toBe(true);
  expect(await page.evaluate(() => (window as any).effectTest.created)).toBe(0);
});

test("ignores foreign statuses and keeps the visual scene independent of audio errors", async ({
  page,
}) => {
  await mount(page, "blocked");
  await page.evaluate(() => {
    const status = {
      enabled: true,
      volume: 0.9,
      ready: true,
      phase: "ready",
      message: "FORGED",
    };
    (window as any).emitAudioStatus(
      { eventId: "test-event", status },
      "remote",
    );
    (window as any).emitAudioStatus({ eventId: "other-event", status }, "self");
  });
  await expect(page.locator(".cinematic-audio-status")).not.toContainText(
    "FORGED",
  );
  await expect(
    page.getByRole("heading", { name: "Cena visível" }),
  ).toBeVisible();
});

test("manual fallback first stops the background and does not claim session activation", async ({
  page,
}) => {
  await mount(page, "blocked");
  await page.getByRole("button", { name: "Ouvir só este anúncio" }).click();
  await expect(page.locator(".cinematic-audio-status")).toContainText(
    "somente nesta entrada",
  );
  expect(
    await page.evaluate(() => (window as any).backgroundTest.stops),
  ).toEqual(["test-event"]);
  expect(await page.evaluate(() => (window as any).effectTest.attempts)).toBe(
    1,
  );
  expect(
    await page.evaluate(() => (window as any).backgroundTest.activations),
  ).toBe(0);
  await page
    .getByRole("button", { name: "Desativar som", exact: true })
    .click();
  await page.getByRole("button", { name: "Ativar som", exact: true }).click();
  expect(await page.evaluate(() => (window as any).effectTest.attempts)).toBe(
    1,
  );
  expect(
    await page.evaluate(() => (window as any).backgroundTest.activations),
  ).toBe(0);
  await expect(
    page.getByRole("button", { name: "Ouvir só este anúncio" }),
  ).not.toBeVisible();
});

test("isolated fallback refuses playback without a background cancellation acknowledgement", async ({
  page,
}) => {
  await mount(page, "blocked");
  await expect(
    page.getByRole("button", { name: "Ouvir só este anúncio" }),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as any).backgroundTest.available = false;
    (window as any).sdkTest.stopAck = false;
  });
  await page.getByRole("button", { name: "Ouvir só este anúncio" }).click();
  await expect(page.locator(".cinematic-audio-status")).toContainText(
    "nenhum som manual foi tocado",
    { timeout: 3500 },
  );
  expect(await page.evaluate(() => (window as any).effectTest.attempts)).toBe(
    0,
  );
  await expect(
    page.getByRole("heading", { name: "Cena visível" }),
  ).toBeVisible();
});

test("mute and live volume update the owner without replaying an old announcement", async ({
  page,
}) => {
  await mount(page);
  await page
    .getByRole("button", { name: "Desativar som", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Ativar som", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem(
      "com.ardonia.cinematic.audio.v1",
      JSON.stringify({ enabled: false, volume: 0.2 }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key: "com.ardonia.cinematic.audio.v1" }),
    );
  });
  expect(
    await page.evaluate(() => (window as any).backgroundTest.volumeUpdates),
  ).toContain(0.2);
  expect(await page.evaluate(() => (window as any).effectTest.created)).toBe(0);
});

test("an isolated muted client can explicitly choose manual playback without claiming session readiness", async ({
  page,
}) => {
  await mount(page, "blocked");
  await page.evaluate(() => {
    const test = (window as any).backgroundTest;
    test.available = false;
    test.state = {
      ...test.state,
      enabled: false,
      phase: "disabled",
      ready: false,
    };
    (window as any).emitAudioStatus({
      eventId: "test-event",
      consumed: false,
      status: test.state,
    });
  });
  await expect(
    page.getByRole("button", { name: "Ouvir só este anúncio" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Ativar som", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Ouvir só este anúncio" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ouvir só este anúncio" }).click();
  await expect(page.locator(".cinematic-audio-status")).toContainText(
    "somente nesta entrada",
  );
  expect(await page.evaluate(() => (window as any).effectTest.attempts)).toBe(
    1,
  );
  expect(
    await page.evaluate(() => (window as any).backgroundTest.activations),
  ).toBe(0);
  await expect(
    page.getByRole("button", { name: "Desativar som", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Desativar som", exact: true })
    .click();
  expect(
    await page.evaluate(() => (window as any).effectTest.stops),
  ).toBeGreaterThan(0);
});
