"""Recipe photos: one generated image per recipe, stored in Supabase Storage.

The prompt shows the dish as the recipe makes it: the model gets the ingredient names and the
final step (where the garnish usually is) and may garnish or dress the background only with
those ingredients, so a photo never suggests herbs or toppings the recipe does not use. Bread
appears in the background only when the recipe uses it or suggests it as a side, and never
next to a gluten-free recipe. The scene (speckled grey stoneware, light stone surface, linen
napkin, side daylight, strong background blur) keeps the set consistent.

Images come back at 1536x1152 (4:3, the ratio every recipe image in the web app uses) and are
stored as 1200x900 WebP. Paths carry a content hash or a random id, so a new photo gets a new
URL and caches never serve a stale one. The database stores paths; `public_url` builds the URL
from SUPABASE_URL, so nothing is hardcoded.
"""

from __future__ import annotations

import base64
import hashlib
import io
import re
import secrets
import time
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Protocol

from pantrio import config
from pantrio.planner import Usage

BUCKET = "recipe-photos"
GENERATE_SIZE = "1536x1152"
STORED_SIZE = (1200, 900)
QUALITY = "medium"

SCENE = (
    "Realistic editorial food photography, eye-level three-quarter angle, close-up with a "
    "very shallow depth of field (f/1.8): the dish is in sharp focus and the background is "
    "strongly blurred; the dish fills most of the frame, slightly below centre. Served in a "
    "matte speckled grey stoneware bowl or plate, whichever suits the dish. Light grey stone "
    "surface, a soft grey linen napkin at one corner, soft natural daylight from the side. "
)
FAITHFUL = (
    "Show only these ingredients. Garnish only with ingredients from this list; add no "
    "herbs, spices or toppings that are not listed. "
)
PROPS = (
    "Softly blurred background props that complement this dish: one or two of its raw "
    "ingredients from the list above, shown whole or freshly cut as they would be before "
    "cooking, loosely arranged to one side and kept well out of focus. Choose the most "
    "colourful, recognisable ingredients; never salt, pepper, water, oil, flour or sugar. "
    "No other dishes, bowls or props. "
)
BREAD = "A few slices of bread to one side in the background. "


@dataclass(frozen=True)
class Dish:
    """What a photo is made from; corpus and cookbook recipes both map to this."""

    title: str
    summary: str
    ingredients: list[str]  # names as the recipe writes them
    steps: list[str]
    gluten_free: bool


def shows_bread(dish: Dish) -> bool:
    """Bread in the background only if the recipe uses it or suggests it as a side. Whole
    word, so "fine breadcrumbs" in a pastry step does not count."""
    text = " ".join([dish.summary, *dish.ingredients]).lower()
    return not dish.gluten_free and re.search(r"\bbread\b", text) is not None


def photo_prompt(dish: Dish) -> str:
    # "butter, cold and cubed" -> "butter": preparation notes would read as more ingredients
    names = ", ".join(dict.fromkeys(n.split(",")[0].strip() for n in dish.ingredients
                                    if n.split(",")[0].strip()))  # fmt: skip
    steps = [s for s in dish.steps if s.strip()]
    final = f" Final step: {steps[-1].strip()}" if steps else ""
    return (
        f"{dish.title}. {dish.summary} Ingredients: {names}.{final} "
        + FAITHFUL + SCENE + PROPS + (BREAD if shows_bread(dish) else "") + "No text, no hands."
    )  # fmt: skip


def prompt_hash(prompt: str, model: str) -> str:
    return hashlib.sha256(f"{model}\n{GENERATE_SIZE}\n{QUALITY}\n{prompt}".encode()).hexdigest()


def corpus_path(recipe_id: str, prompt: str, model: str) -> str:
    return f"recipes/{recipe_id}-{prompt_hash(prompt, model)[:10]}.webp"


def cookbook_path(user_id: str) -> str:
    """Unguessable: the bucket is public, and a cookbook recipe is private."""
    return f"user-recipes/{user_id}/{secrets.token_urlsafe(16)}.webp"


def avatar_path(user_id: str) -> str:
    """Unguessable and new on every upload, so a changed picture is never served from cache."""
    return f"avatars/{user_id}/{secrets.token_urlsafe(16)}.webp"


def public_url(path: str | None) -> str | None:
    base = config.supabase_url_or_none()
    if not path or not base:
        return None
    return f"{base.rstrip('/')}/storage/v1/object/public/{BUCKET}/{path}"


def to_webp(png: bytes) -> bytes:
    """Resize to the stored size (same 4:3 ratio, centre-cropped if the model returned
    another one) and encode as WebP."""
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(png)) as img:
        img = ImageOps.fit(img.convert("RGB"), STORED_SIZE, Image.Resampling.LANCZOS)
        out = io.BytesIO()
        img.save(out, "WEBP", quality=82, method=6)
    return out.getvalue()


AVATAR_SIZE = (256, 256)


def to_avatar_webp(image: bytes) -> bytes:
    """Centre-crop to a square, resize to 256 px and encode as WebP (drops EXIF and any
    transparency, so a re-encoded upload carries nothing but pixels)."""
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(image)) as img:
        img = ImageOps.fit(ImageOps.exif_transpose(img).convert("RGB"), AVATAR_SIZE,
                           Image.Resampling.LANCZOS)  # fmt: skip
        out = io.BytesIO()
        img.save(out, "WEBP", quality=85, method=6)
    return out.getvalue()


class PhotoUsage(Usage):
    """Token usage of image calls, priced with the image model's rates."""

    def cost(self) -> float | None:
        return config.image_prices().chat_cost(self.input_tokens, self.output_tokens)


@dataclass
class Photo:
    webp: bytes
    prompt: str
    model: str
    latency_ms: float
    usage: PhotoUsage = field(default_factory=PhotoUsage)


def generate(
    dish: Dish, client=None, model: str | None = None, usage: PhotoUsage | None = None
) -> Photo:
    """One image call. Raises on any API error; the caller decides what to log."""
    client = client or config.openai_client()
    model = model or config.image_model()
    prompt = photo_prompt(dish)
    start = time.perf_counter()
    usage = usage or PhotoUsage()
    resp = client.images.generate(model=model, prompt=prompt, size=GENERATE_SIZE, quality=QUALITY)
    usage.llm_calls += 1
    if resp.usage:
        usage.input_tokens += resp.usage.input_tokens
        usage.output_tokens += resp.usage.output_tokens
    webp = to_webp(base64.b64decode(resp.data[0].b64_json))
    return Photo(webp, prompt, model, (time.perf_counter() - start) * 1000, usage)


# --- Storage ------------------------------------------------------------------------------


class PhotoStore(Protocol):
    def put(self, path: str, data: bytes) -> None: ...

    def delete(self, paths: Iterable[str]) -> None: ...


class MemoryPhotos:
    def __init__(self):
        self.files: dict[str, bytes] = {}

    def put(self, path: str, data: bytes) -> None:
        self.files[path] = data

    def delete(self, paths: Iterable[str]) -> None:
        for p in paths:
            self.files.pop(p, None)


class SupabasePhotos:
    """The Storage REST API with the service role key (server side only)."""

    def __init__(self, url: str, service_key: str):
        import httpx

        self.http = httpx.Client(
            base_url=f"{url.rstrip('/')}/storage/v1",
            headers={"Authorization": f"Bearer {service_key}", "apikey": service_key},
            timeout=60,
        )

    def ensure_bucket(self) -> bool:
        """Create the public bucket if missing. Returns True if it was created."""
        if self.http.get(f"/bucket/{BUCKET}").status_code == 200:
            return False
        r = self.http.post("/bucket", json={
            "id": BUCKET, "name": BUCKET, "public": True, "file_size_limit": 2 * 1024 * 1024,
            "allowed_mime_types": ["image/webp"],
        })  # fmt: skip
        r.raise_for_status()
        return True

    def put(self, path: str, data: bytes) -> None:
        r = self.http.post(f"/object/{BUCKET}/{path}", content=data, headers={
            "Content-Type": "image/webp", "x-upsert": "true",
            "Cache-Control": "max-age=31536000",  # paths never change content
        })  # fmt: skip
        r.raise_for_status()

    def delete(self, paths: Iterable[str]) -> None:
        paths = [p for p in paths if p]
        if paths:
            self.http.request("DELETE", f"/object/{BUCKET}", json={"prefixes": paths})

    def close(self) -> None:
        self.http.close()


def photo_store() -> PhotoStore | None:
    """Supabase Storage when the service role key is set; None means photos are off."""
    url, key = config.supabase_url_or_none(), config.supabase_service_key()
    return SupabasePhotos(url, key) if url and key else None


# --- Corpus photo paths in the database ---------------------------------------------------


def corpus_paths(conn, ids: Iterable[str]) -> dict[str, str]:
    rows = conn.execute(
        "select recipe_id, path from recipe_photos where recipe_id = any(%s)", (sorted(set(ids)),)
    ).fetchall()
    return dict(rows)


def save_corpus_path(conn, recipe_id: str, path: str, model: str) -> str | None:
    """Record a recipe's photo; returns the path it replaced, if any."""
    with conn.transaction():
        old = conn.execute(
            "select path from recipe_photos where recipe_id = %s", (recipe_id,)
        ).fetchone()
        conn.execute(
            "insert into recipe_photos (recipe_id, path, model) values (%s, %s, %s)"
            " on conflict (recipe_id) do update set path = excluded.path,"
            " model = excluded.model, created_at = now()",
            (recipe_id, path, model),
        )
    return old[0] if old and old[0] != path else None


# --- Corpus run ---------------------------------------------------------------------------


def corpus_dish(recipe) -> Dish:
    from pantrio.schema import DietTag

    return Dish(title=recipe.title, summary=recipe.summary,
                ingredients=[i.name for i in recipe.ingredients], steps=recipe.steps,
                gluten_free=DietTag.GLUTEN_FREE in recipe.diet_tags)  # fmt: skip


@dataclass
class RunReport:
    generated: int = 0
    skipped: int = 0
    failed: list[str] = field(default_factory=list)
    usage: PhotoUsage = field(default_factory=PhotoUsage)
    latencies_ms: list[float] = field(default_factory=list)


def photograph_corpus(
    conn, recipes, store: PhotoStore, client=None, model: str | None = None, workers: int = 4,
    force: bool = False, on_done=None,
) -> RunReport:  # fmt: skip
    """Generate and upload a photo for every recipe whose prompt or model changed (or all with
    `force`). Image calls and uploads run in threads; database writes stay on this thread."""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    # Image models allow about 20 images a minute; the SDK backs off and retries on 429.
    client = (client or config.openai_client()).with_options(max_retries=8)
    model = model or config.image_model()
    current = corpus_paths(conn, [r.id for r in recipes])
    report, todo = RunReport(), []
    for r in recipes:
        path = corpus_path(r.id, photo_prompt(corpus_dish(r)), model)
        if not force and current.get(r.id) == path:
            report.skipped += 1
        else:
            todo.append((r, path))

    def work(recipe, path) -> Photo:
        photo = generate(corpus_dish(recipe), client=client, model=model)
        store.put(path, photo.webp)
        return photo

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(work, r, path): (r, path) for r, path in todo}
        for fut in as_completed(futures):
            r, path = futures[fut]
            try:
                photo = fut.result()
            except Exception as exc:
                report.failed.append(f"{r.id}: {type(exc).__name__}: {str(exc)[:200]}")
                if on_done:
                    on_done(r.id, None)
                continue
            old = save_corpus_path(conn, r.id, path, model)
            if old:
                store.delete([old])
            report.generated += 1
            report.latencies_ms.append(photo.latency_ms)
            for f in ("llm_calls", "input_tokens", "output_tokens"):
                setattr(report.usage, f, getattr(report.usage, f) + getattr(photo.usage, f))
            if on_done:
                on_done(r.id, photo)
    return report
