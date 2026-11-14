/** Data shared by the private library and the announced presentation. */
export interface Cinematic {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  updatedAt: string;
}

export const MAX_CINEMATICS = 500;
export const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
export const MAX_TITLE_LENGTH = 180;
export const MAX_DESCRIPTION_LENGTH = 6000;
export const MAX_IMAGE_URL_LENGTH = 2048;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Os dados devem ser um objeto válido.");
  }
  return value as Record<string, unknown>;
}

function own(object: Record<string, unknown>, name: string): unknown {
  return Object.prototype.hasOwnProperty.call(object, name)
    ? object[name]
    : undefined;
}

function text(
  value: unknown,
  name: string,
  max: number,
  optional = false,
): string {
  if (optional && value === undefined) return "";
  if (typeof value !== "string")
    throw new ValidationError(`${name} deve ser um texto.`);
  const result = value.trim();
  if (result.length > max)
    throw new ValidationError(`${name} deve ter até ${max} caracteres.`);
  return result;
}

/** HTTPS only, except this app's own loopback origin while developing locally. */
export function validateImageUrl(value: unknown, baseUrl?: string): string {
  const input = text(value, "A URL da imagem", MAX_IMAGE_URL_LENGTH, true);
  if (!input) return "";
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ValidationError("Use uma URL completa de imagem com HTTPS.");
  }
  if (url.username || url.password)
    throw new ValidationError("A URL da imagem não pode conter credenciais.");
  const current =
    baseUrl ?? (typeof location !== "undefined" ? location.href : undefined);
  let localDevelopment = false;
  if (current) {
    try {
      const base = new URL(current);
      localDevelopment =
        url.protocol === "http:" &&
        url.origin === base.origin &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    } catch {
      /* A malformed development base never relaxes URL validation. */
    }
  }
  if (url.protocol !== "https:" && !localDevelopment) {
    throw new ValidationError("A imagem deve usar HTTPS.");
  }
  // Keep the original URL rather than silently changing a signed URL's spelling.
  return input;
}

export function parseCinematic(value: unknown): Cinematic {
  const data = record(value);
  const id = text(own(data, "id"), "O identificador", 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(id))
    throw new ValidationError("Identificador de cinematic inválido.");
  const title = text(own(data, "title"), "O título", MAX_TITLE_LENGTH);
  if (!title) throw new ValidationError("Informe um título para a cinematic.");
  const description = text(
    own(data, "description"),
    "A descrição",
    MAX_DESCRIPTION_LENGTH,
    true,
  );
  const imageUrl = validateImageUrl(own(data, "imageUrl"));
  const updatedAt = text(own(data, "updatedAt"), "A data", 40);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(updatedAt) ||
    !Number.isFinite(Date.parse(updatedAt)) ||
    new Date(updatedAt).toISOString().slice(0, 19) !== updatedAt.slice(0, 19)
  ) {
    throw new ValidationError("Data da cinematic inválida.");
  }
  return { id, title, description, imageUrl, updatedAt };
}

export function createCinematic(
  input: { title: string; description?: string; imageUrl?: string },
  id: string = crypto.randomUUID(),
): Cinematic {
  return parseCinematic({
    id,
    title: input.title,
    description: input.description ?? "",
    imageUrl: input.imageUrl ?? "",
    updatedAt: new Date().toISOString(),
  });
}

function validateLibrary(value: unknown): Cinematic[] {
  if (!Array.isArray(value))
    throw new ValidationError("O backup não contém uma lista de cinematics.");
  if (value.length > MAX_CINEMATICS)
    throw new ValidationError(`O limite é de ${MAX_CINEMATICS} cinematics.`);
  const ids = new Set<string>();
  return value.map((item) => {
    const cinematic = parseCinematic(item);
    if (ids.has(cinematic.id))
      throw new ValidationError("O backup contém identificadores duplicados.");
    ids.add(cinematic.id);
    return cinematic;
  });
}

function checkSize(value: string): void {
  if (new TextEncoder().encode(value).byteLength > MAX_BACKUP_BYTES) {
    throw new ValidationError("O backup deve ter no máximo 2 MB.");
  }
}

export function parseBackup(source: string): Cinematic[] {
  checkSize(source);
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new ValidationError("O arquivo não contém um JSON válido.");
  }
  const data = record(value);
  if (
    own(data, "format") !== "ardonia-cinematic" ||
    own(data, "version") !== 1
  ) {
    throw new ValidationError("Formato ou versão de backup incompatível.");
  }
  return validateLibrary(own(data, "cinematics"));
}

export function serializeBackup(cinematics: readonly Cinematic[]): string {
  const output = JSON.stringify(
    {
      format: "ardonia-cinematic",
      version: 1,
      cinematics: validateLibrary(cinematics),
    },
    null,
    2,
  );
  checkSize(output);
  return output;
}

function searchable(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

export function matchesSearch(cinematic: Cinematic, query: string): boolean {
  const tokens = searchable(query).trim().split(/\s+/).filter(Boolean);
  const content = searchable(`${cinematic.title} ${cinematic.description}`);
  return tokens.every((token) => content.includes(token));
}
