import { type Cinematic, parseBackup, serializeBackup } from "./model";

export const LIBRARY_KEY = "com.ardonia.cinematic.library.v1";
export type StoragePort = Pick<Storage, "getItem" | "setItem">;

export class LibraryStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LibraryStorageError";
  }
}

/** Private, browser-local persistence. No room metadata or network upload. */
export class LibraryStorage {
  constructor(private readonly providedStorage?: StoragePort) {}

  private storage(): StoragePort {
    try {
      const value = this.providedStorage ?? globalThis.localStorage;
      if (!value) throw new Error("localStorage unavailable");
      return value;
    } catch (cause) {
      throw new LibraryStorageError(
        "O navegador bloqueou o armazenamento local. Permita os dados deste site para salvar sua biblioteca.",
        { cause },
      );
    }
  }

  load(): Cinematic[] {
    let source: string | null;
    try {
      source = this.storage().getItem(LIBRARY_KEY);
    } catch (cause) {
      throw new LibraryStorageError(
        "Não foi possível ler a biblioteca neste navegador.",
        { cause },
      );
    }
    if (source === null) return [];
    try {
      return parseBackup(source);
    } catch (cause) {
      throw new LibraryStorageError(
        "A biblioteca salva está corrompida ou é incompatível. Ela foi preservada; não será sobrescrita. Recupere os dados deste site antes de restaurar um backup.",
        { cause },
      );
    }
  }

  save(cinematics: readonly Cinematic[]): void {
    const output = serializeBackup(cinematics);
    // Re-read and validate immediately before writing: failed loads and malformed
    // data must never turn into a silently replaced, empty library.
    this.load();
    try {
      this.storage().setItem(LIBRARY_KEY, output);
    } catch (cause) {
      throw new LibraryStorageError(
        "Não foi possível salvar. O armazenamento pode estar bloqueado ou sem espaço. Exporte um backup e libere espaço neste navegador.",
        { cause },
      );
    }
  }
}
