// Single source of truth for the app's billing plans.
//
// These names are the Shopify subscription names (AppSubscription.name). They
// are matched by value in billing.check(), billing.request() and the cancel
// flow, and they are what Shopify shows the merchant on the approval screen.
// NEVER rename an existing plan: live subscriptions carry the old name, so a
// rename makes every existing subscriber look unsubscribed.
//
// The app exposes ONE feature tier ("premium"). Monthly and annual are two
// billing options for that same tier, so both unlock the identical feature set
// (6 coupons) and both write tier "premium" to the shop metafield.

export const PREMIUM_MONTHLY_PLAN = "Premium";
export const PREMIUM_ANNUAL_PLAN = "Premium Annual";

export const PREMIUM_MONTHLY_PRICE = 19;
export const PREMIUM_ANNUAL_PRICE = 190;

export const BILLING_CURRENCY = "USD";

// Every plan we ask Shopify about. Order matters only for display.
export const BILLING_PLAN_NAMES = [PREMIUM_MONTHLY_PLAN, PREMIUM_ANNUAL_PLAN];

// Slugs are the wire format between the frontend and the API (`plan` in the
// request body / query string). They are stable and lowercase.
export const PREMIUM_MONTHLY_SLUG = "premium";
export const PREMIUM_ANNUAL_SLUG = "premium_annual";
export const FREE_SLUG = "free";

export const PLAN_NAME_BY_SLUG = {
  [PREMIUM_MONTHLY_SLUG]: PREMIUM_MONTHLY_PLAN,
  [PREMIUM_ANNUAL_SLUG]: PREMIUM_ANNUAL_PLAN,
};

export const PLAN_SLUG_BY_NAME = {
  [PREMIUM_MONTHLY_PLAN]: PREMIUM_MONTHLY_SLUG,
  [PREMIUM_ANNUAL_PLAN]: PREMIUM_ANNUAL_SLUG,
};

export const isPaidPlanSlug = (slug) =>
  Object.prototype.hasOwnProperty.call(PLAN_NAME_BY_SLUG, slug);

// billing.check(..., { plans: BILLING_PLAN_NAMES, returnObject: true }) returns
// appSubscriptions already filtered to those names (see the library's
// subscriptionMeetsCriteria), so the first recognised name is the active plan.
// A merchant can only hold one active app subscription at a time.
export const getActivePlanSlug = (billing) => {
  const subscriptions = billing?.appSubscriptions || [];

  for (const subscription of subscriptions) {
    const slug = PLAN_SLUG_BY_NAME[subscription?.name];
    if (slug) return slug;
  }

  return null;
};
