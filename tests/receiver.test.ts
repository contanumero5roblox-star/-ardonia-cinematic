import { describe, expect, it, vi } from "vitest";
import { AnnouncementReceiver } from "../src/receiver";
import {
  createAnnouncement,
  MAX_EVENT_AGE_MS,
  MAX_CLOCK_SKEW_MS,
  parseAnnouncement,
  type Announcement,
} from "../src/protocol";

const now = Date.now();
const cinematic = {
  id: "scene",
  title: "O REI SEM COROA",
  description: "",
  imageUrl: "",
  durationSeconds: 14 as const,
  updatedAt: new Date(now).toISOString(),
};
function envelope(overrides: Partial<Announcement> = {}): Announcement {
  return { ...createAnnouncement(cinematic), sentAt: now, ...overrides };
}
function setup(authorize = vi.fn(async (_sender: string) => true)) {
  const close = vi.fn(async () => {});
  const open = vi.fn(async (_event: Announcement) => {});
  const onError = vi.fn();
  const receiver = new AnnouncementReceiver({
    authorize,
    close,
    open,
    onError,
    now: () => now,
  });
  return { receiver, authorize, close, open, onError };
}
const incoming = (data: unknown, connectionId = "gm-connection") => ({
  data,
  connectionId,
});

describe("multiplayer announcement receiver (SDK contract simulation)", () => {
  it("validates payload and only presents after trusted sender authorization", async () => {
    const env = setup(vi.fn(async (sender) => sender === "gm-connection"));
    const event = envelope();
    await env.receiver.receive(incoming(event, "player-connection"));
    expect(env.open).not.toHaveBeenCalled();
    await env.receiver.receive(incoming(event));
    expect(env.open).toHaveBeenCalledExactlyOnceWith(event);
    expect(env.close).toHaveBeenCalledOnce();
  });

  it("does not trust a claimed GM role inside the payload", async () => {
    const env = setup(vi.fn(async () => false));
    await env.receiver.receive(
      incoming({ ...envelope(), role: "GM" }, "player"),
    );
    expect(env.open).not.toHaveBeenCalled();
  });

  it("rejects duplicate events, stale events, future clocks and malformed payloads", async () => {
    const env = setup();
    const event = envelope();
    await env.receiver.receive(incoming(event));
    await env.receiver.receive(incoming(event));
    await env.receiver.receive(
      incoming(envelope({ sentAt: now - MAX_EVENT_AGE_MS - 1 })),
    );
    await env.receiver.receive(
      incoming(envelope({ sentAt: now + MAX_CLOCK_SKEW_MS + 1 })),
    );
    await env.receiver.receive(
      incoming({
        ...envelope(),
        cinematic: { ...cinematic, imageUrl: "javascript:alert(1)" },
      }),
    );
    await env.receiver.receive(
      incoming({ ...envelope(), eventId: "untrusted" }),
    );
    expect(env.open).toHaveBeenCalledOnce();
  });

  it("rejects reordered older events after a more recent scene", async () => {
    const env = setup();
    const latest = envelope({ sentAt: now });
    await env.receiver.receive(incoming(latest));
    await env.receiver.receive(incoming(envelope({ sentAt: now - 1 })));
    expect(env.receiver.active?.eventId).toBe(latest.eventId);
    expect(env.open).toHaveBeenCalledOnce();
  });

  it("keeps the latest scene when asynchronous authorization resolves out of order", async () => {
    let finishOld!: (authorized: boolean) => void;
    const authorize = vi
      .fn(async () => true)
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finishOld = resolve;
          }),
      );
    const env = setup(authorize);
    const old = envelope();
    const latest = envelope();
    const pendingOld = env.receiver.receive(incoming(old));
    await env.receiver.receive(incoming(latest));
    finishOld(true);
    await pendingOld;
    expect(env.open).toHaveBeenCalledExactlyOnceWith(latest);
  });

  it("serializes modal operations and replaces an in-flight scene with the latest", async () => {
    const operations: string[] = [];
    let release!: () => void;
    const firstOpen = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = envelope();
    const second = envelope();
    const third = envelope();
    const env = setup();
    env.close.mockImplementation(async () => {
      operations.push("close");
    });
    env.open.mockImplementation(async (event) => {
      operations.push(event.eventId);
      if (event.eventId === first.eventId) await firstOpen;
    });
    const pendingFirst = env.receiver.receive(incoming(first));
    await vi.waitFor(() => expect(env.open).toHaveBeenCalledOnce());
    const pendingSecond = env.receiver.receive(incoming(second));
    const pendingThird = env.receiver.receive(incoming(third));
    release();
    await Promise.all([pendingFirst, pendingSecond, pendingThird]);
    expect(operations).toEqual([
      "close",
      first.eventId,
      "close",
      third.eventId,
    ]);
  });

  it("recovers after a modal failure and supports a subsequent announcement", async () => {
    const env = setup();
    env.open.mockRejectedValueOnce(new Error("SDK unavailable"));
    await env.receiver.receive(incoming(envelope()));
    await env.receiver.receive(incoming(envelope()));
    expect(env.onError).toHaveBeenCalledOnce();
    expect(env.open).toHaveBeenCalledTimes(2);
  });

  it("does not cache a rejected sender event or leak library fields", async () => {
    const event = envelope();
    const parsed = parseAnnouncement(
      { ...event, library: [{ private: true }] },
      now,
    );
    expect(Object.keys(parsed)).toEqual([
      "version",
      "eventId",
      "sentAt",
      "cinematic",
      "sound",
    ]);
    const env = setup(vi.fn(async () => true).mockResolvedValueOnce(false));
    await env.receiver.receive(incoming(event));
    await env.receiver.receive(incoming(event));
    expect(env.open).toHaveBeenCalledOnce();
  });

  it("enforces an application UTF-8 byte budget rather than only character counts", () => {
    expect(() =>
      createAnnouncement({ ...cinematic, description: "a".repeat(6000) }),
    ).not.toThrow();
    // Three-byte Unicode characters fit the field character limit but exceed transport budget.
    expect(() =>
      createAnnouncement({ ...cinematic, description: "界".repeat(6000) }),
    ).toThrow("15.000 bytes");
  });
});
