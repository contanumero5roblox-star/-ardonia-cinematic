import OBR from "@owlbear-rodeo/sdk";
import { parseCinematic } from "./model";
import { renderPresentation } from "./presentation-view";
import { mountPresentationAudio } from "./presentation-audio";
import { validateSoundChoice, type SoundChoice } from "./sound-model";
import { CHANNEL_READY, CHANNEL_DATA, MODAL_ID } from "./protocol";

const root = document.querySelector<HTMLElement>("#presentation")!;
const eventId = new URLSearchParams(location.search).get("event");
let cleanupScene = () => {};
window.addEventListener("pagehide", () => cleanupScene(), { once: true });

async function closePresentation(): Promise<void> {
  cleanupScene();
  if (OBR.isAvailable) {
    OBR.onReady(async () => {
      try {
        await OBR.modal.close(MODAL_ID);
      } catch {
        showError(
          "Não foi possível fechar automaticamente. Use o botão de fechar do Owlbear Rodeo.",
        );
      }
    });
  } else {
    root.replaceChildren();
    const message = document.createElement("p");
    message.className = "cinematic-document-error";
    message.textContent = "Apresentação encerrada. Você pode fechar esta aba.";
    root.append(message);
  }
}

function showError(message: string): void {
  cleanupScene();
  const box = document.createElement("div");
  box.className = "cinematic-document-error";
  const text = document.createElement("p");
  text.textContent = message;
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Fechar apresentação";
  close.addEventListener("click", () => void closePresentation());
  box.append(text, close);
  root.replaceChildren(box);
  close.focus();
}

if (!OBR.isAvailable || !eventId) {
  showError(
    "Não foi possível carregar esta apresentação. Peça ao mestre para anunciar novamente.",
  );
} else {
  OBR.onReady(async () => {
    let received = false;
    let retry: ReturnType<typeof setInterval> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe = () => {};
    const cleanup = () => {
      if (retry) clearInterval(retry);
      if (timeout) clearTimeout(timeout);
      unsubscribe();
    };
    window.addEventListener("pagehide", cleanup, { once: true });
    try {
      const connectionId = await OBR.player.getConnectionId();
      unsubscribe = OBR.broadcast.onMessage(CHANNEL_DATA, (message) => {
        if (message.connectionId !== connectionId || received) return;
        const data = message.data;
        if (
          typeof data !== "object" ||
          data === null ||
          !("eventId" in data) ||
          !("cinematic" in data) ||
          data.eventId !== eventId
        )
          return;
        try {
          const cinematic = parseCinematic(data.cinematic);
          received = true;
          cleanup();
          let sound: SoundChoice = { kind: "none" };
          try {
            sound = validateSoundChoice(
              "sound" in data ? data.sound : undefined,
            );
          } catch {
            // Invalid audio must not reject an otherwise valid visual scene.
          }
          const cleanupVisual = renderPresentation(
            root,
            cinematic,
            () => void closePresentation(),
          );
          const cleanupAudio = mountPresentationAudio(
            root.querySelector<HTMLElement>(".cinematic-stage")!,
            eventId,
            sound,
          );
          cleanupScene = () => {
            cleanupAudio();
            cleanupVisual();
          };
        } catch {
          /* Ignore invalid data; the bounded handshake can still recover. */
        }
      });
      const request = () => {
        void OBR.broadcast
          .sendMessage(CHANNEL_READY, { eventId }, { destination: "LOCAL" })
          .catch(() => {
            // Transient transport failures can recover on the next bounded retry.
          });
      };
      retry = setInterval(request, 300);
      timeout = setTimeout(() => {
        cleanup();
        if (!received)
          showError(
            "A apresentação não respondeu. Peça ao mestre para anunciar novamente.",
          );
      }, 6000);
      request();
    } catch {
      cleanup();
      showError(
        "Não foi possível carregar esta apresentação. Peça ao mestre para anunciar novamente.",
      );
    }
  });
}
