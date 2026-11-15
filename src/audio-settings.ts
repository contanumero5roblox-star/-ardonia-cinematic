import OBR from "@owlbear-rodeo/sdk";
import { findAudioBridge } from "./audio-bridge";
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
  let lastSessionIssue = "";
  container.classList.add("audio-settings");
  container.innerHTML = `
    <details class="audio-settings-details">
      <summary>Som de entrada <span class="audio-settings-badge"></span></summary>
      <div class="audio-settings-body">
        <p class="audio-settings-help">Ative uma vez por sessão. O teste confirma o controlador que continua ligado mesmo com este painel e as apresentações fechados. Se o navegador bloquear, mostraremos um aviso.</p>
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
    const session = findAudioBridge()?.status();
    if (session)
      preferences = { enabled: session.enabled, volume: session.volume };
    const active =
      preferences.enabled && (!OBR.isAvailable || session?.ready === true);
    toggle.textContent = active ? "Desativar som" : "Ativar som";
    toggle.setAttribute("aria-pressed", String(active));
    badge.textContent = !preferences.enabled
      ? "Desativado"
      : session?.ready
        ? "Pronto nesta sessão"
        : "Precisa ativar nesta sessão";
    badge.classList.toggle("audio-settings-enabled", active);
    const issue =
      session &&
      preferences.enabled &&
      (session.phase === "blocked" || session.phase === "error")
        ? session.message
        : "";
    if (issue && issue !== lastSessionIssue) report(issue, true);
    lastSessionIssue = issue;
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

  function sessionResult(result: {
    ready: boolean;
    phase: string;
    message: string;
  }): void {
    refreshPreferences();
    report(
      result.message,
      result.phase === "blocked" || result.phase === "error",
    );
    if (result.phase === "blocked" || result.phase === "error")
      throw new Error(result.message);
  }

  /** A same-origin call reaches the persistent owner during the real click. */
  function testSound(choice: SoundChoice): Promise<void> {
    const canonical = validateSoundChoice(choice);
    const bridge = findAudioBridge();
    if (bridge) {
      // Retire a standalone preview test before handing playback to the owner.
      ++playbackAttempt;
      player.stop();
      return bridge.test(canonical).then(sessionResult);
    }
    if (OBR.isAvailable) {
      const message =
        "O controlador de áudio não está acessível. Recarregue a sala e ative o som em Som de entrada. Nenhum teste local foi iniciado para evitar fontes simultâneas.";
      report(message, true);
      return Promise.reject(new Error(message));
    }
    // Standalone/local preview remains useful, but is never called session readiness.
    const attempt = ++playbackAttempt;
    const playback = player.play(canonical, preferences.volume);
    report("Testando efeito local…");
    return playback
      .then((result) => {
        if (disposed || attempt !== playbackAttempt) return;
        if (result === "blocked")
          throw new Error(
            "O navegador bloqueou o áudio. Autorize o som deste site e use Som de entrada no painel.",
          );
        report(
          result === "played"
            ? "Efeito testado localmente. O controlador persistente não está acessível; a sessão não foi liberada."
            : "Este efeito está desativado ou o volume está em zero.",
        );
      })
      .catch((error) => {
        report(describeError(error), true);
        throw error;
      });
  }

  toggle.addEventListener(
    "click",
    () => {
      const bridge = findAudioBridge();
      const ready = bridge?.status().ready === true;
      if (bridge) {
        ++playbackAttempt;
        player.stop();
      }
      if (preferences.enabled && (!OBR.isAvailable || ready)) {
        preferences = { ...preferences, enabled: false };
        ++playbackAttempt;
        player.stop();
        bridge?.updatePreferences(preferences);
        if (persistPreferences())
          report("Som dos anúncios desativado neste navegador.");
        refreshPreferences();
        return;
      }
      preferences = { ...preferences, enabled: true };
      if (bridge) {
        // No await/broadcast before this call: resume executes in the background now.
        const activation = bridge.activate(
          isGM && masterSound.kind !== "none"
            ? masterSound
            : { kind: "default" },
        );
        persistPreferences();
        void activation
          .then(sessionResult)
          .catch((error) => report(describeError(error), true));
      } else {
        persistPreferences();
        void testSound({ kind: "default" })
          .then(() => {
            if (OBR.isAvailable)
              report(
                "O controlador persistente não está acessível. Recarregue a sala e autorize o som do site; o teste local não libera anúncios automáticos.",
                true,
              );
          })
          .catch(() => {});
      }
      refreshPreferences();
    },
    { signal: events.signal },
  );
  volume.addEventListener(
    "input",
    () => {
      preferences = { ...preferences, volume: Number(volume.value) / 100 };
      player.setVolume(preferences.volume);
      findAudioBridge()?.updatePreferences(preferences);
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

  const statusPoll = setInterval(() => {
    if (!disposed) refreshPreferences();
  }, 1000);
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
      clearInterval(statusPoll);
      player.dispose(); // Local test only; the background owner survives this UI.
      container.replaceChildren();
      container.classList.remove("audio-settings");
    },
  };
}
