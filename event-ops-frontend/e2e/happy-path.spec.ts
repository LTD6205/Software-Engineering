import { test, expect, request, Page } from '@playwright/test'

// Happy-path browser flows against the running stack. All flows are READ-ONLY
// (authenticate + navigate) so they never mutate the developer's data.
//
// Uses the seeded manager account (see backend seed.js). Language is forced to
// English via localStorage so text assertions are deterministic regardless of
// the developer's saved language preference.

const API = process.env.PW_API_URL || 'http://localhost:3000/api'
const MANAGER = { email: 'manager01@eventops.com', password: 'manager123' }

// Get a real JWT from the backend so navigation tests can skip the login UI.
async function apiLogin(creds: { email: string; password: string }) {
  const ctx = await request.newContext()
  const res = await ctx.post(`${API}/auth/login`, { data: creds })
  expect(res.ok(), `login API should succeed for ${creds.email}`).toBeTruthy()
  const body = await res.json()
  await ctx.dispose()
  return body as { access_token: string; user: unknown }
}

// Seed an authenticated session + English language into the browser BEFORE the
// app's first render (AuthProvider restores the session from localStorage).
async function seedAuth(page: Page, creds = MANAGER) {
  const { access_token, user } = await apiLogin(creds)
  await page.addInitScript(
    ([token, userJson]) => {
      localStorage.setItem('token', token)
      localStorage.setItem('user', userJson)
      localStorage.setItem('lang', 'en')
    },
    [access_token, JSON.stringify(user)],
  )
}

test.describe('Auth happy path', () => {
  test('logs in through the UI and lands on the dashboard', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('lang', 'en'))
    await page.goto('/login')

    await page.locator('input[type="email"]').fill(MANAGER.email)
    await page.locator('input[type="password"]').fill(MANAGER.password)
    await page.getByRole('button', { name: /sign in/i }).click()

    // Redirected to the dashboard with the stat cards rendered.
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText('Total Events')).toBeVisible()
  })

  test('shows an error for invalid credentials', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('lang', 'en'))
    await page.goto('/login')

    await page.locator('input[type="email"]').fill(MANAGER.email)
    await page.locator('input[type="password"]').fill('wrong-password')
    await page.getByRole('button', { name: /sign in/i }).click()

    await expect(page.getByText(/invalid email or password/i)).toBeVisible()
    // Stayed on the login page.
    await expect(page).toHaveURL(/\/login$/)
  })
})

test.describe('Authenticated navigation happy path', () => {
  test('dashboard shows the four event stat cards', async ({ page }) => {
    await seedAuth(page)
    await page.goto('/')
    for (const label of ['Total Events', 'In Progress', 'Completed', 'Pending']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible()
    }
  })

  test('a manager can open the Events page (not bounced to login)', async ({ page }) => {
    await seedAuth(page)
    await page.goto('/events')
    await expect(page).toHaveURL(/\/events$/)
    // A protected page renders, so there is no login form on screen.
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
  })

  test('a manager can open the Tasks page (manager-only feature)', async ({ page }) => {
    await seedAuth(page)
    await page.goto('/tasks')
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
  })

  test('an unauthenticated visit to a protected page redirects to login', async ({
    page,
  }) => {
    // No seeded session here.
    await page.addInitScript(() => localStorage.setItem('lang', 'en'))
    await page.goto('/tasks')
    await expect(page).toHaveURL(/\/login$/)
  })
})
