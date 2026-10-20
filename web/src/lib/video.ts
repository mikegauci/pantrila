/** Read a cooking video in the browser: its sound as 16 kHz mono WAV and 4 frames as JPEG.
 * Only these go to the server (about 3 MB for 90 s); the video itself never leaves the device. */

export const MAX_VIDEO_SECONDS = 180
const MAX_VIDEO_BYTES = 500_000_000
const RATE = 16_000
const FRAME_AT = [0.15, 0.4, 0.65, 0.9]
const FRAME_MAX = 960
const TOO_LONG = "Use a video under 3 minutes. Trim it to the recipe in your Photos app."

export interface VideoParts {
  audio: string | null // data:audio/wav;base64,…, or null when the video has no sound
  frames: string[] // data:image/jpeg;base64,…
  seconds: number
}

function once(target: EventTarget, ok: string, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error("The video took too long to open.")), timeoutMs)
    const done = (err?: Error) => {
      clearTimeout(timer)
      target.removeEventListener(ok, onOk)
      target.removeEventListener("error", onError)
      if (err) reject(err)
      else resolve()
    }
    const onOk = () => done()
    const onError = () => done(new Error("This browser can't open that video. Try an MP4."))
    target.addEventListener(ok, onOk)
    target.addEventListener("error", onError)
  })
}

async function openVideo(file: File): Promise<HTMLVideoElement> {
  const video = document.createElement("video")
  video.muted = true
  video.playsInline = true
  video.preload = "auto"
  video.src = URL.createObjectURL(file)
  await once(video, "loadedmetadata")
  // iOS Safari ignores preload and loads no picture until the video plays; a muted inline
  // video may play without a tap, so start and stop it to have frames to draw.
  const started = video.play().then(() => video.pause(), () => {})
  await Promise.race([started, new Promise((resolve) => setTimeout(resolve, 3_000))])
  return video
}

/** Frames at 15/40/65/90% of the video, longest side 960 px. Frames help but are optional:
 * a seek that never finishes (or a video of unknown length) ends with what was drawn so far. */
async function grabFrames(video: HTMLVideoElement): Promise<string[]> {
  if (!Number.isFinite(video.duration) || !video.videoWidth) return []
  const scale = Math.min(1, FRAME_MAX / Math.max(video.videoWidth, video.videoHeight, 1))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
  const ctx = canvas.getContext("2d")!
  const frames: string[] = []
  try {
    for (const at of FRAME_AT) {
      video.currentTime = Math.min(video.duration * at, Math.max(0, video.duration - 0.05))
      await once(video, "seeked", 5_000)
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      frames.push(canvas.toDataURL("image/jpeg", 0.8))
    }
  } catch {
    // keep the frames drawn so far
  }
  return frames
}

/** The decoded sound, or null when the video has none this browser can read. Decoding into a
 * 16 kHz context resamples in the browser; some browsers only decode at their usual rates, so
 * the second try is 44.1 kHz (resampled below). decodeAudioData takes over the buffer it is
 * given, so only the first try gets a copy. */
async function decode(data: ArrayBuffer): Promise<AudioBuffer | null> {
  for (const [rate, buffer] of [[RATE, data.slice(0)], [44_100, data]] as const) {
    try {
      return await new OfflineAudioContext(1, 1, rate).decodeAudioData(buffer)
    } catch {
      // try the next rate
    }
  }
  return null
}

/** Mono 16 kHz samples: channels averaged, resampled by linear interpolation. */
function monoAt16k(buffer: AudioBuffer): Float32Array {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c))
  const step = buffer.sampleRate / RATE
  const out = new Float32Array(Math.floor(buffer.length / step))
  for (let j = 0; j < out.length; j++) {
    const x = j * step
    const i = Math.floor(x)
    const k = Math.min(i + 1, buffer.length - 1)
    let sum = 0
    for (const ch of channels) sum += ch[i] + (ch[k] - ch[i]) * (x - i)
    out[j] = sum / channels.length
  }
  return out
}

function wavDataUrl(samples: Float32Array): string {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  text(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, "WAVE")
  text(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, RATE, true)
  view.setUint32(28, RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, "data")
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:audio/wav;base64,${btoa(binary)}`
}

export async function readVideo(file: File): Promise<VideoParts> {
  if (!file.type.startsWith("video/") && !/\.(mp4|mov|m4v|webm)$/i.test(file.name)) {
    throw new Error("That isn't a video. Pick the video you saved or screen-recorded.")
  }
  if (file.size > MAX_VIDEO_BYTES) throw new Error("That video is too large. Trim it to the recipe first.")
  // A video this browser can't show (or one that never loads) can still have readable sound.
  const video = await openVideo(file).catch(() => null)
  try {
    if (video && Number.isFinite(video.duration) && video.duration > MAX_VIDEO_SECONDS + 1) {
      throw new Error(TOO_LONG)
    }
    const frames = video ? await grabFrames(video) : []
    const sound = await decode(await file.arrayBuffer())
    if (sound && sound.duration > MAX_VIDEO_SECONDS + 1) throw new Error(TOO_LONG)
    if (!sound && !frames.length) {
      throw new Error("Pantrio couldn't read that video's sound or pictures. Try an MP4, or add screenshots.")
    }
    return { audio: sound ? wavDataUrl(monoAt16k(sound)) : null, frames,
             seconds: sound?.duration ?? video?.duration ?? 0 }
  } finally {
    if (video) {
      URL.revokeObjectURL(video.src)
      video.removeAttribute("src")
      video.load()
    }
  }
}
