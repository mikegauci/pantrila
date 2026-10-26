import type { ConfigContext, ExpoConfig } from "expo/config"

// Set once by `npx eas-cli init` (run in mobile/); it links builds to the Expo project. Not a secret.
const EAS_PROJECT_ID = "b60bab44-4784-4b21-8ba2-e8aed45df863"

// Google's iOS client id (docs/google-sign-in.md); its reverse is the URL scheme Google's sheet
// returns to. Public, not a secret; set as an EAS environment variable.
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
const googleUrlScheme = (id: string) => `com.googleusercontent.apps.${id.replace(".apps.googleusercontent.com", "")}`

// Same green as the icon's gradient end (web/brand); the splash shows the white mark on it.
const BRAND_GREEN = "#2a7a38"

// Permission texts, in the words the phone shows when it asks (the stores read them too). One
// microphone text: two plugins write it, and a plugin given `false` removes the permission for all.
const MICROPHONE = "Pantrila listens for “next”, “back” and timer commands while you cook with the mic on. Nothing is recorded."
const SPEECH = "Pantrila turns what you say into cooking commands. It never records or stores your voice."
const PHOTOS = "Pantrila reads a recipe from the photos you pick, such as a cookbook page or a screenshot."
const CAMERA = "Pantrila reads a recipe from a photo you take of a cookbook page or a recipe card."

// Store builds leave out what only the development build needs (its menu draws over other apps).
const development = () => !process.env.EAS_BUILD_PROFILE || process.env.EAS_BUILD_PROFILE === "development"

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
  // EAS Update: JavaScript and asset fixes reach store builds without a review. An update only reaches
  // builds of the same `version`, so raise `version` with any native change (a native module, a plugin
  // or this file). Not the fingerprint policy: this config reads EAS_BUILD_PROFILE and the
  // SENTRY_AUTH_TOKEN secret, which differ between a Mac and EAS, so the two fingerprints never matched
  // and every EAS build failed.
  runtimeVersion: { policy: "appVersion" },
  updates: {
    url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
    // Start with what is installed; a downloaded update is used from the next launch.
    fallbackToCacheTimeout: 0,
  },
  ios: {
    bundleIdentifier: "com.pantrila.app",
    supportsTablet: false,
    usesAppleSignIn: true,
    // Universal links: app.pantrila.com recipe and plan pages open here (web/src/lib/app-links.ts).
    associatedDomains: ["applinks:app.pantrila.com"],
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
    blockedPermissions: development() ? [] : ["android.permission.SYSTEM_ALERT_WINDOW"],
    // App links: the same pages as on iOS, checked against app.pantrila.com/.well-known/assetlinks.json.
    intentFilters: [{
      action: "VIEW",
      autoVerify: true,
      data: [
        { scheme: "https", host: "app.pantrila.com", pathPrefix: "/recipes/" },
        { scheme: "https", host: "app.pantrila.com", path: "/plan" },
      ],
      category: ["BROWSABLE", "DEFAULT"],
    }],
  },
  plugins: [
    "expo-router",
    // The session key only; no Face ID, so no Face ID question.
    ["expo-secure-store", { faceIDPermission: false }],
    "expo-apple-authentication",
    // Cooking timers ring through local notifications; voice commands need the mic and speech.
    "expo-notifications",
    [
      "expo-speech-recognition",
      {
        microphonePermission: MICROPHONE,
        speechRecognitionPermission: SPEECH,
        androidSpeechServicePackages: ["com.google.android.googlequicksearchbox", "com.google.android.tts"],
      },
    ],
    // "Share to Pantrila" from Instagram, TikTok, Facebook, Safari, Chrome and the photo library: a
    // link, text or up to 4 photos (an iOS share extension and Android intent filters).
    [
      "expo-share-intent",
      {
        iosActivationRules: {
          NSExtensionActivationSupportsWebURLWithMaxCount: 1,
          NSExtensionActivationSupportsWebPageWithMaxCount: 1,
          NSExtensionActivationSupportsText: true,
          NSExtensionActivationSupportsImageWithMaxCount: 4,
        },
        // Its own name: "Pantrila" is the app's Xcode target, which the plugin would then skip.
        iosShareExtensionName: "Save to Pantrila",
        androidIntentFilters: ["text/*", "image/*"],
        androidMultiIntentFilters: ["image/*"],
      },
    ],
    // Recipe photos to import: taken with the camera or picked from the library, never stored.
    [
      "expo-image-picker",
      {
        photosPermission: PHOTOS,
        cameraPermission: CAMERA,
        // Not `false`: that would block the microphone voice commands need, on both platforms.
        microphonePermission: MICROPHONE,
      },
    ],
    // Error reports and feedback (lib/sentry.ts). Source maps and debug files upload at build time
    // only when SENTRY_AUTH_TOKEN is set (an EAS secret), so builds without it still pass.
    [
      "@sentry/react-native",
      {
        organization: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        disableAutoUpload: !process.env.SENTRY_AUTH_TOKEN,
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
