// Expo's Metro config finds the workspace (packages/core) on its own; Uniwind compiles the
// Tailwind classes and must stay the outermost wrapper.
const { getDefaultConfig } = require("expo/metro-config")
const { withUniwindConfig } = require("uniwind/metro")

const config = getDefaultConfig(__dirname)

module.exports = withUniwindConfig(config, {
  cssEntryFile: "./src/global.css",
  dtsFile: "./src/uniwind-types.d.ts",
})
