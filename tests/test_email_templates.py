from scripts.email_templates import OUT, TEMPLATES, readme, render


def test_committed_email_templates_match_the_generator():
    for t in TEMPLATES:
        assert (OUT / t.file).read_text() == render(t), f"rerun the generator for {t.file}"
    assert (OUT / "README.md").read_text() == readme()


def test_every_template_links_the_confirmation_url_and_keeps_no_placeholders():
    for t in TEMPLATES:
        html = render(t)
        assert html.count("{{ .ConfirmationURL }}") == 3
        assert "$" not in html
