import { ApiVersion, BillingInterval } from "@shopify/shopify-api";
import { shopifyApp } from "@shopify/shopify-app-express";
import { MongoDBSessionStorage } from "@shopify/shopify-app-session-storage-mongodb";
import { restResources } from "@shopify/shopify-api/rest/admin/2025-07";
import {
  mongoDbName,
  mongoDbUrl,
  mongoSessionCollection,
} from "./mongo-config.js";
import {
  BILLING_CURRENCY,
  PREMIUM_ANNUAL_PLAN,
  PREMIUM_ANNUAL_PRICE,
  PREMIUM_MONTHLY_PLAN,
  PREMIUM_MONTHLY_PRICE,
} from "./billing-plans.js";
// NOTE: The Shopify App Billing API (charging merchants for this app) requires
// NO dedicated access scope — an app can always manage its own subscriptions.
// It does require the app to use *public* distribution. The previously
// configured "read_own_subscription"/"write_own_subscription" scopes are not
// valid Shopify scopes (Shopify rejects them on `app deploy`), which is why the
// granted token only had `write_products` and billing.check returned 403.
const shopifyHost = process.env.HOST?.replace(/https?:\/\//, "");
const shopifyScopes = (process.env.SCOPES || "")
  .split(",")
  .map((scope) => scope.trim())
  .filter(Boolean);

// Two billing options for the same "premium" feature tier. Leaving
// replacementBehavior unset means Shopify's STANDARD behaviour: approving one
// plan cancels the other on activation and prorates, so a merchant switching
// between monthly and annual never ends up paying for both.
const billingConfig = {
  [PREMIUM_MONTHLY_PLAN]: {
    amount: PREMIUM_MONTHLY_PRICE,
    currencyCode: BILLING_CURRENCY,
    interval: BillingInterval.Every30Days,
  },
  [PREMIUM_ANNUAL_PLAN]: {
    amount: PREMIUM_ANNUAL_PRICE,
    currencyCode: BILLING_CURRENCY,
    interval: BillingInterval.Annual,
  },
};

if (!shopifyHost) {
  throw new Error("Missing HOST configuration for Shopify app setup.");
}

if (!shopifyScopes.length) {
  throw new Error("Missing SCOPES configuration for Shopify app setup.");
}

const shopify = shopifyApp({
  api: {
    apiVersion: ApiVersion.July25,
    restResources,
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET,
    hostName: shopifyHost,
    scopes: shopifyScopes,
    billing: billingConfig,
  },
  auth: {
    path: "/api/auth",
    callbackPath: "/api/auth/callback",
  },
  webhooks: {
    path: "/api/webhooks",
  },
  sessionStorage: new MongoDBSessionStorage(mongoDbUrl, mongoDbName, {
    sessionCollectionName: mongoSessionCollection,
  }),
});

export default shopify;
