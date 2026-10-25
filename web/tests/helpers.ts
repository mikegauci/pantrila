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


const allowance = (limit: number, left = limit) =>
  ({ limit, left, window: "day", resets_at: "2030-01-01T00:00:00+00:00" })

/** `/me`'s plan and allowances as the API sends them, for a Pro account by default. */
export function account(left: { plans?: number; chats?: number; imports?: number; photos?: number } = {},
                        tier: "free" | "pro" = "pro") {
  return {
    subscription: { tier, status: tier === "pro" ? "active" : null, expires_at: null, will_renew: false,
                    store: tier === "pro" ? "manual" : null },
    limits: { plans: allowance(5, left.plans), chats: allowance(50, left.chats),
              imports: allowance(20, left.imports), photos: allowance(5, left.photos) },
  }
}
