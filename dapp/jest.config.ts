export default {
  preset: "ts-jest",
  verbose: true,
  silent: true,
  testEnvironment: "jest-environment-jsdom",
  modulePathIgnorePatterns: ["<rootDir>/dist"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        diagnostics: { ignoreDiagnostics: [1343] },
        astTransformers: {
          before: [
            {
              path: "ts-jest-mock-import-meta",
              options: {
                metaObjectReplacement: {
                  env: {
                    VITE_PAYMENT_SERVICE_URL: "http://localhost:3001",
                    VITE_STRIPE_PUBLISHABLE_KEY: "pk_test_mock",
                    VITE_MUSD_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000000",
                    VITE_WALLETCONNECT_PROJECT_ID: "test-project-id",
                  },
                },
              },
            },
          ],
        },
      },
    ],
  },
  moduleNameMapper: {
    "^#/(.*)": "<rootDir>/src/$1",
    "^.+\\.svg$": "jest-svg-transformer",
    "^.+\\.(css|less|scss)$": "identity-obj-proxy",
  },
  setupFilesAfterEnv: ["<rootDir>/src/setupTests.ts"],
  modulePaths: ["<rootDir>/src"],
}
