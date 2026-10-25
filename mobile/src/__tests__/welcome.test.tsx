import { fireEvent, render, screen } from "@testing-library/react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"

import Welcome from "@/app/welcome"
import { sendEmailLink, signInAsGuest } from "@/lib/auth"

jest.mock("@/lib/supabase", () => ({ supabaseReady: () => true }))
jest.mock("@/lib/auth", () => ({
  appleReady: jest.fn(async () => false),
  googleReady: () => true,
  signInWith: jest.fn(async () => null),
  signInAsGuest: jest.fn(async () => "Guest sign-in is not available: Anonymous sign-ins are disabled"),
  sendEmailLink: jest.fn(async () => null),
}))

const frame = { x: 0, y: 0, width: 390, height: 844 }
const insets = { top: 47, left: 0, right: 0, bottom: 34 }
const show = () => render(<SafeAreaProvider initialMetrics={{ frame, insets }}><Welcome /></SafeAreaProvider>)

it("offers Google, a guest and an email link, and hides Apple where it is not available", async () => {
  await show()
  expect(screen.getByText("Continue with Google")).toBeTruthy()
  expect(screen.queryByText("Continue with Apple")).toBeNull()
  await fireEvent.press(screen.getByText("Try it as a guest"))
  expect(await screen.findByText(/Anonymous sign-ins are disabled/)).toBeTruthy()
  expect(signInAsGuest).toHaveBeenCalled()
})

it("sends an email link and says where to open it", async () => {
  await show()
  await fireEvent.press(screen.getByText("Sign in with a link"))
  await fireEvent.changeText(screen.getByLabelText("Email"), "ada@example.com")
  await fireEvent.press(screen.getByText("Email me a sign-in link"))
  expect(await screen.findByText(/for a sign-in link and open it on this phone/)).toBeTruthy()
  expect(sendEmailLink).toHaveBeenCalledWith("ada@example.com")
})
