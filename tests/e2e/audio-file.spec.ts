import { test, expect } from "@playwright/test";

test("original impact is fetched and decoded by actual browser Web Audio", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const response = await fetch("/sounds/impact.wav");
    const bytes = await response.arrayBuffer();
    const context = new AudioContext();
    try {
      const buffer = await context.decodeAudioData(bytes);
      let peak = 0,
        energy = 0;
      for (const sample of buffer.getChannelData(0)) {
        peak = Math.max(peak, Math.abs(sample));
        energy += sample * sample;
      }
      return {
        status: response.status,
        size: bytes.byteLength,
        duration: buffer.duration,
        channels: buffer.numberOfChannels,
        peak,
        rms: Math.sqrt(energy / buffer.length),
      };
    } finally {
      await context.close();
    }
  });
  expect(result.status).toBe(200);
  expect(result.size).toBeLessThan(1024 * 1024);
  expect(result.duration).toBeCloseTo(0.95, 2);
  expect(result.channels).toBe(1);
  expect(result.peak).toBeGreaterThan(0.5);
  expect(result.peak).toBeLessThan(1);
  expect(result.rms).toBeGreaterThan(0.05);
});

for (const [extension, mime] of [
  ["mp3", "audio/mpeg"],
  ["ogg", "audio/ogg"],
] as const) {
  test(`actual Chromium decoder supports original ${extension.toUpperCase()} custom effect`, async ({
    page,
  }) => {
    const { readFile } = await import("node:fs/promises");
    const bytes = await readFile(`tests/fixtures/impact.${extension}`);
    await page.route(`https://effects.example/impact.${extension}`, (route) =>
      route.fulfill({ contentType: mime, body: bytes }),
    );
    await page.goto("/");
    const duration = await page.evaluate(
      async ({ extension }) => {
        const response = await fetch(
          `https://effects.example/impact.${extension}`,
        );
        const context = new AudioContext();
        try {
          return (await context.decodeAudioData(await response.arrayBuffer()))
            .duration;
        } finally {
          await context.close();
        }
      },
      { extension },
    );
    expect(duration).toBeGreaterThan(0.9);
    expect(duration).toBeLessThan(1.1);
  });
}
