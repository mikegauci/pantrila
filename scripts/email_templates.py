"""Write the branded Supabase Auth email templates to supabase/templates/.

Supabase keeps its email templates in the dashboard (Authentication -> Emails -> Templates), so
these files are the source to paste from; see supabase/templates/README.md. Every template shares
one layout: table-based HTML with inline styles, because email clients ignore most CSS.

    uv run python scripts/email_templates.py
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from string import Template as Layout

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "supabase" / "templates"
LAYOUT = Layout((HERE / "email_layout.html").read_text().split("-->\n", 1)[1])
LOGO = "https://pantrila.com/email/logo.png"  # served by the landing site (site/public/email/)

# Colours from web/DESIGN_SYSTEM.md.
BACKGROUND = "#f7f8f3"
SURFACE = "#ffffff"
FOREGROUND = "#1d2a1f"
MUTED = "#6b756b"
BORDER = "#e6e9e0"
PRIMARY = "#3fa34d"
PRIMARY_TEXT = "#2e8a3b"
SOFT = "#e4f4e5"
FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"


@dataclass(frozen=True)
class Template:
    file: str
    dashboard_name: str
    subject: str
    preheader: str
    heading: str
    body: str
    button: str
    reason: str


TEMPLATES = [
    Template(
        file="confirm-signup.html",
        dashboard_name="Confirm signup",
        subject="Confirm your email for Pantrila",
        preheader="One tap to finish signing in to Pantrila.",
        heading="Welcome to Pantrila",
        body=(
            "Confirm this email address to finish signing in. Pantrila will then find recipes "
            "from your kitchen, plan your week and check every meal against your allergies."
        ),
        button="Confirm and sign in",
        reason="someone used this address to sign up for Pantrila",
    ),
    Template(
        file="magic-link.html",
        dashboard_name="Magic link",
        subject="Your Pantrila sign-in link",
        preheader="Your link to sign in to Pantrila.",
        heading="Sign in to Pantrila",
        body="Tap the button to sign in. No password needed.",
        button="Sign in to Pantrila",
        reason="someone asked to sign in to Pantrila with this address",
    ),
    Template(
        file="change-email.html",
        dashboard_name="Change email address",
        subject="Confirm your new email for Pantrila",
        preheader="Confirm the new email address for your Pantrila account.",
        heading="Confirm your new email",
        body=(
            "Confirm that <strong>{{ .NewEmail }}</strong> should replace "
            "<strong>{{ .Email }}</strong> on your Pantrila account."
        ),
        button="Confirm new email",
        reason="someone asked to move a Pantrila account to this address",
    ),
]


def render(t: Template) -> str:
    return LAYOUT.substitute(
        background=BACKGROUND,
        surface=SURFACE,
        foreground=FOREGROUND,
        muted=MUTED,
        border=BORDER,
        primary=PRIMARY,
        primary_text=PRIMARY_TEXT,
        soft=SOFT,
        font=FONT,
        logo=LOGO,
        subject=t.subject,
        preheader=t.preheader,
        heading=t.heading,
        body=t.body,
        button=t.button,
        reason=t.reason,
    )


def readme() -> str:
    rows = "\n".join(f"| {t.dashboard_name} | `{t.subject}` | `{t.file}` |" for t in TEMPLATES)
    return f"""# Supabase Auth email templates

Written by `scripts/email_templates.py` (edit the script, then rerun it); do not edit these files
by hand. Supabase keeps templates in its dashboard, so after a change paste each one in:
Supabase -> Authentication -> Emails -> Templates -> pick the template -> set the subject ->
Source -> replace the body with the file's contents -> Save.

| Dashboard template | Subject | File |
| --- | --- | --- |
{rows}

The logo is `{LOGO}`, served from `site/public/email/`. A first email to a new address uses
"Confirm signup"; later sign-ins use "Magic link". Mail goes out through Resend
(`no-reply@send.pantrila.com`); see `docs/plans/custom-domain.md`, phase 3.
"""


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for t in TEMPLATES:
        (OUT / t.file).write_text(render(t))
    (OUT / "README.md").write_text(readme())
    print(f"wrote {len(TEMPLATES)} templates to {OUT}")


if __name__ == "__main__":
    main()
