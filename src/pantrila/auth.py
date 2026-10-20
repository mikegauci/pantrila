"""Who is calling the API: verify a Supabase Auth access token and take its user id.

The web app signs people in with Supabase Auth and sends the access token as a bearer token.
Tokens are signed with the project's asymmetric key (ES256), so the API only needs the public
keys from `SUPABASE_URL/auth/v1/.well-known/jwks.json`; no shared secret. The token's `sub`
(the auth user's id) is the `user_id` for profiles, pantries, plans and usage.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import jwt

AUDIENCE = "authenticated"
ALGORITHMS = ["ES256", "RS256"]


class AuthError(Exception):
    pass


@dataclass(frozen=True)
class User:
    id: str
    email: str | None = None
    anonymous: bool = False


class TokenVerifier:
    def __init__(self, supabase_url: str):
        self.issuer = f"{supabase_url.rstrip('/')}/auth/v1"
        self.jwks = jwt.PyJWKClient(f"{self.issuer}/.well-known/jwks.json", cache_keys=True)

    def key_for(self, token: str):
        return self.jwks.get_signing_key_from_jwt(token).key

    def verify(self, token: str) -> User:
        try:
            claims = jwt.decode(
                token,
                self.key_for(token),
                algorithms=ALGORITHMS,
                audience=AUDIENCE,
                issuer=self.issuer,
                options={"require": ["exp", "sub", "aud", "iss"]},
            )
        except jwt.PyJWKClientError as exc:
            raise AuthError(f"cannot get the signing key: {exc}") from exc
        except jwt.InvalidTokenError as exc:
            raise AuthError(str(exc)) from exc
        return User(
            id=claims["sub"],
            email=claims.get("email") or None,
            anonymous=bool(claims.get("is_anonymous")),
        )


@lru_cache
def verifier(supabase_url: str) -> TokenVerifier:
    return TokenVerifier(supabase_url)
