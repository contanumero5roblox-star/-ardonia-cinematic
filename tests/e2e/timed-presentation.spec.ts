import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

type CloseMode = "ok" | "hold" | "error" | "ignored";

interface Room {
  announce(durationSeconds: number): string;
  deliverHeldClose?: () => void;
  mode: CloseMode;
  subscribed: boolean;
  opens: Array<{ id: string; fullScreen: boolean; hidePaper: boolean }>;
  closes: Array<{ id: string; fromModal: boolean; at: number }>;
  rendered: number;
  fadeStart: number;
  almostInvisible: number;
  clicks: number;
  wheels: number;
}

declare global {
  interface Window {
    timingRoom: Room;
  }
}

// A minimal Owlbear host simulator. The real SDK runs in the background and
// presentation frames. Closing removes just the requested iframe, as opposed
// to making an arbitrary overlay disappear when any modal ID is received.
function installRoom() {
  const frames = new Map<HTMLIFrameElement, Set<string>>();
  const channel = "ardonia-cinematic/announce/v1";
  const connectionId = "participant";
  const room: Room = (window.timingRoom = {
    mode: "ok",
    subscribed: false,
    opens: [],
    closes: [],
    rendered: 0,
    fadeStart: 0,
    almostInvisible: 0,
    clicks: 0,
    wheels: 0,
    announce(durationSeconds) {
      const id = crypto.randomUUID();
      deliver(
        channel,
        {
          version: 1,
          eventId: id,
          sentAt: Date.now(),
          sound: { kind: "default" },
          cinematic: {
            id: "scene",
            title: id,
            durationSeconds,
            description: "Ardonia",
            imageUrl: "",
            updatedAt: new Date().toISOString(),
          },
        },
        "master",
      );
      return id;
    },
  });
  const map = document.querySelector("button")!;
  map.onclick = () => room.clicks++;
  map.onwheel = () => room.wheels++;

  function deliver(channel: string, data: unknown, connectionId: string) {
    for (const [frame, channels] of frames)
      if (channels.has(channel))
        frame.contentWindow?.postMessage(
          {
            id: "OBR_BROADCAST_MESSAGE_" + channel,
            data: { data, connectionId },
          },
          location.origin,
        );
  }

  function addFrame(url: string, modalId?: string) {
    const frame = document.createElement("iframe");
    if (modalId) frame.dataset.modalId = modalId;
    else frame.hidden = true;
    const src = new URL(url, location.href);
    src.searchParams.set("obrref", btoa(location.origin + " timing-room"));
    frame.src = src.href;
    frames.set(frame, new Set());
    frame.onload = () => {
      const win = frame.contentWindow!;
      if (modalId) {
        // Observe the rendered stage, not send time or OBR_MODAL_OPEN. Record
        // actual painted CSS opacity through Chromium's native compositor clock.
        const doc = frame.contentDocument!;
        const observer = new MutationObserver(() => {
          const stage = doc.querySelector(".cinematic-stage");
          if (!stage) return;
          observer.disconnect();
          room.rendered = Date.now();
          room.fadeStart = 0;
          room.almostInvisible = 0;
          function sample() {
            if (!stage!.isConnected || !frame.isConnected) return;
            const opacity = Number(win.getComputedStyle(stage!).opacity);
            if (!room.fadeStart && opacity < 0.995) room.fadeStart = Date.now();
            if (!room.almostInvisible && opacity < 0.15)
              room.almostInvisible = Date.now();
            win.requestAnimationFrame(sample);
          }
          sample();
        });
        observer.observe(doc, { childList: true, subtree: true });
      }
      win.postMessage(
        { id: "OBR_READY", data: { userId: connectionId, ref: "test" } },
        location.origin,
      );
    };
    document.body.append(frame);
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin) return;
    const frame = [...frames.keys()].find(
      (f) => f.contentWindow === event.source,
    );
    if (!frame || !event.data || typeof event.data.id !== "string") return;
    const { id, data, nonce } = event.data;
    const respond = (value: unknown = {}, error = false) =>
      frame.contentWindow?.postMessage(
        {
          id: id + (error ? "_ERROR" : "_RESPONSE") + nonce,
          data: value,
        },
        location.origin,
      );
    switch (id) {
      case "OBR_BROADCAST_SUBSCRIBE":
        frames.get(frame)!.add(data.channel);
        if (data.channel === channel) room.subscribed = true;
        break;
      case "OBR_BROADCAST_UNSUBSCRIBE":
        frames.get(frame)!.delete(data.channel);
        break;
      case "OBR_PLAYER_GET_CONNECTION_ID":
        respond({ connectionId });
        break;
      case "OBR_PARTY_GET_PLAYERS":
        respond({ players: [{ role: "GM", connectionId: "master" }] });
        break;
      case "OBR_BROADCAST_SEND_MESSAGE":
        deliver(data.channel, data.data, connectionId);
        respond();
        break;
      case "OBR_MODAL_OPEN":
        room.opens.push({
          id: data.id,
          fullScreen: data.fullScreen,
          hidePaper: data.hidePaper,
        });
        addFrame(data.url, data.id);
        respond();
        break;
      case "OBR_MODAL_CLOSE": {
        const fromModal = !!frame.dataset.modalId;
        room.closes.push({ id: data.id, fromModal, at: Date.now() });
        const close = () => {
          const target = [...frames.keys()].find(
            (f) => f.dataset.modalId === data.id,
          );
          if (target) {
            frames.delete(target);
            target.remove();
          }
        };
        if (fromModal && room.mode === "hold") room.deliverHeldClose = close;
        else if (fromModal && room.mode === "error")
          respond("close failure", true);
        else if (fromModal && room.mode === "ignored") respond();
        else {
          respond();
          close();
        }
        break;
      }
      default:
        if (nonce) respond();
    }
  });
  addFrame("/background.html");
}

async function openRoom(page: Page, virtualClock = false) {
  if (virtualClock) await page.clock.install();
  await page.route("**/timing-room.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
      <style>iframe[data-modal-id]{position:fixed;inset:0;border:0;width:100%;height:100%}button{width:130px;height:70px}</style>
      </head><body><button>Token do mapa</button></body></html>`,
    }),
  );
  await page.goto("/timing-room.html");
  await page.evaluate(installRoom);
  await expect
    .poll(() => page.evaluate(() => window.timingRoom.subscribed))
    .toBe(true);
}

const modal = "iframe[data-modal-id]";
async function announce(page: Page, seconds: number) {
  const title = await page.evaluate(
    (s) => window.timingRoom.announce(s),
    seconds,
  );
  const frame = page.frameLocator(modal);
  await expect(
    frame.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await expect(frame.getByRole("button")).toHaveCount(0);
  return title;
}

for (const seconds of [8, 10, 12, 14, 16, 20]) {
  test(`native opacity fades for the last two of ${seconds}s then the SDK releases the tabletop`, async ({
    browser,
  }, testInfo) => {
    const touch = seconds % 4 === 0;
    const context = await browser.newContext(
      touch
        ? {
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true,
          }
        : { viewport: { width: 1280, height: 800 } },
    );
    try {
      const page = await context.newPage();
      await openRoom(page);
      await announce(page, seconds);
      await expect(page.locator(modal)).toHaveCount(0, {
        timeout: (seconds + 2) * 1000,
      });
      const metrics = await page.evaluate(() => {
        const r = window.timingRoom;
        return {
          opens: r.opens,
          closes: r.closes.filter((c) => c.fromModal),
          rendered: r.rendered,
          fadeMs: r.fadeStart - r.rendered,
          faintMs: r.almostInvisible - r.rendered,
        };
      });
      await writeFile(
        testInfo.outputPath("native-timing.json"),
        JSON.stringify({ seconds, ...metrics }, null, 2),
      );
      expect(metrics.opens).toHaveLength(1);
      expect(metrics.opens[0]).toMatchObject({
        fullScreen: true,
        hidePaper: true,
      });
      expect(metrics.closes).toHaveLength(1);
      expect(metrics.closes[0].id).toBe(metrics.opens[0].id);
      const durationMs = seconds * 1000;
      // CSS opacity is sampled once per native frame; allow scheduling jitter.
      expect(metrics.fadeMs).toBeGreaterThanOrEqual(durationMs - 2100);
      expect(metrics.fadeMs).toBeLessThan(durationMs - 1500);
      expect(metrics.faintMs).toBeGreaterThan(metrics.fadeMs + 900);
      expect(metrics.closes[0].at - metrics.rendered).toBeGreaterThanOrEqual(
        durationMs - 30,
      );
      expect(metrics.closes[0].at - metrics.rendered).toBeLessThan(
        durationMs + 600,
      );
      const map = page.getByRole("button", { name: "Token do mapa" });
      if (touch) await map.tap();
      else {
        await map.click();
        await map.hover();
        await page.mouse.wheel(0, 50);
        await expect
          .poll(() => page.evaluate(() => window.timingRoom.wheels))
          .toBe(1);
      }
      expect(await page.evaluate(() => window.timingRoom.clicks)).toBe(1);
    } finally {
      await context.close();
    }
  });
}

test("replacement gets its full duration and a late SDK close cannot remove the next modal", async ({
  page,
}) => {
  await openRoom(page, true);
  await announce(page, 20);
  await page.clock.fastForward(5000);
  await announce(page, 8);
  await page.evaluate(() => {
    window.timingRoom.mode = "hold";
  });
  await page.clock.fastForward(7300);
  const oldId = await page.evaluate(() => window.timingRoom.opens[0].id);
  expect(
    await page.evaluate(() =>
      window.timingRoom.closes.filter((c) => c.fromModal),
    ),
  ).toHaveLength(0);
  await page.clock.fastForward(800);
  await expect
    .poll(() => page.evaluate(() => !!window.timingRoom.deliverHeldClose))
    .toBe(true);
  const middleId = await page.evaluate(() => window.timingRoom.opens[1].id);
  expect(oldId).not.toBe(middleId);
  // A close message for the 8s modal is already in flight. The background
  // replaces it immediately; then the host processes that delayed message.
  await page.evaluate(() => {
    window.timingRoom.mode = "ok";
  });
  const last = await announce(page, 14);
  await page.evaluate(() => window.timingRoom.deliverHeldClose!());
  await page.clock.fastForward(13000);
  await expect(
    page.frameLocator(modal).getByRole("heading", { name: last }),
  ).toBeVisible();
  await page.clock.fastForward(1200);
  await expect(page.locator(modal)).toHaveCount(0);
  const { ids, closes } = await page.evaluate(() => ({
    ids: window.timingRoom.opens.map((o) => o.id),
    closes: window.timingRoom.closes
      .filter((c) => c.fromModal)
      .map((c) => c.id),
  }));
  expect(new Set(ids).size).toBe(3);
  expect(closes).toEqual(ids.slice(1));
});

test("reloading the presentation preserves the original deadline", async ({
  page,
}) => {
  await openRoom(page, true);
  const title = await announce(page, 12);
  await page.clock.fastForward(7000);
  const frame = page
    .frames()
    .find((f) => f.url().includes("/presentation.html"))!;
  // A browser with CSS animations but no Web Animations API still has to
  // release the tabletop. Remove the optional API in the reloaded frame.
  await page.addInitScript(() => {
    if (location.pathname === "/presentation.html")
      Object.defineProperty(Element.prototype, "getAnimations", {
        value: undefined,
      });
  });
  // Lose any document-local history state to exercise the background handshake.
  await frame.evaluate(() => history.replaceState(null, ""));
  await frame.goto(frame.url());
  await expect(
    page.frameLocator(modal).getByRole("heading", { name: title }),
  ).toBeVisible();
  await page.clock.fastForward(4350);
  await expect(page.locator(modal)).toHaveCount(1);
  await page.clock.fastForward(850);
  await expect(page.locator(modal)).toHaveCount(0);
});

for (const mode of ["error", "ignored", "hold"] as const) {
  test(`bounded recovery after ${mode} SDK close exposes a working manual retry`, async ({
    page,
  }) => {
    await openRoom(page, true);
    await announce(page, 8);
    await page.evaluate((mode) => {
      window.timingRoom.mode = mode;
    }, mode);
    await page.clock.fastForward(8100);
    await expect
      .poll(() =>
        page.evaluate(
          () => window.timingRoom.closes.filter((x) => x.fromModal).length,
        ),
      )
      .toBe(1);
    await page.clock.fastForward(1100);
    await expect
      .poll(() =>
        page.evaluate(
          () => window.timingRoom.closes.filter((x) => x.fromModal).length,
        ),
      )
      .toBe(2);
    await page.clock.fastForward(1100);
    const retry = page
      .frameLocator(modal)
      .getByRole("button", { name: /fechar/i });
    await expect(retry).toBeVisible();
    await page.clock.fastForward(20000);
    expect(
      await page.evaluate(
        () => window.timingRoom.closes.filter((x) => x.fromModal).length,
      ),
    ).toBe(2);
    await page.evaluate(() => {
      window.timingRoom.mode = "ok";
    });
    await retry.click();
    await expect(page.locator(modal)).toHaveCount(0);
    await page.getByRole("button", { name: "Token do mapa" }).click();
  });
}

test("Chromium page freeze across the deadline closes the modal on resume", async ({
  page,
}) => {
  await openRoom(page);
  await announce(page, 8);
  const session = await page.context().newCDPSession(page);
  await session.send("Page.setWebLifecycleState", { state: "frozen" });
  try {
    // Node's timer continues while Chromium suspends timers in the page.
    await new Promise((resolve) => setTimeout(resolve, 8500));
  } finally {
    await session.send("Page.setWebLifecycleState", { state: "active" });
  }
  await expect(page.locator(modal)).toHaveCount(0, { timeout: 2500 });
  expect(
    await page.evaluate(
      () => window.timingRoom.closes.filter((c) => c.fromModal).length,
    ),
  ).toBe(1);
});

test("local preview stays open past the selected duration and remains dismissible", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/");
  await page
    .getByRole("button", { name: "+ Nova cinematic", exact: true })
    .click();
  await page.locator("#title").fill("Prévia no painel");
  await page.getByLabel("Duração da apresentação").selectOption("8");
  await page.locator("#preview-draft").click();
  await page.clock.fastForward(21000);
  const preview = page.getByRole("dialog", {
    name: "Pré-visualização da cinematic",
  });
  await expect(
    preview.getByRole("heading", { name: "Prévia no painel" }),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Fechar apresentação" }).click();
  await expect(preview).toBeHidden();
  await expect(page.locator("#editor")).toBeVisible();
});
