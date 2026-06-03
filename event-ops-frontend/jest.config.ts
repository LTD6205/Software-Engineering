import type { Config } from 'jest'
import nextJest from 'next/jest.js'

// next/jest wires the Next.js SWC transform, CSS/font/image mocks, and .env
// loading for us. See node_modules/next/dist/docs/01-app/02-guides/testing/jest.md
const createJestConfig = nextJest({ dir: './' })

const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // Mirror the tsconfig "@/*" -> "./src/*" path alias.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // Unit/component tests live in src and __tests__; never crawl Playwright e2e.
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/e2e/'],
}

export default createJestConfig(config)
