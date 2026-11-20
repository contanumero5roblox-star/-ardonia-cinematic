import { test, expect, type CDPSession } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { writeFile } from "node:fs/promises";

/** Test-only native instrumentation: no production logger or autoplay override. */
interface AudioMetric {
  kind: "context" | "start" | "stop" | "disconnect" | "ended";
  owner: string;
  source?: string;
  gain?: number;
  bufferPeak?: number;
  state?: string;
}
function observeAudio() {
  if (location.hostname !== "127.0.0.1") return;
  const owner =
    new URL(location.href).searchParams.get("fixtureOwner") ??
    location.pathname;
  const Native = AudioContext;
  let serial = 0;
  class ObservedContext extends Native {
    constructor(options?: AudioContextOptions) {
      super(options);
      void (window as any).recordAudioOwner({
        kind: "context",
        owner,
        state: this.state,
      });
    }
    createBufferSource(): AudioBufferSourceNode {
      const source = super.createBufferSource();
      const id = owner + ":" + ++serial;
      let gain: GainNode | undefined;
      const connect = source.connect.bind(source),
        start = source.start.bind(source),
        stop = source.stop.bind(source),
        disconnect = source.disconnect.bind(source);
      const report = (kind: AudioMetric["kind"]) => {
        let peak = 0;
        if (kind === "start" && source.buffer)
          for (const sample of source.buffer.getChannelData(0))
            peak = Math.max(peak, Math.abs(sample));
        void (window as any).recordAudioOwner({
          kind,
          owner,
          source: id,
          gain: gain?.gain.value,
          bufferPeak: peak,
          state: this.state,
        });
      };
      source.connect = ((destination: AudioNode, ...args: unknown[]) => {
        gain = destination as GainNode;
        return (connect as any)(destination, ...args);
      }) as typeof source.connect;
      source.start = ((...args: Parameters<AudioBufferSourceNode["start"]>) => {
        report("start");
        start(...args);
      }) as typeof source.start;
      source.stop = ((...args: Parameters<AudioBufferSourceNode["stop"]>) => {
        report("stop");
        stop(...args);
      }) as typeof source.stop;
      source.disconnect = ((...args: unknown[]) => {
        report("disconnect");
        return (disconnect as any)(...args);
      }) as typeof source.disconnect;
      source.addEventListener("ended", () => report("ended"));
      return source;
    }
  }
  window.AudioContext = ObservedContext;
}

function ownerHost(): string {
  return `<!doctype html><html><head><style>body{margin:0}#panel{border:0;width:600px;height:950px}.sdk-modal{position:fixed;inset:0;width:100%;height:100%;border:0}</style></head><body><script>
  const ext='http://127.0.0.1:4173',clients=[],ref=btoa(location.origin+' owner-fixture');
  window.host={subscriptions:0,deliver(channel,data,sender='owner-connection'){for(const c of clients)if(c.frame.isConnected&&c.channels.has(channel))c.frame.contentWindow.postMessage({id:'OBR_BROADCAST_MESSAGE_'+channel,data:{data,connectionId:sender}},ext)}};
  function addFrame(url,id,modalId){const f=document.createElement('iframe');f.id=id;if(id.startsWith('bg'))f.hidden=true;if(modalId){f.className='sdk-modal';f.dataset.modalId=modalId;}const u=new URL(url,ext);u.searchParams.set('obrref',ref);u.searchParams.set('fixtureOwner',id);f.src=u.href;const c={frame:f,channels:new Set()};clients.push(c);f.onload=()=>f.contentWindow.postMessage({id:'OBR_READY',data:{userId:'owner-connection',ref:id}},ext);document.body.append(f)}
  window.addEventListener('message',event=>{if(event.origin!==ext)return;const c=clients.find(c=>c.frame.contentWindow===event.source);if(!c)return;const {id,data,nonce}=event.data||{};if(typeof id!=='string')return;const reply=result=>event.source.postMessage({id:id+'_RESPONSE'+nonce,data:result},ext);
  if(id==='OBR_BROADCAST_SUBSCRIBE'){c.channels.add(data.channel);window.host.subscriptions++;return}if(id==='OBR_BROADCAST_UNSUBSCRIBE'){c.channels.delete(data.channel);return}
  if(id==='OBR_PLAYER_GET_CONNECTION_ID'){reply({connectionId:'owner-connection'});return}if(id==='OBR_PLAYER_GET_ROLE'){reply({role:'GM'});return}if(id==='OBR_PARTY_GET_PLAYERS'){reply({players:[]});return}
  if(id==='OBR_BROADCAST_SEND_MESSAGE'){host.deliver(data.channel,data.data);reply({});return}
  if(id==='OBR_MODAL_CLOSE'){const modal=document.getElementById('sdk-modal');if(modal?.dataset.modalId===data.id)modal.remove();reply({});return}
  if(id==='OBR_MODAL_OPEN'){addFrame(data.url,'sdk-modal',data.id);reply({});return}
  if(id==='OBR_NOTIFICATION_SHOW'){reply({id:'notice'});return}if(nonce)reply({});});
  addFrame('/background.html','bg1');addFrame('/background.html','bg2');addFrame('/index.html','panel');
  </script></body></html>`;
}
async function withoutGesture(cdp: CDPSession, expression: string) {
  await cdp.send("Runtime.evaluate", {
    expression,
    userGesture: false,
    awaitPromise: true,
  });
}

test("two background frames and interleaved manual tests still have one native source with unchanged gain", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
  });
  let server: Server | undefined;
  const metrics: AudioMetric[] = [];
  const active = new Set<string>();
  let maximumActive = 0;
  try {
    await context.addInitScript(observeAudio);
    const page = await context.newPage();
    await page.exposeFunction("recordAudioOwner", (metric: AudioMetric) => {
      metrics.push(metric);
      if (metric.source) {
        if (metric.kind === "start") active.add(metric.source);
        else active.delete(metric.source);
      }
      maximumActive = Math.max(maximumActive, active.size);
    });
    server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(ownerHost());
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    await page.goto(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    );
    const panel = page.frameLocator("#panel");
    await panel.locator(".audio-settings-details summary").click();
    await panel.locator(".audio-settings-toggle").click();
    const starts = () => metrics.filter((metric) => metric.kind === "start");
    await expect.poll(() => starts().length).toBe(1);
    await expect.poll(() => active.size).toBe(0);
    const cdp = await context.newCDPSession(page);
    // Explicit panel test begins immediately before the first announcement.
    await panel
      .getByRole("button", { name: "Testar efeito", exact: true })
      .click();
    await expect.poll(() => starts().length).toBe(2);
    for (let index = 0; index < 10; index++) {
      const event = {
        version: 1,
        eventId: crypto.randomUUID(),
        sentAt: Date.now(),
        cinematic: {
          id: "owner-scene",
          title: "RAJADA " + (index + 1),
          durationSeconds: 8,
          description: "",
          imageUrl: "",
          updatedAt: new Date().toISOString(),
        },
        sound:
          index % 2 === 0
            ? { kind: "default" }
            : {
                kind: "url",
                url: "http://127.0.0.1:4173/sounds/impact.wav?custom=owner",
              },
      };
      await withoutGesture(
        cdp,
        `window.host.deliver('ardonia-cinematic/announce/v1',${JSON.stringify(event)})`,
      );
      await expect.poll(() => starts().length).toBe(index + 3);
      await expect(
        page
          .frameLocator("#sdk-modal")
          .getByRole("heading", { name: event.cinematic.title, exact: true }),
      ).toBeVisible();
    }
    await expect(page.locator("#sdk-modal")).toHaveCount(0, { timeout: 11000 });
    await expect.poll(() => active.size).toBe(0);
    expect(maximumActive).toBe(1);
    expect(metrics.filter((metric) => metric.kind === "context")).toHaveLength(
      1,
    );
    expect(starts()).toHaveLength(12); // confirmation, manual test, ten entries
    const referencePeak = starts()[0].bufferPeak!;
    expect(referencePeak).toBeGreaterThan(0.8);
    expect(referencePeak).toBeLessThan(0.9);
    for (const metric of starts()) {
      expect(metric.owner).toMatch(/^bg[12]$/);
      expect(metric.gain).toBeCloseTo(0.65, 6);
      expect(metric.bufferPeak).toBeCloseTo(referencePeak, 7);
      expect(metric.state).toBe("running");
    }
    await writeFile(
      testInfo.outputPath("native-owner-summary.json"),
      JSON.stringify(
        {
          maximumActive,
          contexts: metrics.filter((metric) => metric.kind === "context")
            .length,
          starts: starts().length,
          gains: [...new Set(starts().map((metric) => metric.gain))],
          bufferPeaks: [
            ...new Set(starts().map((metric) => metric.bufferPeak)),
          ],
          owners: [...new Set(starts().map((metric) => metric.owner))],
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await testInfo.attach("native-source-diagnostics", {
      body: JSON.stringify({ maximumActive, metrics }, null, 2),
      contentType: "application/json",
    });
    throw error;
  } finally {
    await context.close();
    if (server)
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve())),
      );
  }
});
