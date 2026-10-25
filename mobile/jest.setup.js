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
