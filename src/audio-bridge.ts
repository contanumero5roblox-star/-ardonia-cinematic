import type { AudioPreferences } from "./audio-preferences";
import type { SoundChoice } from "./sound-model";
import type { SessionAudioStatus } from "./session-audio";

export const AUDIO_BRIDGE_KEY = "__ardoniaAudioSessionV1__";
export const AUDIO_RENDERED = "ardonia-cinematic/audio-rendered/v1";
export const AUDIO_STOP = "ardonia-cinematic/audio-stop/v1";
export const AUDIO_STATUS = "ardonia-cinematic/audio-status/v1";

/** Direct same-origin call, made inside a real click; async broadcasts cannot carry activation. */
export interface AudioSessionBridge {
  version: 1;
  scope: string;
  activate(sound?: SoundChoice): Promise<SessionAudioStatus>;
  test(sound: SoundChoice): Promise<SessionAudioStatus>;
  status(): SessionAudioStatus;
  updatePreferences(preferences: AudioPreferences): SessionAudioStatus;
  subscribe(callback: (status: SessionAudioStatus) => void): () => void;
  stop(eventId: string): void;
  consumed(eventId: string): boolean;
}

type BridgeWindow = Window & { [AUDIO_BRIDGE_KEY]?: AudioSessionBridge };

export function publishAudioBridge(bridge: AudioSessionBridge): () => void {
  const owner = window as BridgeWindow;
  owner[AUDIO_BRIDGE_KEY] = bridge;
  return () => {
    if (owner[AUDIO_BRIDGE_KEY] === bridge) delete owner[AUDIO_BRIDGE_KEY];
  };
}

/** WindowProxy indexed access is permitted across origins; foreign DOM/properties are never read. */
export function findAudioBridge(): AudioSessionBridge | undefined {
  const scope = new URL(".", window.location.href).href;
  const visited = new Set<Window>();
  let remaining = 128;
  function visit(
    candidate: Window,
    depth: number,
  ): AudioSessionBridge | undefined {
    if (remaining-- <= 0 || depth > 6 || visited.has(candidate)) return;
    visited.add(candidate);
    try {
      // Reading this property succeeds only in same-origin windows. Other apps
      // on the same host cannot be mistaken for this deployment's background.
      const bridge = (candidate as BridgeWindow)[AUDIO_BRIDGE_KEY];
      if (
        bridge?.version === 1 &&
        bridge.scope === scope &&
        typeof bridge.activate === "function" &&
        typeof bridge.status === "function"
      )
        return bridge;
    } catch {
      /* Expected for the Owlbear host and unrelated extensions. */
    }
    try {
      const count = Math.min(candidate.length, 128);
      for (let i = 0; i < count; i++) {
        const found = visit(candidate[i], depth + 1);
        if (found) return found;
      }
    } catch {
      /* An isolated frame may not expose its children. */
    }
  }
  try {
    return visit(window.top ?? window, 0);
  } catch {
    return visit(window, 0);
  }
}
