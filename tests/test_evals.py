import json

import pytest

from evals.metrics import normalized_recall_at_k, percentile, reciprocal_rank
from evals.retrieval_queries import OUT, SPECS, generate, render
from pantrila.corpus import load_briefs, load_corpus


def test_normalized_recall_at_k_is_capped_by_k():
    ranked = ["a", "b", "c", "d", "e", "f"]
    assert normalized_recall_at_k(ranked, {"a", "c"}, 5) == 1.0
    assert normalized_recall_at_k(ranked, {"a", "z"}, 5) == 0.5
    # 10 relevant, 5 of them in the top 5: perfect at k=5.
    assert (
        normalized_recall_at_k(ranked[:5], set(ranked[:5]) | {str(i) for i in range(5)}, 5) == 1.0
    )
    with pytest.raises(ValueError):
        normalized_recall_at_k(ranked, set(), 5)


def test_reciprocal_rank():
    assert reciprocal_rank(["x", "a"], {"a"}) == 0.5
    assert reciprocal_rank(["x"], {"a"}) == 0.0


def test_percentile_nearest_rank():
    values = list(range(1, 101))
    assert percentile(values, 50) == 50
    assert percentile(values, 95) == 95
    assert percentile([7.0], 95) == 7.0


def test_query_specs_cover_the_hard_cases():
    kinds = {s.kind for s in SPECS}
    assert {"negation", "allergen", "vague", "pantry"} <= kinds
    assert len(SPECS) >= 60
    assert len({s.id for s in SPECS}) == len(SPECS)


def test_committed_queries_match_generator():
    recipes = load_corpus()
    if not recipes:
        pytest.skip("corpus not generated yet")
    assert OUT.read_text() == render(generate(recipes, load_briefs()))


def test_committed_queries_never_label_filter_breakers_relevant():
    if not OUT.exists():
        pytest.skip("retrieval queries not generated yet")
    from pantrila.search import SearchFilters

    recipes = {r.id: r for r in load_corpus()}
    for q in json.loads(OUT.read_text()):
        f = SearchFilters.model_validate(q["filters"])
        assert q["relevant_ids"]
        assert all(not f.violations(recipes[rid]) for rid in q["relevant_ids"]), q["id"]


def test_committed_plan_profiles_match_generator():
    from evals.plan_profiles import OUT as PROFILES
    from evals.plan_profiles import generate
    from evals.plan_profiles import render as render_profiles

    assert PROFILES.read_text() == render_profiles(generate())


def test_every_plan_profile_is_feasible():
    """Each slot has enough safe recipes to fill the plan without breaking the repeat limit,
    and every pantry and excluded food is in the ingredient table."""
    import math

    from evals.plan_profiles import load_profiles
    from pantrila.constraints import MAX_REPEATS, recipe_violations
    from pantrila.foods import load_foods

    recipes = load_corpus()
    foods = load_foods()
    for pid, p in load_profiles():
        assert set(p.pantry) | set(p.exclude_foods) <= set(foods), pid
        for slot in p.meals:
            safe = sum(not recipe_violations(r, p, slot) for r in recipes)
            assert safe >= math.ceil(p.days / MAX_REPEATS), (pid, slot)


def test_committed_chat_cases_match_generator():
    from evals.chat_cases import OUT as CASES
    from evals.chat_cases import generate
    from evals.chat_cases import render as render_cases

    assert CASES.read_text() == render_cases(generate())


def test_chat_cases_point_at_real_recipes_tools_and_foods():
    from evals.chat_cases import CITED_IN_MESSAGE, load_cases
    from evals.run_assistant import kitchen_for
    from pantrila.assistant import TOOL_ARGS
    from pantrila.foods import load_foods

    ids = {r.id for r in load_corpus()}
    foods = load_foods()
    for c in load_cases():
        e = c["expect"]
        kitchen_for(c)  # every pantry food and amount is valid
        assert set(e.get("tools_all", []) + e.get("tools_any", [])) <= set(TOOL_ARGS), c["id"]
        assert set(e.get("pantry_has", []) + e.get("pantry_lacks", [])) <= set(foods), c["id"]
        assert set(CITED_IN_MESSAGE.findall(c["message"])) <= ids, c["id"]
        assert set(e.get("allow_flagged", [])) <= ids, c["id"]


def test_committed_import_cases_match_generator_and_use_real_foods():
    from evals.import_cases import OUT as IMPORTS
    from evals.import_cases import generate
    from evals.import_cases import render as render_imports
    from pantrila.foods import load_foods

    assert IMPORTS.read_text() == render_imports(generate())
    foods = load_foods()
    for case in generate():
        for line in case["expect"]["lines"]:
            assert line["foods"] is None or set(line["foods"]) <= set(foods), case["id"]


def test_import_scoring_counts_estimates_and_missed_allergens():
    from evals.import_cases import load_cases
    from evals.run_import import score
    from pantrila.cookbook import CookbookRecipeIn

    case = next(c for c in load_cases() if c["id"] == "graph-tteokbokki")
    lines = [{"name": li["text"], "quantity": 1, "unit": "g", "food": (li["foods"] or [None])[0]}
             for li in case["expect"]["lines"]]  # fmt: skip
    draft = CookbookRecipeIn(title="T", meal_types=["dinner"], total_minutes=24, servings=2,
                             ingredients=lines, steps=["Cook."])  # fmt: skip
    row = score(case, draft, [])
    # Two foods should have been estimated and were left blank: those lines miss, and the
    # gochujang's gluten is still covered by the soy sauce, but nothing else is lost.
    assert row["lines_matched"] == 5 and row["missed_allergens"] == []
    assert row["servings_ok"] and row["time_ok"]


def test_committed_video_cases_match_generator_and_use_real_foods():
    from evals.video_cases import OUT as VIDEOS
    from evals.video_cases import generate
    from evals.video_cases import render as render_videos
    from pantrila.foods import load_foods

    assert VIDEOS.read_text() == render_videos(generate())
    foods = load_foods()
    for case in generate():
        assert len(case["frames"]) == 4, case["id"]
        for line in case["expect"]["lines"]:
            assert set(line["foods"]) <= set(foods), case["id"]
            assert line["vague"] == (line["amount"] is None), case["id"]


def test_video_media_matches_what_the_browser_sends():
    import base64
    import io
    import math
    import wave
    from array import array

    from evals.video_audio import RATE, frame_urls, resample, wav_bytes, with_music
    from evals.video_cases import load_cases

    tone = array("h", (int(8000 * math.sin(2 * math.pi * 440 * j / 24_000))
                       for j in range(24_000)))  # fmt: skip
    speech = resample(tone.tobytes())
    assert len(speech) == RATE and max(speech) <= 8000
    with wave.open(io.BytesIO(wav_bytes(with_music(speech)))) as w:
        assert (w.getnchannels(), w.getframerate(), w.getnframes()) == (1, RATE, RATE)
    case = next(c for c in load_cases() if c["kind"] == "on-screen")
    frames = frame_urls(case)
    assert len(frames) == 4 and all(f.startswith("data:image/jpeg;base64,") for f in frames)
    assert len(base64.b64decode(frames[1].split(",")[1])) < 200_000


def test_video_scoring_counts_flags_and_stated_amounts():
    from evals.run_video import score
    from evals.video_cases import load_cases
    from pantrila.cookbook import CookbookRecipeIn

    case = next(c for c in load_cases() if c["kind"] == "vague")
    lines = [{"name": li["text"], "quantity": (li["amount"] or [1])[0],
              "unit": (li["amount"] or [0, "tbsp"])[1], "food": li["foods"][0]}
             for li in case["expect"]["lines"]]  # fmt: skip
    draft = CookbookRecipeIn(title="T", meal_types=["dinner"], total_minutes=15, servings=2,
                             ingredients=lines, steps=["Cook."])  # fmt: skip
    notes = [
        "Ingredient 2 (olive oil): the video only says \u201ca glug\u201d, so the amount "
        "is a guess. Set it.",
        "Ingredient 3 (garlic): the video only says \u201cfour\u201d",
    ]
    row = score(case, draft, notes)
    assert row["lines_matched"] == 5 and row["missed_allergens"] == []
    assert (row["vague_flagged"], row["vague_expected"]) == (1, 3)
    assert (row["stated_right"], row["stated_expected"], row["stated_flagged"]) == (2, 2, 1)
    assert row["sponsor_ignored"] and row["servings_ok"]
    assert score(case, None, []) == {"found_ok": False}


def test_insights_snapshot_matches_the_selected_eval_reports():
    from scripts.update_eval_snapshot import OUT, render_snapshot

    assert OUT.read_text() == render_snapshot()


def test_committed_reel_cases_match_generator_and_pair_real_videos():
    from evals.reel_cases import OUT as REELS
    from evals.reel_cases import generate
    from evals.reel_cases import render as render_reels
    from evals.video_cases import AUDIO
    from pantrila.foods import load_foods
    from pantrila.social import detect

    assert REELS.read_text() == render_reels(generate())
    foods = load_foods()
    for case in generate():
        assert detect(case["url"]) == case["platform"], case["id"]
        assert (AUDIO / f"{case['video']}.wav").exists(), case["id"]
        for line in case["expect"]["lines"]:
            assert set(line["foods"]) <= set(foods), case["id"]


def test_reel_scoring_counts_service_calls_and_the_method():
    from evals.reel_cases import load_cases
    from evals.run_reel import EvalMedia, fake_fetch, fake_read, score
    from pantrila.cookbook import CookbookRecipeIn
    from pantrila.recipe_import import NO_METHOD_STEP

    case = next(c for c in load_cases() if c["kind"] == "ingredients-only")
    lines = [{"name": li["text"], "quantity": li["amount"][0], "unit": li["amount"][1],
              "food": li["foods"][0]} for li in case["expect"]["lines"]]  # fmt: skip
    draft = CookbookRecipeIn(title="T", meal_types=["dinner"], total_minutes=15, servings=2,
                             ingredients=lines, steps=[NO_METHOD_STEP])  # fmt: skip
    row = score(case, draft, EvalMedia(case, None), media_on=True, fetched=[])
    assert row["lines_matched"] == row["stated_right"] == 5 and row["missed_allergens"] == []
    assert not row["method"] and not row["calls_ok"] and row["comment_calls_ok"]
    assert score(case, draft, EvalMedia(case, None), media_on=False, fetched=[])["calls_ok"]
    media = fake_read(fake_fetch(f"https://media.pantrila-eval.example/{case['video']}.mp4"))
    assert media.seconds > 1 and len(media.frames) == 4


def test_reel_eval_comments_go_through_the_real_creator_filter():
    from evals.reel_cases import SITE, load_cases
    from evals.run_reel import EvalMedia
    from pantrila.post_media import COMMENT_LIMIT

    cases = {c["kind"]: c for c in load_cases()}
    creator, stranger = cases["creator-comment-link"], cases["stranger-comment-link"]
    found = EvalMedia(creator, None).creator_comments(creator["url"], "facebook", None)
    assert found.texts == [SITE] and found.fetched == COMMENT_LIMIT
    found = EvalMedia(stranger, None).creator_comments(stranger["url"], "tiktok", None)
    assert found.texts == [] and found.fetched == COMMENT_LIMIT
