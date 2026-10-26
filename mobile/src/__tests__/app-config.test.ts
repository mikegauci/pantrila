import appConfig from "../../app.config"

type Plugin = string | [string, Record<string, unknown>]

function load(profile?: string) {
  const before = process.env.EAS_BUILD_PROFILE
  if (profile) process.env.EAS_BUILD_PROFILE = profile
  else delete process.env.EAS_BUILD_PROFILE
  try {
    return appConfig({ config: {} } as never)
  } finally {
    if (before === undefined) delete process.env.EAS_BUILD_PROFILE
    else process.env.EAS_BUILD_PROFILE = before
  }
}

const options = (name: string) => {
  const found = (load().plugins as Plugin[]).find((p) => (Array.isArray(p) ? p[0] : p) === name)
  return Array.isArray(found) ? found[1] : {}
}

test("no plugin blocks the microphone voice commands need", () => {
  // `false` here would remove RECORD_AUDIO and the iOS microphone text for every plugin.
  const picker = options("expo-image-picker")
  const speech = options("expo-speech-recognition")
  expect(typeof picker.microphonePermission).toBe("string")
  expect(picker.microphonePermission).toBe(speech.microphonePermission)
})

test("every permission text names Pantrila and says what it is for", () => {
  const texts = [
    ...Object.values(options("expo-image-picker")),
    options("expo-speech-recognition").microphonePermission,
    options("expo-speech-recognition").speechRecognitionPermission,
  ].filter((t): t is string => typeof t === "string")
  expect(texts).toHaveLength(5)
  for (const t of texts) expect(t).toMatch(/^Pantrila /)
  expect(options("expo-secure-store").faceIDPermission).toBe(false)
})

test("store builds leave out the development menu's overlay permission", () => {
  expect(load("production").android?.blockedPermissions).toEqual(["android.permission.SYSTEM_ALERT_WINDOW"])
  expect(load("e2e").android?.blockedPermissions).toEqual(["android.permission.SYSTEM_ALERT_WINDOW"])
  expect(load("development").android?.blockedPermissions).toEqual([])
})

test("an update only reaches builds with the same native code", () => {
  const c = load("production")
  expect(c.runtimeVersion).toEqual({ policy: "fingerprint" })
  expect(c.updates?.url).toBe(`https://u.expo.dev/${(c.extra as { eas: { projectId: string } }).eas.projectId}`)
})
