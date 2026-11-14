import { parseAnnouncement, type Announcement } from "./protocol";

interface Dependencies {
  authorize(connectionId: string): Promise<boolean>;
  close(): Promise<void>;
  open(announcement: Announcement): Promise<void>;
  onError(error: unknown): void;
  now?(): number;
}

/** One receiver runs in each participant's background iframe, not the GM panel. */
export class AnnouncementReceiver {
  private readonly seen = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  private accepted?: Announcement;
  private acceptedOrder = -1;
  private arrivalOrder = 0;

  constructor(private readonly dependencies: Dependencies) {}

  get active(): Announcement | undefined {
    return this.accepted;
  }

  async receive(event: { data: unknown; connectionId: string }): Promise<void> {
    const order = this.arrivalOrder++;
    let announcement: Announcement;
    try {
      announcement = parseAnnouncement(
        event.data,
        this.dependencies.now?.() ?? Date.now(),
      );
    } catch {
      // Untrusted or delayed network events must not interrupt the current scene.
      return;
    }
    if (this.seen.has(announcement.eventId)) return;
    try {
      if (!(await this.dependencies.authorize(event.connectionId))) return;
    } catch (error) {
      this.dependencies.onError(error);
      return;
    }
    // Authorization can finish out of order. Recheck freshness and identity after it.
    try {
      parseAnnouncement(announcement, this.dependencies.now?.() ?? Date.now());
    } catch {
      return;
    }
    if (this.seen.has(announcement.eventId)) return;
    if (
      this.accepted &&
      (announcement.sentAt < this.accepted.sentAt ||
        (announcement.sentAt === this.accepted.sentAt &&
          order < this.acceptedOrder))
    )
      return;
    this.seen.add(announcement.eventId);
    if (this.seen.size > 256)
      this.seen.delete(this.seen.values().next().value!);
    this.accepted = announcement;
    this.acceptedOrder = order;
    this.queue = this.queue
      .then(async () => {
        if (this.accepted?.eventId !== announcement.eventId) return;
        await this.dependencies.close();
        if (this.accepted?.eventId !== announcement.eventId) return;
        await this.dependencies.open(announcement);
      })
      .catch((error: unknown) => {
        this.dependencies.onError(error);
      });
    await this.queue;
  }
}
