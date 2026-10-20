"""Media for the video-import eval: each case's audio (made once, committed) and its frames.

Audio: the case's script read by OpenAI text-to-speech (`gpt-4o-mini-tts`, raw 24 kHz PCM),
resampled to the 16 kHz mono 16-bit WAV the browser sends, with a looping synthetic backing
track mixed under the speech for the music case. Text-to-speech is not deterministic, so the
WAV files are committed and only missing ones are made (`--force` remakes them all).

Frames: drawn at run time with Pillow, white overlay text on a plain dark frame, like a
creator's on-screen captions, sent as JPEG data URLs the size the browser sends (960 px).

    uv run python -m evals.video_audio [--only ids] [--force]   # paid, ~$0.01 for all cases
"""

from __future__ import annotations

import argparse
import base64
import io
import math
import wave
from array import array

from evals.video_cases import AUDIO, load_cases
from pantrila import config

TTS_MODEL = "gpt-4o-mini-tts"
TTS_RATE, RATE = 24_000, 16_000
STYLE = "A friendly food creator talking to camera in a short cooking video. Natural and upbeat."
FAST = " Speak very fast, like a creator squeezing a recipe into a 30-second video."


def resample(pcm: bytes, rate_in: int = TTS_RATE, rate_out: int = RATE) -> array:
    """16-bit mono PCM resampled by linear interpolation (what an OfflineAudioContext does)."""
    src = array("h")
    src.frombytes(pcm[: len(pcm) // 2 * 2])
    n = int(len(src) * rate_out / rate_in)
    out = array("h", bytes(2 * n))
    step = rate_in / rate_out
    for j in range(n):
        x = j * step
        i = int(x)
        a, b = src[i], src[min(i + 1, len(src) - 1)]
        out[j] = int(a + (b - a) * (x - i))
    return out


def with_music(speech: array, level: float = 0.3) -> array:
    """A looping four-chord backing track with a soft beat, mixed under the speech."""
    peak = max(1, max(abs(s) for s in speech))
    chords = [(220.0, 277.18, 329.63), (196.0, 246.94, 293.66), (174.61, 220.0, 261.63),
              (196.0, 246.94, 311.13)]  # fmt: skip
    out = array("h", bytes(2 * len(speech)))
    for j, s in enumerate(speech):
        t = j / RATE
        chord = chords[int(t / 2) % len(chords)]
        tone = sum(math.sin(2 * math.pi * f * t) for f in chord) / len(chord)
        beat = math.exp(-12 * (t % 0.5)) * math.sin(2 * math.pi * 60 * t)
        m = (0.7 * tone + 0.6 * beat) * level * peak
        out[j] = max(-32768, min(32767, int(s + m)))
    return out


def wav_bytes(samples: array) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(samples.tobytes())
    return buf.getvalue()


def make_audio(case: dict, client) -> bytes:
    tts = case["tts"]
    resp = client.audio.speech.create(
        model=TTS_MODEL,
        voice=tts["voice"],
        input=case["script"],
        instructions=STYLE + (FAST if tts["speed"] > 1 else ""),
        response_format="pcm",
    )
    speech = resample(resp.content)
    return wav_bytes(with_music(speech) if tts["music"] else speech)


def audio_url(case: dict) -> str:
    data = (AUDIO / f"{case['id']}.wav").read_bytes()
    return "data:audio/wav;base64," + base64.b64encode(data).decode()


def frame_urls(case: dict, width: int = 960, height: int = 540) -> list[str]:
    """One JPEG per frame: the case's on-screen text, or a plain frame when it has none."""
    from PIL import Image, ImageDraw, ImageFont

    font = ImageFont.load_default(size=44)
    urls = []
    for n, texts in enumerate(case["frames"]):
        img = Image.new("RGB", (width, height), (60 + 12 * n, 48 + 8 * n, 40))
        draw = ImageDraw.Draw(img)
        y = height // 2 - 30 * len(texts)
        for text in texts:
            w = draw.textlength(text, font=font)
            draw.rectangle(((width - w) / 2 - 16, y - 6, (width + w) / 2 + 16, y + 54),
                           fill=(20, 20, 20))  # fmt: skip
            draw.text(((width - w) / 2, y), text, font=font, fill=(255, 255, 255))
            y += 64
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=85)
        urls.append("data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode())
    return urls


def main() -> None:
    parser = argparse.ArgumentParser(description="Make the video eval's audio (paid TTS)")
    parser.add_argument("--only", help="comma-separated case ids")
    parser.add_argument("--force", action="store_true", help="remake existing files")
    args = parser.parse_args()
    cases = load_cases()
    if args.only:
        cases = [c for c in cases if c["id"] in set(args.only.split(","))]
    AUDIO.mkdir(parents=True, exist_ok=True)
    client = config.openai_client()
    for case in cases:
        path = AUDIO / f"{case['id']}.wav"
        if path.exists() and not args.force:
            continue
        path.write_bytes(make_audio(case, client))
        with wave.open(str(path)) as w:
            print(f"{path.name}: {w.getnframes() / w.getframerate():.1f} s", flush=True)


if __name__ == "__main__":
    main()
