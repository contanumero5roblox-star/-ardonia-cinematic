import { validateSoundChoice, type SoundChoice } from "./sound-model";

export interface AudioPreferences {
  enabled: boolean;
  volume: number;
}

type StoragePort = Pick<Storage, "getItem" | "setItem">;

export const AUDIO_PREFERENCES_KEY = "com.ardonia.cinematic.audio.v1";
export const MASTER_SOUND_KEY = "com.ardonia.cinematic.master-sound.v1";
export const DEFAULT_AUDIO_PREFERENCES: Readonly<AudioPreferences> =
  Object.freeze({ enabled: false, volume: 0.65 });

export function validateAudioPreferences(value: unknown): AudioPreferences {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Preferências de áudio inválidas.");
  }
  const data = value as Record<string, unknown>;
  if (
    !Object.prototype.hasOwnProperty.call(data, "enabled") ||
    !Object.prototype.hasOwnProperty.call(data, "volume") ||
    typeof data.enabled !== "boolean" ||
    typeof data.volume !== "number" ||
    !Number.isFinite(data.volume) ||
    data.volume < 0 ||
    data.volume > 1
  ) {
    throw new Error("As preferências exigem volume entre 0 e 100%.");
  }
  return { enabled: data.enabled, volume: data.volume };
}

/** Preference failure never prevents an announcement or writes over corrupt data. */
export function loadAudioPreferences(
  providedStorage?: StoragePort,
): AudioPreferences {
  try {
    const storage = providedStorage ?? globalThis.localStorage;
    const source = storage.getItem(AUDIO_PREFERENCES_KEY);
    if (source !== null) return validateAudioPreferences(JSON.parse(source));
  } catch {
    // Browsers can block third-party storage; the safe default is always muted.
  }
  return { ...DEFAULT_AUDIO_PREFERENCES };
}

/** The caller keeps current settings in memory if persistence is unavailable. */
export function saveAudioPreferences(
  preferences: AudioPreferences,
  providedStorage?: StoragePort,
): boolean {
  try {
    const canonical = validateAudioPreferences(preferences);
    const storage = providedStorage ?? globalThis.localStorage;
    storage.setItem(AUDIO_PREFERENCES_KEY, JSON.stringify(canonical));
    return true;
  } catch {
    return false;
  }
}

/** The GM's selection is local; only each resolved announcement choice is shared. */
export function loadMasterSound(providedStorage?: StoragePort): SoundChoice {
  try {
    const storage = providedStorage ?? globalThis.localStorage;
    const source = storage.getItem(MASTER_SOUND_KEY);
    if (source !== null) return validateSoundChoice(JSON.parse(source));
  } catch {
    // Invalid settings fall back without preventing visual announcements.
  }
  return { kind: "default" };
}

export function saveMasterSound(
  sound: SoundChoice,
  providedStorage?: StoragePort,
): boolean {
  try {
    const canonical = validateSoundChoice(sound);
    const storage = providedStorage ?? globalThis.localStorage;
    storage.setItem(MASTER_SOUND_KEY, JSON.stringify(canonical));
    return true;
  } catch {
    return false;
  }
}
