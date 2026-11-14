import { describe, it, expect } from "vitest";
import { createCinematic, parseBackup, serializeBackup } from "../src/model";
import { createAnnouncement, parseAnnouncement } from "../src/protocol";

const base = createCinematic({ title: "Uma revelação" });
const custom = { kind: "url", url: "https://example.org/entrada.mp3" } as const;
describe("backward-compatible cinematic sound selection and wire format", () => {
  it("old backups stay compatible and inherit the current master default", () => {
    const old = JSON.stringify({
      format: "ardonia-cinematic",
      version: 1,
      cinematics: [base],
    });
    const [scene] = parseBackup(old);
    expect(scene.sound).toBeUndefined();
    expect(createAnnouncement(scene, custom).sound).toEqual(custom);
  });
  it("per-scene effects survive export/import and override the master default", () => {
    const scene = createCinematic({ title: "Chefe", sound: custom });
    const [restored] = parseBackup(serializeBackup([scene]));
    expect(restored.sound).toEqual(custom);
    expect(createAnnouncement(restored, { kind: "none" }).sound).toEqual(
      custom,
    );
  });
  it("explicit built-in or no sound overrides a global custom effect", () => {
    for (const kind of ["default", "none"] as const) {
      const scene = createCinematic({ title: "Cena", sound: { kind } });
      expect(createAnnouncement(scene, custom).sound).toEqual({ kind });
    }
  });
  it("does not embed audio or private settings and accepts legacy visual-only wire events", () => {
    const event = createAnnouncement(base, custom);
    const parsed = parseAnnouncement({
      ...event,
      volume: 1,
      enabled: true,
      audioBytes: "PRIVATE",
    });
    expect(parsed).not.toHaveProperty("volume");
    expect(parsed).not.toHaveProperty("enabled");
    expect(parsed).not.toHaveProperty("audioBytes");
    const { sound, ...legacy } = event;
    expect(parseAnnouncement(legacy).cinematic).toEqual(base);
  });
  it("rejects invalid sound and audio bytes in place of an HTTPS source", () => {
    expect(() =>
      parseBackup(
        JSON.stringify({
          format: "ardonia-cinematic",
          version: 1,
          cinematics: [
            {
              ...base,
              sound: { kind: "url", url: "data:audio/wav;base64,xyz" },
            },
          ],
        }),
      ),
    ).toThrow();
    expect(() =>
      parseAnnouncement({
        ...createAnnouncement(base),
        sound: { kind: "url", url: "blob:https://example.org/file" },
      }),
    ).toThrow();
  });
});
