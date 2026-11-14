"""Original Ardonia impact: deterministic synthesis, no samples or external media.

MIT licensed with this project. 0.95 seconds, mono PCM16, 22050Hz.
A falling low sine plus harmonics, a filtered noise transient and short echoes.
Run from any directory to reproduce public/sounds/impact.wav byte for byte.
"""
from pathlib import Path
import math
import random
import struct
import wave

RATE = 22050
DURATION = 0.95
rng = random.Random(24753)
samples = []
phase = 0.0
filtered = 0.0
for index in range(round(RATE * DURATION)):
    t = index / RATE
    frequency = 48 + 104 * math.exp(-t * 17)
    phase += 2 * math.pi * frequency / RATE
    attack = min(1.0, t / 0.004)
    bass = (math.sin(phase) + 0.22 * math.sin(phase * 2.01)) * math.exp(-t * 6.2)
    noise = rng.uniform(-1, 1)
    filtered += 0.28 * (noise - filtered)
    transient = filtered * 0.75 * math.exp(-t * 45)
    air = noise * 0.055 * math.exp(-t * 12)
    tail_fade = min(1.0, max(0.0, (DURATION - t) / 0.12))
    samples.append((bass + 0.20 * math.sin(phase * 3.0) * math.exp(-t * 9) + transient + air) * attack * tail_fade)
# Quiet, finite echoes add space without a continuous track.
base = samples[:]
for delay, gain in [(0.047, 0.17), (0.089, 0.09)]:
    offset = round(delay * RATE)
    for i in range(offset, len(samples)):
        samples[i] += base[i-offset] * gain * min(1.0, (len(samples)-i)/(RATE*0.12))
scale = 0.86 / max(abs(sample) for sample in samples)
payload = b''.join(struct.pack('<h', round(sample * scale * 32767)) for sample in samples)
destination = Path(__file__).resolve().parent.parent / 'public' / 'sounds' / 'impact.wav'
destination.parent.mkdir(exist_ok=True)
with wave.open(str(destination), 'wb') as output:
    output.setnchannels(1)
    output.setsampwidth(2)
    output.setframerate(RATE)
    output.writeframes(payload)
print(f'{destination.name}: {len(samples)/RATE:.3f}s; {destination.stat().st_size} bytes; original synthesis')
