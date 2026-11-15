import { test, expect, type Page, type CDPSession } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Native AudioContext/AudioBufferSourceNode/GainNode instrumentation only in the
 * test browser. The host/room delivery are simulated; this is not an OBR room
 * or an acoustic measurement. No autoplay override or gesture-bearing evaluate.
 */
interface AudioMetric {
  kind: "context" | "start" | "stop" | "disconnect" | "ended";
  sourceId?: number;
  contextId: number;
  path: string;
  gain?: number;
  activeSources: number;
  duration?: number;
  loop?: boolean;
  naturalEnd?: boolean;
  bufferPeak?: number;
  eventId?: string;
}
function observeNativeGraph() {
  if (location.hostname !== "127.0.0.1") return;
  const Native = window.AudioContext;
  let contextSerial = 0;
  let renderedEventId: string | undefined;
  window.addEventListener("message", (event) => {
    if (
      event.data?.id ===
      "OBR_BROADCAST_MESSAGE_ardonia-cinematic/audio-rendered/v1"
    ) {
      const value = event.data?.data?.data?.eventId;
      if (typeof value === "string") renderedEventId = value;
    }
  });
  class ObservedContext extends Native {
    readonly testContextId = ++contextSerial;
    private sourceSerial = 0;
    private live = new Set<number>();
    constructor(options?: AudioContextOptions) {
      super(options);
      void (window as any).recordStressAudio({
        kind: "context",
        contextId: this.testContextId,
        path: location.pathname,
        activeSources: 0,
      });
    }
    createBufferSource() {
      const source = super.createBufferSource();
      const id = ++this.sourceSerial;
      let target: GainNode | undefined;
      let connected = false;
      let stopped = false;
      const record = (kind: AudioMetric["kind"]) => {
        let peak = 0;
        if (kind === "start" && source.buffer)
          for (const sample of source.buffer.getChannelData(0))
            peak = Math.max(peak, Math.abs(sample));
        void (window as any).recordStressAudio({
          kind,
          naturalEnd: kind === "ended" && !stopped,
          bufferPeak: kind === "start" ? peak : undefined,
          sourceId: id,
          eventId: renderedEventId,
          contextId: this.testContextId,
          path: location.pathname,
          gain: target?.gain.value,
          activeSources: this.live.size,
          duration: source.buffer?.duration,
          loop: source.loop,
        });
      };
      const connect = source.connect.bind(source);
      source.connect = ((destination: AudioNode, ...rest: number[]) => {
        if (destination instanceof GainNode) target = destination;
        connected = true;
        return (connect as any)(destination, ...rest);
      }) as AudioBufferSourceNode["connect"];
      const disconnect = source.disconnect.bind(source);
      source.disconnect = ((...args: unknown[]) => {
        connected = false;
        this.live.delete(id);
        record("disconnect");
        return (disconnect as any)(...args);
      }) as AudioBufferSourceNode["disconnect"];
      const start = source.start.bind(source);
      source.start = ((...args: Parameters<AudioBufferSourceNode["start"]>) => {
        start(...args);
        if (connected) this.live.add(id);
        record("start");
      }) as AudioBufferSourceNode["start"];
      const stop = source.stop.bind(source);
      source.stop = ((...args: Parameters<AudioBufferSourceNode["stop"]>) => {
        stop(...args);
        stopped = true;
        if (args[0] === undefined || args[0] <= this.currentTime)
          this.live.delete(id);
        record("stop");
      }) as AudioBufferSourceNode["stop"];
      source.addEventListener("ended", () => {
        this.live.delete(id);
        record("ended");
      });
      return source;
    }
  }
  window.AudioContext = ObservedContext;
}

function hostDocument(role: "GM" | "PLAYER", connectionId: string) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:0;background:#15151e}#panel{border:0;width:min(100vw,560px);height:100vh}.sdk-modal{position:fixed;inset:0;width:100%;height:100%;border:0;background:#09090e}
</style></head><body><script>
const extensionOrigin='http://127.0.0.1:4173',role=${JSON.stringify(role)},connectionId=${JSON.stringify(connectionId)};
const clients=[];const host=window.host={};const ref=btoa(location.origin+' simulated-stress-room');
function addFrame(url,id){
 const frame=document.createElement('iframe');frame.id=id;
 if(id==='background')frame.hidden=true;
 if(id==='sdk-modal')frame.className='sdk-modal';
 const address=new URL(url,extensionOrigin);address.searchParams.set('obrref',ref);frame.src=address.href;
 const client={frame,channels:new Set()};clients.push(client);
 frame.onload=()=>frame.contentWindow.postMessage({id:'OBR_READY',data:{userId:connectionId,ref:'stress-'+id}},extensionOrigin);
 document.body.append(frame);
}
host.deliver=(channel,data,sender)=>{
 for(const client of clients){if(client.frame.isConnected&&client.channels.has(channel))client.frame.contentWindow.postMessage({id:'OBR_BROADCAST_MESSAGE_'+channel,data:{data,connectionId:sender}},extensionOrigin)}
 if(channel==='ardonia-cinematic/announce/v1')document.getElementById('panel')?.remove();
};
window.addEventListener('message',async event=>{
 if(event.origin!==extensionOrigin)return;
 const client=clients.find(c=>c.frame.contentWindow===event.source);if(!client)return;
 const message=event.data;if(!message||typeof message.id!=='string')return;
 const {id,data,nonce}=message;const respond=result=>event.source.postMessage({id:id+'_RESPONSE'+nonce,data:result},extensionOrigin);
 if(id==='OBR_BROADCAST_SUBSCRIBE'){client.channels.add(data.channel);window.recordStressHost({kind:'subscription',channel:data.channel});return;}
 if(id==='OBR_BROADCAST_UNSUBSCRIBE'){client.channels.delete(data.channel);return;}
 if(id==='OBR_PLAYER_GET_CONNECTION_ID'){respond({connectionId});return;}
 if(id==='OBR_PLAYER_GET_ROLE'){respond({role});return;}
 if(id==='OBR_PARTY_GET_PLAYERS'){respond({players:[{id:'gm',connectionId:'stress-gm',role:'GM'},{id:'player',connectionId:'stress-player',role:'PLAYER'}].filter(p=>p.connectionId!==connectionId)});return;}
 if(id==='OBR_BROADCAST_SEND_MESSAGE'){await window.relayStress(data.channel,data.data,data.options?.destination||'ALL');respond({});return;}
 if(id==='OBR_MODAL_OPEN'){addFrame(data.url,'sdk-modal');window.recordStressHost({kind:'open'});respond({});return;}
 if(id==='OBR_MODAL_CLOSE'){const modal=document.getElementById('sdk-modal');modal?.remove();window.recordStressHost({kind:'close',exists:!!modal});respond({});return;}
 if(id==='OBR_NOTIFICATION_SHOW'){window.recordStressHost({kind:'notification'});respond({id:'stress-notice'});return;}
 if(nonce)respond({});
});
addFrame('/background.html','background');addFrame('/index.html','panel');
</script></body></html>`;
}
interface Client {
  page: Page;
  cdp: CDPSession;
  connectionId: string;
  metrics: AudioMetric[];
  host: Array<{ kind: string; channel?: string }>;
  volume: number;
}
async function deliver(client: Client, data: unknown) {
  await client.cdp.send("Runtime.evaluate", {
    expression: `window.host.deliver('ardonia-cinematic/announce/v1',${JSON.stringify(data)},'stress-gm')`,
    userGesture: false,
    awaitPromise: true,
  });
}
async function relay(
  client: Client,
  channel: string,
  data: unknown,
  sender: string,
) {
  await client.cdp.send("Runtime.evaluate", {
    expression: `window.host.deliver(${JSON.stringify(channel)},${JSON.stringify(data)},${JSON.stringify(sender)})`,
    userGesture: false,
    awaitPromise: true,
  });
}
const starts = (client: Client) =>
  client.metrics.filter((event) => event.kind === "start");
const pause = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

// Native timers are intentional here: five-second spacing is a requested
// acceptance condition, and source lifetime must be observed at real speed.
test("native graph keeps one source and the selected gain through slow, rapid, replaced and reopened announcements", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120000);
  const contexts = [
    await browser.newContext({ viewport: { width: 1280, height: 800 } }),
    await browser.newContext({
      viewport: { width: 375, height: 812 },
      isMobile: true,
      hasTouch: true,
    }),
  ];
  const clients: Client[] = [];
  let succeeded = false;
  const hostServer = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const role = url.searchParams.get("role") === "PLAYER" ? "PLAYER" : "GM";
    response
      .writeHead(200, { "content-type": "text/html" })
      .end(hostDocument(role, role === "GM" ? "stress-gm" : "stress-player"));
  });
  await new Promise<void>((resolve) => hostServer.listen(0, resolve));
  const origin =
    "http://localhost:" + (hostServer.address() as AddressInfo).port;
  let sequence = 0;
  function announcement(custom = false) {
    sequence++;
    return {
      version: 1,
      eventId: crypto.randomUUID(),
      sentAt: Date.now(),
      cinematic: {
        id: "stress-scene",
        title: "CENA " + sequence,
        description: "Uma descrição sem controles adicionais.",
        imageUrl: "http://127.0.0.1:4173/cena-floresta.svg",
        updatedAt: "2026-11-14T00:00:00.000Z",
      },
      sound: custom
        ? { kind: "url", url: "http://127.0.0.1:4173/sounds/impact.wav" }
        : { kind: "default" },
    };
  }
  async function send(custom = false) {
    const event = announcement(custom);
    await Promise.all(clients.map((client) => deliver(client, event)));
    return event;
  }
  async function cleanView(client: Client, title: string) {
    const modal = client.page.frameLocator("#sdk-modal");
    await expect(
      modal.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(modal.getByRole("button")).toHaveCount(1);
    await expect(
      modal.getByRole("button", { name: "Fechar apresentação", exact: true }),
    ).toBeVisible();
    await expect(
      modal.locator(".cinematic-audio, .cinematic-audio-status"),
    ).toHaveCount(0);
    await expect(modal.getByRole("status")).toHaveCount(0);
    await expect(client.page.locator("#panel")).toHaveCount(0);
  }
  async function close(client: Client) {
    const button = client.page
      .frameLocator("#sdk-modal")
      .getByRole("button", { name: "Fechar apresentação", exact: true });
    if (client === clients[1]) await button.tap();
    else await button.click();
    await expect(client.page.locator("#sdk-modal")).toHaveCount(0);
  }
  try {
    for (let i = 0; i < contexts.length; i++) {
      const context = contexts[i];
      await context.addInitScript(observeNativeGraph);
      const page = await context.newPage();
      const client: Client = {
        page,
        cdp: await context.newCDPSession(page),
        connectionId: i === 0 ? "stress-gm" : "stress-player",
        metrics: [],
        host: [],
        volume: i === 0 ? 0.36 : 0.81,
      };
      clients.push(client);
      await page.exposeFunction("recordStressAudio", (event: AudioMetric) =>
        client.metrics.push(event),
      );
      await page.exposeFunction(
        "recordStressHost",
        (event: { kind: string; channel?: string }) => client.host.push(event),
      );
      await page.exposeFunction(
        "relayStress",
        async (channel: string, data: unknown, destination: string) => {
          const recipients =
            destination === "LOCAL"
              ? [client]
              : clients.filter(
                  (other) => destination !== "REMOTE" || other !== client,
                );
          await Promise.all(
            recipients.map((recipient) =>
              relay(recipient, channel, data, client.connectionId),
            ),
          );
        },
      );
      await page.goto(origin + "/?role=" + (i === 0 ? "GM" : "PLAYER"));
      await expect
        .poll(
          () =>
            client.host.filter((event) => event.kind === "subscription").length,
        )
        .toBeGreaterThanOrEqual(2);
      const panel = page.frameLocator("#panel");
      await panel.locator(".audio-settings-details summary").click();
      await panel
        .getByRole("slider", { name: "Volume dos efeitos sonoros" })
        .fill(String(client.volume * 100));
      if (i === 0) await panel.locator(".audio-settings-toggle").click();
      else await panel.locator(".audio-settings-toggle").tap();
      await expect.poll(() => starts(client).length).toBe(1);
    }
    await pause(6500); // Expires the activation, preserving native autoplay policy.
    const spacedTimes: number[] = [];
    const spacedStart = Date.now();
    for (let i = 0; i < 5; i++) {
      await pause(spacedStart + i * 5000 - Date.now());
      spacedTimes.push(Date.now());
      const event = await send(i % 2 === 1);
      for (const client of clients) {
        await expect.poll(() => starts(client).length).toBe(i + 2);
        await cleanView(client, event.cinematic.title);
      }
      await pause(1100); // Observe natural end before closing, not merely a PID/port.
      for (const client of clients) await close(client);
    }
    for (let i = 1; i < spacedTimes.length; i++)
      expect(spacedTimes[i] - spacedTimes[i - 1]).toBeGreaterThanOrEqual(4900);
    // Ten consecutive arrivals replace still-open scenes. Old announcements may
    // be superseded, but each rendered one must remain exclusive and constant.
    const rapidBefore = clients.map((client) => starts(client).length);
    let finalEvent: ReturnType<typeof announcement> | undefined;
    for (let i = 0; i < 10; i++) {
      finalEvent = await send(i % 2 === 0);
      await pause(120);
    }
    for (let index = 0; index < clients.length; index++) {
      const client = clients[index];
      await cleanView(client, finalEvent!.cinematic.title);
      await expect
        .poll(() => starts(client).length)
        .toBeGreaterThan(rapidBefore[index]);
      expect(starts(client).length - rapidBefore[index]).toBeLessThanOrEqual(
        10,
      );
    }
    // Closing and immediately reopening must stop the playing source without
    // destroying the context; alternate reusable default/custom effects.
    for (let i = 0; i < 4; i++) {
      for (const client of clients) await close(client);
      const before = clients.map((client) => starts(client).length);
      const event = await send(i % 2 === 1);
      for (let index = 0; index < clients.length; index++) {
        await expect
          .poll(() => starts(clients[index]).length)
          .toBe(before[index] + 1);
        await cleanView(clients[index], event.cinematic.title);
      }
    }
    await pause(1100);
    for (const client of clients) await close(client);
    const summary = clients.map((client) => {
      const played = starts(client);
      const maximum = Math.max(
        ...client.metrics.map((event) => event.activeSources),
      );
      const gains = played.map((event) => event.gain);
      return {
        connectionId: client.connectionId,
        starts: played.length,
        maximumActiveSources: maximum,
        gains,
        contextCount: client.metrics.filter((event) => event.kind === "context")
          .length,
        naturalEnds: client.metrics.filter(
          (event) => event.kind === "ended" && event.naturalEnd,
        ).length,
        stops: client.metrics.filter((event) => event.kind === "stop").length,
      };
    });
    const summaryPath = testInfo.outputPath("native-audio-stress-summary.json");
    await mkdir(dirname(summaryPath), { recursive: true });
    await writeFile(
      summaryPath,
      JSON.stringify(
        {
          spacedIntervals: spacedTimes
            .slice(1)
            .map((time, index) => time - spacedTimes[index]),
          clients: summary,
        },
        null,
        2,
      ),
    );
    await testInfo.attach("native-audio-stress-summary", {
      path: summaryPath,
      contentType: "application/json",
    });
    for (let index = 0; index < clients.length; index++) {
      const client = clients[index];
      const played = starts(client);
      expect(summary[index].maximumActiveSources).toBe(1);
      expect(summary[index].contextCount).toBe(1);
      expect(summary[index].naturalEnds).toBeGreaterThanOrEqual(6);
      expect(summary[index].stops).toBeGreaterThan(0);
      for (const metric of played) {
        expect(metric.path).toBe("/background.html");
        expect(metric.gain).toBeCloseTo(client.volume, 6);
        expect(metric.bufferPeak).toBeCloseTo(played[0].bufferPeak!, 7);
        expect(metric.loop).toBe(false);
        expect(metric.duration).toBeCloseTo(0.95, 2);
      }
      const announcementIds = played.slice(1).map((metric) => metric.eventId);
      expect(announcementIds.every((id) => typeof id === "string")).toBe(true);
      expect(new Set(announcementIds).size).toBe(announcementIds.length);
      const ids = played.map(
        (metric) => metric.contextId + ":" + metric.sourceId,
      );
      expect(new Set(ids).size).toBe(ids.length);
    }
    succeeded = true;
  } finally {
    if (!succeeded)
      await testInfo.attach("native-audio-stress-diagnostic", {
        body: JSON.stringify(
          clients.map((client) => ({
            connectionId: client.connectionId,
            metrics: client.metrics,
            host: client.host,
          })),
        ),
        contentType: "application/json",
      });
    await Promise.all(contexts.map((context) => context.close()));
    await new Promise<void>((resolve) => hostServer.close(() => resolve()));
  }
});
