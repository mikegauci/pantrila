/** @type {import("jest").Config} */
module.exports = {
  preset: "jest-expo",
  setupFiles: ["<rootDir>/jest.setup.js"],
  moduleNameMapper: {
    // Its React Native entry is an ES module Jest cannot load; the CommonJS build has the same icons.
    "^lucide-react-native$": require.resolve("lucide-react-native"),
  },
}
