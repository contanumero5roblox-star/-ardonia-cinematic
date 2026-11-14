import { describe, expect, it } from "vitest";
import {
  createCinematic,
  matchesSearch,
  MAX_BACKUP_BYTES,
  MAX_CINEMATICS,
  parseBackup,
  parseCinematic,
  serializeBackup,
  validateImageUrl,
} from "../src/model";
import { LIBRARY_KEY, LibraryStorage, type StoragePort } from "../src/storage";

const scene = {
  id: "scene-1",
  title: "Floresta dos Sussurros",
  description: "Árvores silenciosas. A ação terá consequências.",
  imageUrl: "https://example.com/forest.jpg",
  updatedAt: "2026-11-14T20:00:00.000Z",
};
const backup = (cinematics: unknown = [scene]) =>
  JSON.stringify({
    format: "ardonia-cinematic",
    version: 1,
    cinematics,
  });

function memoryStorage(): StoragePort & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("cinematic input", () => {
  it("creates a cinematic with optional blank fields and an explicit edit id", () => {
    const result = createCinematic({ title: "  O REI SEM COROA  " }, "edit-id");
    expect(result).toMatchObject({
      id: "edit-id",
      title: "O REI SEM COROA",
      description: "",
      imageUrl: "",
    });
    expect(Number.isFinite(Date.parse(result.updatedAt))).toBe(true);
  });

  it("requires a nonempty title", () => {
    expect(() => createCinematic({ title: "  \n " })).toThrow(/título/);
  });

  it("accepts the limits and rejects longer titles and descriptions", () => {
    expect(
      parseCinematic({
        ...scene,
        title: "a".repeat(180),
        description: "a".repeat(6000),
      }).title,
    ).toHaveLength(180);
    expect(() => parseCinematic({ ...scene, title: "a".repeat(181) })).toThrow(
      /180/,
    );
    expect(() =>
      parseCinematic({ ...scene, description: "a".repeat(6001) }),
    ).toThrow(/6000/);
  });

  it("accepts empty descriptions and missing images", () => {
    expect(
      parseCinematic({ ...scene, description: "", imageUrl: "" }),
    ).toMatchObject({ description: "", imageUrl: "" });
    const {
      description: _description,
      imageUrl: _imageUrl,
      ...withoutOptionals
    } = scene;
    expect(parseCinematic(withoutOptionals)).toMatchObject({
      description: "",
      imageUrl: "",
    });
  });

  it.each([null, [], "scene", 1, true])(
    "rejects non-record input: %s",
    (input) => {
      expect(() => parseCinematic(input)).toThrow();
    },
  );

  it("requires own properties and rejects invalid identifiers", () => {
    expect(() => parseCinematic(Object.create(scene))).toThrow();
    expect(() => parseCinematic({ ...scene, id: "../escape" })).toThrow(
      /Identificador/,
    );
    expect(() => parseCinematic({ ...scene, id: "" })).toThrow(/Identificador/);
  });

  it.each([
    "not-a-date",
    "2026-02-30T00:00:00Z",
    "2026-11-14T24:00:00Z",
    "2026-11-14",
  ])("rejects invalid dates: %s", (updatedAt) => {
    expect(() => parseCinematic({ ...scene, updatedAt })).toThrow(/Data/);
  });

  it("preserves text as plain data, including HTML-looking content", () => {
    expect(
      parseCinematic({ ...scene, title: "<img src=x onerror=alert(1)>" }).title,
    ).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("image URLs", () => {
  it("accepts HTTPS without rewriting signed URLs", () => {
    const url = "https://example.com/photo?a=%2f&b=hello+world#focus";
    expect(validateImageUrl(url)).toBe(url);
  });

  it.each([
    "javascript:alert(1)",
    "data:image/svg+xml,<svg/>",
    "file:///etc/passwd",
    "http://example.com/a.jpg",
    "//example.com/a.jpg",
    "not-a-url",
  ])("rejects unsafe or incomplete URL: %s", (url) => {
    expect(() => validateImageUrl(url)).toThrow();
  });

  it("rejects credential-bearing URLs and long URLs", () => {
    expect(() =>
      validateImageUrl("https://user:secret@example.com/a.jpg"),
    ).toThrow(/credenciais/);
    expect(() =>
      validateImageUrl(`https://example.com/${"a".repeat(2048)}`),
    ).toThrow(/2048/);
  });

  it("allows loopback HTTP only on the current development origin", () => {
    expect(
      validateImageUrl(
        "http://localhost:5173/scene.svg",
        "http://localhost:5173/",
      ),
    ).toBe("http://localhost:5173/scene.svg");
    expect(() =>
      validateImageUrl(
        "http://localhost:5174/scene.svg",
        "http://localhost:5173/",
      ),
    ).toThrow(/HTTPS/);
    expect(() =>
      validateImageUrl("http://example.com/scene.svg", "http://example.com/"),
    ).toThrow(/HTTPS/);
    expect(() =>
      validateImageUrl(
        "http://localhost:5173/scene.svg",
        "https://ardonia.example/",
      ),
    ).toThrow(/HTTPS/);
  });
});

describe("backup validation", () => {
  it("exports and imports all fields without loss", () => {
    const output = serializeBackup([scene]);
    expect(JSON.parse(output)).toMatchObject({
      format: "ardonia-cinematic",
      version: 1,
    });
    expect(parseBackup(output)).toEqual([scene]);
  });

  it("supports an empty library", () => {
    expect(parseBackup(serializeBackup([]))).toEqual([]);
  });

  it("rejects malformed JSON, unknown formats and versions", () => {
    expect(() => parseBackup("{")).toThrow(/JSON/);
    expect(() => parseBackup(JSON.stringify([scene]))).toThrow();
    expect(() =>
      parseBackup(
        JSON.stringify({ format: "other", version: 1, cinematics: [] }),
      ),
    ).toThrow(/Formato/);
    expect(() =>
      parseBackup(
        JSON.stringify({
          format: "ardonia-cinematic",
          version: 2,
          cinematics: [],
        }),
      ),
    ).toThrow(/versão/);
  });

  it("rejects invalid entries atomically and does not coerce types", () => {
    expect(() =>
      parseBackup(backup([scene, { ...scene, id: "two", title: 123 }])),
    ).toThrow();
    expect(() => parseBackup(backup({ 0: scene }))).toThrow(/lista/);
  });

  it("rejects duplicate IDs", () => {
    expect(() => parseBackup(backup([scene, scene]))).toThrow(/duplicados/);
  });

  it("caps item count on import and export", () => {
    const items = Array.from({ length: MAX_CINEMATICS + 1 }, (_, i) => ({
      ...scene,
      id: `scene-${i}`,
    }));
    expect(() => parseBackup(backup(items))).toThrow(/500/);
    expect(() => serializeBackup(items)).toThrow(/500/);
  });

  it("caps backup byte size before parsing and while exporting", () => {
    expect(() => parseBackup(" ".repeat(MAX_BACKUP_BYTES + 1))).toThrow(/2 MB/);
    const items = Array.from({ length: 500 }, (_, i) => ({
      ...scene,
      id: `scene-${i}`,
      description: "a".repeat(6000),
    }));
    expect(() => serializeBackup(items)).toThrow(/2 MB/);
  });

  it("does not merge imported prototype keys into the application", () => {
    const input = JSON.parse(backup());
    Object.defineProperty(input.cinematics[0], "__proto__", {
      value: { injected: true },
      enumerable: true,
    });
    input.cinematics[0].constructor = { prototype: { injected: true } };
    const output = parseBackup(JSON.stringify(input));
    expect(output[0]).toEqual(scene);
    expect(Object.prototype).not.toHaveProperty("injected");
  });
});

describe("search", () => {
  it("matches title and description regardless of case and accents", () => {
    expect(matchesSearch(scene, "FLORESTA")).toBe(true);
    expect(matchesSearch(scene, "arvores consequencias")).toBe(true);
    expect(matchesSearch(scene, "floresta ação")).toBe(true);
    expect(matchesSearch(scene, "chefe")).toBe(false);
    expect(matchesSearch(scene, "   ")).toBe(true);
  });
});

describe("private library persistence", () => {
  it("starts empty and persists edits, deletion and reloads", () => {
    const port = memoryStorage();
    const firstPanel = new LibraryStorage(port);
    expect(firstPanel.load()).toEqual([]);
    firstPanel.save([scene]);
    const nextPanel = new LibraryStorage(port);
    expect(nextPanel.load()).toEqual([scene]);
    nextPanel.save([{ ...scene, title: "O REI SEM COROA" }]);
    expect(firstPanel.load()[0].title).toBe("O REI SEM COROA");
    nextPanel.save([]);
    expect(firstPanel.load()).toEqual([]);
  });

  it("preserves corrupt stored data and refuses to overwrite it", () => {
    const port = memoryStorage();
    port.values.set(LIBRARY_KEY, "broken original");
    const storage = new LibraryStorage(port);
    expect(() => storage.load()).toThrow(/preservada/);
    expect(() => storage.save([scene])).toThrow(/preservada/);
    expect(port.values.get(LIBRARY_KEY)).toBe("broken original");
  });

  it("does not change storage when an imported record is invalid", () => {
    const port = memoryStorage();
    const storage = new LibraryStorage(port);
    storage.save([scene]);
    const previous = port.values.get(LIBRARY_KEY);
    expect(() => storage.save([{ ...scene, title: "" }])).toThrow();
    expect(port.values.get(LIBRARY_KEY)).toBe(previous);
  });

  it("reports read and quota failures", () => {
    expect(() =>
      new LibraryStorage({
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {},
      }).load(),
    ).toThrow(/ler/);
    expect(() =>
      new LibraryStorage({
        getItem: () => null,
        setItem: () => {
          throw new Error("quota");
        },
      }).save([scene]),
    ).toThrow(/salvar/);
  });
});
