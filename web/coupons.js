import { GraphqlQueryError } from "@shopify/shopify-api";
import shopify from "./shopify.js";

// Coupons created here become REAL Shopify discount codes (so they reduce the
// price at checkout) and are mirrored into a shop metafield that the storefront
// theme block reads directly. The metafield is the single source of truth for
// what the block renders; the Shopify discount is the enforcement at checkout.
//
// Storage: shop metafield custom/promomint_coupons (type json), an array of
//   { id, code, title, type, value, minSubtotal, discountGid, status }
// where type is "percentage" | "fixed" | "free_shipping".

export const COUPONS_NAMESPACE = "custom";
export const COUPONS_KEY = "promomint_coupons";

export const COUPON_TYPES = ["percentage", "fixed", "free_shipping"];

/* -------------------------------------------------------------------------- */
/*                                  HELPERS                                    */
/* -------------------------------------------------------------------------- */

// A user-facing validation/Shopify-userError problem (e.g. duplicate code).
// Routes turn this into a 400 instead of a 500/reauth.
export class CouponValidationError extends Error {
  constructor(message, userErrors = []) {
    super(message);
    this.name = "CouponValidationError";
    this.userErrors = userErrors;
  }
}

const createClient = (session) => new shopify.api.clients.Graphql({ session });

// client.query() resolves to { body: { data, errors } }. Surface both
// top-level GraphQL errors and mutation userErrors (matches cancel-subscription.js).
const assertNoErrors = (body, mutationName) => {
  const topLevelErrors = body?.errors || [];
  const userErrors = body?.data?.[mutationName]?.userErrors || [];

  if (userErrors.length) {
    throw new CouponValidationError(
      userErrors[0]?.message || "Shopify rejected this coupon.",
      userErrors
    );
  }

  if (topLevelErrors.length) {
    throw new GraphqlQueryError({
      message: topLevelErrors[0]?.message || `Error while running ${mutationName}.`,
      response: body,
      headers: {},
      body,
    });
  }
};

const normalizeCode = (code) => String(code || "").trim().toUpperCase();

const buildMinimumRequirement = (minSubtotal) => {
  const amount = Number(minSubtotal);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  return { subtotal: { greaterThanOrEqualToSubtotal: amount.toFixed(2) } };
};

// percentage: Shopify wants a fraction 0..1 (merchant enters 0..100).
const buildBasicInput = (coupon) => {
  const input = {
    title: coupon.title,
    code: coupon.code,
    startsAt: new Date().toISOString(),
    customerSelection: { all: true },
    customerGets: {
      items: { all: true },
      value:
        coupon.type === "percentage"
          ? { percentage: Number(coupon.value) / 100 }
          : {
              discountAmount: {
                amount: Number(coupon.value).toFixed(2),
                appliesOnEachItem: false,
              },
            },
    },
    appliesOncePerCustomer: false,
  };

  const minimumRequirement = buildMinimumRequirement(coupon.minSubtotal);
  if (minimumRequirement) input.minimumRequirement = minimumRequirement;

  return input;
};

const buildFreeShippingInput = (coupon) => {
  const input = {
    title: coupon.title,
    code: coupon.code,
    startsAt: new Date().toISOString(),
    customerSelection: { all: true },
    destination: { all: true },
    appliesOncePerCustomer: false,
  };

  const minimumRequirement = buildMinimumRequirement(coupon.minSubtotal);
  if (minimumRequirement) input.minimumRequirement = minimumRequirement;

  return input;
};

/* -------------------------------------------------------------------------- */
/*                              VALIDATION                                     */
/* -------------------------------------------------------------------------- */

// Validate + normalize an incoming coupon payload. Throws CouponValidationError
// on bad input so the route returns 400.
export const normalizeCouponInput = (raw = {}) => {
  const code = normalizeCode(raw.code);
  const title = String(raw.title || "").trim();
  const type = String(raw.type || "").trim();

  if (!code) throw new CouponValidationError("A coupon code is required.");
  if (!/^[A-Z0-9_-]+$/.test(code)) {
    throw new CouponValidationError(
      "Coupon codes can only contain letters, numbers, hyphens and underscores."
    );
  }
  if (!title) throw new CouponValidationError("A coupon title is required.");
  if (!COUPON_TYPES.includes(type)) {
    throw new CouponValidationError("Select a valid discount type.");
  }

  let value = null;
  if (type === "percentage") {
    value = Number(raw.value);
    if (!Number.isFinite(value) || value <= 0 || value > 100) {
      throw new CouponValidationError("Enter a percentage between 1 and 100.");
    }
  } else if (type === "fixed") {
    value = Number(raw.value);
    if (!Number.isFinite(value) || value <= 0) {
      throw new CouponValidationError("Enter a discount amount greater than 0.");
    }
  }

  let minSubtotal = null;
  if (raw.minSubtotal != null && String(raw.minSubtotal).trim() !== "") {
    const parsed = Number(raw.minSubtotal);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new CouponValidationError("Minimum subtotal must be 0 or more.");
    }
    minSubtotal = parsed > 0 ? parsed : null;
  }

  return { code, title, type, value, minSubtotal };
};

/* -------------------------------------------------------------------------- */
/*                          METAFIELD (SOURCE OF TRUTH)                        */
/* -------------------------------------------------------------------------- */

// One round-trip for everything the routes need: shop GID (metafield owner),
// shop currency (fixed-amount label), and the stored coupon list.
export const getCouponsState = async (session) => {
  const client = createClient(session);

  const response = await client.query({ data: SHOP_COUPONS_QUERY });
  assertNoErrors(response.body, "shop");

  const shop = response.body?.data?.shop;
  const shopGid = shop?.id;
  if (!shopGid) throw new Error("Shop ID not found.");

  let coupons = [];
  const rawValue = shop?.metafield?.value;
  if (rawValue) {
    try {
      const parsed = JSON.parse(rawValue);
      if (Array.isArray(parsed)) coupons = parsed;
    } catch {
      coupons = [];
    }
  }

  return { shopGid, currency: shop?.currencyCode || "USD", coupons };
};

export const writeCoupons = async (session, shopGid, coupons) => {
  const client = createClient(session);

  const response = await client.query({
    data: {
      query: METAFIELDS_SET,
      variables: {
        metafields: [
          {
            ownerId: shopGid,
            namespace: COUPONS_NAMESPACE,
            key: COUPONS_KEY,
            type: "json",
            value: JSON.stringify(coupons),
          },
        ],
      },
    },
  });

  assertNoErrors(response.body, "metafieldsSet");
};

/* -------------------------------------------------------------------------- */
/*                          SHOPIFY DISCOUNT MUTATIONS                         */
/* -------------------------------------------------------------------------- */

// Returns { discountGid, code } for the created discount.
export const createDiscount = async (session, coupon) => {
  const client = createClient(session);

  if (coupon.type === "free_shipping") {
    const response = await client.query({
      data: {
        query: FREE_SHIPPING_CREATE,
        variables: { freeShippingCodeDiscount: buildFreeShippingInput(coupon) },
      },
    });
    assertNoErrors(response.body, "discountCodeFreeShippingCreate");
    const node =
      response.body.data.discountCodeFreeShippingCreate.codeDiscountNode;
    return {
      discountGid: node?.id,
      code: node?.codeDiscount?.codes?.nodes?.[0]?.code || coupon.code,
    };
  }

  const response = await client.query({
    data: {
      query: BASIC_CREATE,
      variables: { basicCodeDiscount: buildBasicInput(coupon) },
    },
  });
  assertNoErrors(response.body, "discountCodeBasicCreate");
  const node = response.body.data.discountCodeBasicCreate.codeDiscountNode;
  return {
    discountGid: node?.id,
    code: node?.codeDiscount?.codes?.nodes?.[0]?.code || coupon.code,
  };
};

// Edit an existing coupon. A type change requires delete + recreate because
// basic and free-shipping discounts are different node types.
export const updateDiscount = async (session, existing, coupon) => {
  if (!existing?.discountGid) {
    return createDiscount(session, coupon);
  }

  if (existing.type !== coupon.type) {
    await deleteDiscount(session, existing.discountGid);
    return createDiscount(session, coupon);
  }

  const client = createClient(session);

  if (coupon.type === "free_shipping") {
    const response = await client.query({
      data: {
        query: FREE_SHIPPING_UPDATE,
        variables: {
          id: existing.discountGid,
          freeShippingCodeDiscount: buildFreeShippingInput(coupon),
        },
      },
    });
    assertNoErrors(response.body, "discountCodeFreeShippingUpdate");
    return { discountGid: existing.discountGid, code: coupon.code };
  }

  const response = await client.query({
    data: {
      query: BASIC_UPDATE,
      variables: {
        id: existing.discountGid,
        basicCodeDiscount: buildBasicInput(coupon),
      },
    },
  });
  assertNoErrors(response.body, "discountCodeBasicUpdate");
  return { discountGid: existing.discountGid, code: coupon.code };
};

// Delete the Shopify discount. A "not found" is tolerated so the caller can
// still drop the entry from the metafield (self-heal).
export const deleteDiscount = async (session, discountGid) => {
  if (!discountGid) return;

  const client = createClient(session);

  try {
    const response = await client.query({
      data: { query: DISCOUNT_DELETE, variables: { id: discountGid } },
    });
    assertNoErrors(response.body, "discountCodeDelete");
  } catch (error) {
    const message = (error?.message || "").toLowerCase();
    if (message.includes("not found") || message.includes("does not exist")) {
      return;
    }
    throw error;
  }
};

/* -------------------------------------------------------------------------- */
/*                                  GRAPHQL                                    */
/* -------------------------------------------------------------------------- */

const SHOP_COUPONS_QUERY = `
query shopCoupons {
  shop {
    id
    currencyCode
    metafield(namespace: "${COUPONS_NAMESPACE}", key: "${COUPONS_KEY}") {
      value
    }
  }
}
`;

const METAFIELDS_SET = `
mutation SetCoupons($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key }
    userErrors { field message }
  }
}
`;

const CODE_DISCOUNT_NODE_FIELDS = `
  codeDiscountNode {
    id
    codeDiscount {
      ... on DiscountCodeBasic {
        title
        status
        codes(first: 1) { nodes { code } }
      }
      ... on DiscountCodeFreeShipping {
        title
        status
        codes(first: 1) { nodes { code } }
      }
    }
  }
`;

const BASIC_CREATE = `
mutation CreateBasicCodeDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
  discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
    ${CODE_DISCOUNT_NODE_FIELDS}
    userErrors { field code message }
  }
}
`;

const BASIC_UPDATE = `
mutation UpdateBasicCodeDiscount($id: ID!, $basicCodeDiscount: DiscountCodeBasicInput!) {
  discountCodeBasicUpdate(id: $id, basicCodeDiscount: $basicCodeDiscount) {
    ${CODE_DISCOUNT_NODE_FIELDS}
    userErrors { field code message }
  }
}
`;

const FREE_SHIPPING_CREATE = `
mutation CreateFreeShippingCodeDiscount($freeShippingCodeDiscount: DiscountCodeFreeShippingInput!) {
  discountCodeFreeShippingCreate(freeShippingCodeDiscount: $freeShippingCodeDiscount) {
    ${CODE_DISCOUNT_NODE_FIELDS}
    userErrors { field code message }
  }
}
`;

const FREE_SHIPPING_UPDATE = `
mutation UpdateFreeShippingCodeDiscount($id: ID!, $freeShippingCodeDiscount: DiscountCodeFreeShippingInput!) {
  discountCodeFreeShippingUpdate(id: $id, freeShippingCodeDiscount: $freeShippingCodeDiscount) {
    ${CODE_DISCOUNT_NODE_FIELDS}
    userErrors { field code message }
  }
}
`;

const DISCOUNT_DELETE = `
mutation DeleteCodeDiscount($id: ID!) {
  discountCodeDelete(id: $id) {
    deletedCodeDiscountId
    userErrors { field code message }
  }
}
`;
