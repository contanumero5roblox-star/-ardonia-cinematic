import OBR from "@owlbear-rodeo/sdk";
import {
  createCinematic,
  parseBackup,
  serializeBackup,
  matchesSearch,
  PRESENTATION_DURATIONS,
  DEFAULT_DURATION_SECONDS,
  type Cinematic,
} from "./model";
import { LibraryStorage, LIBRARY_KEY } from "./storage";
import { renderPresentation } from "./presentation-view";
import { CHANNEL_ANNOUNCE, createAnnouncement } from "./protocol";
import { mountAudioSettings } from "./audio-settings";
import { validateSoundChoice, type SoundChoice } from "./sound-model";
import "./style.css";

const root = document.querySelector<HTMLDivElement>("#app")!;
root.innerHTML = `
<header class="masthead"><img src="./icon.svg" alt="" width="40" height="40"><div><p class="eyebrow">O palco da sua aventura</p><h1>ARDONIA <span>CINEMATIC</span></h1></div><span class="connection" id="connection">Conectando…</span></header>
<main><section class="intro"><p class="eyebrow">Seu próximo grande momento</p><h2>Banco de Cinematics <br>do Mestre</h2><p class="muted">Prepare a cena. Deixe a história falar.</p></section>
<div id="notice" role="status" aria-live="polite"></div>
<div id="audio-settings"></div>
<div id="manager" hidden><div class="toolbar"><label class="search"><span aria-hidden="true">⌕</span><input id="search" type="search" placeholder="Pesquisar cinematics…" aria-label="Pesquisar cinematics" maxlength="180"></label><button id="new" class="primary">+ Nova cinematic</button></div>
<div class="library-meta"><span id="count"></span><span>Imagem · título · história</span></div><div id="library" class="library"></div>
<footer class="library-footer"><div class="backup-actions"><button id="export">Exportar backup</button><button id="import">Importar backup</button><input id="import-file" type="file" accept=".json,application/json" hidden></div><p>A biblioteca fica neste navegador. Exporte um backup para guardar ou levar a outro dispositivo.</p></footer></div></main>
<dialog id="editor" aria-labelledby="editor-heading"><form id="form"><div class="dialog-heading"><div><p class="eyebrow">Um instante inesquecível</p><h2 id="editor-heading">Nova cinematic</h2></div><button type="button" class="icon-button" id="cancel" aria-label="Fechar editor">×</button></div>
<label>Título <span class="required">obrigatório</span><input id="title" required maxlength="180" placeholder="O REI SEM COROA"></label>
<label>Descrição <span class="muted">opcional</span><textarea id="description" maxlength="6000" rows="4" placeholder="Uma presença esmagadora toma conta da sala…"></textarea></label>
<label>Imagem <span class="muted">URL HTTPS · opcional</span><input id="image" type="url" maxlength="2048" placeholder="https://seu-site.com/cena.webp"></label>
<div class="image-tools"><button type="button" id="pick-image">Escolher no Owlbear</button><small>Use uma imagem acessível aos jogadores. Links privados podem falhar.</small></div>
<div id="image-check" class="image-check" hidden><img id="editor-image" alt="Prévia da imagem da cinematic" referrerpolicy="no-referrer"><p id="image-status" class="muted"></p></div>
<label>Duração da apresentação<select id="duration">${PRESENTATION_DURATIONS.map((seconds) => `<option value="${seconds}">${seconds} segundos</option>`).join("")}</select></label>
<fieldset class="scene-sound"><legend>Efeito de entrada desta cinematic</legend><label>Som<select id="scene-sound-kind"><option value="inherit">Usar efeito geral</option><option value="default">Impacto original</option><option value="url">URL personalizada</option><option value="none">Sem efeito</option></select></label><label id="scene-sound-url-label" hidden>URL HTTPS do áudio<input id="scene-sound-url" type="url" maxlength="2048" placeholder="https://seu-site.com/impacto.mp3"></label><p class="muted">MP3, WAV ou OGG compatível · até 5 segundos e 1 MiB · URL pública com CORS.</p><button type="button" id="test-scene-sound">Testar efeito da cinematic</button></fieldset>
<p id="form-error" class="error" role="alert"></p><div class="form-actions"><button type="button" id="preview-draft">Pré-visualizar</button><button type="submit" class="primary">Salvar cinematic</button></div></form></dialog>
<dialog id="preview" class="preview-dialog" aria-label="Pré-visualização da cinematic"><div id="preview-content"></div></dialog>
<dialog id="confirmation" aria-labelledby="confirmation-title"><h2 id="confirmation-title"></h2><p id="confirmation-text"></p><div class="form-actions"><button id="confirm-no">Cancelar</button><button id="confirm-yes" class="danger">Excluir</button></div></dialog>`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const storage = new LibraryStorage();
const audioSettings = mountAudioSettings($("audio-settings"));
let cinematics: Cinematic[] = [];
let connected = false;
let allowed = false;
let editing: string | undefined;
let announcing = false;
let cleanupPreview: (() => void) | undefined;
const editor = $<HTMLDialogElement>("editor");
const preview = $<HTMLDialogElement>("preview");
const form = $<HTMLFormElement>("form");
const title = $<HTMLInputElement>("title");
const description = $<HTMLTextAreaElement>("description");
const image = $<HTMLInputElement>("image");
const duration = $<HTMLSelectElement>("duration");
function notice(message: string, error = false) {
  $("notice").textContent = message;
  $("notice").className = error ? "notice error" : "notice";
}
function fail(error: unknown) {
  notice(
    error instanceof Error
      ? error.message
      : "Não foi possível concluir a operação.",
    true,
  );
}
function load() {
  try {
    cinematics = storage.load();
    renderLibrary();
  } catch (e) {
    fail(e);
  }
}
function save(next: Cinematic[]) {
  storage.save(next);
  cinematics = next;
  renderLibrary();
}
function button(
  text: string,
  action: () => void | Promise<void>,
  className = "",
) {
  const b = document.createElement("button");
  b.textContent = text;
  b.className = className;
  b.onclick = () => {
    Promise.resolve().then(action).catch(fail);
  };
  return b;
}
function renderLibrary() {
  const query = $<HTMLInputElement>("search").value;
  const list = cinematics.filter((c) => matchesSearch(c, query));
  $("count").textContent = `${list.length} de ${cinematics.length} cinematics`;
  const library = $("library");
  library.replaceChildren();
  if (!list.length) {
    const box = document.createElement("div");
    box.className = "empty";
    const h = document.createElement("h3");
    h.textContent = query
      ? "Nenhuma cena encontrada"
      : "Toda aventura tem um começo.";
    const p = document.createElement("p");
    p.textContent = query
      ? "Tente outro título ou palavra da descrição."
      : "Crie sua primeira cinematic e prepare o próximo momento da sua mesa.";
    box.append(h, p);
    library.append(box);
    return;
  }
  for (const c of list) {
    const card = document.createElement("article");
    card.className = "card";
    const thumb = document.createElement("div");
    thumb.className = "thumbnail";
    thumb.textContent = "✦";
    if (c.imageUrl) {
      const img = document.createElement("img");
      img.src = c.imageUrl;
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.onerror = () => img.remove();
      thumb.append(img);
    }
    const body = document.createElement("div");
    body.className = "card-body";
    const h = document.createElement("h3");
    h.textContent = c.title;
    const p = document.createElement("p");
    p.textContent = c.description || "A imagem e o título contam a história.";
    body.append(h, p);
    const actions = document.createElement("div");
    actions.className = "card-actions";
    const announce = button("Anunciar", () => announceScene(c), "primary");
    announce.disabled = !connected || announcing;
    actions.append(
      announce,
      button("Pré-visualizar", () => showPreview(c)),
      button("Editar", () => openEditor(c)),
      button("Duplicar", () => openEditor(c, true)),
      button("Excluir", () => deleteScene(c), "subtle-danger"),
    );
    card.append(thumb, body, actions);
    library.append(card);
  }
}
function openEditor(c?: Cinematic, duplicate = false) {
  editing = duplicate ? undefined : c?.id;
  form.reset();
  $("form-error").textContent = "";
  title.value = c?.title ?? "";
  description.value = c?.description ?? "";
  image.value = c?.imageUrl ?? "";
  duration.value = String(c?.durationSeconds ?? DEFAULT_DURATION_SECONDS);
  $<HTMLSelectElement>("scene-sound-kind").value = c?.sound?.kind ?? "inherit";
  $<HTMLInputElement>("scene-sound-url").value =
    c?.sound?.kind === "url" ? c.sound.url : "";
  updateSceneSound();
  $("editor-heading").textContent = duplicate
    ? "Duplicar cinematic"
    : c ? "Editar cinematic" : "Nova cinematic";
  updateImage();
  editor.showModal();
  title.focus();
}
function draft() {
  return createCinematic(
    {
      title: title.value,
      description: description.value,
      imageUrl: image.value,
      durationSeconds: Number(duration.value),
      sound: sceneSound(),
    },
    editing,
  );
}
function showPreview(c: Cinematic) {
  cleanupPreview?.();
  cleanupPreview = renderPresentation($("preview-content"), c, () =>
    preview.close(),
  );
  preview.showModal();
  preview.querySelector<HTMLButtonElement>("button")?.focus();
}
preview.addEventListener("close", () => {
  cleanupPreview?.();
  cleanupPreview = undefined;
});
function updateImage() {
  const img = $<HTMLImageElement>("editor-image");
  const raw = image.value.trim();
  $("image-check").hidden = !raw;
  $("image-status").textContent = "";
  img.hidden = false;
  img.removeAttribute("src");
  if (!raw) return;
  try {
    const c = createCinematic({ title: "Prévia", imageUrl: raw });
    img.onload = () => {
      $("image-status").textContent = "Imagem carregada neste navegador.";
    };
    img.onerror = () => {
      img.hidden = true;
      $("image-status").textContent =
        "Não foi possível carregar a imagem. Confira o link e o acesso público.";
    };
    img.src = c.imageUrl;
  } catch {
    img.hidden = true;
    $("image-status").textContent = "Use uma URL HTTPS válida.";
  }
}
function confirmAction(
  heading: string,
  text: string,
  label: string,
): Promise<boolean> {
  const d = $<HTMLDialogElement>("confirmation");
  $("confirmation-title").textContent = heading;
  $("confirmation-text").textContent = text;
  $("confirm-yes").textContent = label;
  d.returnValue = "";
  d.showModal();
  $("confirm-no").focus();
  return new Promise((resolve) => {
    $("confirm-no").onclick = () => d.close("no");
    $("confirm-yes").onclick = () => d.close("yes");
    d.addEventListener("close", () => resolve(d.returnValue === "yes"), {
      once: true,
    });
  });
}
async function deleteScene(c: Cinematic) {
  if (
    await confirmAction(
      "Excluir cinematic?",
      `“${c.title}” será removida deste navegador.`,
      "Excluir",
    )
  ) {
    save(cinematics.filter((x) => x.id !== c.id));
    notice("Cinematic excluída.");
  }
}
async function announceScene(c: Cinematic) {
  if (!connected || !allowed || announcing) return;
  announcing = true;
  renderLibrary();
  try {
    if ((await OBR.player.getRole()) !== "GM")
      throw new Error("Somente o mestre pode anunciar.");
    const envelope = createAnnouncement(c, audioSettings.getMasterSound());
    await OBR.broadcast.sendMessage(CHANNEL_ANNOUNCE, envelope, {
      destination: "ALL",
    });
    notice(
      "Anúncio enviado aos clientes conectados. O recebimento depende de cada conexão.",
    );
  } finally {
    announcing = false;
    renderLibrary();
  }
}
$("new").onclick = () => openEditor();
$("cancel").onclick = () => editor.close();
$("search").addEventListener("input", renderLibrary);
image.addEventListener("input", updateImage);
$("preview-draft").onclick = () => {
  try {
    showPreview(draft());
    $("form-error").textContent = "";
  } catch (e) {
    $("form-error").textContent = (e as Error).message;
  }
};
form.onsubmit = (e) => {
  e.preventDefault();
  try {
    if (!allowed) throw new Error("Somente o mestre pode salvar.");
    const c = draft();
    save(
      editing
        ? cinematics.map((x) => (x.id === editing ? c : x))
        : [...cinematics, c],
    );
    editor.close();
    notice("Cinematic salva neste navegador.");
  } catch (e) {
    $("form-error").textContent = (e as Error).message;
  }
};
$("pick-image").onclick = async () => {
  try {
    if (!connected)
      throw new Error(
        "Abra a extensão em uma sala do Owlbear para escolher uma imagem.",
      );
    const selected = await OBR.assets.downloadImages(false);
    if (selected[0]) {
      image.value = selected[0].image.url;
      updateImage();
    }
  } catch (e) {
    $("form-error").textContent =
      e instanceof Error ? e.message : "Não foi possível selecionar a imagem.";
  }
};
$("export").onclick = () => {
  try {
    const data = serializeBackup(cinematics);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ardonia-cinematic-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice("Backup exportado. Guarde o arquivo em um local seguro.");
  } catch (e) {
    fail(e);
  }
};
$("import").onclick = () => $<HTMLInputElement>("import-file").click();
$<HTMLInputElement>("import-file").onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024)
      throw new Error("O backup deve ter no máximo 2 MiB.");
    const incoming = parseBackup(await file.text());
    const map = new Map(cinematics.map((c) => [c.id, c]));
    let conflicts = 0;
    for (const c of incoming) {
      if (map.has(c.id)) conflicts++;
      map.set(c.id, c);
    }
    if (
      conflicts &&
      !(await confirmAction(
        "Importar backup?",
        `${conflicts} cinematics com o mesmo identificador serão substituídas. As demais serão mantidas.`,
        "Importar",
      ))
    )
      return;
    save([...map.values()]);
    notice(
      `${incoming.length} cinematics importadas. Faça uma prévia para conferir as imagens.`,
    );
  } catch (e) {
    fail(e);
  }
};
function setRole(role: "GM" | "PLAYER") {
  const wasAllowed = allowed;
  allowed = role === "GM";
  $("manager").hidden = !allowed;
  audioSettings.setRole(allowed);
  if (!allowed) {
    editor.close();
    preview.close();
    $<HTMLDialogElement>("confirmation").close();
    cinematics = [];
    $("library").replaceChildren();
    notice(
      "Você receberá os anúncios do mestre automaticamente. Pode fechar este painel.",
    );
  } else if (!wasAllowed) {
    notice(
      connected
        ? "Biblioteca privada deste navegador. Os jogadores recebem apenas o que você anunciar."
        : "Modo local: crie e visualize cenas. Para anunciar, instale a extensão no Owlbear Rodeo.",
    );
    load();
  }
}
if (OBR.isAvailable) {
  OBR.onReady(async () => {
    try {
      connected = true;
      $("connection").textContent = "Na sala";
      await OBR.player.getRole().then(setRole);
      OBR.player.onChange((p) => setRole(p.role));
    } catch (e) {
      connected = false;
      fail(e);
    }
  });
} else {
  $("connection").textContent = "Modo local";
  setRole("GM");
}
window.addEventListener("storage", (event) => {
  if (allowed && event.key === LIBRARY_KEY) load();
});

function sceneSound(): SoundChoice | undefined {
  const kind = $<HTMLSelectElement>("scene-sound-kind").value;
  if (kind === "inherit") return undefined;
  return validateSoundChoice(
    kind === "url"
      ? { kind, url: $<HTMLInputElement>("scene-sound-url").value }
      : { kind },
  );
}
function updateSceneSound() {
  const custom = $<HTMLSelectElement>("scene-sound-kind").value === "url";
  $("scene-sound-url-label").hidden = !custom;
  $<HTMLInputElement>("scene-sound-url").disabled = !custom;
}
$("scene-sound-kind").addEventListener("change", updateSceneSound);
$("test-scene-sound").onclick = () => {
  try {
    const choice = sceneSound() ?? audioSettings.getMasterSound();
    $("form-error").textContent = "Testando efeito…";
    void audioSettings
      .testSound(choice)
      .then(() => {
        $("form-error").textContent =
          choice.kind === "none"
            ? "Esta cinematic está sem efeito sonoro."
            : "Teste concluído. O volume continua sendo individual.";
      })
      .catch((error) => {
        $("form-error").textContent = (error as Error).message;
      });
  } catch (error) {
    $("form-error").textContent = (error as Error).message;
  }
};
window.addEventListener("pagehide", () => audioSettings.dispose(), {
  once: true,
});
