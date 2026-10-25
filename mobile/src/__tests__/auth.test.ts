import AsyncStorage from "@react-native-async-storage/async-storage"
import { GoogleSignin } from "@react-native-google-signin/google-signin"
import * as AppleAuthentication from "expo-apple-authentication"

import { authMessage, callbackParams, finishEmailLink, forgetLocal, linkWith, sendEmailLink, signInWith, userKey } from "@/lib/auth"
import { supabase } from "@/lib/supabase"

jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock"))

jest.mock("@react-native-google-signin/google-signin", () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(async () => true),
    signIn: jest.fn(),
    signOut: jest.fn(),
  },
  isErrorWithCode: (e: { code?: string }) => typeof e?.code === "string",
  statusCodes: { SIGN_IN_CANCELLED: "SIGN_IN_CANCELLED" },
}))

jest.mock("expo-apple-authentication", () => ({
  isAvailableAsync: jest.fn(async () => true),
  signInAsync: jest.fn(),
  formatFullName: (n: { givenName?: string; familyName?: string }) => [n.givenName, n.familyName].filter(Boolean).join(" "),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}))

jest.mock("expo-crypto", () => ({
  randomUUID: () => "raw-nonce",
  digestStringAsync: async (_: string, value: string) => `sha256(${value})`,
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
}))

const auth = {
  signInWithIdToken: jest.fn(async () => ({ error: null })),
  linkIdentity: jest.fn(async () => ({ error: null })),
  signInWithOtp: jest.fn(async () => ({ error: null })),
  exchangeCodeForSession: jest.fn(async () => ({ error: null })),
  updateUser: jest.fn(async () => ({ error: null })),
}
jest.mock("@/lib/supabase", () => ({ supabase: jest.fn() }))

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(supabase).mockReturnValue({ auth } as never)
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = "web.apps.googleusercontent.com"
})

describe("Google", () => {
  it("hands Google's id token to Supabase", async () => {
    jest.mocked(GoogleSignin.signIn).mockResolvedValue({ type: "success", data: { idToken: "g-token" } } as never)
    expect(await signInWith("google")).toBeNull()
    expect(GoogleSignin.configure).toHaveBeenCalledWith(expect.objectContaining({ webClientId: "web.apps.googleusercontent.com" }))
    expect(auth.signInWithIdToken).toHaveBeenCalledWith({ provider: "google", token: "g-token" })
  })

  it("does nothing when the person closes the sheet", async () => {
    jest.mocked(GoogleSignin.signIn).mockResolvedValue({ type: "cancelled", data: null })
    expect(await signInWith("google")).toBeNull()
    jest.mocked(GoogleSignin.signIn).mockRejectedValue(Object.assign(new Error("x"), { code: "SIGN_IN_CANCELLED" }))
    expect(await linkWith("google")).toBeNull()
    expect(auth.signInWithIdToken).not.toHaveBeenCalled()
    expect(auth.linkIdentity).not.toHaveBeenCalled()
  })

  it("keeps the guest's data by linking Google, and explains an account that exists", async () => {
    jest.mocked(GoogleSignin.signIn).mockResolvedValue({ type: "success", data: { idToken: "g-token" } } as never)
    auth.linkIdentity.mockResolvedValueOnce({ error: { code: "identity_already_exists", message: "Identity is already linked" } } as never)
    expect(await linkWith("google")).toMatch(/That Google account already has its own Pantrila account/)
    expect(auth.linkIdentity).toHaveBeenCalledWith({ provider: "google", token: "g-token" })
  })
})

describe("Apple", () => {
  it("sends Apple the hashed nonce and Supabase the nonce itself, and keeps the name", async () => {
    jest.mocked(AppleAuthentication.signInAsync).mockResolvedValue({
      identityToken: "a-token", fullName: { givenName: "Ada", familyName: "Lovelace" },
    } as never)
    expect(await signInWith("apple")).toBeNull()
    expect(AppleAuthentication.signInAsync).toHaveBeenCalledWith(expect.objectContaining({ nonce: "sha256(raw-nonce)" }))
    expect(auth.signInWithIdToken).toHaveBeenCalledWith({ provider: "apple", token: "a-token", nonce: "raw-nonce" })
    expect(auth.updateUser).toHaveBeenCalledWith({ data: { full_name: "Ada Lovelace" } })
  })

  it("treats a cancel as nothing and other failures as a message", async () => {
    jest.mocked(AppleAuthentication.signInAsync).mockRejectedValueOnce(Object.assign(new Error("c"), { code: "ERR_REQUEST_CANCELED" }))
    expect(await linkWith("apple")).toBeNull()
    jest.mocked(AppleAuthentication.signInAsync).mockRejectedValueOnce(new Error("no network"))
    expect(await signInWith("apple")).toBe("Apple sign-in failed: no network")
  })
})

describe("email links", () => {
  it("come back to the app", async () => {
    await sendEmailLink(" ada@example.com ")
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: "ada@example.com", options: { emailRedirectTo: "pantrila://auth/callback" },
    })
  })

  it("trade the link's code for a session, or say what went wrong", async () => {
    expect(callbackParams("pantrila://auth/callback?code=abc")).toEqual({ code: "abc", error: null })
    expect(await finishEmailLink("pantrila://auth/callback?code=abc")).toBeNull()
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc")
    expect(await finishEmailLink("pantrila://auth/callback#error=access_denied&error_description=Email+link+is+invalid+or+has+expired"))
      .toBe("Email link is invalid or has expired")
    expect(await finishEmailLink("pantrila://auth/callback")).toMatch(/incomplete/)
    expect(authMessage("manual_linking_disabled", "apple")).toBe("Adding Apple to a guest account is not switched on yet.")
  })
})

it("forgets only the signed-out person's things on the phone", async () => {
  await AsyncStorage.multiSet([[userKey("alice", "cook"), "1"], [userKey("alice", "draft"), "2"], [userKey("bob", "cook"), "3"],
                               ["pantrila-temp-unit", "c"]])
  await forgetLocal("alice")
  expect([...(await AsyncStorage.getAllKeys())].sort()).toEqual(["pantrila-temp-unit", userKey("bob", "cook")])
})
