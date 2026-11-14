import type { Cinematic } from "./model";
import "./presentation.css";

let presentationNumber = 0;

/** Shared renderer used by the local preview and the Owlbear presentation modal. */
export function renderPresentation(
  container: HTMLElement,
  cinematic: Cinematic,
  onClose: () => void,
): () => void {
  const number = ++presentationNumber;
  const stage = document.createElement("section");
  stage.className = "cinematic-stage";
  stage.setAttribute("aria-labelledby", `cinematic-title-${number}`);

  const close = document.createElement("button");
  close.className = "cinematic-close";
  close.type = "button";
  close.setAttribute("aria-label", "Fechar apresentação");
  close.title = "Fechar apresentação (Esc)";
  close.textContent = "×";
  close.addEventListener("click", onClose);

  const scroll = document.createElement("div");
  scroll.className = "cinematic-scroll";
  const scene = document.createElement("div");
  scene.className = "cinematic-scene";

  if (cinematic.imageUrl) {
    const visual = document.createElement("div");
    visual.className = "cinematic-visual";
    const image = document.createElement("img");
    image.className = "cinematic-image";
    image.alt = cinematic.title;
    image.referrerPolicy = "no-referrer";
    image.decoding = "async";
    image.addEventListener(
      "error",
      () => {
        const fallback = document.createElement("p");
        fallback.className = "cinematic-image-error";
        fallback.textContent = "Imagem indisponível";
        visual.replaceChildren(fallback);
      },
      { once: true },
    );
    image.src = cinematic.imageUrl;
    visual.append(image);
    scene.append(visual);
  }

  const ornament = document.createElement("div");
  ornament.className = "cinematic-ornament";
  ornament.setAttribute("aria-hidden", "true");
  const diamond = document.createElement("span");
  diamond.textContent = "◆";
  ornament.append(diamond);

  const title = document.createElement("h1");
  title.id = `cinematic-title-${number}`;
  title.className = "cinematic-title";
  title.textContent = cinematic.title;
  scene.append(ornament, title);

  if (cinematic.description.trim()) {
    const description = document.createElement("p");
    description.className = "cinematic-description";
    description.textContent = cinematic.description;
    scene.append(description);
  }

  scroll.append(scene);
  stage.append(scroll, close);
  container.replaceChildren(stage);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };
  stage.addEventListener("keydown", onKeyDown);
  const frame = requestAnimationFrame(() =>
    close.focus({ preventScroll: true }),
  );

  return () => {
    cancelAnimationFrame(frame);
    close.removeEventListener("click", onClose);
    stage.removeEventListener("keydown", onKeyDown);
    stage.remove();
  };
}
