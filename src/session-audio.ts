import { EffectPlayer, type PlaybackResult } from "./audio-engine";
import {
  loadAudioPreferences,
  saveAudioPreferences,
  validateAudioPreferences,
  type AudioPreferences,
} from "./audio-preferences";
import { validateSoundChoice, type SoundChoice } from "./sound-model";

export interface SessionAudioStatus extends AudioPreferences {
  /** Actual context readiness, never inferred from a saved enabled flag. */
  ready: boolean;
  phase: "disabled" | "ready" | "blocked" | "loading" | "error";
  message: string;
}

export interface SessionAudioPlayer {
  unlock(): Promise<boolean>;
  play(choice: SoundChoice, volume: number): Promise<PlaybackResult>;
  preload(choice: SoundChoice): Promise<void>;
  setVolume(volume: number): void;
  stop(): void;
  dispose(): void;
  isRunning?(): boolean;
}

interface SessionAudioOptions {
  player?: SessionAudioPlayer;
  loadPreferences?: () => AudioPreferences;
  savePreferences?: (preferences: AudioPreferences) => boolean;
}
interface ActiveEntry {
  eventId: string;
  sound: SoundChoice;
  attempted: boolean;
  played: boolean;
  closed: boolean;
}

/**
 * A single instance lives in the background document for the participant's
 * session. Closing UI documents must never dispose this controller/context.
 */
export class SessionAudioController {
  private readonly player: SessionAudioPlayer;
  private readonly savePreferences: (preferences: AudioPreferences) => boolean;
  private preferences: AudioPreferences;
  private phase: SessionAudioStatus["phase"];
  private message: string;
  private confirmed = false;
  private generation = 0;
  private active?: ActiveEntry;
  private readonly seen = new Set<string>();
  private readonly listeners = new Set<(status: SessionAudioStatus) => void>();
  private disposed = false;
  private persistenceFailed = false;

  constructor(options: SessionAudioOptions = {}) {
    this.player = options.player ?? new EffectPlayer();
    this.savePreferences = options.savePreferences ?? saveAudioPreferences;
    this.preferences = (options.loadPreferences ?? loadAudioPreferences)();
    this.phase = this.preferences.enabled ? "blocked" : "disabled";
    this.message = this.preferences.enabled
      ? "Ative o som nesta sessão para habilitar o controlador persistente."
      : "Som dos anúncios desativado neste navegador.";
  }

  get status(): SessionAudioStatus {
    const ready =
      !this.disposed && this.confirmed && (this.player.isRunning?.() ?? true);
    const suspended = this.confirmed && !ready && this.preferences.enabled;
    return {
      ...this.preferences,
      ready,
      phase: suspended ? "blocked" : this.phase,
      message: suspended
        ? "O navegador suspendeu o áudio. Ative o som novamente nesta sessão."
        : this.message,
    };
  }

  hasPlayed(eventId: string): boolean {
    return this.active?.eventId === eventId && this.active.played;
  }

  markConsumed(eventId: string): void {
    if (this.active?.eventId !== eventId) return;
    this.active.played = true;
    this.active.attempted = true;
  }

  subscribe(listener: (status: SessionAudioStatus) => void): () => void {
    this.listeners.add(listener);
    this.notify(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(listener: (status: SessionAudioStatus) => void): void {
    try {
      listener(this.status);
    } catch {
      this.listeners.delete(
        listener,
      ); /* A destroyed UI cannot interrupt playback or stay subscribed. */
    }
  }

  private publish(
    phase: SessionAudioStatus["phase"],
    message: string,
  ): SessionAudioStatus {
    this.phase = phase;
    this.message = this.persistenceFailed
      ? `${message} O navegador não permitiu salvar a preferência; ela vale nesta sessão.`
      : message;
    for (const listener of this.listeners) this.notify(listener);
    return this.status;
  }

  private persist(): void {
    try {
      this.persistenceFailed = !this.savePreferences(this.preferences);
    } catch {
      this.persistenceFailed = true;
    }
  }

  private cancelPlayback(): void {
    this.generation++;
    this.player.stop();
  }

  private idle(message?: string): SessionAudioStatus {
    if (!this.preferences.enabled)
      return this.publish(
        "disabled",
        message ?? "Som dos anúncios desativado neste navegador.",
      );
    if (this.status.ready)
      return this.publish(
        "ready",
        message ?? "Som pronto nesta sessão para os próximos anúncios.",
      );
    return this.publish(
      "blocked",
      message ??
        "Ative o som nesta sessão. A apresentação visual continua funcionando.",
    );
  }

  updatePreferences(value: AudioPreferences): SessionAudioStatus {
    const preferences = validateAudioPreferences(value);
    // Storage notifications and re-opened panels can echo the current value.
    // Do not write it back, interrupt a pending activation, or reset its status.
    if (
      preferences.enabled === this.preferences.enabled &&
      preferences.volume === this.preferences.volume
    )
      return this.status;
    this.preferences = preferences;
    this.persist();
    this.player.setVolume(this.preferences.volume);
    if (!this.preferences.enabled || this.preferences.volume === 0)
      this.cancelPlayback();
    return this.idle(
      this.preferences.enabled && this.preferences.volume === 0
        ? "Volume em zero. O efeito está silenciado neste navegador."
        : undefined,
    );
  }

  /**
   * Must be called synchronously from a real click in this context or a verified
   * same-origin bridge. No broadcast message can carry the user's activation.
   */
  async activate(
    choice: SoundChoice = { kind: "default" },
  ): Promise<SessionAudioStatus> {
    if (this.disposed) return this.status;
    this.preferences = { ...this.preferences, enabled: true };
    this.persist();
    this.cancelPlayback();
    const generation = this.generation;
    const active = this.active;
    // Do not repeat an entry already heard in a still-visible presentation.
    const alreadyPlayed = active?.played && !active.closed;
    try {
      const canonical = validateSoundChoice(choice);
      const unlocked = this.player.unlock(); // Synchronous invocation during the genuine gesture.
      const playback = alreadyPlayed
        ? Promise.resolve<PlaybackResult>("silent")
        : this.player.play(
            canonical.kind === "none" ? { kind: "default" } : canonical,
            this.preferences.volume,
          );
      this.publish("loading", "Habilitando e testando o áudio desta sessão…");
      const [ready, result] = await Promise.all([unlocked, playback]);
      if (this.disposed || generation !== this.generation) return this.status;
      this.confirmed =
        ready &&
        (result === "played" ||
          (result === "silent" &&
            (alreadyPlayed || this.preferences.volume === 0)));
      if (!this.confirmed || result === "blocked") {
        this.confirmed = false;
        return this.publish(
          "blocked",
          "O navegador não liberou o áudio persistente. Confira as permissões de som/autoplay e tente Ativar som novamente. O visual continua funcionando.",
        );
      }
      if (
        active &&
        active === this.active &&
        !active.closed &&
        result === "played"
      )
        active.played = true;
      return this.idle(
        this.preferences.volume === 0
          ? "Áudio habilitado nesta sessão, mas o volume está em zero e o teste não é audível."
          : alreadyPlayed
            ? "Som pronto nesta sessão. Este anúncio já tocou e não será repetido."
            : "Teste reproduzido. Som pronto nesta sessão para os próximos anúncios.",
      );
    } catch (error) {
      if (this.disposed || generation !== this.generation) return this.status;
      this.confirmed = false;
      return this.publish(
        "error",
        error instanceof Error
          ? error.message
          : "Não foi possível habilitar o áudio. A apresentação visual continua funcionando.",
      );
    }
  }

  /** Explicit tests are independent of the participant's announcement mute. */
  async test(choice: SoundChoice): Promise<SessionAudioStatus> {
    if (this.disposed) return this.status;
    this.cancelPlayback();
    const generation = this.generation;
    try {
      const canonical = validateSoundChoice(choice);
      const playback = this.player.play(canonical, this.preferences.volume);
      this.publish("loading", "Testando efeito no controlador persistente…");
      const result = await playback;
      if (this.disposed || generation !== this.generation) return this.status;
      if (result === "blocked") {
        this.confirmed = false;
        return this.publish(
          "blocked",
          "O navegador bloqueou o teste. Use Ativar som e confira as permissões de áudio.",
        );
      }
      if (result === "played") this.confirmed = true;
      return this.idle(
        result === "played"
          ? this.preferences.enabled
            ? "Efeito testado no controlador persistente."
            : "Efeito testado. Os anúncios continuam desativados neste navegador."
          : "Este efeito está desativado ou o volume está em zero.",
      );
    } catch (error) {
      if (this.disposed || generation !== this.generation) return this.status;
      return this.publish(
        "error",
        error instanceof Error
          ? error.message
          : "Não foi possível testar o efeito.",
      );
    }
  }

  /** Preloading is independent of opening the visual modal and never unlocks. */
  prepare(eventId: string, choice: SoundChoice): void {
    if (this.disposed || this.seen.has(eventId)) return;
    const sound = validateSoundChoice(choice);
    this.seen.add(eventId);
    if (this.seen.size > 256)
      this.seen.delete(this.seen.values().next().value!);
    this.cancelPlayback();
    const active: ActiveEntry = {
      eventId,
      sound,
      attempted: false,
      played: false,
      closed: false,
    };
    this.active = active;
    if (this.preferences.enabled && sound.kind !== "none") {
      void this.player.preload(sound).catch(() => {
        // Playback reports the failure, without delaying or rejecting the modal.
      });
    }
  }

  /** Only a validated local RENDERED for the current announcement may call this. */
  async rendered(eventId: string): Promise<SessionAudioStatus> {
    const active = this.active;
    if (
      this.disposed ||
      !active ||
      active.eventId !== eventId ||
      active.closed ||
      active.played ||
      active.attempted
    )
      return this.status;
    active.attempted = true; // Mark before await: duplicate READY/RENDERED cannot play twice.
    if (!this.preferences.enabled) return this.idle();
    if (active.sound.kind === "none" || this.preferences.volume === 0) {
      active.played = true;
      return this.idle("Esta entrada está silenciada neste navegador.");
    }
    this.cancelPlayback();
    const generation = this.generation;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const playback = this.player.play(active.sound, this.preferences.volume);
      this.publish("loading", "Preparando efeito de entrada…");
      const result = await Promise.race([
        playback,
        new Promise<"late">((resolve) => {
          timer = setTimeout(() => resolve("late"), 1500);
        }),
      ]);
      if (
        this.disposed ||
        generation !== this.generation ||
        active !== this.active
      )
        return this.status;
      if (result === "late") {
        this.cancelPlayback();
        return this.publish(
          "error",
          "O efeito demorou a carregar e foi cancelado para não tocar fora de hora. Teste o áudio antes do próximo anúncio.",
        );
      }
      if (result === "blocked") {
        this.confirmed = false;
        return this.publish(
          "blocked",
          "O navegador bloqueou o áudio persistente. Use Ativar som e confira as permissões; a apresentação continua funcionando.",
        );
      }
      if (result === "played") {
        active.played = true;
        this.confirmed = true;
      }
      return this.idle(
        result === "played" ? "" : "Efeito silenciado para esta entrada.",
      );
    } catch (error) {
      if (
        this.disposed ||
        generation !== this.generation ||
        active !== this.active
      )
        return this.status;
      return this.publish(
        "error",
        error instanceof Error
          ? error.message
          : "Efeito indisponível. A apresentação visual continua funcionando.",
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** A stale modal's close must never stop a newer announcement's effect. */
  stop(eventId: string): void {
    if (!this.active || this.active.eventId !== eventId || this.active.closed)
      return;
    this.active.closed = true;
    this.cancelPlayback();
    this.idle();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPlayback();
    this.player.dispose();
    this.listeners.clear();
  }
}
