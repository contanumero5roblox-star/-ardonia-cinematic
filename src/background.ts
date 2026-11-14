import OBR from "@owlbear-rodeo/sdk";
import {
  CHANNEL_ANNOUNCE,
  CHANNEL_DATA,
  CHANNEL_READY,
  MODAL_ID,
  isEventId,
} from "./protocol";
import { AnnouncementReceiver } from "./receiver";

async function reportFailure(): Promise<void> {
  try {
    await OBR.notification.show(
      "Ardonia: não foi possível abrir a apresentação. Tente anunciar novamente.",
      "ERROR",
    );
  } catch {
    // No payload, image URLs, room data or credentials are written to logs.
    console.error(
      "Ardonia Cinematic: falha na comunicação com o Owlbear Rodeo.",
    );
  }
}

if (OBR.isAvailable)
  OBR.onReady(() => {
    const receiver = new AnnouncementReceiver({
      authorize: async (sender) => {
        const ownConnection = await OBR.player.getConnectionId();
        if (sender === ownConnection)
          return (await OBR.player.getRole()) === "GM";
        const players = await OBR.party.getPlayers();
        return players.some(
          (player) => player.connectionId === sender && player.role === "GM",
        );
      },
      close: async () => {
        // The host may report an absent/already-dismissed modal as an error.
        // Opening the same stable ID remains the authoritative readiness operation.
        try {
          await OBR.modal.close(MODAL_ID);
        } catch {
          /* Continue with open. */
        }
      },
      open: async (announcement) => {
        const url = new URL("presentation.html", window.location.href);
        url.search = "";
        url.searchParams.set("event", announcement.eventId);
        await OBR.modal.open({
          id: MODAL_ID,
          url: url.href,
          fullScreen: true,
          hidePaper: true,
        });
      },
      onError: () => {
        void reportFailure();
      },
    });

    OBR.broadcast.onMessage(CHANNEL_ANNOUNCE, (event) => {
      void receiver.receive(event);
    });
    OBR.broadcast.onMessage(CHANNEL_READY, (event) => {
      void (async () => {
        if (
          !event.data ||
          typeof event.data !== "object" ||
          Array.isArray(event.data)
        )
          return;
        const eventId = (event.data as Record<string, unknown>).eventId;
        if (
          !isEventId(eventId) ||
          event.connectionId !== (await OBR.player.getConnectionId())
        )
          return;
        const active = receiver.active;
        if (!active || active.eventId !== eventId) return;
        await OBR.broadcast.sendMessage(
          CHANNEL_DATA,
          {
            eventId: active.eventId,
            cinematic: active.cinematic,
          },
          { destination: "LOCAL" },
        );
      })().catch(() => {
        void reportFailure();
      });
    });
  });
