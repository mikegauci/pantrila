# Supabase Auth email templates

Written by `scripts/email_templates.py` (edit the script, then rerun it); do not edit these files
by hand. Supabase keeps templates in its dashboard, so after a change paste each one in:
Supabase -> Authentication -> Emails -> Templates -> pick the template -> set the subject ->
Source -> replace the body with the file's contents -> Save.

| Dashboard template | Subject | File |
| --- | --- | --- |
| Confirm signup | `Confirm your email for Pantrila` | `confirm-signup.html` |
| Magic link | `Your Pantrila sign-in link` | `magic-link.html` |
| Change email address | `Confirm your new email for Pantrila` | `change-email.html` |

The logo is `https://pantrila.com/email/logo.png`, served from `site/public/email/`. A first email to a new address uses
"Confirm signup"; later sign-ins use "Magic link". Mail goes out through Resend
(`no-reply@send.pantrila.com`); see `docs/plans/custom-domain.md`, phase 3.
