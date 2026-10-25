import wave

from scripts.cooking_sounds import OUT, RATE, frames, sounds


def test_committed_cooking_sounds_match_the_generator():
    for name, samples in sounds().items():
        with wave.open(str(OUT / name), "rb") as f:
            assert (f.getframerate(), f.getnchannels()) == (RATE, 1)
            assert f.readframes(f.getnframes()) == frames(samples), (
                f"rerun the generator for {name}"
            )
