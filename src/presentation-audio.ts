import OBR from "@owlbear-rodeo/sdk";
import { AUDIO_RENDERED, AUDIO_STOP, findAudioBridge } from "./audio-bridge";
import type { SoundChoice } from "./sound-model";

/**
 * The presentation only signals its lifecycle. The persistent background owns
 * playback, preferences and status; audio never adds UI or blocks the scene.
 */
export function mountPresentationAudio(
  _container: HTMLElement,
  eventId: string,
  _sound: SoundChoice,
): () => void {
  let disposed = false;
  let frame: number | undefined;

  function send(channel: string): void {
    if (!OBR.isAvailable) return;
    void OBR.broadcast
      .sendMessage(channel, { eventId }, { destination: "LOCAL" })
      .catch(() => {
        // Audio failures are reported by the main panel, never on the cinematic.
      });
  }

  if (OBR.isAvailable) {
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (!disposed) send(AUDIO_RENDERED);
    });
  }

  return () => {
    if (disposed) return;
    disposed = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    // A same-origin direct stop cancels pending playback in this task. The
    // background checks the ID, so closing an old modal cannot stop a new scene.
    try {
      findAudioBridge()?.stop(eventId);
    } catch {
      // A restarted or isolated background still has the SDK stop route below.
    }
    send(AUDIO_STOP);
  };
}
