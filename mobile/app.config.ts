import type { ConfigContext, ExpoConfig } from "expo/config"

// Set once by `npx eas-cli init` (run in mobile/); it links builds to the Expo project. Not a secret.
const EAS_PROJECT_ID = "b60bab44-4784-4b21-8ba2-e8aed45df863"

// Same green as the icon's gradient end (web/brand); the splash shows the white mark on it.
const BRAND_GREEN = "#2a7a38"

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Pantrila",
  slug: "pantrila",
  // The web app is web/ (Next.js); this one is phones only.
  platforms: ["ios", "android"],
  version: "0.1.0",
  scheme: "pantrila",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  ios: {
    bundleIdentifier: "com.pantrila.app",
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
  },
  android: {
    package: "com.pantrila.app",
    adaptiveIcon: {
      foregroundImage: "./assets/android-foreground.png",
      backgroundImage: "./assets/android-background.png",
      monochromeImage: "./assets/android-foreground.png",
      backgroundColor: BRAND_GREEN,
    },
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    "expo-router",
    [
      "expo-splash-screen",
      { image: "./assets/android-foreground.png", imageWidth: 200, backgroundColor: BRAND_GREEN },
    ],
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
  extra: { ...config.extra, ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}) },
})
