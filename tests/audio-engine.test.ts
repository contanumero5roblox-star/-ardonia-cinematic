import { afterEach, describe, expect, it, vi } from "vitest";
import { EffectPlayer } from "../src/audio-engine";
import { MAX_SOUND_BYTES } from "../src/sound-model";

function fixture(state: AudioContextState = "running") {
  const sources: any[] = [];
  const gains: any[] = [];
  const context = {
    state,
    destination: {},
    resume: vi.fn(async () => {
      context.state = "running";
    }),
    decodeAudioData: vi.fn(async () => ({ duration: 0.9 })),
    createBufferSource: vi.fn(() => {
      const source = {
        start: vi.fn(),
        stop: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        onended: null,
        buffer: null,
        loop: true,
      };
      sources.push(source);
      return source;
    }),
    createGain: vi.fn(() => {
      const gain = {
        gain: { value: 1 },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      gains.push(gain);
      return gain;
    }),
    close: vi.fn(async () => {
      context.state = "closed";
    }),
  };
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
  const player = new EffectPlayer({
    contextFactory: () => context as unknown as AudioContext,
    fetcher: fetcher as typeof fetch,
    baseUrl: "https://example.test/-ardonia-cinematic/presentation.html",
  });
  return { player, context, sources, gains, fetcher };
}
const standard = { kind: "default" } as const;
const custom = (url: string) => ({ kind: "url", url }) as const;
afterEach(() => vi.useRealTimers());

describe("short effect playback", () => {
  it("preloads from the Pages subdirectory without resuming or playing", async () => {
    const f = fixture("suspended");
    await f.player.preload(standard);
    expect(f.fetcher.mock.calls[0][0]).toBe(
      "https://example.test/-ardonia-cinematic/sounds/impact.wav",
    );
    expect(f.context.resume).not.toHaveBeenCalled();
    expect(f.sources).toHaveLength(0);
    expect(f.fetcher.mock.calls[0][1]).toMatchObject({
      credentials: "omit",
      referrerPolicy: "no-referrer",
      mode: "cors",
    });
  });

  it("resumes synchronously in the click and schedules one non-looping source", async () => {
    const f = fixture("suspended");
    const result = f.player.play(standard, 0.45);
    expect(f.context.resume).toHaveBeenCalledTimes(1);
    expect(await result).toBe("played");
    expect(f.sources).toHaveLength(1);
    expect(f.sources[0].start).toHaveBeenCalledTimes(1);
    expect(f.sources[0].loop).toBe(false);
    expect(f.gains[0].gain.value).toBe(0.45);
  });

  it("never schedules a blocked resume even when it resolves late", async () => {
    vi.useFakeTimers();
    const f = fixture("suspended");
    let resume!: () => void;
    f.context.resume.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resume = () => {
            f.context.state = "running";
            resolve();
          };
        }),
    );
    const pending = f.player.play(standard, 1);
    await vi.advanceTimersByTimeAsync(250);
    expect(await pending).toBe("blocked");
    resume();
    await Promise.resolve();
    expect(f.sources).toHaveLength(0);
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("reports a rejected resume as blocked without fetching", async () => {
    const f = fixture("suspended");
    f.context.resume.mockRejectedValue(new DOMException("NotAllowedError"));
    expect(await f.player.play(standard, 1)).toBe("blocked");
    expect(f.sources).toHaveLength(0);
  });

  it("none, zero and invalid volume remain silent without fetching", async () => {
    const f = fixture();
    expect(await f.player.play({ kind: "none" }, 1)).toBe("silent");
    expect(await f.player.play(standard, 0)).toBe("silent");
    expect(await f.player.play(standard, NaN)).toBe("silent");
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("stops the old source before another effect and cleans finished nodes", async () => {
    const f = fixture();
    await f.player.play(standard, 1);
    await f.player.play(standard, 1);
    expect(f.sources[0].stop).toHaveBeenCalledTimes(1);
    expect(f.sources[0].disconnect).toHaveBeenCalled();
    expect(f.sources[1].start).toHaveBeenCalledTimes(1);
    f.sources[1].onended();
    expect(f.gains[1].disconnect).toHaveBeenCalledTimes(1);
    f.player.stop();
    expect(f.sources[1].stop).not.toHaveBeenCalled();
  });

  it("stop cancels scheduling while a download is pending", async () => {
    const f = fixture();
    let finish!: (response: Response) => void;
    f.fetcher.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = f.player.play(standard, 1);
    await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalled());
    f.player.stop();
    finish(new Response(new Uint8Array([1])));
    expect(await pending).toBe("silent");
    expect(f.sources).toHaveLength(0);
  });

  it("shares concurrent preloads and caches at most four URLs", async () => {
    const f = fixture();
    await Promise.all([f.player.preload(standard), f.player.preload(standard)]);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 4; i++)
      await f.player.preload(custom(`https://example.test/${i}.mp3`));
    await f.player.preload(standard);
    expect(f.fetcher).toHaveBeenCalledTimes(6);
  });

  it("updates gain and immediately stops on mute", async () => {
    const f = fixture();
    await f.player.play(standard, 2);
    expect(f.gains[0].gain.value).toBe(1);
    f.player.setVolume(0.3);
    expect(f.gains[0].gain.value).toBe(0.3);
    f.player.setVolume(0);
    expect(f.sources[0].stop).toHaveBeenCalledTimes(1);
  });

  it("bounds declared and actual streamed file size", async () => {
    const f = fixture();
    f.fetcher.mockResolvedValueOnce(
      new Response(new Uint8Array([1]), {
        headers: { "content-length": String(MAX_SOUND_BYTES + 1) },
      }),
    );
    await expect(f.player.preload(standard)).rejects.toThrow("1 MiB");
    f.fetcher.mockResolvedValueOnce(
      new Response(new Uint8Array(MAX_SOUND_BYTES + 1)),
    );
    await expect(f.player.preload(standard)).rejects.toThrow("1 MiB");
    expect(f.context.decodeAudioData).not.toHaveBeenCalled();
  });

  it.each([0, 5.01, Infinity, NaN])(
    "rejects unsupported effect duration %s",
    async (duration) => {
      const f = fixture();
      f.context.decodeAudioData.mockResolvedValue({ duration });
      await expect(f.player.play(standard, 1)).rejects.toThrow("5 segundos");
      expect(f.sources).toHaveLength(0);
    },
  );

  it("rejects decode failures, empty data and HTTP errors with safe messages", async () => {
    const f = fixture();
    f.context.decodeAudioData.mockRejectedValueOnce(
      new Error("secret signed url"),
    );
    await expect(f.player.preload(standard)).rejects.toThrow(
      "formato não suportado",
    );
    f.fetcher.mockResolvedValueOnce(new Response(new Uint8Array()));
    await expect(f.player.preload(standard)).rejects.toThrow("vazio");
    f.fetcher.mockResolvedValueOnce(
      new Response("private details", { status: 403 }),
    );
    await expect(f.player.preload(standard)).rejects.toThrow("público");
  });

  it("times out a stalled download and aborts its signal", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.fetcher.mockImplementation(() => new Promise(() => {}));
    const pending = expect(f.player.preload(standard)).rejects.toThrow(
      "demorou",
    );
    await vi.advanceTimersByTimeAsync(6000);
    await pending;
    expect(f.fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("rejects insecure URL before fetch and rejects use after disposal", async () => {
    const f = fixture();
    await expect(
      f.player.play(custom("http://evil.test/test.mp3"), 1),
    ).rejects.toThrow("HTTPS");
    expect(f.fetcher).not.toHaveBeenCalled();
    f.player.dispose();
    await expect(f.player.preload(standard)).rejects.toThrow("encerrado");
  });

  it("dispose stops playback and closes only its own context", async () => {
    const f = fixture();
    await f.player.play(standard, 1);
    f.player.dispose();
    expect(f.sources[0].stop).toHaveBeenCalledTimes(1);
    expect(f.context.close).toHaveBeenCalledTimes(1);
    f.player.dispose();
    expect(f.context.close).toHaveBeenCalledTimes(1);
  });
});
