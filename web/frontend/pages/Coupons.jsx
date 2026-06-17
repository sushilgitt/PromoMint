// @ts-check
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Page,
  Layout,
  Card,
  Banner,
  Button,
  Form,
  FormLayout,
  TextField,
  Select,
  Stack,
  Spinner,
  TextContainer,
} from "@shopify/polaris";
import { Redirect } from "@shopify/app-bridge/actions";
import { useAppBridge } from "@shopify/app-bridge-react";
import { promoMintColors, promoMintStyles } from "../brand";
import {
  useAuthenticatedFetch,
  isReauthorizationInProgressError,
} from "../hooks";

const TYPE_OPTIONS = [
  { label: "Percentage off", value: "percentage" },
  { label: "Fixed amount off", value: "fixed" },
  { label: "Free shipping", value: "free_shipping" },
];

const EMPTY_FORM = {
  id: null,
  code: "",
  title: "",
  type: "percentage",
  value: "",
  minSubtotal: "",
};

const decodeHost = (host) => {
  if (!host) return "";
  try {
    return atob(host.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return "";
  }
};

const getCurrentParams = () => new URLSearchParams(window.location.search);
const getCurrentHost = () =>
  getCurrentParams().get("host") || window.__SHOPIFY_DEV_HOST || "";

const getCurrentShop = () => {
  const fromUrl = getCurrentParams().get("shop");
  if (fromUrl) return fromUrl;

  const decoded = decodeHost(getCurrentHost());
  if (!decoded) return "";

  const adminStoreMatch = decoded.match(/\/store\/([^/?]+)/);
  if (adminStoreMatch?.[1]) return `${adminStoreMatch[1]}.myshopify.com`;

  const directShopMatch = decoded.match(/([a-z0-9][a-z0-9-]*\.myshopify\.com)/i);
  return directShopMatch?.[1] || "";
};

const formatCouponSummary = (coupon, currency) => {
  let main = "";
  if (coupon.type === "percentage") main = `${coupon.value}% off`;
  else if (coupon.type === "fixed") main = `${currency} ${coupon.value} off`;
  else main = "Free shipping";

  if (coupon.minSubtotal) {
    main += ` (min. ${currency} ${coupon.minSubtotal})`;
  }
  return main;
};

export default function Coupons() {
  const app = useAppBridge();
  const fetchAuth = useAuthenticatedFetch();
  const redirect = useMemo(() => Redirect.create(app), [app]);

  const shop = getCurrentShop();
  const host = getCurrentHost();

  const [coupons, setCoupons] = useState([]);
  const [tier, setTier] = useState(/** @type {"free"|"premium"|null} */ (null));
  const [limit, setLimit] = useState(3);
  const [currency, setCurrency] = useState("USD");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(/** @type {string|null} */ (null));
  const [form, setForm] = useState(EMPTY_FORM);
  const [banner, setBanner] = useState({ msg: "", status: null });

  const withShopQuery = useCallback(
    (path) => {
      if (!shop && !host) return path;
      const [base, existingQuery = ""] = path.split("?");
      const params = new URLSearchParams(existingQuery);
      if (shop && !params.has("shop")) params.set("shop", shop);
      if (host && !params.has("host")) params.set("host", host);
      const query = params.toString();
      return query ? `${base}?${query}` : base;
    },
    [shop, host]
  );

  const parseJsonSafe = async (response) => {
    try {
      return await response.json();
    } catch {
      return {};
    }
  };

  const applyState = (data) => {
    if (Array.isArray(data.coupons)) setCoupons(data.coupons);
    if (data.tier) setTier(data.tier);
    if (typeof data.limit === "number") setLimit(data.limit);
    if (data.currency) setCurrency(data.currency);
  };

  const handleResponse = (response, data, fallback) => {
    if (response.status === 403 && data?.upsell) {
      setBanner({
        msg:
          data.error ||
          "You've reached your plan limit. Upgrade to add more coupons.",
        status: "warning",
      });
      return false;
    }

    if (response.status === 401 && data?.needsReauth) {
      throw new Error(
        "Authentication is being restored. If this persists, reopen the app from Shopify admin and try again."
      );
    }

    if (!response.ok) {
      throw new Error(data?.error || fallback);
    }

    return true;
  };

  const loadCoupons = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchAuth(withShopQuery("/api/coupons"));
      const data = await parseJsonSafe(response);
      if (handleResponse(response, data, "We couldn't load your coupons.")) {
        applyState(data);
      }
    } catch (error) {
      if (!isReauthorizationInProgressError(error)) {
        setBanner({
          msg:
            error instanceof Error
              ? error.message
              : "We couldn't load your coupons.",
          status: "critical",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [fetchAuth, withShopQuery]);

  // Load once on mount. Do NOT depend on loadCoupons/fetchAuth here:
  // useAuthenticatedFetch() returns a new function every render, so depending on
  // it would re-run this effect on every render → infinite fetch loop (the
  // spinner flickers forever). Pricing.jsx uses the same empty-deps pattern.
  const didLoadRef = useRef(false);
  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    loadCoupons();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetForm = () => setForm(EMPTY_FORM);

  const startEdit = (coupon) => {
    setForm({
      id: coupon.id,
      code: coupon.code || "",
      title: coupon.title || "",
      type: coupon.type || "percentage",
      value: coupon.value != null ? String(coupon.value) : "",
      minSubtotal: coupon.minSubtotal != null ? String(coupon.minSubtotal) : "",
    });
    setBanner({ msg: "", status: null });
  };

  const isEditing = !!form.id;
  const atLimit = coupons.length >= limit;
  const addDisabled = !isEditing && atLimit;

  const submit = async () => {
    setSaving(true);
    setBanner({ msg: "", status: null });

    const payload = {
      code: form.code,
      title: form.title,
      type: form.type,
      value: form.type === "free_shipping" ? null : form.value,
      minSubtotal: form.minSubtotal,
      host,
    };

    const path = isEditing ? `/api/coupons/${form.id}` : "/api/coupons";
    const method = isEditing ? "PUT" : "POST";

    try {
      const response = await fetchAuth(withShopQuery(path), {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await parseJsonSafe(response);

      if (handleResponse(response, data, "We couldn't save this coupon.")) {
        applyState(data);
        resetForm();
        setBanner({
          msg: isEditing
            ? "Coupon updated. The discount is live at checkout."
            : "Coupon created. The discount is live at checkout.",
          status: "success",
        });
      }
    } catch (error) {
      if (!isReauthorizationInProgressError(error)) {
        setBanner({
          msg:
            error instanceof Error
              ? error.message
              : "We couldn't save this coupon.",
          status: "critical",
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async (couponId) => {
    setDeletingId(couponId);
    setBanner({ msg: "", status: null });
    try {
      const response = await fetchAuth(withShopQuery(`/api/coupons/${couponId}`), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host }),
      });
      const data = await parseJsonSafe(response);

      if (handleResponse(response, data, "We couldn't delete this coupon.")) {
        applyState(data);
        if (form.id === couponId) resetForm();
        setBanner({ msg: "Coupon deleted.", status: "success" });
      }
    } catch (error) {
      if (!isReauthorizationInProgressError(error)) {
        setBanner({
          msg:
            error instanceof Error
              ? error.message
              : "We couldn't delete this coupon.",
          status: "critical",
        });
      }
    } finally {
      setDeletingId(null);
    }
  };

  const goToPricing = () => {
    redirect.dispatch(Redirect.Action.APP, withShopQuery("/pricing"));
  };

  const canSubmit =
    form.code.trim() &&
    form.title.trim() &&
    (form.type === "free_shipping" || String(form.value).trim()) &&
    !saving;

  const valueLabel =
    form.type === "percentage"
      ? "Percentage off (1–100)"
      : `Amount off (${currency})`;

  return (
    <Page
      title="Coupons"
      subtitle="Create real discount codes that reduce the price at checkout and show on your product pages."
    >
      <Layout>
        {!!banner.msg && (
          <Layout.Section>
            <Banner
              status={banner.status}
              onDismiss={() => setBanner({ msg: "", status: null })}
            >
              {banner.msg}
            </Banner>
          </Layout.Section>
        )}

        {atLimit && (
          <Layout.Section>
            <Banner status="info">
              <p>
                You're using {coupons.length} of {limit} coupons on the{" "}
                {tier === "premium" ? "Premium" : "Free"} plan.
                {tier !== "premium" &&
                  " Upgrade to Premium to add up to 6 coupons."}
              </p>
              {tier !== "premium" && (
                <div style={{ marginTop: 12 }}>
                  <Button onClick={goToPricing} style={promoMintStyles.primaryButton}>
                    See Premium
                  </Button>
                </div>
              )}
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section oneHalf>
          <Card
            sectioned
            title={isEditing ? "Edit coupon" : "Add a coupon"}
            style={promoMintStyles.accentCard}
          >
            <Form onSubmit={submit}>
              <FormLayout>
                <TextField
                  label="Coupon code"
                  value={form.code}
                  onChange={(value) =>
                    setForm((f) => ({ ...f, code: value.toUpperCase() }))
                  }
                  autoComplete="off"
                  helpText="Shoppers type this at checkout. Letters, numbers, - and _ only."
                  disabled={addDisabled}
                />
                <TextField
                  label="Offer title"
                  value={form.title}
                  onChange={(value) => setForm((f) => ({ ...f, title: value }))}
                  autoComplete="off"
                  helpText="Shown on the product page, e.g. “Shop $50+ Get 15% OFF”."
                  disabled={addDisabled}
                />
                <Select
                  label="Discount type"
                  options={TYPE_OPTIONS}
                  value={form.type}
                  onChange={(value) => setForm((f) => ({ ...f, type: value }))}
                  disabled={addDisabled}
                />
                {form.type !== "free_shipping" && (
                  <TextField
                    label={valueLabel}
                    type="number"
                    value={form.value}
                    onChange={(value) => setForm((f) => ({ ...f, value }))}
                    autoComplete="off"
                    min={0}
                    disabled={addDisabled}
                  />
                )}
                <TextField
                  label={`Minimum order subtotal (${currency}) — optional`}
                  type="number"
                  value={form.minSubtotal}
                  onChange={(value) =>
                    setForm((f) => ({ ...f, minSubtotal: value }))
                  }
                  autoComplete="off"
                  min={0}
                  helpText="Leave blank for no minimum."
                  disabled={addDisabled}
                />

                <Stack distribution="trailing" spacing="tight">
                  {isEditing && (
                    <Button onClick={resetForm} disabled={saving}>
                      Cancel
                    </Button>
                  )}
                  <Button
                    submit
                    primary
                    loading={saving}
                    disabled={!canSubmit || addDisabled}
                    style={promoMintStyles.primaryButton}
                  >
                    {isEditing ? "Save changes" : "Add coupon"}
                  </Button>
                </Stack>

                {addDisabled && (
                  <p style={{ color: promoMintColors.mutedText }}>
                    You've reached your plan limit. Delete a coupon or upgrade to
                    add more.
                  </p>
                )}
              </FormLayout>
            </Form>
          </Card>
        </Layout.Section>

        <Layout.Section oneHalf>
          <Card
            sectioned
            title={`Your coupons (${coupons.length}/${limit})`}
            style={promoMintStyles.accentCard}
          >
            {loading ? (
              <Stack distribution="center">
                <Spinner accessibilityLabel="Loading coupons" size="small" />
              </Stack>
            ) : coupons.length === 0 ? (
              <TextContainer>
                <p style={{ color: promoMintColors.mutedText }}>
                  No coupons yet. Add your first coupon to start showing real
                  discount codes on your product pages.
                </p>
              </TextContainer>
            ) : (
              <Stack vertical spacing="loose">
                {coupons.map((coupon) => (
                  <div
                    key={coupon.id}
                    style={{
                      border: `1px solid ${promoMintColors.border}`,
                      borderRadius: 12,
                      padding: 14,
                    }}
                  >
                    <Stack alignment="center" distribution="equalSpacing">
                      <Stack vertical spacing="extraTight">
                        <strong style={{ color: promoMintColors.text }}>
                          {coupon.title}
                        </strong>
                        <span style={{ color: promoMintColors.mutedText }}>
                          Code: <b>{coupon.code}</b>
                        </span>
                        <span style={{ color: promoMintColors.mutedText }}>
                          {formatCouponSummary(coupon, currency)}
                        </span>
                      </Stack>
                      <Stack spacing="tight">
                        <Button onClick={() => startEdit(coupon)} disabled={saving}>
                          Edit
                        </Button>
                        <Button
                          destructive
                          loading={deletingId === coupon.id}
                          onClick={() => remove(coupon.id)}
                        >
                          Delete
                        </Button>
                      </Stack>
                    </Stack>
                  </div>
                ))}
              </Stack>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
