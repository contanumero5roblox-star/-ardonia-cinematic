import { test, expect, type Page, type CDPSession } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Real Chromium/Web Audio and real SDK, with a simulated Owlbear host/server.
 * No autoplay override and no userGesture=true evaluation is used. The host is
 * localhost on an ephemeral port while extension frames are 127.0.0.1:4173,
 * reproducing a cross-site parent. Third-party storage remains browser-controlled.
 * This proves API scheduling, not physical loudspeakers or a real Owlbear room.
 */
interface Metric {
  kind: "context" | "start";
  contextId: number;
  path: string;
  state: string;
  active: boolean;
  sticky: boolean;
  duration?: number;
  loop?: boolean;
}
function instrumentNativeAudio() {
  if (location.hostname !== "127.0.0.1") return;
  const Native = window.AudioContext;
  let serial = 0;
  class ObservedAudioContext extends Native {
    readonly probeId = ++serial;
    constructor(options?: AudioContextOptions) {
      super(options);
      void (window as any).recordNativeAudio({
        kind: "context",
        contextId: this.probeId,
        path: location.pathname,
        state: this.state,
        active: navigator.userActivation.isActive,
        sticky: navigator.userActivation.hasBeenActive,
      });
    }
    createBufferSource(): AudioBufferSourceNode {
      const source = super.createBufferSource();
      const start = source.start.bind(source);
      source.start = ((...args: Parameters<AudioBufferSourceNode["start"]>) => {
        void (window as any).recordNativeAudio({
          kind: "start",
          contextId: this.probeId,
          path: location.pathname,
          state: this.state,
          active: navigator.userActivation.isActive,
          sticky: navigator.userActivation.hasBeenActive,
          duration: source.buffer?.duration,
          loop: source.loop,
        });
        start(...args);
      }) as AudioBufferSourceNode["start"];
      return source;
    }
  }
  window.AudioContext = ObservedAudioContext;
}

function hostHtml(role: "GM" | "PLAYER", connectionId: string) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:0;background:#15151e}#panel{border:0;width:min(100vw,560px);height:100vh}.sdk-modal{position:fixed;inset:0;width:100%;height:100%;border:0;background:#09090e}
</style></head><body><script>
const extensionOrigin='http://127.0.0.1:4173',role=${JSON.stringify(role)},connectionId=${JSON.stringify(connectionId)};
const clients=[];let closeNumber=0;
const host=window.host={opens:0,subscriptions:0};
const ref=btoa(location.origin+' simulated-audio-room');
function addFrame(url,id){
 const frame=document.createElement('iframe');frame.id=id;
 if(id==='background')frame.hidden=true;
 if(id==='sdk-modal')frame.className='sdk-modal';
 // Deliberately no allow=autoplay; activation must be observed rather than assumed.
 const address=new URL(url,extensionOrigin);address.searchParams.set('obrref',ref);frame.src=address.href;
 const client={frame,channels:new Set()};clients.push(client);
 frame.onload=()=>frame.contentWindow.postMessage({id:'OBR_READY',data:{userId:connectionId,ref:'native-'+id}},extensionOrigin);
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
 const {id,data,nonce}=message;
 const respond=result=>event.source.postMessage({id:id+'_RESPONSE'+nonce,data:result},extensionOrigin);
 if(id==='OBR_BROADCAST_SUBSCRIBE'){client.channels.add(data.channel);host.subscriptions++;window.recordHost({kind:'subscription',channel:data.channel});return;}
 if(id==='OBR_BROADCAST_UNSUBSCRIBE'){client.channels.delete(data.channel);return;}
 if(id==='OBR_PLAYER_GET_CONNECTION_ID'){respond({connectionId});return;}
 if(id==='OBR_PLAYER_GET_ROLE'){respond({role});return;}
 if(id==='OBR_PARTY_GET_PLAYERS'){respond({players:[{id:'gm',connectionId:'native-gm',role:'GM'},{id:'player',connectionId:'native-player',role:'PLAYER'}].filter(p=>p.connectionId!==connectionId)});return;}
 if(id==='OBR_BROADCAST_SEND_MESSAGE'){await window.relayNative(data.channel,data.data,data.options?.destination||'ALL');respond({});return;}
 if(id==='OBR_MODAL_OPEN'){host.opens++;addFrame(data.url,'sdk-modal');window.recordHost({kind:'open'});respond({});return;}
 if(id==='OBR_MODAL_CLOSE'){
  const modal=document.getElementById('sdk-modal');window.recordHost({kind:'close',frame:client.frame.id,exists:!!modal});modal?.remove();respond({});
  if(modal&&role==='GM'&&++closeNumber<3)setTimeout(()=>window.nextNativeAnnouncement(closeNumber+1),6500);
  return;
 }
 if(id==='OBR_NOTIFICATION_SHOW'){window.recordHost({kind:'notification',data});respond({id:'native-notice'});return;}
 if(nonce)respond({});
});
addFrame('/background.html','background');addFrame('/index.html','panel');
</script></body></html>`;
}

interface NativeClient {
  page: Page;
  cdp: CDPSession;
  connectionId: string;
  metrics: Metric[];
  hostEvents: Array<{ kind: string; channel?: string }>;
}
async function deliverWithoutActivation(
  client: NativeClient,
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
const starts = (client: NativeClient) =>
  client.metrics.filter((m) => m.kind === "start");

test("one real activation survives three modal lifecycles and closed panels in cross-site simulated hosts", async ({
  browser,
}) => {
  test.setTimeout(45000);
  const contexts = [
    await browser.newContext({ viewport: { width: 1280, height: 800 } }),
    await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    }),
  ];
  const clients: NativeClient[] = [];
  let succeeded = false;
  // Use an actual localhost HTTP server: route.fulfill classifies its origin as
  // public in recent Chromium and wrongly triggers Local Network Access checks.
  const hostServer = createServer((request, response) => {
    const address = new URL(request.url ?? "/", "http://localhost");
    const role =
      address.searchParams.get("role") === "PLAYER" ? "PLAYER" : "GM";
    response.writeHead(200, { "content-type": "text/html" });
    response.end(hostHtml(role, role === "GM" ? "native-gm" : "native-player"));
  });
  await new Promise<void>((resolve) => hostServer.listen(0, resolve));
  const hostOrigin =
    "http://localhost:" + (hostServer.address() as AddressInfo).port;
  try {
    for (let index = 0; index < 2; index++) {
      const context = contexts[index];
      const gm = index === 0;
      await context.addInitScript(instrumentNativeAudio);
      const page = await context.newPage();
      const client: NativeClient = {
        page,
        cdp: await context.newCDPSession(page),
        connectionId: gm ? "native-gm" : "native-player",
        metrics: [],
        hostEvents: [],
      };
      clients.push(client);
      page.on("pageerror", (error) =>
        console.log("NATIVE PAGE ERROR", error.message),
      );
      page.on("console", (message) => {
        if (message.type() === "error")
          console.log("NATIVE CONSOLE ERROR", message.text());
      });
      await page.exposeFunction("recordNativeAudio", (metric: Metric) =>
        client.metrics.push(metric),
      );
      await page.exposeFunction(
        "recordHost",
        (event: { kind: string; channel?: string }) =>
          client.hostEvents.push(event),
      );
      await page.exposeFunction(
        "relayNative",
        async (channel: string, data: unknown, destination: string) => {
          const recipients =
            destination === "LOCAL"
              ? [client]
              : clients.filter((c) => destination !== "REMOTE" || c !== client);
          await Promise.all(
            recipients.map((recipient) =>
              deliverWithoutActivation(
                recipient,
                channel,
                data,
                client.connectionId,
              ),
            ),
          );
        },
      );
      await page.exposeFunction(
        "nextNativeAnnouncement",
        async (sequence: number) => {
          const event = {
            version: 1,
            eventId: crypto.randomUUID(),
            sentAt: Date.now(),
            cinematic: {
              id: "native-scene",
              title: "CENA NATIVA " + sequence,
              description: "",
              imageUrl: "",
              updatedAt: "2026-11-14T00:00:00.000Z",
            },
            sound:
              sequence === 2
                ? {
                    kind: "url",
                    url: "http://127.0.0.1:4173/sounds/impact.wav",
                  }
                : { kind: "default" },
          };
          await Promise.all(
            clients.map((recipient) =>
              deliverWithoutActivation(
                recipient,
                "ardonia-cinematic/announce/v1",
                event,
                "native-gm",
              ),
            ),
          );
        },
      );
      await page.goto(
        hostOrigin + "/native-audio-host.html?role=" + (gm ? "GM" : "PLAYER"),
      );
      await expect
        .poll(
          () =>
            client.hostEvents.filter((e) => e.kind === "subscription").length,
        )
        .toBeGreaterThanOrEqual(2);
      const panel = page.frameLocator("#panel");
      if (gm) {
        await panel.locator(".audio-settings-details summary").click();
        await panel.locator(".audio-settings-toggle").click();
      } else {
        await panel.locator(".audio-settings-details summary").tap();
        await panel.locator(".audio-settings-toggle").tap();
      }
      await expect.poll(() => starts(client).length).toBe(1);
      expect(starts(client)[0].path).toBe("/background.html");
      expect(starts(client)[0].state).toBe("running");
      expect(starts(client)[0].active).toBe(true);
    }
    // Let transient activation expire before the first received remote announcement.
    // No page.evaluate/locator.evaluate is used for observations or commands.
    await clients[0].page.waitForTimeout(6500);
    // This genuinely cross-site HTTP harness has third-party localStorage denied
    // in current Chromium. Keep native storage policy intact: the simulated
    // server supplies canonical GM events; other tests cover the GM's UI click.
    await clients[0].cdp.send("Runtime.evaluate", {
      expression: "window.nextNativeAnnouncement(1)",
      userGesture: false,
      awaitPromise: true,
    });
    for (let sequence = 1; sequence <= 3; sequence++) {
      for (const client of clients) {
        await expect
          .poll(() => starts(client).length, { timeout: 12000 })
          .toBe(sequence + 1);
        const metric = starts(client)[sequence];
        expect(metric.path).toBe("/background.html");
        expect(metric.state).toBe("running");
        expect(metric.loop).toBe(false);
        expect(metric.duration).toBeCloseTo(0.95, 2);
        expect(metric.active).toBe(false);
        await expect(
          client.page
            .frameLocator("#sdk-modal")
            .getByRole("heading", {
              name: "CENA NATIVA " + sequence,
              exact: true,
            }),
        ).toBeVisible();
        await expect(client.page.locator("#panel")).toHaveCount(0);
      }
      // Close the player first, then the GM starts the host's delayed server timer.
      for (const client of [...clients].reverse()) {
        const close = client.page
          .frameLocator("#sdk-modal")
          .getByRole("button", { name: "Fechar apresentação", exact: true });
        if (client === clients[1]) await close.tap();
        else await close.click();
        await expect(client.page.locator("#sdk-modal")).toHaveCount(0);
      }
    }
    for (const client of clients) {
      expect(starts(client)).toHaveLength(4); // one confirmation plus three announcements
      const backgroundContexts = client.metrics.filter(
        (m) => m.kind === "context" && m.path === "/background.html",
      );
      expect(backgroundContexts).toHaveLength(1);
      expect(new Set(starts(client).map((m) => m.contextId)).size).toBe(1);
      expect(
        client.metrics.filter(
          (m) => m.kind === "context" && m.path === "/presentation.html",
        ),
      ).toHaveLength(0);
    }
    succeeded = true;
  } finally {
    if (!succeeded)
      for (const client of clients)
        console.log(
          "NATIVE FINAL",
          client.connectionId,
          JSON.stringify({ metrics: client.metrics, host: client.hostEvents }),
        );
    await Promise.all(contexts.map((context) => context.close()));
    await new Promise<void>((resolve) => hostServer.close(() => resolve()));
  }
});
