import AsyncStorage from "@react-native-async-storage/async-storage"
import { Stack } from "expo-router"
import { act, renderRouter, screen, waitFor } from "expo-router/testing-library"
import { Text } from "react-native"
import { SWRConfig } from "swr"

import { redirectSystemPath } from "@/app/+native-intent"
import NewRecipe from "@/app/recipes/mine/new"
import Welcome from "@/app/welcome"
import { ShareHandler } from "@/components/share-handler"
import { Toaster } from "@/components/toaster"
import { api, send } from "@/lib/api"
import { fromShareIntent } from "@/lib/share"
import { fakeApi } from "@/test/screens"

declare const mockShare: (intent: object) => void

// The session as a tiny store, so signing in re-renders the app as AuthProvider does.
let mockSession: object | null = { user: { id: "u1", user_metadata: {} } }
const mockAuthListeners = new Set<() => void>()
function signIn() {
  mockSession = { user: { id: "u1", user_metadata: {} } }
  mockAuthListeners.forEach((l) => l())
}
jest.mock("@/components/auth-provider", () => {
  const { useSyncExternalStore } = jest.requireActual("react")
  const subscribe = (l: () => void) => { mockAuthListeners.add(l); return () => mockAuthListeners.delete(l) }
  return { useAuth: () => ({ ready: true, session: useSyncExternalStore(subscribe, () => mockSession) }) }
})
jest.mock("@/lib/auth", () => ({
  userKey: (id: string, name: string) => `pantrila:${id}:${name}`,
  appleReady: async () => false,
  googleReady: () => true,
  signInWith: jest.fn(), signInAsGuest: jest.fn(), sendEmailLink: jest.fn(),
}))
jest.mock("@/lib/supabase", () => ({ supabaseReady: () => true }))
jest.mock("@/lib/api", () => ({
  ApiError: jest.requireActual("@pantrila/core/api").ApiError,
  api: jest.fn(), send: jest.fn(), health: jest.fn(async () => true),
}))
let mockJobId = ""
jest.mock("expo-crypto", () => ({ randomUUID: () => mockJobId }))
let jobs = 0

const ME = { subscription: { tier: "pro" }, limits: { imports: { limit: 20, left: 19, window: "day", resets_at: "2026-10-26T00:00:00Z" } } }

/** The root layout's share handling over a signed-in screen, the new-recipe screen and welcome. */
function showRoot(url: string) {
  const Root = () => {
    const signedIn = !!jest.requireMock("@/components/auth-provider").useAuth().session
    return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="index" />
          <Stack.Screen name="recipes/mine/new" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="welcome" />
        </Stack.Protected>
      </Stack>
      <ShareHandler />
      <Toaster />
    </>
    )
  }
  return renderRouter(
    { _layout: Root, index: () => <Text>Home screen</Text>, "recipes/mine/new": NewRecipe, welcome: Welcome },
    {
      initialUrl: url,
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false, dedupingInterval: 0 }}>{children}</SWRConfig>
      ),
    } as Parameters<typeof renderRouter>[1],
  )
}

beforeEach(async () => {
  mockJobId = `share${++jobs}`
  mockSession = { user: { id: "u1", user_metadata: {} } }
  await AsyncStorage.clear()
  ;(send as jest.Mock).mockReset().mockResolvedValue({ id: mockJobId, status: "running" })
  ;(api as jest.Mock).mockImplementation(fakeApi({
    "/me": ME, "/meta": { reel_platforms: [] }, "/me/recipes/import/timing": { estimated_seconds: 60 },
    [`/me/recipes/import/jobs/${mockJobId}`]: { id: mockJobId, status: "running", steps: [] },
  }))
})

it("reads what a share holds", () => {
  const share = (over: object) => ({ files: null, text: null, webUrl: null, type: null, ...over })
  expect(fromShareIntent(share({ text: "Look! https://www.instagram.com/reel/abc/", webUrl: "https://www.instagram.com/reel/abc/" })))
    .toEqual({ kind: "post", url: "https://www.instagram.com/reel/abc/" })
  expect(fromShareIntent(share({ webUrl: "https://www.bbcgoodfood.com/recipes/x" })))
    .toEqual({ kind: "link", url: "https://www.bbcgoodfood.com/recipes/x" })
  expect(fromShareIntent(share({ text: "Pancakes\n200 g flour\n2 eggs\nWhisk and fry." }))).toHaveProperty("kind", "text")
  expect(fromShareIntent(share({ text: "Yum" }))).toHaveProperty("error")
  expect(fromShareIntent(share({ files: [{ path: "file:///v.mp4", mimeType: "video/mp4" }] })))
    .toHaveProperty("error", expect.stringMatching(/Share the post itself/))
  const photos = Array.from({ length: 6 }, (_, i) => ({ path: `file:///p${i}.jpg`, mimeType: "image/jpeg", width: 800, height: 600 }))
  expect(fromShareIntent(share({ files: photos }))).toMatchObject({ kind: "photos", photos: { length: 4 } })
})

it("sends iOS's share link to the new-recipe screen and keeps other paths", () => {
  expect(redirectSystemPath({ path: "pantrila://dataUrl=pantrilaShareKey#weburl", initial: true })).toBe("/recipes/mine/new")
  expect(redirectSystemPath({ path: "/recipes/mine/12", initial: false })).toBe("/recipes/mine/12")
})

it("imports a shared post at once", async () => {
  const shown = await showRoot("/")
  expect(await screen.findByText("Home screen")).toBeTruthy()
  await act(async () => mockShare({ text: "Try this https://vm.tiktok.com/ZM123/", webUrl: "https://vm.tiktok.com/ZM123/" }))
  await waitFor(() => expect(shown.getPathname()).toBe("/recipes/mine/new"))
  await waitFor(() => expect(send).toHaveBeenCalledWith("/me/recipes/import/jobs", "POST",
                                                      { id: mockJobId, kind: "post", url: "https://vm.tiktok.com/ZM123/" }))
  expect(screen.getByDisplayValue("https://vm.tiktok.com/ZM123/")).toBeTruthy()
  expect(await screen.findByLabelText("Import steps")).toBeTruthy()
})

it("imports shared photos, shrunk to JPEG", async () => {
  await showRoot("/")
  await screen.findByText("Home screen")
  await act(async () => mockShare({ files: [{ path: "file:///page.heic", mimeType: "image/heic", width: 4000, height: 3000 }] }))
  await waitFor(() => expect(send).toHaveBeenCalledWith("/me/recipes/import/jobs", "POST",
                                                      { id: mockJobId, kind: "photos", images: ["data:image/jpeg;base64,SlBFRw=="] }))
  expect(await screen.findByLabelText("Photo 1")).toBeTruthy()
})

it("says why a shared video cannot be read", async () => {
  const shown = await showRoot("/")
  await screen.findByText("Home screen")
  await act(async () => mockShare({ files: [{ path: "file:///clip.mp4", mimeType: "video/mp4" }] }))
  expect(await screen.findByText(/Share the post itself/)).toBeTruthy()
  expect(shown.getPathname()).toBe("/")
  expect(send).not.toHaveBeenCalled()
})

it("asks a signed-out person to sign in first, then imports the share", async () => {
  mockSession = null
  const shown = await showRoot("/welcome")
  expect(await screen.findByText("Welcome to Pantrila")).toBeTruthy()
  await act(async () => mockShare({ webUrl: "https://www.bbcgoodfood.com/recipes/x" }))
  expect(await screen.findByText(/Sign in to import the recipe you shared/)).toBeTruthy()
  expect(send).not.toHaveBeenCalled()

  // Signed in (the guard swaps welcome for the signed-in screens): the waiting share is imported.
  await act(async () => signIn())
  await waitFor(() => expect(shown.getPathname()).toBe("/recipes/mine/new"))
  await waitFor(() => expect(send).toHaveBeenCalledWith("/me/recipes/import/jobs", "POST",
                                                      { id: mockJobId, kind: "link", url: "https://www.bbcgoodfood.com/recipes/x" }))
})
