import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHANNEL_ANNOUNCE,
  CHANNEL_READY,
  CHANNEL_DATA,
  MODAL_ID,
  createAnnouncement,
} from "../src/protocol";

type BroadcastEvent = { data: unknown; connectionId: string };
const sdk = vi.hoisted(() => ({
  handlers: new Map<string, (event: BroadcastEvent) => void>(),
  getConnectionId: vi.fn(async () => "own-connection"),
  getRole: vi.fn(async (): Promise<"GM" | "PLAYER"> => "GM"),
  getPlayers: vi.fn(async () => [
    { connectionId: "remote-gm", role: "GM" },
    { connectionId: "remote-player", role: "PLAYER" },
  ]),
  close: vi.fn(async () => {}),
  open: vi.fn(async (_options: unknown) => {}),
  sendMessage: vi.fn(
    async (_channel: string, _data: unknown, _options: unknown) => {},
  ),
  show: vi.fn(async () => "notice"),
}));

vi.mock("@owlbear-rodeo/sdk", () => ({
  default: {
    isAvailable: true,
    onReady: (callback: () => void) => callback(),
    player: { getConnectionId: sdk.getConnectionId, getRole: sdk.getRole },
    party: { getPlayers: sdk.getPlayers },
    modal: { close: sdk.close, open: sdk.open },
    notification: { show: sdk.show },
    broadcast: {
      onMessage: (
        channel: string,
        callback: (event: BroadcastEvent) => void,
      ) => {
        sdk.handlers.set(channel, callback);
        return () => sdk.handlers.delete(channel);
      },
      sendMessage: sdk.sendMessage,
    },
  },
}));

const scene = {
  id: "scene",
  title: "REVELAÇÃO",
  description: "",
  imageUrl: "https://example.org/scene.png",
  updatedAt: new Date().toISOString(),
};
function emit(
  channel: string,
  data: unknown,
  connectionId = "own-connection",
): void {
  const listener = sdk.handlers.get(channel);
  expect(listener).toBeTypeOf("function");
  listener!({ data, connectionId });
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  sdk.handlers.clear();
  sdk.getRole.mockResolvedValue("GM");
  sdk.close.mockResolvedValue();
  sdk.open.mockResolvedValue();
  vi.stubGlobal("window", {
    location: {
      href: "https://example.org/-ardonia-cinematic/background.html?obrref=host-injected",
    },
  });
  await import("../src/background");
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("background SDK integration (mock host, not a real Owlbear room)", () => {
  it("opens a local fullscreen modal under the deployment subpath without scene content in its URL", async () => {
    const event = createAnnouncement(scene);
    emit(CHANNEL_ANNOUNCE, event);
    await vi.waitFor(() => expect(sdk.open).toHaveBeenCalledOnce());
    const options = sdk.open.mock.calls[0][0] as {
      id: string;
      url: string;
      fullScreen: boolean;
      hidePaper: boolean;
    };
    expect(options.id).toBe(MODAL_ID);
    expect(options.fullScreen).toBe(true);
    expect(options.hidePaper).toBe(true);
    const url = new URL(options.url);
    expect(url.pathname).toBe("/-ardonia-cinematic/presentation.html");
    expect([...url.searchParams.entries()]).toEqual([["event", event.eventId]]);
    expect(sdk.close).toHaveBeenCalledExactlyOnceWith(MODAL_ID);
  });

  it("authorizes an actual remote GM and refuses a player claiming GM in payload", async () => {
    emit(
      CHANNEL_ANNOUNCE,
      { ...createAnnouncement(scene), role: "GM" },
      "remote-player",
    );
    await vi.waitFor(() => expect(sdk.getPlayers).toHaveBeenCalledOnce());
    expect(sdk.open).not.toHaveBeenCalled();
    emit(CHANNEL_ANNOUNCE, createAnnouncement(scene), "remote-gm");
    await vi.waitFor(() => expect(sdk.open).toHaveBeenCalledOnce());
  });

  it("checks the current role for a self-sent announcement", async () => {
    sdk.getRole.mockResolvedValue("PLAYER");
    emit(CHANNEL_ANNOUNCE, createAnnouncement(scene));
    await vi.waitFor(() => expect(sdk.getRole).toHaveBeenCalledOnce());
    expect(sdk.open).not.toHaveBeenCalled();
  });

  it("replies to local matching READY with exactly one selected cinematic", async () => {
    const event = createAnnouncement(scene);
    emit(CHANNEL_ANNOUNCE, { ...event, library: [{ title: "PRIVATE" }] });
    await vi.waitFor(() => expect(sdk.open).toHaveBeenCalledOnce());
    emit(CHANNEL_READY, { eventId: event.eventId });
    await vi.waitFor(() =>
      expect(sdk.sendMessage).toHaveBeenCalledExactlyOnceWith(
        CHANNEL_DATA,
        {
          eventId: event.eventId,
          cinematic: scene,
          sound: { kind: "default" },
        },
        { destination: "LOCAL" },
      ),
    );
  });

  it("does not leak a scene to a remote READY, wrong event ID or malformed request", async () => {
    const event = createAnnouncement(scene);
    emit(CHANNEL_ANNOUNCE, event);
    await vi.waitFor(() => expect(sdk.open).toHaveBeenCalledOnce());
    emit(CHANNEL_READY, { eventId: event.eventId }, "remote-player");
    emit(CHANNEL_READY, { eventId: createAnnouncement(scene).eventId });
    emit(CHANNEL_READY, null);
    // A valid final request makes prior asynchronous authorization checks settle.
    emit(CHANNEL_READY, { eventId: event.eventId });
    await vi.waitFor(() => expect(sdk.sendMessage).toHaveBeenCalledOnce());
    expect(sdk.sendMessage.mock.calls[0][2]).toEqual({ destination: "LOCAL" });
  });

  it("notifies on host modal failure, then accepts a later announcement", async () => {
    sdk.open.mockRejectedValueOnce(new Error("host modal error"));
    emit(CHANNEL_ANNOUNCE, createAnnouncement(scene));
    await vi.waitFor(() => expect(sdk.show).toHaveBeenCalledOnce());
    emit(CHANNEL_ANNOUNCE, createAnnouncement(scene));
    await vi.waitFor(() => expect(sdk.open).toHaveBeenCalledTimes(2));
    expect(sdk.show.mock.calls[0]).toEqual([
      "Ardonia: não foi possível abrir a apresentação. Tente anunciar novamente.",
      "ERROR",
    ]);
  });

  it("still opens when closing an absent or already dismissed modal is rejected", async () => {
    sdk.close.mockRejectedValueOnce(new Error("modal not found"));
    emit(CHANNEL_ANNOUNCE, createAnnouncement(scene));
    await vi.waitFor(() => expect(sdk.open).toHaveBeenCalledOnce());
    expect(sdk.show).not.toHaveBeenCalled();
  });
});
