import OBR from "@owlbear-rodeo/sdk";
import { parseCinematic } from "./model";
import { renderPresentation } from "./presentation-view";
import { mountPresentationAudio } from "./presentation-audio";
import {
  isDeadline,
  readDeadline,
  rememberDeadline,
  startPresentationClock,
} from "./presentation-lifetime";
import { validateSoundChoice, type SoundChoice } from "./sound-model";
import { CHANNEL_READY, CHANNEL_DATA, getModalId, isEventId } from "./protocol";

const root = document.querySelector<HTMLElement>("#presentation")!;
const eventId = new URLSearchParams(location.search).get("event");

function showMessage(message: string, retryClose?: () => void): void {
  const box = document.createElement("div");
  box.className = "cinematic-document-error";
  const text = document.createElement("p");
  text.textContent = message;
  box.append(text);
  if (retryClose) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Tentar fechar novamente";
    button.addEventListener("click", retryClose, { once: true });
    box.append(button);
  }
  root.replaceChildren(box);
  box.querySelector("button")?.focus();
}

function start(eventId: string): void {
  const modalId = getModalId(eventId);
  const savedDeadline = readDeadline(eventId);
  const handshakeLimit = Math.min(Date.now() + 6000, savedDeadline ?? Infinity);
  let waiting = true;
  let disposed = false;
  let closing = false;
  let retry: number | undefined;
  let timeout: number | undefined;
  let closeWatchdog: number | undefined;
  let unsubscribe = () => {};
  let disposeScene = () => {};

  function finishHandshake(): void {
    if (!waiting) return;
    waiting = false;
    window.clearInterval(retry);
    window.clearTimeout(timeout);
    unsubscribe();
    window.removeEventListener("pageshow", checkHandshakeLimit);
    document.removeEventListener("visibilitychange", checkHandshakeLimit);
  }

  function checkHandshakeLimit(): void {
    if (waiting && Date.now() >= handshakeLimit) closePresentation();
  }

  function closePresentation(attempts = 2): void {
    if (closing || disposed) return;
    closing = true;
    finishHandshake();
    disposeScene();

    // The SDK has no isOpen/onClose. If this document still runs after the
    // grace period, even a resolved or unanswered request needs recovery.
    function attempt(): void {
      void OBR.modal.close(modalId).catch(() => {});
      closeWatchdog = window.setTimeout(() => {
        if (disposed) return;
        if (--attempts > 0) {
          showMessage("Aguardando o fechamento da apresentação…");
          attempt();
        } else {
          closing = false;
          showMessage(
            "O Owlbear Rodeo ainda não fechou a apresentação. Tente novamente. Se o problema continuar, recarregue a sala.",
            () => closePresentation(1),
          );
        }
      }, 1000);
    }
    attempt();
  }

  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return; // pageshow reconciles a restored document.
    disposed = true;
    finishHandshake();
    window.clearTimeout(closeWatchdog);
    disposeScene();
  });

  // Bound the complete handshake, including OBR_READY and getConnectionId.
  window.addEventListener("pageshow", checkHandshakeLimit);
  document.addEventListener("visibilitychange", checkHandshakeLimit);
  timeout = window.setTimeout(
    closePresentation,
    Math.max(0, handshakeLimit - Date.now()),
  );
  OBR.onReady(async () => {
    if (!waiting) return;
    try {
      const connectionId = await OBR.player.getConnectionId();
      if (!waiting) return;
      unsubscribe = OBR.broadcast.onMessage(CHANNEL_DATA, (message) => {
        if (!waiting || message.connectionId !== connectionId) return;
        const data = message.data;
        if (
          typeof data !== "object" ||
          data === null ||
          !("eventId" in data) ||
          data.eventId !== eventId ||
          !("cinematic" in data)
        )
          return;

        let cinematic;
        try {
          cinematic = parseCinematic(data.cinematic);
        } catch {
          return; // A subsequent valid reply can still complete the handshake.
        }
        finishHandshake();
        const remoteDeadline = "deadline" in data ? data.deadline : undefined;
        const previous = Math.min(
          savedDeadline ?? Infinity,
          isDeadline(remoteDeadline) ? remoteDeadline : Infinity,
        );
        if (previous <= Date.now()) {
          closePresentation();
          return;
        }

        const disposeVisual = renderPresentation(root, cinematic);
        const stage = root.querySelector<HTMLElement>(".cinematic-stage")!;
        const latest = Date.now() + cinematic.durationSeconds * 1000;
        const deadline = Math.min(previous, latest);
        rememberDeadline(eventId, deadline);
        void OBR.broadcast
          .sendMessage(CHANNEL_READY, { eventId, deadline }, { destination: "LOCAL" })
          .catch(() => {
            // The iframe retains its own deadline if this acknowledgement fails.
          });

        let disposeAudio = () => {};
        let stopClock = () => {};
        disposeScene = () => {
          stopClock();
          disposeAudio();
          disposeVisual();
          disposeScene = () => {};
        };
        stopClock = startPresentationClock(stage, deadline, closePresentation);
        if (closing) return;
        let sound: SoundChoice = { kind: "none" };
        try {
          sound = validateSoundChoice("sound" in data ? data.sound : undefined);
        } catch {
          // Invalid audio must not reject an otherwise valid visual scene.
        }
        disposeAudio = mountPresentationAudio(stage, eventId, sound);
      });
      const request = () => {
        if (Date.now() >= handshakeLimit) {
          closePresentation();
          return;
        }
        void OBR.broadcast
          .sendMessage(CHANNEL_READY, { eventId }, { destination: "LOCAL" })
          .catch(() => {
            // Transient errors can recover on the next bounded handshake retry.
          });
      };
      retry = window.setInterval(request, 300);
      request();
    } catch {
      closePresentation();
    }
  });
}

if (OBR.isAvailable && isEventId(eventId)) {
  start(eventId);
} else {
  showMessage(
    "Apresentação indisponível. Feche esta aba ou recarregue a sala do Owlbear Rodeo.",
  );
}
