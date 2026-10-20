"""Supabase token checks with a local ES256 key in place of the project's JWKS."""

import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from pantrila.auth import AuthError, TokenVerifier

URL = "https://example.supabase.co"
KEY = ec.generate_private_key(ec.SECP256R1())


@pytest.fixture
def verifier(monkeypatch):
    v = TokenVerifier(URL)
    monkeypatch.setattr(v, "key_for", lambda token: KEY.public_key())
    return v


def token(key=KEY, **overrides) -> str:
    claims = {
        "sub": "user-1",
        "aud": "authenticated",
        "iss": f"{URL}/auth/v1",
        "exp": int(time.time()) + 600,
        "email": "a@example.com",
        "is_anonymous": False,
    }
    claims.update(overrides)
    return jwt.encode({k: v for k, v in claims.items() if v is not None}, key, algorithm="ES256")


def test_valid_token_gives_the_user(verifier):
    user = verifier.verify(token())
    assert (user.id, user.email, user.anonymous) == ("user-1", "a@example.com", False)
    assert verifier.verify(token(email="", is_anonymous=True)).anonymous is True


@pytest.mark.parametrize(
    "bad",
    [
        {"exp": int(time.time()) - 10},
        {"aud": "anon"},
        {"iss": "https://other.supabase.co/auth/v1"},
        {"sub": None},
    ],
)
def test_bad_claims_are_rejected(verifier, bad):
    with pytest.raises(AuthError):
        verifier.verify(token(**bad))


def test_wrong_key_and_hs256_are_rejected(verifier):
    with pytest.raises(AuthError):
        verifier.verify(token(key=ec.generate_private_key(ec.SECP256R1())))
    forged = jwt.encode({"sub": "x", "aud": "authenticated"}, "s" * 32, algorithm="HS256")
    with pytest.raises(AuthError):
        verifier.verify(forged)
