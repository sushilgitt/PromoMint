import { GraphqlQueryError } from "@shopify/shopify-api";
import shopify from "./shopify.js";
import { BILLING_PLAN_NAMES } from "./billing-plans.js";

export default async function cancelSubscription(session) {
  const subscriptions = await getActiveSubscriptions(session);
  const subscriptionId = getActiveSubscriptionId(subscriptions);

  if (!subscriptionId) {
    throw new Error("No active Premium subscription ID found for cancellation.");
  }

  return appSubscriptionCancel(session, subscriptionId);
}

export async function getActiveSubscriptions(session) {
  const client = new shopify.api.clients.Graphql({ session });

  const currentInstallations = await client.query({
    data: RECURRING_PURCHASES_QUERY,
  });

  return (
    currentInstallations.body.data?.currentAppInstallation?.activeSubscriptions || []
  );
}

function getActiveSubscriptionId(subscriptions) {
  // Cancel the active paid subscription regardless of whether Shopify recorded
  // it as a TEST or LIVE charge. Development stores (used by App Store
  // reviewers) always produce test charges, so a mode-specific match would fail
  // to find the very subscription it needs to cancel.
  //
  // Matching against every plan name matters now that the tier has both a
  // monthly and an annual option: keying on one name would leave an annual
  // subscriber unable to cancel.
  const premium = subscriptions.find(
    (subscription) =>
      BILLING_PLAN_NAMES.includes(subscription?.name) && subscription?.id
  );

  if (premium?.id) {
    return premium.id;
  }

  if (subscriptions.length > 0) {
    throw new Error(
      "Active subscriptions were found, but none matched a PromoMint plan."
    );
  }

  return "";
}

async function appSubscriptionCancel(session, subscriptionId) {
  const client = new shopify.api.clients.Graphql({ session });

  const mutationResponse = await client.query({
    data: {
      query: CANCEL_SUBSCRIPTION,
      variables: {
        id: subscriptionId,
      },
    },
  });

  const topLevelErrors = mutationResponse.body.errors || [];
  const userErrors =
    mutationResponse.body.data?.appSubscriptionCancel?.userErrors || [];

  if (topLevelErrors.length || userErrors.length) {
    throw new GraphqlQueryError({
      message:
        userErrors[0]?.message || "Error while cancelling subscription.",
      response: mutationResponse.body,
      headers: {},
      body: mutationResponse.body,
    });
  }

  return mutationResponse.body.data.appSubscriptionCancel.appSubscription.status;
}

const CANCEL_SUBSCRIPTION = `
mutation appSubscriptionCancel($id: ID!) {
  appSubscriptionCancel(id: $id) {
    appSubscription {
      id
      name
      status
    }
    userErrors {
      field
      message
    }
  }
}
`;

const RECURRING_PURCHASES_QUERY = `
query appSubscription {
  currentAppInstallation {
    activeSubscriptions {
      name
      id
      test
      status
    }
  }
}
`;
