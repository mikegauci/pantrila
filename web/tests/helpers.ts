export function session(id: string) {
  const exp = Math.floor(Date.now() / 1000) + 3600
  const encode = (data: unknown) => Buffer.from(JSON.stringify(data)).toString("base64url")
  return {
    access_token: `${encode({ alg: "HS256" })}.${encode({ sub: id, exp })}.signature`,
    refresh_token: `refresh-${id}`, token_type: "bearer", expires_in: 3600, expires_at: exp,
    user: { id, aud: "authenticated", role: "authenticated", is_anonymous: true,
      app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  }
}

