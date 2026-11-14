import { describe, expect, it, vi, afterEach } from "vitest";
import {
  SessionAudioController,
  type SessionAudioPlayer,
} from "../src/session-audio";
import type { PlaybackResult } from "../src/audio-engine";

const standard = { kind: "default" } as const;
const custom = { kind: "url", url: "https://example.test/entry.mp3" } as const;
function fixture(enabled = false, volume = 0.65) {
  const player = {
    unlock: vi.fn(async () => true),
    play: vi.fn(async (): Promise<PlaybackResult> => "played"),
    preload: vi.fn(async () => {}),
    setVolume: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
    isRunning: vi.fn(() => true),
  } satisfies SessionAudioPlayer;
  const save = vi.fn(() => true);
  const controller = new SessionAudioController({
    player,
    loadPreferences: () => ({ enabled, volume }),
    savePreferences: save,
  });
  return { controller, player, save };
}
afterEach(() => vi.useRealTimers());

describe("participant persistent audio session", () => {
  it("never confuses a saved enabled preference with a ready audio context", () => {
    const f = fixture(true);
    expect(f.controller.status).toMatchObject({
      enabled: true,
      ready: false,
      phase: "blocked",
    });
    expect(f.player.play).not.toHaveBeenCalled();
  });

  it("requests unlock and confirmation synchronously before the gesture handler returns", async () => {
    const f = fixture();
    const activation = f.controller.activate(custom);
    expect(f.player.unlock).toHaveBeenCalledOnce();
    expect(f.player.play).toHaveBeenCalledExactlyOnceWith(custom, 0.65);
    expect(await activation).toMatchObject({
      enabled: true,
      ready: true,
      phase: "ready",
    });
    expect(f.save).toHaveBeenCalledWith({ enabled: true, volume: 0.65 });
  });

  it("plays three announcements with one activation, close between them and no UI context disposal", async () => {
    const f = fixture();
    await f.controller.activate();
    for (const id of ["first", "second", "third"]) {
      f.controller.prepare(id, custom);
      await f.controller.rendered(id);
      f.controller.stop(id);
    }
    expect(f.player.unlock).toHaveBeenCalledTimes(1);
    expect(f.player.play).toHaveBeenCalledTimes(4); // Confirmation plus three entries.
    expect(f.player.dispose).not.toHaveBeenCalled();
    expect(f.controller.status.ready).toBe(true);
  });

  it("preloads without scheduling and consumes repeated rendered/prepare notifications", async () => {
    const f = fixture(true);
    f.controller.prepare("one", custom);
    expect(f.player.preload).toHaveBeenCalledExactlyOnceWith(custom);
    expect(f.player.play).not.toHaveBeenCalled();
    await Promise.all([
      f.controller.rendered("one"),
      f.controller.rendered("one"),
    ]);
    f.controller.prepare("one", standard);
    await f.controller.rendered("one");
    expect(f.player.play).toHaveBeenCalledOnce();
    expect(f.player.play).toHaveBeenCalledWith(custom, 0.65);
  });

  it("ignores stale modal closes and rendered messages after the newer entry is active", async () => {
    const f = fixture(true);
    f.controller.prepare("old", standard);
    f.controller.prepare("new", custom);
    const stops = f.player.stop.mock.calls.length;
    f.controller.stop("old");
    await f.controller.rendered("old");
    expect(f.player.stop).toHaveBeenCalledTimes(stops);
    await f.controller.rendered("new");
    expect(f.player.play).toHaveBeenCalledExactlyOnceWith(custom, 0.65);
  });

  it("retains custom effects, personal gain and silence across announcements", async () => {
    const f = fixture(true, 0.2);
    f.controller.prepare("custom", custom);
    await f.controller.rendered("custom");
    expect(f.player.play).toHaveBeenLastCalledWith(custom, 0.2);
    f.controller.updatePreferences({ enabled: true, volume: 0.8 });
    expect(f.player.setVolume).toHaveBeenLastCalledWith(0.8);
    f.controller.prepare("silent", { kind: "none" });
    await f.controller.rendered("silent");
    expect(f.player.play).toHaveBeenCalledOnce();
    f.controller.updatePreferences({ enabled: false, volume: 0.8 });
    f.controller.prepare("muted", custom);
    await f.controller.rendered("muted");
    expect(f.player.play).toHaveBeenCalledOnce();
  });

  it("reports blocked activation truthfully rather than claiming the session is unlocked", async () => {
    const f = fixture();
    f.player.unlock.mockResolvedValue(false);
    f.player.play.mockResolvedValue("blocked");
    const status = await f.controller.activate();
    expect(status).toMatchObject({
      enabled: true,
      ready: false,
      phase: "blocked",
    });
    expect(status.message).toContain("não liberou");
  });

  it("reflects native context suspension even after a previously successful activation", async () => {
    const f = fixture();
    await f.controller.activate();
    f.player.isRunning.mockReturnValue(false);
    expect(f.controller.status).toMatchObject({
      ready: false,
      phase: "blocked",
    });
    expect(f.controller.status.message).toContain("suspendeu");
  });

  it("does not announce an audible confirmation at volume zero", async () => {
    const f = fixture(false, 0);
    f.player.play.mockResolvedValue("silent");
    const status = await f.controller.activate();
    expect(status.ready).toBe(true);
    expect(status.message).toContain("teste não é audível");
  });

  it("manual fallback after blocked rendered plays once; toggling again does not repeat a heard entry", async () => {
    const f = fixture(true);
    f.controller.prepare("one", custom);
    f.player.play.mockResolvedValueOnce("blocked");
    await f.controller.rendered("one");
    await f.controller.activate(custom);
    expect(f.controller.hasPlayed("one")).toBe(true);
    expect(f.controller.hasPlayed("other")).toBe(false);
    await f.controller.rendered("one");
    await f.controller.activate(custom);
    expect(f.player.play).toHaveBeenCalledTimes(2);
  });

  it("keeps tests separate from the participant's announcement mute", async () => {
    const f = fixture();
    const status = await f.controller.test(custom);
    expect(status).toMatchObject({
      enabled: false,
      ready: true,
      phase: "disabled",
    });
    expect(status.message).toContain("anúncios continuam desativados");
  });

  it("cancels delayed starts when the presentation closes", async () => {
    const f = fixture(true);
    let finish!: (value: PlaybackResult) => void;
    f.player.play.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    f.controller.prepare("one", custom);
    const pending = f.controller.rendered("one");
    f.controller.stop("one");
    finish("played");
    await pending;
    await f.controller.rendered("one");
    expect(f.player.play).toHaveBeenCalledOnce();
    expect(f.controller.status.ready).toBe(false);
  });

  it("bounds automatic entry latency and ignores eventual completion", async () => {
    vi.useFakeTimers();
    const f = fixture(true);
    let finish!: (value: PlaybackResult) => void;
    f.player.play.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    f.controller.prepare("one", standard);
    const pending = f.controller.rendered("one");
    await vi.advanceTimersByTimeAsync(1500);
    expect((await pending).message).toContain("fora de hora");
    finish("played");
    await Promise.resolve();
    expect(f.controller.status.ready).toBe(false);
  });

  it("handles decoder errors and preference persistence failure without disposing the session", async () => {
    const f = fixture();
    f.save.mockReturnValue(false);
    f.player.play.mockRejectedValueOnce(new Error("Formato indisponível"));
    const status = await f.controller.activate();
    expect(status.phase).toBe("error");
    expect(status.message).toContain("não permitiu salvar");
    expect(f.player.dispose).not.toHaveBeenCalled();
  });

  it("allows unsubscribe and keeps subscriber errors outside the audio pipeline", async () => {
    const f = fixture();
    const listener = vi.fn();
    const unsubscribe = f.controller.subscribe(listener);
    f.controller.subscribe(() => {
      throw new Error("UI failed");
    });
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    await f.controller.activate();
    expect(listener).toHaveBeenCalledOnce();
    expect(f.controller.status.ready).toBe(true);
  });

  it("only runtime teardown closes the persistent owner and it is idempotent", async () => {
    const f = fixture();
    await f.controller.activate();
    f.controller.dispose();
    f.controller.dispose();
    expect(f.player.dispose).toHaveBeenCalledOnce();
    expect(f.controller.status.ready).toBe(false);
    f.controller.prepare("after", custom);
    await f.controller.rendered("after");
    expect(f.player.play).toHaveBeenCalledTimes(1);
  });

  it("does not duplicate an activation confirmation when RENDERED arrives afterwards", async () => {
    const f = fixture();
    f.controller.prepare("one", custom);
    await f.controller.activate(custom);
    expect(f.controller.hasPlayed("one")).toBe(true);
    await f.controller.rendered("one");
    expect(f.player.play).toHaveBeenCalledOnce();
  });

  it("does not persist or interrupt status when another frame echoes identical preferences", async () => {
    const f = fixture();
    let finish!: (value: PlaybackResult) => void;
    f.player.play.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const activation = f.controller.activate();
    const stops = f.player.stop.mock.calls.length;
    const saves = f.save.mock.calls.length;
    const status = f.controller.updatePreferences({
      enabled: true,
      volume: 0.65,
    });
    expect(status.phase).toBe("loading");
    expect(f.player.stop).toHaveBeenCalledTimes(stops);
    expect(f.save).toHaveBeenCalledTimes(saves);
    finish("played");
    expect((await activation).ready).toBe(true);
  });

  it("retains a manual fallback consumption for the matching closed entry only", () => {
    const f = fixture(true);
    f.controller.prepare("one", custom);
    f.controller.stop("one");
    f.controller.markConsumed("different");
    expect(f.controller.hasPlayed("one")).toBe(false);
    f.controller.markConsumed("one");
    expect(f.controller.hasPlayed("one")).toBe(true);
  });
});
