// Uniwind's theme values come from the stylesheet Metro builds, which tests do not have: any
// colour will do there.
jest.mock("uniwind", () => ({
  useCSSVariable: (name) => (Array.isArray(name) ? name.map(() => "#000000") : "#000000"),
}))

// AsyncStorage's own in-memory stand-in.
jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock"))
