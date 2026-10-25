import * as Notifications from "expo-notifications"
import { AndroidImportance } from "expo-notifications"
import { useEffect, useRef } from "react"
import { Platform } from "react-native"

import type { RunningTimer } from "@pantrila/core/cooking"

/** Cooking timers that ring with the phone locked or the app closed: each running timer has a
 * local notification at its end, with a fixed id so pausing, changing or dismissing it replaces
 * or cancels it. While cooking mode is on screen it rings itself, so the notification stays quiet. */

const CHANNEL = "timers"
let onScreen = false
let configured = false

function configure() {
  if (configured) return
  configured = true
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: !onScreen, shouldShowList: true, shouldPlaySound: !onScreen, shouldSetBadge: false,
    }),
  })
  if (Platform.OS === "android") {
    Notifications.setNotificationChannelAsync(CHANNEL, {
      name: "Cooking timers",
      importance: AndroidImportance.HIGH,
      vibrationPattern: [0, 300, 150, 300, 150, 300],
      sound: "default",
    }).catch(() => {})
  }
}

/** Ask once, the first time a timer starts; a "no" still leaves the in-app ring. */
export async function allowTimerAlerts(): Promise<boolean> {
  configure()
  try {
    const now = await Notifications.getPermissionsAsync()
    if (now.granted || !now.canAskAgain) return now.granted
    return (await Notifications.requestPermissionsAsync()).granted
  } catch {
    return false
  }
}

export const alertId = (timer: RunningTimer) => `pantrila-timer-${timer.id}`

/** Keep one scheduled notification per running timer of this recipe, none for paused, rung or
 * dismissed ones. `title` is the recipe's. */
export function useTimerAlerts(timers: RunningTimer[], title: string, enabled = true) {
  const scheduled = useRef(new Map<string, number>())

  useEffect(() => {
    onScreen = true
    return () => { onScreen = false }
  }, [])

  useEffect(() => {
    configure()
    const want = new Map(enabled
      ? timers.filter((t) => t.endsAt !== null && !t.rang && t.endsAt > Date.now()).map((t) => [alertId(t), t] as const)
      : [])
    for (const [id, endsAt] of scheduled.current) {
      if (want.get(id)?.endsAt !== endsAt) {
        Notifications.cancelScheduledNotificationAsync(id).catch(() => {})
        scheduled.current.delete(id)
      }
    }
    for (const [id, t] of want) {
      if (scheduled.current.has(id)) continue
      scheduled.current.set(id, t.endsAt!)
      Notifications.scheduleNotificationAsync({
        identifier: id,
        content: { title: `Timer done: ${t.label}`, body: `${title}, step ${t.step}`, sound: "default" },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: t.endsAt!, channelId: CHANNEL },
      }).catch(() => scheduled.current.delete(id))
    }
  }, [timers, title, enabled])
}
