import OBR from "@owlbear-rodeo/sdk";
import {
  CHANNEL_ANNOUNCE,
  CHANNEL_DATA,
  CHANNEL_READY,
  MODAL_ID,
  isEventId,
} from "./protocol";
import { AnnouncementReceiver } from "./receiver";
import { SessionAudioController } from "./session-audio";
import {
  publishAudioBridge,
  AUDIO_RENDERED,
  AUDIO_STOP,
  AUDIO_STATUS,
} from "./audio-bridge";
import {
  AUDIO_PREFERENCES_KEY,
  loadAudioPreferences,
} from "./audio-preferences";

// This owner outlives the action panel and every cinematic modal.
const audio = new SessionAudioController();
const unpublish = publishAudioBridge({
  version: 1,
  scope: new URL(".", window.location.href).href,
  activate: (choice) => audio.activate(choice),
  test: (choice) => audio.test(choice),
  status: () => audio.status,
  updatePreferences: (preferences) => audio.updatePreferences(preferences),
  subscribe: (listener) => audio.subscribe(listener),
  stop: (eventId) => audio.stop(eventId),
  consumed: (eventId) => audio.hasPlayed(eventId),
});
window.addEventListener(
  "pagehide",
  () => {
    unpublish();
    audio.dispose();
  },
  { once: true },
);
window.addEventListener("storage", (event) => {
  if (event.key === AUDIO_PREFERENCES_KEY || event.key === null)
    audio.updatePreferences(loadAudioPreferences());
});

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
    let openedAudioEventId: string | undefined;
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
        if (openedAudioEventId) audio.stop(openedAudioEventId);
        // The host may report an absent/already-dismissed modal as an error.
        // Opening the same stable ID remains the authoritative readiness operation.
        try {
          await OBR.modal.close(MODAL_ID);
        } catch {
          /* Continue with open. */
        }
      },
      open: async (announcement) => {
        openedAudioEventId = announcement.eventId;
        audio.prepare(
          announcement.eventId,
          announcement.sound ?? { kind: "default" },
        );
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

    async function sendAudioStatus(
      eventId: string,
      requestId?: string,
      stopped = false,
    ) {
      await OBR.broadcast.sendMessage(
        AUDIO_STATUS,
        {
          eventId,
          status: audio.status,
          consumed: audio.hasPlayed(eventId),
          ...(requestId ? { requestId } : {}),
          ...(stopped ? { stopped: true } : {}),
        },
        { destination: "LOCAL" },
      );
    }
    for (const channel of [AUDIO_RENDERED, AUDIO_STOP]) {
      OBR.broadcast.onMessage(channel, (event) => {
        void (async () => {
          if (
            !event.data ||
            typeof event.data !== "object" ||
            Array.isArray(event.data)
          )
            return;
          const data = event.data as Record<string, unknown>;
          if (
            !isEventId(data.eventId) ||
            event.connectionId !== (await OBR.player.getConnectionId())
          )
            return;
          if (receiver.active?.eventId !== data.eventId) return;
          if (channel === AUDIO_STOP) {
            audio.stop(data.eventId);
            if (data.consumed === true) audio.markConsumed(data.eventId);
            await sendAudioStatus(
              data.eventId,
              isEventId(data.requestId) ? data.requestId : undefined,
              true,
            );
          } else {
            await audio.rendered(data.eventId);
            // A new announcement may have replaced this one while audio was loading.
            if (receiver.active?.eventId === data.eventId)
              await sendAudioStatus(data.eventId);
          }
        })().catch(() => {
          /* Audio transport never rejects the visual announcement. */
        });
      });
    }

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
            ...(active.sound === undefined ? {} : { sound: active.sound }),
          },
          { destination: "LOCAL" },
        );
      })().catch(() => {
        void reportFailure();
      });
    });
  });
