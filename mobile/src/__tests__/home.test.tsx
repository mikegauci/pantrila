import { render, screen } from "@testing-library/react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { SWRConfig } from "swr"

import Home from "@/app/index"

jest.mock("@/lib/api", () => {
  const { ApiError } = jest.requireActual("@pantrila/core/api")
  return {
    ApiError,
    health: jest.fn(async () => true),
    api: jest.fn(async () => { throw new ApiError(401, "Sign in first.") }),
  }
})

const frame = { x: 0, y: 0, width: 390, height: 844 }
const insets = { top: 47, left: 0, right: 0, bottom: 34 }

it("shows the server is up and that recipe options need a sign-in", async () => {
  await render(
    <SafeAreaProvider initialMetrics={{ frame, insets }}>
      <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}>
        <Home />
      </SWRConfig>
    </SafeAreaProvider>,
  )
  expect(screen.getByText("Pantrila")).toBeTruthy()
  expect(await screen.findByText("Up")).toBeTruthy()
  expect(await screen.findByText("Sign in first.")).toBeTruthy()
})
