import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SOUND,
  MAX_SOUND_URL_LENGTH,
  validateSoundChoice,
} from "../src/sound-model";
import {
  AUDIO_PREFERENCES_KEY,
  MASTER_SOUND_KEY,
  loadAudioPreferences,
  saveAudioPreferences,
  loadMasterSound,
  saveMasterSound,
  validateAudioPreferences,
} from "../src/audio-preferences";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  };
}

describe("sound choice validation", () => {
  it("accepts absent legacy effects as default and strips unrelated fields", () => {
    expect(validateSoundChoice(undefined)).toEqual(DEFAULT_SOUND);
    expect(validateSoundChoice({ kind: "default", url: "ignored" })).toEqual({
      kind: "default",
    });
    expect(validateSoundChoice({ kind: "none", volume: 1 })).toEqual({
      kind: "none",
    });
    expect(
      validateSoundChoice({
        kind: "url",
        url: " https://audio.example/a.mp3?signature=Ab%2FCD ",
        private: "discard",
      }),
    ).toEqual({
      kind: "url",
      url: "https://audio.example/a.mp3?signature=Ab%2FCD",
    });
  });

  it.each([
    null,
    false,
    "default",
    [],
    {},
    { kind: "file" },
    { kind: "url" },
    { kind: "url", url: false },
    { kind: "url", url: "" },
    { kind: "url", url: "/a.mp3" },
    { kind: "url", url: "javascript:alert(1)" },
    { kind: "url", url: "data:audio/wav;base64,AAAA" },
    { kind: "url", url: "blob:https://audio.example/key" },
    { kind: "url", url: "file:///audio.wav" },
    { kind: "url", url: "http://audio.example/a.wav" },
    { kind: "url", url: "https://user:password@audio.example/a.mp3" },
    {
      kind: "url",
      url: "https://audio.example/" + "x".repeat(MAX_SOUND_URL_LENGTH),
    },
    Object.create({ kind: "default" }),
    Object.assign(Object.create({ url: "https://audio.example/a.mp3" }), {
      kind: "url",
    }),
  ])("rejects invalid or unsafe choice %#", (value) => {
    expect(() => validateSoundChoice(value)).toThrow();
  });

  it("does not mistake a signed URL suffix for a file format requirement", () => {
    expect(
      validateSoundChoice({
        kind: "url",
        url: "https://audio.example/download?id=123",
      }).kind,
    ).toBe("url");
  });

  it("only permits HTTP during same-origin loopback development", () => {
    expect(
      validateSoundChoice(
        { kind: "url", url: "http://127.0.0.1:4173/sounds/impact.wav" },
        "http://127.0.0.1:4173/index.html",
      ).kind,
    ).toBe("url");
    expect(() =>
      validateSoundChoice(
        { kind: "url", url: "http://127.0.0.1:4174/sounds/impact.wav" },
        "http://127.0.0.1:4173/index.html",
      ),
    ).toThrow("HTTPS");
    expect(() =>
      validateSoundChoice(
        { kind: "url", url: "http://localhost:4173/a.wav" },
        "https://audio.example/",
      ),
    ).toThrow("HTTPS");
    expect(() =>
      validateSoundChoice(
        { kind: "url", url: "http://audio.example/a.wav" },
        "http://audio.example/",
      ),
    ).toThrow("HTTPS");
  });
});

describe("private audio preferences", () => {
  it("defaults muted without writing storage", () => {
    const storage = memoryStorage();
    expect(loadAudioPreferences(storage)).toEqual({
      enabled: false,
      volume: 0.65,
    });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("round-trips participant choice independently of GM sound", () => {
    const storage = memoryStorage();
    expect(saveAudioPreferences({ enabled: true, volume: 0.2 }, storage)).toBe(
      true,
    );
    expect(
      saveMasterSound(
        { kind: "url", url: "https://audio.example/boss.ogg" },
        storage,
      ),
    ).toBe(true);
    expect(loadAudioPreferences(storage)).toEqual({
      enabled: true,
      volume: 0.2,
    });
    expect(loadMasterSound(storage)).toEqual({
      kind: "url",
      url: "https://audio.example/boss.ogg",
    });
    expect(AUDIO_PREFERENCES_KEY).not.toBe(MASTER_SOUND_KEY);
  });

  it.each([
    null,
    [],
    {},
    { enabled: "true", volume: 0.5 },
    { enabled: true, volume: "0.5" },
    { enabled: true, volume: NaN },
    { enabled: true, volume: Infinity },
    { enabled: true, volume: -0.1 },
    { enabled: true, volume: 1.1 },
    Object.create({ enabled: true, volume: 1 }),
  ])("rejects malformed preferences %#", (prefs) => {
    expect(() => validateAudioPreferences(prefs)).toThrow();
    const storage = memoryStorage();
    expect(saveAudioPreferences(prefs as any, storage)).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("accepts zero and full volume without restoring the default", () => {
    const storage = memoryStorage();
    for (const volume of [0, 1]) {
      saveAudioPreferences({ enabled: true, volume }, storage);
      expect(loadAudioPreferences(storage)).toEqual({ enabled: true, volume });
    }
  });

  it("uses muted defaults for corrupt data without changing its bytes", () => {
    const storage = memoryStorage();
    storage.setItem(AUDIO_PREFERENCES_KEY, "corrupt");
    storage.setItem.mockClear();
    expect(loadAudioPreferences(storage)).toEqual({
      enabled: false,
      volume: 0.65,
    });
    expect(storage.getItem(AUDIO_PREFERENCES_KEY)).toBe("corrupt");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("handles blocked reads and quota failures without interrupting announcements", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(loadAudioPreferences(storage)).toEqual({
      enabled: false,
      volume: 0.65,
    });
    expect(loadMasterSound(storage)).toEqual({ kind: "default" });
    expect(saveAudioPreferences({ enabled: true, volume: 0.5 }, storage)).toBe(
      false,
    );
    expect(saveMasterSound({ kind: "default" }, storage)).toBe(false);
  });

  it("falls back from malformed master settings without silently writing them", () => {
    const storage = memoryStorage();
    storage.setItem(
      MASTER_SOUND_KEY,
      JSON.stringify({ kind: "url", url: "javascript:alert(1)" }),
    );
    storage.setItem.mockClear();
    expect(loadMasterSound(storage)).toEqual({ kind: "default" });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(saveMasterSound({ kind: "url", url: "blob:private" }, storage)).toBe(
      false,
    );
  });
});
