import type { ConfigContext, ExpoConfig } from "expo/config"

// Set once by `npx eas-cli init` (run in mobile/); it links builds to the Expo project. Not a secret.
const EAS_PROJECT_ID = "b60bab44-4784-4b21-8ba2-e8aed45df863"

// Google's iOS client id (docs/google-sign-in.md); its reverse is the URL scheme Google's sheet
// returns to. Public, not a secret; set as an EAS environment variable.
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
const googleUrlScheme = (id: string) => `com.googleusercontent.apps.${id.replace(".apps.googleusercontent.com", "")}`

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
    usesAppleSignIn: true,
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
    "expo-secure-store",
    "expo-apple-authentication",
    // Cooking timers ring through local notifications; voice commands need the mic and speech.
    "expo-notifications",
    [
      "expo-speech-recognition",
      {
        microphonePermission: "Pantrila listens for “next”, “back” and timer commands while you cook with the mic on.",
        speechRecognitionPermission: "Pantrila turns what you say into cooking commands. It never records or stores your voice.",
        androidSpeechServicePackages: ["com.google.android.googlequicksearchbox", "com.google.android.tts"],
      },
    ],
    // iOS only (Android needs no plugin); without options the plugin expects Firebase files instead.
    ...(GOOGLE_IOS_CLIENT_ID
      ? [["@react-native-google-signin/google-signin", { iosUrlScheme: googleUrlScheme(GOOGLE_IOS_CLIENT_ID) }] as [string, object]]
      : []),
    [
      "expo-splash-screen",
      { image: "./assets/android-foreground.png", imageWidth: 200, backgroundColor: BRAND_GREEN },
    ],
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
  extra: { ...config.extra, ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}) },
})
