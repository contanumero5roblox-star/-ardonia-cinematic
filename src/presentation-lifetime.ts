// The iframe's history entry lasts across reloads, including when localStorage
// is unavailable. The background also remembers this deadline for this event.
export function readDeadline(eventId: string): number | undefined {
  try {
    const saved = history.state?.ardoniaPresentation;
    if (saved?.eventId === eventId && isDeadline(saved.deadline))
      return saved.deadline;
  } catch {
    // A restricted embedding may deny History API access.
  }
}

export function isDeadline(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function rememberDeadline(eventId: string, deadline: number): void {
  try {
    history.replaceState(
      { ...history.state, ardoniaPresentation: { eventId, deadline } },
      "",
    );
  } catch {
    // The local background handshake also carries the deadline.
  }
}

/** One clock per rendered announcement. CSS fades towards the document's
 * dark background. The wall-clock deadline, independent of animationend and
 * audio, also applies after the browser has throttled or frozen this frame. */
export function startPresentationClock(
  stage: HTMLElement,
  deadline: number,
  onExpire: () => void,
): () => void {
  const mountedAt = Date.now();
  stage.style.setProperty("--time-left", `${deadline - mountedAt}ms`);
  stage.classList.add("cinematic-timed");
  let timer: number;
  let disposed = false;

  function reconcile(): void {
    if (disposed) return;
    window.clearTimeout(timer);
    const now = Date.now();
    const remaining = deadline - now;
    if (remaining <= 0) {
      dispose();
      onExpire();
      return;
    }
    timer = window.setTimeout(reconcile, remaining);
    try {
      const fade = stage.getAnimations?.()[0];
      if (fade) fade.currentTime = now - mountedAt;
    } catch {
      // CSS still animates on WebViews without seekable animations.
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", reconcile);
    window.removeEventListener("pageshow", reconcile);
    stage.classList.remove("cinematic-timed");
  }

  document.addEventListener("visibilitychange", reconcile);
  window.addEventListener("pageshow", reconcile);
  reconcile();
  return dispose;
}
