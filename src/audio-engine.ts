import {
  validateSoundChoice,
  MAX_SOUND_BYTES,
  MAX_SOUND_DURATION_SECONDS,
  type SoundChoice,
} from "./sound-model";

export type PlaybackResult = "played" | "blocked" | "silent";

export class AudioEffectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioEffectError";
  }
}

interface EffectPlayerOptions {
  /** Dependency injection for tests; normal clients use the browser APIs. */
  contextFactory?: () => AudioContext;
  fetcher?: typeof fetch;
  baseUrl?: string;
}

/** One owner per document. Never unlocks or plays in another iframe. */
export class EffectPlayer {
  private context?: AudioContext;
  private active?: { source: AudioBufferSourceNode; gain: GainNode };
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loading = new Map<string, Promise<AudioBuffer>>();
  private readonly controllers = new Set<AbortController>();
  private generation = 0;
  private desiredVolume = 1;
  private disposed = false;

  constructor(private readonly options: EffectPlayerOptions = {}) {}

  private getContext(): AudioContext {
    if (this.disposed) throw new AudioEffectError("O áudio foi encerrado.");
    if (!this.context) {
      try {
        const Constructor =
          globalThis.AudioContext ??
          (
            globalThis as typeof globalThis & {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext;
        if (!this.options.contextFactory && !Constructor)
          throw new Error("AudioContext unavailable");
        this.context = this.options.contextFactory?.() ?? new Constructor!();
      } catch {
        throw new AudioEffectError(
          "Este navegador não disponibilizou o áudio. A apresentação visual continua funcionando.",
        );
      }
    }
    return this.context;
  }

  /** Call directly inside a real click/touch handler, before awaiting anything. */
  async unlock(): Promise<boolean> {
    const context = this.getContext();
    if (context.state === "running") return true;
    let resume: Promise<void>;
    try {
      // Do not move this call into a timer or a broadcast callback: activation is local.
      resume = context.resume();
    } catch {
      return false;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        resume.catch(() => {}),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 250);
        }),
      ]);
      return !this.disposed && (context.state as string) === "running";
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private resolve(choice: SoundChoice): string | undefined {
    const checked = validateSoundChoice(choice, this.options.baseUrl);
    if (checked.kind === "none") return undefined;
    if (checked.kind === "url") return checked.url;
    const base = this.options.baseUrl ?? globalThis.location?.href;
    if (!base)
      throw new AudioEffectError("Não foi possível localizar o efeito padrão.");
    return new URL("sounds/impact.wav", base).href;
  }

  private async download(url: string): Promise<AudioBuffer> {
    const controller = new AbortController();
    this.controllers.add(controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const operation = (async () => {
      const response = await (this.options.fetcher ?? globalThis.fetch)(url, {
        signal: controller.signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        mode: "cors",
      });
      if (!response.ok)
        throw new AudioEffectError(
          "Não foi possível carregar o efeito. Confira se o arquivo é público e permite CORS.",
        );
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > MAX_SOUND_BYTES) {
        void response.body?.cancel().catch(() => {});
        throw new AudioEffectError("O efeito deve ter no máximo 1 MiB.");
      }
      let bytes: Uint8Array;
      if (response.body) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            total += part.value.byteLength;
            if (total > MAX_SOUND_BYTES) {
              throw new AudioEffectError("O efeito deve ter no máximo 1 MiB.");
            }
            chunks.push(part.value);
          }
          bytes = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
        } catch (error) {
          void reader.cancel().catch(() => {});
          throw error;
        } finally {
          reader.releaseLock();
        }
      } else {
        bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > MAX_SOUND_BYTES)
          throw new AudioEffectError("O efeito deve ter no máximo 1 MiB.");
      }
      if (!bytes.byteLength)
        throw new AudioEffectError("O arquivo de efeito está vazio.");
      let buffer: AudioBuffer;
      try {
        buffer = await this.getContext().decodeAudioData(
          bytes.buffer as ArrayBuffer,
        );
      } catch {
        throw new AudioEffectError(
          "Áudio inválido ou formato não suportado neste navegador. Experimente MP3 ou WAV.",
        );
      }
      if (
        !Number.isFinite(buffer.duration) ||
        buffer.duration <= 0 ||
        buffer.duration > MAX_SOUND_DURATION_SECONDS
      ) {
        throw new AudioEffectError("O efeito deve durar no máximo 5 segundos.");
      }
      return buffer;
    })();
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(
              new AudioEffectError(
                "O efeito demorou para carregar. Tente novamente ou use o efeito padrão.",
              ),
            );
          }, 6000);
        }),
      ]);
    } catch (error) {
      controller.abort();
      if (error instanceof AudioEffectError) throw error;
      throw new AudioEffectError(
        "Não foi possível carregar o efeito. Verifique a conexão e o acesso público com CORS.",
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }

  private getBuffer(url: string): Promise<AudioBuffer> {
    const cached = this.buffers.get(url);
    if (cached) {
      this.buffers.delete(url);
      this.buffers.set(url, cached);
      return Promise.resolve(cached);
    }
    const pending = this.loading.get(url);
    if (pending) return pending;
    const operation = this.download(url)
      .then((buffer) => {
        if (!this.disposed) {
          this.buffers.set(url, buffer);
          if (this.buffers.size > 4)
            this.buffers.delete(this.buffers.keys().next().value!);
        }
        return buffer;
      })
      .finally(() => {
        this.loading.delete(url);
      });
    this.loading.set(url, operation);
    return operation;
  }

  /** Loads and validates only: never resumes a context or schedules a source. */
  async preload(choice: SoundChoice): Promise<void> {
    if (this.disposed) throw new AudioEffectError("O áudio foi encerrado.");
    const url = this.resolve(choice);
    if (url) await this.getBuffer(url);
  }

  /** A stopped/replaced request can finish downloading, but can never start later. */
  async play(choice: SoundChoice, volume: number): Promise<PlaybackResult> {
    this.stop();
    const generation = this.generation;
    const url = this.resolve(choice);
    const gainValue = Number.isFinite(volume)
      ? Math.max(0, Math.min(1, volume))
      : 0;
    if (!url || gainValue === 0) return "silent";
    this.desiredVolume = gainValue;
    const unlocked = this.unlock(); // Calls resume synchronously while gesture is active.
    if (!(await unlocked)) return "blocked";
    const buffer = await this.getBuffer(url);
    if (this.disposed || generation !== this.generation) return "silent";
    const context = this.getContext();
    if (context.state !== "running") return "blocked";
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = false;
    gain.gain.value = this.desiredVolume;
    source.connect(gain);
    gain.connect(context.destination);
    this.active = { source, gain };
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      if (this.active?.source === source) this.active = undefined;
    };
    try {
      source.start();
    } catch {
      this.stop();
      throw new AudioEffectError(
        "Não foi possível iniciar o efeito. Tente habilitar o áudio novamente.",
      );
    }
    return "played";
  }

  setVolume(volume: number): void {
    const value = Number.isFinite(volume)
      ? Math.max(0, Math.min(1, volume))
      : 0;
    this.desiredVolume = value;
    if (value === 0) {
      this.stop();
      return;
    }
    if (this.active) this.active.gain.gain.value = value;
  }

  stop(): void {
    this.generation++;
    const active = this.active;
    this.active = undefined;
    if (!active) return;
    active.source.onended = null;
    try {
      active.source.stop();
    } catch {
      /* An ended source is already silent. */
    }
    active.source.disconnect();
    active.gain.disconnect();
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.buffers.clear();
    if (this.context && this.context.state !== "closed") {
      try {
        void this.context.close().catch(() => {});
      } catch {
        /* Closing is best effort. */
      }
    }
  }
}
