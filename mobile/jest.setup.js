// Uniwind's theme values come from the stylesheet Metro builds, which tests do not have: any
// colour will do there.
jest.mock("uniwind", () => ({
  useCSSVariable: (name) => (Array.isArray(name) ? name.map(() => "#000000") : "#000000"),
}))

// AsyncStorage's own in-memory stand-in.
jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock"))

// Native modules cooking mode uses; tests check what is asked of them.
jest.mock("expo-keep-awake", () => ({ useKeepAwake: jest.fn() }))
jest.mock("expo-audio", () => ({
  createAudioPlayer: jest.fn(() => ({ play: jest.fn(), seekTo: jest.fn() })),
  setAudioModeAsync: jest.fn(async () => {}),
}))
jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  scheduleNotificationAsync: jest.fn(async (r) => r.identifier),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  AndroidImportance: { HIGH: 4 },
  SchedulableTriggerInputTypes: { DATE: "date" },
}))
jest.mock("expo-speech-recognition", () => {
  const listeners = {}
  return {
    ExpoSpeechRecognitionModule: {
      isRecognitionAvailable: () => true,
      supportsOnDeviceRecognition: () => true,
      getPermissionsAsync: jest.fn(async () => ({ granted: true })),
      requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
      start: jest.fn(),
      abort: jest.fn(),
      addListener: (name, fn) => {
        ;(listeners[name] ??= new Set()).add(fn)
        return { remove: () => listeners[name].delete(fn) }
      },
      // Tests call this to hear a phrase: emit("result", { isFinal: true, results: [{ transcript: "next" }] }).
      emit: (name, event) => (listeners[name] ?? new Set()).forEach((fn) => fn(event)),
    },
  }
})

// Photos to import: tests set what the picker returns; the manipulator hands back a fixed JPEG.
jest.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: null })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}))
jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  ImageManipulator: {
    manipulate: jest.fn(() => {
      const context = {
        resize: jest.fn(() => context),
        crop: jest.fn(() => context),
        renderAsync: jest.fn(async () => ({ width: 1200, height: 900, saveAsync: jest.fn(async () => ({ base64: "SlBFRw==" })) })),
      }
      return context
    }),
  },
}))

// The share sheet: tests call `mockShare(intent)` (global) to share into the app.
jest.mock("expo-share-intent", () => {
  const React = require("react")
  const empty = { files: null, text: null, webUrl: null, type: null }
  let setIntent = () => {}
  global.mockShare = (intent) => setIntent({ ...empty, ...intent })
  return {
    ShareIntentProvider: ({ children }) => children,
    useShareIntentContext: () => {
      const [shareIntent, set] = React.useState(empty)
      setIntent = set
      const hasShareIntent = Boolean(shareIntent.text || shareIntent.webUrl || shareIntent.files)
      return { hasShareIntent, shareIntent, resetShareIntent: React.useCallback(() => set(empty), []), error: null }
    },
  }
})

// Sentry: tests check what is reported; nothing is sent.
jest.mock("@sentry/react-native", () => ({
  init: jest.fn(),
  wrap: (component) => component,
  setUser: jest.fn(),
  captureFeedback: jest.fn(),
  flush: jest.fn(async () => true),
}))

// The first-run intro pushes a route when the tabs open; its own test turns it back on.
jest.mock("@/lib/intro", () => ({
  useFirstIntro: () => {},
  introDone: jest.fn(async () => {}),
  forgetIntro: jest.fn(async () => {}),
}))
