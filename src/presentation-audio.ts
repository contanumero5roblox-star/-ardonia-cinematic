import OBR from "@owlbear-rodeo/sdk";
import { EffectPlayer } from "./audio-engine";
import {
  AUDIO_RENDERED,
  AUDIO_STATUS,
  AUDIO_STOP,
  findAudioBridge,
} from "./audio-bridge";
import {
  AUDIO_PREFERENCES_KEY,
  loadAudioPreferences,
  saveAudioPreferences,
} from "./audio-preferences";
import type { SessionAudioStatus } from "./session-audio";
import type { SoundChoice } from "./sound-model";

function parseStatus(value: unknown): SessionAudioStatus | undefined {
  if (!value || typeof value !== "object") return;
  const data = value as Record<string, unknown>;
  if (
    typeof data.enabled !== "boolean" ||
    typeof data.ready !== "boolean" ||
    typeof data.volume !== "number" ||
    !Number.isFinite(data.volume) ||
    data.volume < 0 ||
    data.volume > 1 ||
    typeof data.message !== "string" ||
    !["disabled", "ready", "blocked", "loading", "error"].includes(
      String(data.phase),
    )
  )
    return;
  return {
    enabled: data.enabled,
    ready: data.ready,
    volume: data.volume,
    phase: data.phase as SessionAudioStatus["phase"],
    message: data.message.slice(0, 600),
  };
}

/** The modal is a control surface. Normal announcement audio belongs to the background. */
export function mountPresentationAudio(
  container: HTMLElement,
  eventId: string,
  sound: SoundChoice,
): () => void {
  let preferences = loadAudioPreferences();
  let current: SessionAudioStatus = {
    ...preferences,
    ready: false,
    phase: preferences.enabled ? "blocked" : "disabled",
    message: preferences.enabled
      ? "Verificando o áudio desta sessão…"
      : "Som desativado neste navegador.",
  };
  let disposed = false;
  let busy = false;
  let consumed = false;
  let manualPlayed = false;
  let manualEnabled = false;
  let activationRequested = false;
  let manualPlayer: EffectPlayer | undefined;
  let connectionId: string | undefined;
  let unsubscribe = () => {};
  let stopWaiter:
    | { requestId: string; finish: (consumed: boolean) => void }
    | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let lastStateKey = "";
  let receivedStatus = false;
  const controls = document.createElement("div");
  controls.className = "cinematic-audio";
  controls.dataset.eventId = eventId;
  container.classList.add("cinematic-has-audio");
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "cinematic-audio-toggle";
  const manual = document.createElement("button");
  manual.type = "button";
  manual.className = "cinematic-audio-toggle cinematic-audio-manual";
  manual.textContent = "Ouvir só este anúncio";
  manual.hidden = true;
  const status = document.createElement("p");
  status.className = "cinematic-audio-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  controls.append(toggle, manual, status);
  container.append(controls);

  function show(message = current.message): void {
    if (disposed) return;
    const active = (current.enabled && current.ready) || manualEnabled;
    toggle.textContent = active ? "Desativar som" : "Ativar som";
    toggle.setAttribute("aria-pressed", String(active));
    toggle.disabled = busy;
    // A received status confirms the background has settled its attempt. Manual
    // playback is still preceded by a cancellation acknowledgement below.
    manual.hidden =
      !receivedStatus ||
      consumed ||
      manualPlayed ||
      sound.kind === "none" ||
      (current.ready && current.phase !== "error") ||
      (!current.enabled && !activationRequested);
    manual.disabled = busy;
    status.textContent =
      sound.kind === "none" ? "Esta cinematic não usa efeito sonoro." : message;
  }
  function accept(next: SessionAudioStatus): void {
    const key = JSON.stringify(next);
    const wasEnabled = preferences.enabled;
    current = next;
    preferences = { enabled: next.enabled, volume: next.volume };
    manualPlayer?.setVolume(next.volume);
    if (!next.enabled && (wasEnabled || !manualPlayed)) {
      manualPlayer?.stop();
      manualEnabled = false;
    }
    if (key !== lastStateKey) {
      lastStateKey = key;
      show(next.ready && next.phase === "ready" ? "" : next.message);
    } else show(status.textContent || next.message);
  }
  function send(channel: string, data: unknown): Promise<void> {
    if (!OBR.isAvailable)
      return Promise.reject(
        new Error("Abra a extensão na sala para controlar o áudio."),
      );
    return OBR.broadcast.sendMessage(channel, data, { destination: "LOCAL" });
  }
  function inspectBridge(): void {
    if (disposed) return;
    try {
      const bridge = findAudioBridge();
      if (!bridge) return;
      consumed ||= bridge.consumed(eventId);
      accept(bridge.status());
    } catch {
      show(
        "O controle de áudio foi reiniciado. Reabra o painel e ative o som nesta sessão.",
      );
    }
  }

  toggle.addEventListener("click", () => {
    if (disposed || busy) return;
    const bridge = findAudioBridge();
    if ((current.enabled && current.ready) || manualEnabled) {
      manualEnabled = false;
      preferences = { ...preferences, enabled: false };
      saveAudioPreferences(preferences);
      manualPlayer?.stop();
      if (bridge) accept(bridge.updatePreferences(preferences));
      else {
        current = { ...current, ...preferences, phase: "disabled" };
        show("Som desativado neste navegador.");
      }
      return;
    }
    if (manualPlayed) {
      // The entry was already consumed by the explicitly requested fallback.
      // Re-enabling is a preference update, never a second confirmation effect.
      preferences = { ...preferences, enabled: true };
      saveAudioPreferences(preferences);
      if (bridge) accept(bridge.updatePreferences(preferences));
      else current = { ...current, ...preferences };
      show(
        "Preferência de som ativada, sem repetir esta entrada. Para confirmar o áudio automático da sessão, use o painel da extensão.",
      );
      return;
    }
    if (!bridge) {
      activationRequested = true;
      show(
        "O navegador isolou o controle persistente. Reabra o painel ou use Ouvir só este anúncio; a sessão não foi liberada.",
      );
      return;
    }
    busy = true;
    // This direct call must stay in the genuine click handler. A broadcast or
    // an awaited lookup would not transfer user activation to the audio owner.
    const activation = bridge.activate(sound);
    show("Ativando o áudio persistente…");
    void activation
      .then((next) => {
        if (disposed) return;
        consumed ||= bridge.consumed(eventId);
        receivedStatus = true;
        accept(next);
        if (!next.ready)
          show(`${next.message} Se necessário, use Ouvir só este anúncio.`);
      })
      .catch(() => {
        if (!disposed)
          show(
            "O áudio da sessão não foi liberado. Reabra o painel ou use o teste manual desta entrada.",
          );
      })
      .finally(() => {
        busy = false;
        if (!disposed) show(status.textContent || current.message);
      });
  });

  function confirmStopped(): Promise<boolean> {
    // Cancel synchronously when possible, but also require the owner's event-
    // matched acknowledgement. This prevents an old modal from playing a stale
    // effect while a newer announcement has already become active.
    findAudioBridge()?.stop(eventId);
    return new Promise<boolean>((resolve, reject) => {
      const requestId = crypto.randomUUID();
      stopWaiter = { requestId, finish: resolve };
      deadline = setTimeout(() => {
        stopWaiter = undefined;
        reject(
          new Error(
            "Não foi possível confirmar o cancelamento do áudio automático. Reabra o painel; nenhum som manual foi tocado.",
          ),
        );
      }, 2000);
      void send(AUDIO_STOP, { eventId, requestId }).catch(() => {
        if (deadline) clearTimeout(deadline);
        stopWaiter = undefined;
        reject(
          new Error(
            "O controle de áudio não respondeu. Reabra o painel da extensão.",
          ),
        );
      });
    });
  }
  manual.addEventListener("click", () => {
    if (disposed || busy || consumed || manualPlayed) return;
    busy = true;
    manualPlayer ??= new EffectPlayer();
    // Unlock this exceptional local context in the real gesture, before waiting
    // for the persistent owner's cancellation. Never race two possible owners.
    const unlocked = manualPlayer.unlock();
    const stopped = confirmStopped();
    show("Confirmando o cancelamento do áudio automático…");
    void Promise.all([unlocked, stopped])
      .then(async ([allowed, wasConsumed]) => {
        if (disposed || wasConsumed) {
          consumed ||= wasConsumed;
          return;
        }
        if (!allowed)
          throw new Error(
            "O navegador também bloqueou o teste manual. Confira a permissão de som do site.",
          );
        const result = await manualPlayer!.play(sound, preferences.volume);
        if (disposed) return;
        if (result === "blocked")
          throw new Error(
            "O navegador bloqueou o som. Confira a permissão de áudio do site.",
          );
        manualPlayed = true;
        manualEnabled = result === "played";
        consumed = true;
        // Record this explicit fallback as consumed in the persistent owner too.
        void send(AUDIO_STOP, { eventId, consumed: true }).catch(() => {});
        show(
          result === "played"
            ? "Som ouvido somente nesta entrada. A autorização automática da sessão não foi confirmada; reabra o painel para ativá-la."
            : "Entrada silenciosa: o volume está em zero. A autorização automática da sessão não foi confirmada.",
        );
      })
      .catch((error) => {
        if (!disposed) show((error as Error).message);
      })
      .finally(() => {
        busy = false;
        if (!disposed) show(status.textContent || current.message);
      });
  });

  async function connect(): Promise<void> {
    try {
      connectionId = await OBR.player.getConnectionId();
      if (disposed) return;
      unsubscribe = OBR.broadcast.onMessage(AUDIO_STATUS, (event) => {
        if (
          disposed ||
          event.connectionId !== connectionId ||
          !event.data ||
          typeof event.data !== "object"
        )
          return;
        const data = event.data as Record<string, unknown>;
        if (data.eventId !== eventId) return;
        const checked = parseStatus(data.status);
        if (!checked) return;
        receivedStatus = true;
        consumed ||= data.consumed === true;
        accept(checked);
        if (
          data.stopped === true &&
          stopWaiter &&
          data.requestId === stopWaiter.requestId
        ) {
          if (deadline) clearTimeout(deadline);
          deadline = undefined;
          const finish = stopWaiter.finish;
          stopWaiter = undefined;
          finish(data.consumed === true);
        }
      });
      // Register before signalling the rendered scene. The background owns
      // deduplication; no message here creates or unlocks a modal AudioContext.
      requestAnimationFrame(() => {
        if (!disposed)
          void send(AUDIO_RENDERED, { eventId }).catch(() =>
            show(
              "O áudio não respondeu. Reabra o painel; a apresentação visual continua.",
            ),
          );
      });
    } catch {
      if (!disposed)
        show("O controle de áudio não respondeu. Reabra o painel da extensão.");
    }
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== AUDIO_PREFERENCES_KEY && event.key !== null) return;
    const next = loadAudioPreferences();
    const bridge = findAudioBridge();
    if (bridge) accept(bridge.updatePreferences(next));
    else {
      preferences = next;
      current = { ...current, ...next };
      manualPlayer?.setVolume(next.volume);
      if (!next.enabled) {
        manualPlayer?.stop();
        manualEnabled = false;
      }
      show();
    }
  };
  window.addEventListener("storage", onStorage);
  show();
  inspectBridge();
  poll = setInterval(inspectBridge, 1000);
  if (OBR.isAvailable) void connect();
  else
    show(
      "Abra a extensão na sala para controlar o áudio; esta prévia não libera uma sessão.",
    );

  return () => {
    if (disposed) return;
    disposed = true;
    if (deadline) clearTimeout(deadline);
    stopWaiter?.finish(true);
    stopWaiter = undefined;
    if (poll) clearInterval(poll);
    unsubscribe();
    window.removeEventListener("storage", onStorage);
    // Stop only this event. Disposing the modal must never dispose the background context.
    try {
      findAudioBridge()?.stop(eventId);
    } catch {
      /* The owner may have restarted. */
    }
    if (OBR.isAvailable) void send(AUDIO_STOP, { eventId }).catch(() => {});
    manualPlayer?.dispose();
    controls.remove();
    container.classList.remove("cinematic-has-audio");
  };
}
