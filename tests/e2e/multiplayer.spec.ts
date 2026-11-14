import { test, expect, type Page } from "@playwright/test";

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

test("real SDK in simulated hosts delivers GM announcements to GM and mobile player, deduplicates and replaces scenes", async ({
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
  try {
    for (const [context, role, connectionId] of [
      [gmContext, "GM", "gm-connection"],
      [playerContext, "PLAYER", "player-connection"],
    ] as const) {
      const page = await context.newPage();
      const client = { page, connectionId };
      clients.push(client);
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
    }
    const announced = await gm.page.evaluate(
      () => (window as any).host.announcements[0],
    );
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
    await gmPanel.locator("#title").fill("FLORESTA DOS SUSSURROS");
    await gmPanel.locator("#description").fill("");
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
          .getByRole("heading", {
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
    }

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
    await player.page
      .frameLocator("#sdk-modal")
      .getByRole("button", { name: "Fechar apresentação", exact: true })
      .click();
    await expect(player.page.locator("#sdk-modal")).toHaveCount(0);
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
        client.page
          .frameLocator("#sdk-modal")
          .getByRole("heading", {
            name: "FLORESTA DOS SUSSURROS",
            exact: true,
          }),
      ).toBeVisible();
      expect(await client.page.evaluate(() => (window as any).host.opens)).toBe(
        3,
      );
    }
    // The player's browser never receives the private library through storage.
    expect(await player.page.evaluate(() => Object.keys(localStorage))).toEqual(
      [],
    );
  } finally {
    await Promise.all([gmContext.close(), playerContext.close()]);
  }
});
