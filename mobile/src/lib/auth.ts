import { GoogleSignin, isErrorWithCode, statusCodes } from "@react-native-google-signin/google-signin"
import AsyncStorage from "@react-native-async-storage/async-storage"
import type { User } from "@supabase/supabase-js"
import * as AppleAuthentication from "expo-apple-authentication"
import * as Crypto from "expo-crypto"
import { Platform } from "react-native"

import { progressKey } from "@pantrila/core/cooking"

import { supabase } from "@/lib/supabase"

/**
 * Sign-in on the phone, as on the web: Google, Apple (iPhone only), an email link, or a guest.
 * Google and Apple use the phone's own sign-in sheet and hand Supabase the id token
 * (`signInWithIdToken`), so there is no browser round trip. A guest keeps their user id (and
 * their pantry, plans, cookbook and chats) by linking Google or Apple (`linkIdentity`).
 *
 * Each action returns null on success or when the person cancelled, else a message to show.
 */

export type Provider = "google" | "apple"
const NAMES: Record<Provider, string> = { google: "Google", apple: "Apple" }

/** Where email links come back: the app's `auth/callback` route (allowed in Supabase Auth). */
export const CALLBACK_URL = "pantrila://auth/callback"

/** Supabase error codes, in the web's words (web/src/app/auth/callback/page.tsx). */
export function authMessage(code: string | null | undefined, provider: Provider = "google"): string | null {
  const name = NAMES[provider]
  if (code === "identity_already_exists" || code === "email_exists") {
    return `That ${name} account already has its own Pantrila account. Your guest data stays here; to use the ${name} account instead, sign out and choose Continue with ${name}.`
  }
  if (code === "manual_linking_disabled") return `Adding ${name} to a guest account is not switched on yet.`
  return null
}

function failed(error: { code?: string; message: string } | null, provider: Provider): string | null {
  return error ? authMessage(error.code, provider) ?? error.message : null
}

// --- Google ---------------------------------------------------------------------------------

/** The web client id makes Google put Supabase's audience in the id token; the iOS client id
 * is the app's own (docs/google-sign-in.md). Without them the Google button is hidden. */
export const googleReady = () =>
  Boolean(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) &&
  (Platform.OS !== "ios" || Boolean(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID))

let configured = false

/** Google's sheet; the id token, or null if the person cancelled. */
async function googleToken(): Promise<string | null> {
  if (!configured) {
    GoogleSignin.configure({
      webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
      iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    })
    configured = true
  }
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true })
  try {
    const res = await GoogleSignin.signIn()
    if (res.type !== "success") return null
    if (!res.data.idToken) throw new Error("Google sent no id token. Check the web client id.")
    return res.data.idToken
  } catch (e) {
    if (isErrorWithCode(e) && e.code === statusCodes.SIGN_IN_CANCELLED) return null
    throw e
  }
}

// --- Apple ----------------------------------------------------------------------------------

/** Sign in with Apple is offered on iPhones only (Android would need Apple's web flow). */
export async function appleReady(): Promise<boolean> {
  return Platform.OS === "ios" && AppleAuthentication.isAvailableAsync()
}

interface AppleToken {
  token: string
  nonce: string
  fullName: string | null
}

/** Apple's sheet with a fresh nonce: Apple gets its SHA-256, Supabase the nonce itself. */
async function appleToken(): Promise<AppleToken | null> {
  const nonce = Crypto.randomUUID()
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce)
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
                        AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashed,
    })
    if (!credential.identityToken) throw new Error("Apple sent no identity token.")
    // Apple gives the name only the first time, and apps may not ask for it again.
    const name = credential.fullName
      ? AppleAuthentication.formatFullName(credential.fullName).trim() || null
      : null
    return { token: credential.identityToken, nonce, fullName: name }
  } catch (e) {
    if ((e as { code?: string }).code === "ERR_REQUEST_CANCELED") return null
    throw e
  }
}

async function keepAppleName(name: string | null) {
  if (name) await supabase().auth.updateUser({ data: { full_name: name } })
}

// --- Actions --------------------------------------------------------------------------------

function messageOf(e: unknown, provider: Provider): string {
  return `${NAMES[provider]} sign-in failed: ${e instanceof Error ? e.message : String(e)}`
}

export async function signInWith(provider: Provider): Promise<string | null> {
  try {
    if (provider === "google") {
      const token = await googleToken()
      if (!token) return null
      const { error } = await supabase().auth.signInWithIdToken({ provider, token })
      return failed(error, provider)
    }
    const apple = await appleToken()
    if (!apple) return null
    const { error } = await supabase().auth.signInWithIdToken({ provider, token: apple.token, nonce: apple.nonce })
    if (!error) await keepAppleName(apple.fullName)
    return failed(error, provider)
  } catch (e) {
    return messageOf(e, provider)
  }
}

/** Add Google or Apple to the signed-in guest: same user id, so their data carries on. */
export async function linkWith(provider: Provider): Promise<string | null> {
  try {
    if (provider === "google") {
      const token = await googleToken()
      if (!token) return null
      const { error } = await supabase().auth.linkIdentity({ provider, token })
      return failed(error, provider)
    }
    const apple = await appleToken()
    if (!apple) return null
    const { error } = await supabase().auth.linkIdentity({ provider, token: apple.token, nonce: apple.nonce })
    if (!error) await keepAppleName(apple.fullName)
    return failed(error, provider)
  } catch (e) {
    return messageOf(e, provider)
  }
}

export async function signInAsGuest(): Promise<string | null> {
  const { error } = await supabase().auth.signInAnonymously()
  return error ? `Guest sign-in is not available: ${error.message}` : null
}

export async function sendEmailLink(email: string): Promise<string | null> {
  const { error } = await supabase().auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: CALLBACK_URL },
  })
  return error?.message ?? null
}

/** What an email link (or a failed one) put in `pantrila://auth/callback?...#...`. */
export function callbackParams(url: string): { code: string | null; error: string | null } {
  const query = url.split("?")[1]?.split("#")[0] ?? ""
  const hash = url.split("#")[1] ?? ""
  const params = new URLSearchParams(`${query}&${hash}`)
  return {
    code: params.get("code"),
    error: authMessage(params.get("error_code")) ?? params.get("error_description"),
  }
}

/** Finish an email sign-in: trade the link's code for a session (the PKCE verifier is on this phone). */
export async function finishEmailLink(url: string): Promise<string | null> {
  const { code, error } = callbackParams(url)
  if (error) return error
  if (!code) return "This sign-in link is incomplete. Ask for a new one."
  const { error: failure } = await supabase().auth.exchangeCodeForSession(code)
  return failure?.message ?? null
}

// --- Signing out and what the phone keeps per user ------------------------------------------

/** AsyncStorage keys for one person's things on this phone (drafts, cooking progress...). */
export const userKey = (userId: string, name: string) => `pantrila:${userId}:${name}`

/** Forget what this phone kept for the person, including cooking progress (kept under the web's
 * key shape, `progressKey`). Their session goes with Supabase's signOut. */
export async function forgetLocal(userId: string): Promise<void> {
  const prefixes = [userKey(userId, ""), progressKey(userId, "")]
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => prefixes.some((p) => k.startsWith(p)))
  if (keys.length) await AsyncStorage.multiRemove(keys)
}

/** Sign out. A guest who signs out loses the account for good, so the screen warns first. */
export async function signOut(userId: string | null): Promise<void> {
  if (userId) await forgetLocal(userId)
  try {
    if (configured) await GoogleSignin.signOut()  // the next Google sign-in can pick another account
  } catch {}
  await supabase().auth.signOut()
}

/** The person's first name from Google's or Apple's profile, if any. */
export function firstName(user: User | undefined): string | null {
  const meta = user?.user_metadata ?? {}
  const full = typeof meta.full_name === "string" ? meta.full_name : typeof meta.name === "string" ? meta.name : ""
  return full.trim().split(/\s+/)[0] || null
}
