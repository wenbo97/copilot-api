import consola from "consola"
import fs from "node:fs/promises"

import { PATHS } from "~/lib/paths"
import { getCopilotToken } from "~/services/github/get-copilot-token"
import { getDeviceCode } from "~/services/github/get-device-code"
import { getGitHubUser } from "~/services/github/get-user"
import { pollAccessToken } from "~/services/github/poll-access-token"

import { HTTPError } from "./error"
import { state } from "./state"

const readGithubToken = () => fs.readFile(PATHS.GITHUB_TOKEN_PATH, "utf8")

const writeGithubToken = (token: string) =>
  fs.writeFile(PATHS.GITHUB_TOKEN_PATH, token)

let refreshTimer: ReturnType<typeof setTimeout> | null = null

// If a refresh is already in progress, subsequent callers share the same promise
let refreshPromise: Promise<void> | null = null

function applyCopilotToken(token: string, expires_at: number) {
  state.copilotToken = token
  state.copilotTokenExpiresAt = expires_at
}

function scheduleRefresh(refresh_in: number) {
  if (refreshTimer) clearTimeout(refreshTimer)

  // Refresh 60s before the suggested time, minimum 30s
  const delayMs = Math.max((refresh_in - 60) * 1000, 30_000)
  consola.debug(`Next copilot token refresh in ${Math.round(delayMs / 1000)}s`)

  refreshTimer = setTimeout(async () => {
    await refreshCopilotToken()
  }, delayMs)
}

async function refreshCopilotToken(): Promise<void> {
  consola.debug("Refreshing Copilot token")
  try {
    const { token, refresh_in, expires_at } = await getCopilotToken()
    applyCopilotToken(token, expires_at)
    consola.debug("Copilot token refreshed")
    if (state.showToken) {
      consola.info("Refreshed Copilot token:", token)
    }
    scheduleRefresh(refresh_in)
  } catch (error) {
    consola.error("Failed to refresh Copilot token:", error)

    if (error instanceof HTTPError && error.response.status === 401) {
      // Retry once before escalating — the Copilot token endpoint can 401
      // transiently even when the GitHub token is still valid.
      consola.warn("Got 401 from Copilot token endpoint, retrying once...")
      try {
        const { token, refresh_in, expires_at } = await getCopilotToken()
        applyCopilotToken(token, expires_at)
        consola.success("Copilot token refreshed on retry")
        scheduleRefresh(refresh_in)
        return
      } catch {
        // Retry failed — now check if the GitHub token itself is bad
      }

      consola.warn(
        "Copilot token refresh returned 401, re-reading GitHub token from disk...",
      )
      try {
        // Re-read the ghu_ token from disk — it may have been refreshed
        // externally (e.g. via re-auth.cmd). No interactive auth needed.
        const githubToken = await readGithubToken()
        if (githubToken) {
          // eslint-disable-next-line require-atomic-updates -- intentional overwrite with fresh disk value
          state.githubToken = githubToken
          consola.debug(
            "GitHub token re-read from disk, retrying copilot token fetch",
          )
        }
        const { token, refresh_in, expires_at } = await getCopilotToken()
        applyCopilotToken(token, expires_at)
        consola.success("Copilot token refreshed after re-reading GitHub token")
        scheduleRefresh(refresh_in)
      } catch (retryError) {
        consola.error("Retry with disk token also failed:", retryError)
        consola.warn(
          "GitHub token may be invalid. Run re-auth.cmd manually to re-authenticate.",
        )
        // Retry in 120s so we don't give up permanently
        scheduleRefresh(120)
      }
    } else {
      consola.warn(
        "Will retry on next refresh interval. Current token may still be valid.",
      )
      // Retry sooner on transient errors
      scheduleRefresh(120)
    }
  }
}

/**
 * Called before each request to ensure the copilot token is still valid.
 * If the token is expired or about to expire (within 60s), refresh it on-demand.
 * Multiple concurrent callers share a single refresh attempt.
 */
export async function ensureCopilotToken(): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = state.copilotTokenExpiresAt ?? 0

  // Token still valid for at least 60s — nothing to do
  if (state.copilotToken && expiresAt - now > 60) {
    return
  }

  consola.warn("Copilot token expired or expiring soon, refreshing on-demand")

  // Coalesce concurrent refresh attempts into one
  if (!refreshPromise) {
    refreshPromise = refreshCopilotToken().finally(() => {
      refreshPromise = null
    })
  }

  await refreshPromise
}

export const setupCopilotToken = async () => {
  const { token, refresh_in, expires_at } = await getCopilotToken()
  applyCopilotToken(token, expires_at)

  // Display the Copilot token to the screen
  consola.debug("GitHub Copilot Token fetched successfully!")
  if (state.showToken) {
    consola.info("Copilot token:", token)
  }

  scheduleRefresh(refresh_in)
}

interface SetupGitHubTokenOptions {
  force?: boolean
}

export async function setupGitHubToken(
  options?: SetupGitHubTokenOptions,
): Promise<void> {
  try {
    const githubToken = await readGithubToken()

    if (githubToken && !options?.force) {
      state.githubToken = githubToken
      if (state.showToken) {
        consola.info("GitHub token:", githubToken)
      }
      await logUser()

      return
    }

    // When force=true, validate the existing token before starting device code flow.
    // The Copilot token endpoint may return 401 transiently — that doesn't mean
    // the GitHub token itself is invalid.
    if (githubToken && options?.force) {
      state.githubToken = githubToken
      try {
        await logUser() // calls /user — validates the GitHub token
        consola.info("Existing GitHub token is still valid, reusing it")
        if (state.showToken) {
          consola.info("GitHub token:", githubToken)
        }
        return
      } catch {
        consola.warn(
          "Existing GitHub token failed validation, requesting new one",
        )
        // Fall through to device code flow below
      }
    }

    consola.info("Not logged in, getting new access token")
    const response = await getDeviceCode()
    consola.debug("Device code response:", response)

    consola.info(
      `Please enter the code "${response.user_code}" in ${response.verification_uri}`,
    )

    const token = await pollAccessToken(response)
    await writeGithubToken(token)
    state.githubToken = token

    if (state.showToken) {
      consola.info("GitHub token:", token)
    }
    await logUser()
  } catch (error) {
    if (error instanceof HTTPError) {
      consola.error("Failed to get GitHub token:", await error.response.json())
      throw error
    }

    consola.error("Failed to get GitHub token:", error)
    throw error
  }
}

async function logUser() {
  const user = await getGitHubUser()
  consola.info(`Logged in as ${user.login}`)
}
