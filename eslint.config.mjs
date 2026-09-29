import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [".next/**", "node_modules/**", "drizzle/**", ".pgdata/**", ".pgdata-test/**", "next-env.d.ts"],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "mercadopago", message: "Only src/server/payments/providers/mercadopago/* may import the PSP SDK." }],
        },
      ],
    },
  },
  {
    files: ["src/server/payments/providers/mercadopago/**"],
    rules: { "no-restricted-imports": "off" },
  },
];

export default config;
