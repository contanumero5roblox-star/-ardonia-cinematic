/** Only a small effect choice is transmitted; audio bytes never enter broadcasts. */
export type SoundChoice =
  | { kind: "default" }
  | { kind: "url"; url: string }
  | { kind: "none" };

export const DEFAULT_SOUND: SoundChoice = Object.freeze({ kind: "default" });
export const MAX_SOUND_URL_LENGTH = 2048;
export const MAX_SOUND_BYTES = 1024 * 1024;
export const MAX_SOUND_DURATION_SECONDS = 5;

export class SoundValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SoundValidationError";
  }
}

/** Keep signed URLs unchanged; only permit safe network sources, not local blobs. */
export function validateSoundChoice(
  value: unknown,
  baseUrl?: string,
): SoundChoice {
  if (value === undefined) return { kind: "default" };
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SoundValidationError("Escolha de efeito sonoro inválida.");
  }
  const data = value as Record<string, unknown>;
  const kind = Object.prototype.hasOwnProperty.call(data, "kind")
    ? data.kind
    : undefined;
  if (kind === "default" || kind === "none") return { kind };
  if (
    kind !== "url" ||
    !Object.prototype.hasOwnProperty.call(data, "url") ||
    typeof data.url !== "string"
  ) {
    throw new SoundValidationError("Escolha de efeito sonoro inválida.");
  }
  const source = data.url.trim();
  if (!source || source.length > MAX_SOUND_URL_LENGTH) {
    throw new SoundValidationError(
      "A URL do som deve ter entre 1 e 2.048 caracteres.",
    );
  }
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new SoundValidationError("Use uma URL completa de áudio com HTTPS.");
  }
  if (url.username || url.password) {
    throw new SoundValidationError("A URL do som não pode conter credenciais.");
  }
  const current =
    baseUrl ?? (typeof location !== "undefined" ? location.href : undefined);
  let localDevelopment = false;
  if (current) {
    try {
      const base = new URL(current);
      localDevelopment =
        url.protocol === "http:" &&
        url.origin === base.origin &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    } catch {
      // An invalid development origin never relaxes the HTTPS requirement.
    }
  }
  if (url.protocol !== "https:" && !localDevelopment) {
    throw new SoundValidationError("O efeito sonoro deve usar HTTPS.");
  }
  return { kind: "url", url: source };
}
