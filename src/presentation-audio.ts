import { EffectPlayer } from "./audio-engine";
import {
  AUDIO_PREFERENCES_KEY,
  loadAudioPreferences,
  saveAudioPreferences,
} from "./audio-preferences";
import type { SoundChoice } from "./sound-model";

const AUTOMATIC_START_BUDGET_MS = 1500;

/**
 * The presentation is the only audio owner. A failed or delayed effect never
 * delays the visual scene, and a late resume cannot unexpectedly replay it.
 */
export function mountPresentationAudio(
  container: HTMLElement,
  eventId: string,
  sound: SoundChoice,
): () => void {
  const player = new EffectPlayer();
  container.classList.add("cinematic-has-audio");
  let preferences = loadAudioPreferences();
  let disposed = false;
  let played = false;
  let busy = false;
  let needsAction = false;
  let generation = 0;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let persistenceWarning = false;

  const controls = document.createElement("div");
  controls.className = "cinematic-audio";
  controls.dataset.eventId = eventId;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "cinematic-audio-toggle";
  const status = document.createElement("p");
  status.className = "cinematic-audio-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  controls.append(toggle, status);
  container.append(controls);

  function updateButton(): void {
    const activating = !preferences.enabled || needsAction;
    toggle.textContent = activating ? "Ativar som" : "Desativar som";
    toggle.setAttribute(
      "aria-pressed",
      String(preferences.enabled && !needsAction),
    );
    toggle.title = activating
      ? "Habilitar o efeito neste navegador"
      : "Desativar o efeito neste navegador";
  }

  function message(text: string): void {
    status.textContent = persistenceWarning
      ? `${text} A preferência vale nesta apresentação; o navegador não permitiu salvá-la.`
      : text;
  }

  function persist(): void {
    persistenceWarning = !saveAudioPreferences(preferences);
  }

  function cancelPending(): void {
    generation++;
    if (deadline) clearTimeout(deadline);
    deadline = undefined;
    busy = false;
    player.stop();
  }

  function attempt(automatic: boolean): void {
    if (
      disposed ||
      played ||
      busy ||
      !preferences.enabled ||
      sound.kind === "none"
    )
      return;
    const current = ++generation;
    busy = true;
    needsAction = false;
    updateButton();
    message("Preparando efeito de entrada…");
    // EffectPlayer invokes AudioContext.resume synchronously before its first
    // await. When called from the button, this keeps the real user gesture.
    const result = player.play(sound, preferences.volume);
    if (automatic) {
      deadline = setTimeout(() => {
        if (disposed || current !== generation) return;
        cancelPending();
        needsAction = true;
        updateButton();
        message("O som demorou a carregar. Toque em Ativar som para tentar.");
      }, AUTOMATIC_START_BUDGET_MS);
    }
    void result
      .then((outcome) => {
        if (disposed || current !== generation) return;
        if (deadline) clearTimeout(deadline);
        deadline = undefined;
        busy = false;
        if (outcome === "blocked") {
          needsAction = true;
          message("Som bloqueado pelo navegador. Toque em Ativar som.");
        } else {
          // Volume zero and a silent choice also consume this occurrence. Raising
          // volume later must not make an old announcement suddenly play.
          played = true;
          needsAction = false;
          message(
            outcome === "played" ? "" : "Som silenciado para esta entrada.",
          );
        }
        updateButton();
      })
      .catch((error: unknown) => {
        if (disposed || current !== generation) return;
        if (deadline) clearTimeout(deadline);
        deadline = undefined;
        busy = false;
        needsAction = true;
        updateButton();
        const detail =
          error instanceof Error ? error.message : "Efeito indisponível.";
        message(
          `${detail} A apresentação continua. Toque em Ativar som para tentar.`,
        );
      });
  }

  toggle.addEventListener("click", () => {
    if (disposed) return;
    if (preferences.enabled && !needsAction) {
      preferences = { ...preferences, enabled: false };
      persist();
      cancelPending();
      needsAction = false;
      updateButton();
      message("Som desativado neste navegador.");
      return;
    }
    preferences = { ...preferences, enabled: true };
    persist();
    // Do not await: resume must be requested during the actual click. This is
    // useful even when an already played event must not be replayed.
    void player.unlock().catch(() => {});
    if (played || sound.kind === "none") {
      needsAction = false;
      updateButton();
      message(
        sound.kind === "none"
          ? "Esta cinematic não usa efeito sonoro."
          : "Som ativado para os próximos anúncios.",
      );
      return;
    }
    attempt(false);
  });

  const onStorage = (event: StorageEvent) => {
    if (event.key !== AUDIO_PREFERENCES_KEY && event.key !== null) return;
    const previous = preferences;
    const next = loadAudioPreferences();
    preferences = next;
    player.setVolume(next.volume);
    if (!next.enabled || next.volume === 0) {
      cancelPending();
      needsAction = false;
      message(
        next.enabled ? "Volume silenciado." : "Som desativado neste navegador.",
      );
    } else if (
      !previous.enabled &&
      next.enabled &&
      !played &&
      sound.kind !== "none"
    ) {
      needsAction = true;
      message("Toque em Ativar som para habilitar o áudio nesta apresentação.");
    }
    // Enabling in another iframe is a preference update, not a user gesture in
    // this context and not a reason to play an old scene late.
    updateButton();
  };
  window.addEventListener("storage", onStorage);

  updateButton();
  if (sound.kind === "none") message("Esta cinematic não usa efeito sonoro.");
  else if (preferences.enabled) attempt(true);
  else message("Som desativado. Toque em Ativar som para ouvir a entrada.");

  return () => {
    if (disposed) return;
    disposed = true;
    cancelPending();
    window.removeEventListener("storage", onStorage);
    player.dispose();
    controls.remove();
    container.classList.remove("cinematic-has-audio");
  };
}
