import {
  validateSoundChoice,
  type SoundChoice,
  DEFAULT_SOUND,
} from "./sound-model";
import { parseCinematic, ValidationError, type Cinematic } from "./model";

export const CHANNEL_ANNOUNCE = "ardonia-cinematic/announce/v1";
export const CHANNEL_READY = "ardonia-cinematic/ready/v1";
export const CHANNEL_DATA = "ardonia-cinematic/data/v1";
export const MODAL_ID = "ardonia-cinematic:screen";
export const MAX_EVENT_AGE_MS = 120_000;
export const MAX_CLOCK_SKEW_MS = 120_000;
/** An application budget, not a claimed SDK/server quota. */
export const MAX_MESSAGE_BYTES = 15_000;

export interface Announcement {
  version: 1;
  eventId: string;
  sentAt: number;
  cinematic: Cinematic;
  sound?: SoundChoice;
}

export interface PresentationData {
  eventId: string;
  cinematic: Cinematic;
  sound?: SoundChoice;
}

export function isEventId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

/** Only public, selected cinematic data is included in this transient message. */
export function createAnnouncement(
  cinematic: Cinematic,
  masterSound: SoundChoice = DEFAULT_SOUND,
): Announcement {
  return parseAnnouncement({
    version: 1,
    eventId: crypto.randomUUID(),
    sentAt: Date.now(),
    cinematic: parseCinematic(cinematic),
    sound: validateSoundChoice(cinematic.sound ?? masterSound),
  });
}

export function parseAnnouncement(
  value: unknown,
  now = Date.now(),
): Announcement {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Anúncio inválido.");
  }
  const event = value as Record<string, unknown>;
  if (
    event.version !== 1 ||
    !isEventId(event.eventId) ||
    typeof event.sentAt !== "number" ||
    !Number.isSafeInteger(event.sentAt) ||
    event.sentAt < now - MAX_EVENT_AGE_MS ||
    event.sentAt > now + MAX_CLOCK_SKEW_MS
  ) {
    throw new ValidationError(
      "Anúncio inválido, expirado ou com relógio incompatível.",
    );
  }
  const result: Announcement = {
    version: 1,
    eventId: event.eventId,
    sentAt: event.sentAt,
    cinematic: parseCinematic(event.cinematic),
    ...(event.sound === undefined
      ? {}
      : { sound: validateSoundChoice(event.sound) }),
  };
  if (
    new TextEncoder().encode(JSON.stringify(result)).byteLength >
    MAX_MESSAGE_BYTES
  ) {
    throw new ValidationError(
      "O anúncio excede 15.000 bytes. Reduza a descrição ou a URL da imagem.",
    );
  }
  return result;
}
