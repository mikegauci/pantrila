import { ImageManipulator, SaveFormat } from "expo-image-manipulator"
import * as ImagePicker from "expo-image-picker"

/** Recipe photos from the camera or the photo library, shrunk on the phone to JPEG with the
 * longest side at most `MAX` px (as the web does in `web/src/lib/images.ts`), as data URLs.
 * The originals never leave the phone. */
const MAX = 1600

export class PhotoAccessError extends Error {}

/** One photo as a JPEG data URL, longest side at most `MAX` px. Shared photos may not say their
 * size, so it is read from the image then. */
export async function shrinkPhoto(photo: { uri: string; width?: number | null; height?: number | null }): Promise<string> {
  let image = await ImageManipulator.manipulate(photo.uri).renderAsync()
  const width = photo.width || image.width
  const height = photo.height || image.height
  const scale = Math.min(1, MAX / Math.max(width, height))
  if (scale < 1) {
    image = await ImageManipulator.manipulate(image)
      .resize(width >= height ? { width: Math.round(width * scale) } : { height: Math.round(height * scale) })
      .renderAsync()
  }
  const out = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true })
  if (!out.base64) throw new Error("Could not read that photo.")
  return `data:image/jpeg;base64,${out.base64}`
}

/** Up to `limit` photos; an empty list when the person cancels. */
export async function pickPhotos(from: "camera" | "library", limit: number): Promise<string[]> {
  const asked = from === "camera"
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!asked.granted) {
    throw new PhotoAccessError(from === "camera"
      ? "Pantrila needs the camera to take a photo of the recipe. Allow it in Settings."
      : "Pantrila needs your photos to read a recipe from them. Allow it in Settings.")
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 1 }
  const result = from === "camera"
    ? await ImagePicker.launchCameraAsync(options)
    : await ImagePicker.launchImageLibraryAsync({ ...options, allowsMultipleSelection: true, selectionLimit: limit })
  if (result.canceled) return []
  return Promise.all(result.assets.slice(0, limit).map(shrinkPhoto))
}
