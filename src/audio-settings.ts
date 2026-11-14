import { EffectPlayer } from "./audio-engine";
import {
  AUDIO_PREFERENCES_KEY,
  MASTER_SOUND_KEY,
  loadAudioPreferences,
  saveAudioPreferences,
  loadMasterSound,
  saveMasterSound,
} from "./audio-preferences";
import { validateSoundChoice, type SoundChoice } from "./sound-model";
import "./audio-settings.css";

export interface AudioSettingsController {
  setRole(isGM: boolean): void;
  getMasterSound(): SoundChoice;
  testSound(choice: SoundChoice): Promise<void>;
  dispose(): void;
}

/** Personal consent and volume remain separate from the GM's selected effect. */
export function mountAudioSettings(
  container: HTMLElement,
): AudioSettingsController {
  const player = new EffectPlayer();
  const events = new AbortController();
  let preferences = loadAudioPreferences();
  let masterSound = loadMasterSound();
  let isGM = false;
  let playbackAttempt = 0;
  let disposed = false;
  container.classList.add("audio-settings");
  container.innerHTML = `
    <details class="audio-settings-details">
      <summary>Som de entrada <span class="audio-settings-badge"></span></summary>
      <div class="audio-settings-body">
        <p class="audio-settings-help">Cada participante controla o próprio som. Ativar aqui testa este painel; o navegador ainda pode pedir um toque na apresentação.</p>
        <div class="audio-settings-actions">
          <button type="button" class="audio-settings-toggle">Ativar som</button>
          <button type="button" class="audio-settings-test">Testar efeito</button>
        </div>
        <label class="audio-settings-volume">Volume <output></output>
          <input type="range" min="0" max="100" step="1" aria-label="Volume dos efeitos sonoros">
        </label>
        <p class="audio-settings-test-help">O teste manual usa o efeito padrão, mesmo com os anúncios silenciados.</p>
        <div class="audio-settings-master" hidden>
          <label for="master-sound-kind">Efeito geral dos anúncios</label>
          <select id="master-sound-kind">
            <option value="default">Impacto padrão</option>
            <option value="url">Áudio por URL HTTPS</option>
            <option value="none">Sem efeito sonoro</option>
          </select>
          <label class="audio-settings-url-label" for="master-sound-url" hidden>URL do efeito
            <input type="url" id="master-sound-url" maxlength="2048" placeholder="https://seu-site.com/impacto.mp3" autocomplete="off" spellcheck="false">
          </label>
          <p class="audio-settings-help">MP3, WAV ou OGG compatível com o navegador; até 5 segundos e 1 MiB. A URL deve ser pública e permitir CORS. O arquivo precisa estar hospedado para os jogadores acessarem.</p>
          <div class="audio-settings-actions">
            <button type="button" class="audio-settings-save">Salvar efeito geral</button>
            <button type="button" class="audio-settings-reset">Voltar ao efeito padrão</button>
          </div>
          <p class="audio-settings-help">O efeito salvo vale para os próximos anúncios sem efeito específico. Volume e ativação continuam individuais.</p>
        </div>
        <p class="audio-settings-status" role="status" aria-live="polite"></p>
      </div>
    </details>`;
  const find = <T extends HTMLElement>(selector: string) =>
    container.querySelector<T>(selector)!;
  const toggle = find<HTMLButtonElement>(".audio-settings-toggle");
  const badge = find<HTMLSpanElement>(".audio-settings-badge");
  const volume = find<HTMLInputElement>(".audio-settings-volume input");
  const output = find<HTMLOutputElement>(".audio-settings-volume output");
  const testHelp = find<HTMLParagraphElement>(".audio-settings-test-help");
  const masterControls = find<HTMLDivElement>(".audio-settings-master");
  const kind = find<HTMLSelectElement>("#master-sound-kind");
  const source = find<HTMLInputElement>("#master-sound-url");
  const sourceLabel = find<HTMLLabelElement>(".audio-settings-url-label");
  const status = find<HTMLParagraphElement>(".audio-settings-status");

  function report(message: string, error = false): void {
    if (disposed) return;
    status.textContent = message;
    status.classList.toggle("audio-settings-error", error);
  }
  function describeError(error: unknown): string {
    return error instanceof Error
      ? error.message
      : "Não foi possível reproduzir o efeito.";
  }
  function refreshPreferences(): void {
    toggle.textContent = preferences.enabled ? "Desativar som" : "Ativar som";
    toggle.setAttribute("aria-pressed", String(preferences.enabled));
    badge.textContent = preferences.enabled ? "Ativado" : "Desativado";
    badge.classList.toggle("audio-settings-enabled", preferences.enabled);
    volume.value = String(Math.round(preferences.volume * 100));
    output.value = `${Math.round(preferences.volume * 100)}%`;
  }
  function refreshMaster(): void {
    kind.value = masterSound.kind;
    source.value = masterSound.kind === "url" ? masterSound.url : "";
    sourceLabel.hidden = kind.value !== "url";
  }
  function persistPreferences(): boolean {
    const saved = saveAudioPreferences(preferences);
    if (!saved)
      report(
        "Preferências válidas nesta sessão, mas o navegador não permitiu salvá-las.",
        true,
      );
    return saved;
  }
  function readChoice(): SoundChoice {
    return validateSoundChoice(
      kind.value === "url"
        ? { kind: "url", url: source.value }
        : { kind: kind.value },
    );
  }

  /** The play call executes synchronously in the caller's genuine click handler. */
  function testSound(choice: SoundChoice): Promise<void> {
    const attempt = ++playbackAttempt;
    let playback: ReturnType<EffectPlayer["play"]>;
    try {
      const canonical = validateSoundChoice(choice);
      player.stop();
      playback = player.play(canonical, preferences.volume);
      report(
        canonical.kind === "none"
          ? "Este efeito está desativado."
          : "Testando efeito…",
      );
    } catch (error) {
      report(describeError(error), true);
      return Promise.reject(error);
    }
    return playback
      .then((result) => {
        if (disposed || attempt !== playbackAttempt) return;
        if (result === "blocked") {
          report(
            "O navegador bloqueou o áudio. Tente pelo botão Ativar som; na apresentação, use o botão de áudio se solicitado.",
            true,
          );
          throw new Error(
            "O navegador bloqueou o áudio. Use o botão de áudio na apresentação quando solicitado.",
          );
        } else if (result === "played") {
          const persisted = saveAudioPreferences(preferences);
          report(
            persisted
              ? "Efeito testado neste painel. A autorização de áudio pode ser solicitada novamente na apresentação."
              : "Efeito testado. As preferências valem nesta sessão; o navegador não permitiu salvá-las.",
            !persisted,
          );
        } else {
          report("Este efeito está desativado ou o volume está em zero.");
        }
      })
      .catch((error) => {
        if (attempt === playbackAttempt) report(describeError(error), true);
        throw error;
      });
  }

  toggle.addEventListener(
    "click",
    () => {
      preferences = { ...preferences, enabled: !preferences.enabled };
      refreshPreferences();
      if (preferences.enabled) {
        // Explicit interaction tests the built-in sound even if the GM chose silence.
        const playback = testSound(
          isGM && masterSound.kind !== "none"
            ? masterSound
            : { kind: "default" },
        );
        persistPreferences();
        void playback.catch(() => {});
      } else {
        ++playbackAttempt;
        player.stop();
        if (persistPreferences())
          report("Som dos anúncios desativado neste navegador.");
      }
    },
    { signal: events.signal },
  );
  volume.addEventListener(
    "input",
    () => {
      preferences = { ...preferences, volume: Number(volume.value) / 100 };
      player.setVolume(preferences.volume);
      refreshPreferences();
      if (persistPreferences())
        report(
          `Volume ajustado para ${Math.round(preferences.volume * 100)}%.`,
        );
    },
    { signal: events.signal },
  );
  find<HTMLButtonElement>(".audio-settings-test").addEventListener(
    "click",
    () => {
      try {
        void testSound(isGM ? readChoice() : { kind: "default" }).catch(
          () => {},
        );
      } catch (error) {
        report(describeError(error), true);
      }
    },
    { signal: events.signal },
  );
  kind.addEventListener(
    "change",
    () => {
      sourceLabel.hidden = kind.value !== "url";
      report(
        "Seleção ainda não salva. Você pode testar antes de aplicar aos anúncios.",
      );
    },
    { signal: events.signal },
  );
  find<HTMLButtonElement>(".audio-settings-save").addEventListener(
    "click",
    () => {
      if (!isGM) return;
      try {
        masterSound = readChoice();
        const saved = saveMasterSound(masterSound);
        report(
          saved
            ? "Efeito geral salvo para os próximos anúncios."
            : "Efeito geral válido nesta sessão, mas o navegador não permitiu salvá-lo.",
          !saved,
        );
      } catch (error) {
        report(describeError(error), true);
      }
    },
    { signal: events.signal },
  );
  find<HTMLButtonElement>(".audio-settings-reset").addEventListener(
    "click",
    () => {
      if (!isGM) return;
      masterSound = { kind: "default" };
      refreshMaster();
      const saved = saveMasterSound(masterSound);
      report(
        saved
          ? "Efeito padrão restaurado."
          : "Efeito padrão restaurado nesta sessão; não foi possível salvar.",
        !saved,
      );
    },
    { signal: events.signal },
  );
  window.addEventListener(
    "storage",
    (event) => {
      if (event.key === AUDIO_PREFERENCES_KEY) {
        preferences = loadAudioPreferences();
        refreshPreferences();
        player.setVolume(preferences.volume);
        if (!preferences.enabled) {
          ++playbackAttempt;
          player.stop();
        }
      }
      if (event.key === MASTER_SOUND_KEY) {
        masterSound = loadMasterSound();
        refreshMaster();
      }
    },
    { signal: events.signal },
  );

  refreshPreferences();
  refreshMaster();
  return {
    setRole(value) {
      isGM = value;
      masterControls.hidden = !isGM;
      testHelp.textContent = isGM
        ? "O teste manual usa o efeito selecionado, mesmo antes de salvar e com os anúncios silenciados."
        : "O teste manual usa o efeito padrão, mesmo com os anúncios silenciados.";
    },
    getMasterSound: () => validateSoundChoice(masterSound),
    testSound,
    dispose() {
      disposed = true;
      ++playbackAttempt;
      events.abort();
      player.dispose();
      container.replaceChildren();
      container.classList.remove("audio-settings");
    },
  };
}
