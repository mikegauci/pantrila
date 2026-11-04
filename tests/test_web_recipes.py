from types import SimpleNamespace

from pantrila.schema import Allergen, DietTag, UserProfile
from pantrila.web_recipes import FoundRecipe, FoundRecipes, find_web_recipes, ingredient_problems

USAGE = SimpleNamespace(input_tokens=1000, output_tokens=100)


def found(*recipes: FoundRecipe) -> SimpleNamespace:
    return SimpleNamespace(output_parsed=FoundRecipes(recipes=list(recipes)), usage=USAGE)


def page(title: str, url: str, *ingredients: str) -> FoundRecipe:
    return FoundRecipe(title=title, url=url, summary="A dish.", ingredients=list(ingredients))


class FakeClient:
    def __init__(self, reply):
        self.reply, self.calls = reply, []
        self.responses = self

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        return self.reply


def test_ingredient_problems_judge_only_what_the_table_knows():
    profile = UserProfile(allergies=[Allergen.PEANUTS], diets=[DietTag.VEGETARIAN,
                                                               DietTag.HIGH_PROTEIN])  # fmt: skip
    assert ingredient_problems(["rice", "unobtainium"], profile) == []
    assert any("peanuts" in p for p in ingredient_problems(["peanut butter", "rice"], profile))
    assert any("vegetarian" in p for p in ingredient_problems(["chicken breast"], profile))


def test_find_drops_bad_links_and_rule_breakers_and_sends_the_profile():
    profile = UserProfile(allergies=[Allergen.FISH])
    client = FakeClient(found(
        page("Chicken rice", "https://www.example.com/chicken-rice", "chicken thigh", "rice"),
        page("Same again", "https://www.example.com/chicken-rice", "rice"),
        page("Salmon rice", "https://fish.example/salmon", "salmon", "rice"),
        page("A reel", "https://www.tiktok.com/@a/video/1", "rice"),
        page("No scheme", "ftp://example.com/x", "rice"),
    ))  # fmt: skip
    result = find_web_recipes("I have chicken and rice", profile, client=client, model="m")
    assert [(r.title, r.site) for r in result.recipes] == [("Chicken rice", "example.com")]
    assert result.dropped == 1 and result.usage.web_searches == 1
    call = client.calls[0]
    assert call["store"] is False and call["tools"] == [{"type": "web_search"}]
    assert "Allergies: fish." in call["instructions"]
    assert "chicken and rice" in call["input"][0]["content"][0]["text"]
