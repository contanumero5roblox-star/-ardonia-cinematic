import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const audioPreferencesKey = "com.ardonia.cinematic.audio.v1";

interface ScheduledEffect {
  volume: number;
  loop: boolean;
  pathname: string;
}

/**
 * Deterministic Web Audio scheduler double. Transport uses the real SDK, but
 * source.start observations do not prove audible output or browser autoplay.
 */
function instrumentAudio({ volume }: { volume: number }): void {
  if (localStorage.getItem("com.ardonia.cinematic.audio.v1") === null) {
    localStorage.setItem(
      "com.ardonia.cinematic.audio.v1",
      JSON.stringify({ enabled: true, volume }),
    );
  }
  class DeterministicAudioContext {
    state = "running";
    destination = {};
    resume() {
      return Promise.resolve();
    }
    close() {
      this.state = "closed";
      return Promise.resolve();
    }
    async decodeAudioData(bytes: ArrayBuffer) {
      const text = new TextDecoder();
      if (
        text.decode(bytes.slice(0, 4)) !== "RIFF" ||
        text.decode(bytes.slice(8, 12)) !== "WAVE" ||
        bytes.byteLength < 44
      ) {
        throw new Error("Expected the actual WAV effect bytes");
      }
      return { duration: 0.95 };
    }
    createGain() {
      return { gain: { value: 0 }, connect() {}, disconnect() {} };
    }
    createBufferSource() {
      let gain: { gain: { value: number } };
      return {
        buffer: undefined,
        loop: false,
        onended: null,
        connect(node: { gain: { value: number } }) {
          gain = node;
        },
        disconnect() {},
        stop() {},
        start() {
          void (window as any).recordScheduledEffect({
            volume: gain.gain.value,
            loop: this.loop,
            pathname: location.pathname,
          });
        },
      };
    }
  }
  (globalThis as any).AudioContext = DeterministicAudioContext;
}

/** This fixture implements the documented host message contract, not the OBR service. */
function simulatedHost(role: "GM" | "PLAYER", connectionId: string): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  body{margin:0;background:#15151e}#panel{border:0;width:min(100vw,520px);height:100vh}.sdk-modal{position:fixed;inset:0;width:100%;height:100%;border:0;background:#09090e}
  </style></head><body><script>
  const role=${JSON.stringify(role)},connectionId=${JSON.stringify(connectionId)};
  const clients=[];
  const host=window.host={opens:0,announcements:[],readyMessages:0,dataMessages:0,subscribed:0};
  const target=location.origin;
  const ref=btoa(target+' simulated-room');
  function addFrame(url,id){
    const frame=document.createElement('iframe'); frame.id=id;
    frame.allow='autoplay';
    if(id==='background') frame.hidden=true;
    if(id==='sdk-modal') frame.className='sdk-modal';
    const address=new URL(url,location.href);address.searchParams.set('obrref',ref);frame.src=address.href;
    const client={frame,channels:new Set()};clients.push(client);
    frame.onload=()=>frame.contentWindow.postMessage({id:'OBR_READY',data:{userId:connectionId,ref:'mock-'+id}},target);
    document.body.append(frame);return frame;
  }
  host.deliver=(channel,data,sender)=>{
    for(const client of clients){
      if(client.frame.isConnected&&client.channels.has(channel)) client.frame.contentWindow.postMessage({id:'OBR_BROADCAST_MESSAGE_'+channel,data:{data,connectionId:sender}},target);
    }
  };
  window.addEventListener('message',async event=>{
    if(event.origin!==target) return;
    const client=clients.find(c=>c.frame.contentWindow===event.source);if(!client)return;
    const message=event.data;if(!message||typeof message.id!=='string')return;
    const {id,data,nonce}=message;
    const respond=result=>event.source.postMessage({id:id+'_RESPONSE'+nonce,data:result},target);
    if(id==='OBR_BROADCAST_SUBSCRIBE'){client.channels.add(data.channel);host.subscribed++;return;}
    if(id==='OBR_BROADCAST_UNSUBSCRIBE'){client.channels.delete(data.channel);return;}
    if(id==='OBR_PLAYER_GET_CONNECTION_ID'){respond({connectionId});return;}
    if(id==='OBR_PLAYER_GET_ROLE'){respond({role});return;}
    if(id==='OBR_PARTY_GET_PLAYERS'){respond({players:[{id:'gm',connectionId:'gm-connection',role:'GM'},{id:'player',connectionId:'player-connection',role:'PLAYER'}].filter(p=>p.connectionId!==connectionId)});return;}
    if(id==='OBR_BROADCAST_SEND_MESSAGE'){
      if(data.channel.includes('/announce/'))host.announcements.push(data.data);
      if(data.channel.includes('/ready/'))host.readyMessages++;
      if(data.channel.includes('/data/'))host.dataMessages++;
      await window.relayBroadcast(data.channel,data.data,data.options?.destination||'ALL');respond({});return;
    }
    if(id==='OBR_MODAL_CLOSE'){document.getElementById('sdk-modal')?.remove();respond({});return;}
    if(id==='OBR_MODAL_OPEN'){host.opens++;addFrame(data.url,'sdk-modal');respond({});return;}
    if(id==='OBR_NOTIFICATION_SHOW'){respond({id:'notice'});return;}
    // Non-response subscriptions such as player role updates need no acknowledgement.
    if(nonce)respond({});
  });
  addFrame('/background.html','background');addFrame('/index.html','panel');
  </script></body></html>`;
}

interface Client {
  page: Page;
  connectionId: string;
  scheduled: ScheduledEffect[];
  downloaded: string[];
}
async function deliver(
  client: Client,
  channel: string,
  data: unknown,
  sender: string,
): Promise<void> {
  await client.page.evaluate(
    ({ channel, data, sender }) => {
      (window as any).host.deliver(channel, data, sender);
    },
    { channel, data, sender },
  );
}

test("real SDK with simulated hosts/audio schedules one effect per GM/mobile-player announcement and preserves visuals, privacy and mute", async ({
  browser,
}) => {
  const gmContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const playerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const clients: Client[] = [];
  const effectBytes = await readFile("public/sounds/impact.wav");
  try {
    for (const [context, role, connectionId] of [
      [gmContext, "GM", "gm-connection"],
      [playerContext, "PLAYER", "player-connection"],
    ] as const) {
      await context.addInitScript(instrumentAudio, {
        volume: role === "GM" ? 0.2 : 0.8,
      });
      const page = await context.newPage();
      const client: Client = {
        page,
        connectionId,
        scheduled: [],
        downloaded: [],
      };
      clients.push(client);
      await page.exposeFunction(
        "recordScheduledEffect",
        (event: ScheduledEffect) => {
          client.scheduled.push(event);
        },
      );
      await page.route("https://effects.example/*.wav", (route) => {
        client.downloaded.push(route.request().url());
        return route.fulfill({
          contentType: "audio/wav",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: effectBytes,
        });
      });
      await page.exposeFunction(
        "relayBroadcast",
        async (channel: string, data: unknown, destination: string) => {
          const recipients =
            destination === "LOCAL"
              ? [client]
              : clients.filter((c) => destination !== "REMOTE" || c !== client);
          await Promise.all(
            recipients.map((recipient) =>
              deliver(recipient, channel, data, connectionId),
            ),
          );
        },
      );
      await page.route("**/simulated-owlbear-host.html", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: simulatedHost(role, connectionId),
        }),
      );
      await page.goto("http://127.0.0.1:4173/simulated-owlbear-host.html");
      await expect
        .poll(() => page.evaluate(() => (window as any).host.subscribed))
        .toBeGreaterThanOrEqual(2);
    }
    const gm = clients[0];
    const player = clients[1];
    const gmPanel = gm.page.frameLocator("#panel");
    const playerPanel = player.page.frameLocator("#panel");
    await expect(
      playerPanel.getByText(
        "Você receberá os anúncios do mestre automaticamente. Pode fechar este painel.",
      ),
    ).toBeVisible();
    await expect(
      playerPanel.getByRole("button", {
        name: "+ Nova cinematic",
        exact: true,
      }),
    ).not.toBeVisible();

    // The GM chooses a shared effect by URL. Each participant keeps own volume.
    await gmPanel.locator(".audio-settings-details summary").click();
    await gmPanel.locator("#master-sound-kind").selectOption("url");
    await gmPanel
      .locator("#master-sound-url")
      .fill("https://effects.example/entrance.wav");
    await gmPanel
      .getByRole("button", { name: "Salvar efeito geral", exact: true })
      .click();

    await gmPanel
      .getByRole("button", { name: "+ Nova cinematic", exact: true })
      .click();
    await gmPanel.locator("#title").fill("O REI SEM COROA");
    await gmPanel
      .locator("#description")
      .fill("Uma presença esmagadora toma conta da sala.");
    await gmPanel
      .getByRole("button", { name: "Salvar cinematic", exact: true })
      .click();
    await gmPanel
      .getByRole("button", { name: "Anunciar", exact: true })
      .click();
    for (const client of clients) {
      await expect(
        client.page
          .frameLocator("#sdk-modal")
          .getByRole("heading", { name: "O REI SEM COROA", exact: true }),
      ).toBeVisible();
      await expect
        .poll(() =>
          client.page.evaluate(() => (window as any).host.readyMessages),
        )
        .toBeGreaterThan(0);
      await expect
        .poll(() =>
          client.page.evaluate(() => (window as any).host.dataMessages),
        )
        .toBeGreaterThan(0);
      expect(
        await client.page
          .frameLocator("#sdk-modal")
          .locator("body")
          .evaluate((body) => body.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await expect.poll(() => client.scheduled.length).toBe(1);
      expect(client.downloaded).toEqual([
        "https://effects.example/entrance.wav",
      ]);
      expect(client.scheduled[0]).toEqual({
        volume: client === gm ? 0.2 : 0.8,
        loop: false,
        pathname: "/background.html",
      });
    }
    const announced = await gm.page.evaluate(
      () => (window as any).host.announcements[0],
    );
    expect(announced.sound).toEqual({
      kind: "url",
      url: "https://effects.example/entrance.wav",
    });
    expect(JSON.stringify(announced)).not.toContain("data:audio");
    expect(JSON.stringify(announced)).not.toContain("blob:");
    await Promise.all(
      clients.map((client) =>
        deliver(
          client,
          "ardonia-cinematic/announce/v1",
          announced,
          "gm-connection",
        ),
      ),
    );
    await gm.page
      .frameLocator("#sdk-modal")
      .getByRole("button", { name: "Fechar apresentação", exact: true })
      .click();
    await expect(gm.page.locator("#sdk-modal")).toHaveCount(0);
    // Wait for a roundtrip after duplicate delivery, then assert it did not reopen.
    await gmPanel.getByRole("button", { name: "Editar", exact: true }).click();
    for (const client of clients)
      expect(await client.page.evaluate(() => (window as any).host.opens)).toBe(
        1,
      );
    for (const client of clients) expect(client.scheduled).toHaveLength(1);
    await gmPanel.locator("#title").fill("FLORESTA DOS SUSSURROS");
    await gmPanel.locator("#description").fill("");
    await gmPanel.locator("#scene-sound-kind").selectOption("url");
    await gmPanel
      .locator("#scene-sound-url")
      .fill("https://effects.example/forest.wav");
    await gmPanel
      .getByRole("button", { name: "Salvar cinematic", exact: true })
      .click();
    await gmPanel
      .getByRole("button", { name: "Anunciar", exact: true })
      .click();
    for (const client of clients) {
      await expect(
        client.page.frameLocator("#sdk-modal").getByRole("heading", {
          name: "FLORESTA DOS SUSSURROS",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        client.page
          .frameLocator("#sdk-modal")
          .locator(".cinematic-description"),
      ).toHaveCount(0);
      expect(await client.page.locator("#sdk-modal").count()).toBe(1);
      await expect.poll(() => client.scheduled.length).toBe(2);
      expect(client.downloaded).toEqual([
        "https://effects.example/entrance.wav",
        "https://effects.example/forest.wav",
      ]);
    }
    const specific = await gm.page.evaluate(
      () => (window as any).host.announcements[1],
    );
    expect(specific.sound).toEqual({
      kind: "url",
      url: "https://effects.example/forest.wav",
    });

    // Host-authenticated PLAYER sender cannot announce even with a forged role field.
    const forged = {
      ...announced,
      eventId: "11111111-1111-4111-8111-111111111111",
      sentAt: Date.now(),
      role: "GM",
      cinematic: { ...announced.cinematic, title: "FORGED" },
    };
    await Promise.all(
      clients.map((client) =>
        deliver(
          client,
          "ardonia-cinematic/announce/v1",
          forged,
          "player-connection",
        ),
      ),
    );
    // Personal audio controls live only in the main panel; the cinematic has only X.
    await expect(
      player.page.frameLocator("#sdk-modal").getByRole("button"),
    ).toHaveCount(1);
    await player.page
      .frameLocator("#sdk-modal")
      .getByRole("button", { name: "Fechar apresentação", exact: true })
      .click();
    await expect(player.page.locator("#sdk-modal")).toHaveCount(0);
    await playerPanel.locator(".audio-settings-details summary").click();
    await playerPanel
      .getByRole("button", { name: "Desativar som", exact: true })
      .click();
    await gm.page
      .frameLocator("#sdk-modal")
      .getByRole("button", { name: "Fechar apresentação", exact: true })
      .click();
    await expect(gm.page.locator("#sdk-modal")).toHaveCount(0);

    await gmPanel
      .getByRole("button", { name: "Anunciar", exact: true })
      .click();
    for (const client of clients) {
      await expect(
        client.page.frameLocator("#sdk-modal").getByRole("heading", {
          name: "FLORESTA DOS SUSSURROS",
          exact: true,
        }),
      ).toBeVisible();
      expect(await client.page.evaluate(() => (window as any).host.opens)).toBe(
        3,
      );
    }
    await expect.poll(() => gm.scheduled.length).toBe(3);
    await expect(
      player.page.frameLocator("#sdk-modal").getByRole("button"),
    ).toHaveCount(1);
    await expect(
      player.page.frameLocator("#sdk-modal").getByRole("status"),
    ).toHaveCount(0);
    expect(player.scheduled).toHaveLength(2);
    // The player's browser never receives the private library through storage.
    expect(await player.page.evaluate(() => Object.keys(localStorage))).toEqual(
      [audioPreferencesKey],
    );
    expect(
      await player.page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!),
        audioPreferencesKey,
      ),
    ).toEqual({ enabled: false, volume: 0.8 });
  } finally {
    await Promise.all([gmContext.close(), playerContext.close()]);
  }
});
