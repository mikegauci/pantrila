// Expo's Metro config (through Sentry's, which adds the debug ids its source maps need) finds the
// workspace (packages/core) on its own; Uniwind compiles the Tailwind classes and must stay the
// outermost wrapper.
const { getSentryExpoConfig } = require("@sentry/react-native/metro")
const { withUniwindConfig } = require("uniwind/metro")

const config = getSentryExpoConfig(__dirname)

module.exports = withUniwindConfig(config, {
  cssEntryFile: "./src/global.css",
  dtsFile: "./src/uniwind-types.d.ts",
})
