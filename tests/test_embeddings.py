from pantrila.embeddings import content_hash, embedding_text, to_pgvector


def test_embedding_text_has_key_facts_and_skips_seasoning(curry):
    text = embedding_text(curry)
    assert text.startswith("Chickpea and Spinach Curry\n")
    assert "Cuisine: indian" in text
    key_line = next(line for line in text.splitlines() if line.startswith("Key ingredients"))
    assert "chickpeas" in key_line and "coconut milk" in key_line
    assert "salt" not in key_line and "curry powder" not in key_line and "olive oil" not in key_line
    # Heaviest first.
    assert key_line.index("chickpeas") < key_line.index("spinach")
    assert "Diet: vegan" in text


def test_embedding_text_is_deterministic(curry):
    assert embedding_text(curry) == embedding_text(curry.model_copy())


def test_content_hash_depends_on_text_and_model():
    assert content_hash("a", "m1") == content_hash("a", "m1")
    assert content_hash("a", "m1") != content_hash("b", "m1")
    assert content_hash("a", "m1") != content_hash("a", "m2")


def test_to_pgvector_literal():
    assert to_pgvector([0.5, -1.0, 0.0]) == "[0.5,-1,0]"
