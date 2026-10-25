"""Write the phone app's cooking sounds, the same notes the web plays with Web Audio
(web/src/lib/cooking.ts): mobile/assets/sounds/ring.wav (three 880 Hz beeps, a finished timer)
and chime.wav (one rising note, a voice command heard). Deterministic; run after changing them."""

import math
import struct
import wave
from pathlib import Path

RATE = 22050
OUT = Path(__file__).resolve().parent.parent / "mobile" / "assets" / "sounds"


def note(start_hz: float, end_hz: float, seconds: float, peak: float) -> list[float]:
    """A note sliding from start_hz to end_hz, rising fast and fading out, as the web does."""
    n = int(RATE * seconds)
    out, phase = [], 0.0
    for i in range(n):
        t = i / n
        hz = start_hz * (end_hz / start_hz) ** min(1.0, t * seconds / 0.12)
        phase += 2 * math.pi * hz / RATE
        rise = min(1.0, i / (RATE * 0.02))
        fade = 0.0001 ** max(0.0, (t * seconds - 0.02) / (seconds - 0.02))
        out.append(peak * rise * fade * math.sin(phase))
    return out


def silence(seconds: float) -> list[float]:
    return [0.0] * int(RATE * seconds)


def sounds() -> dict[str, list[float]]:
    beep = note(880, 880, 0.3, 0.6)
    return {
        "ring.wav": beep + silence(0.15) + beep + silence(0.15) + beep + silence(0.1),
        "chime.wav": note(660, 990, 0.25, 0.3) + silence(0.05),
    }


def frames(samples: list[float]) -> bytes:
    return b"".join(struct.pack("<h", round(s * 32767)) for s in samples)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, samples in sounds().items():
        with wave.open(str(OUT / name), "wb") as f:
            f.setnchannels(1)
            f.setsampwidth(2)
            f.setframerate(RATE)
            f.writeframes(frames(samples))


if __name__ == "__main__":
    main()
