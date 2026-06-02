// @ts-check
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Page,
  Layout,
  Card,
  Button,
  Banner,
  Stack,
  Modal,
  TextContainer,
  Icon,
} from "@shopify/polaris";
import { promoMintColors, promoMintStyles } from "../brand";
import { CircleTickMinor } from "@shopify/polaris-icons";
import { Redirect } from "@shopify/app-bridge/actions";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  useAuthenticatedFetch,
  isReauthorizationInProgressError,
  hasRecentReauthAttempt,
} from "../hooks";

const PENDING_PLAN_STORAGE_KEY = "promomint:pendingPlan";
const RETURN_TO_STORAGE_KEY = "promomint:returnTo";
const REQUEST_TIMEOUT_MS = 15000;
const REAUTH_RECOVERY_RETRY_MS = 16000;

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
  const params = getCurrentParams();
  const fromUrl = params.get("shop");
  if (fromUrl) return fromUrl;

  const decoded = decodeHost(getCurrentHost());
  if (!decoded) return "";

  const adminStoreMatch = decoded.match(/\/store\/([^/?]+)/);
  if (adminStoreMatch?.[1]) {
    return `${adminStoreMatch[1]}.myshopify.com`;
  }

  const directShopMatch = decoded.match(
    /([a-z0-9][a-z0-9-]*\.myshopify\.com)/i
  );

  return directShopMatch?.[1] || "";
};

const getBillingReturnState = () => {
  const params = getCurrentParams();
  return {
    isBillingReturn: params.get("billingReturn") === "1",
    plan: params.get("plan") || "",
  };
};

export default function Pricing() {
  const app = useAppBridge();
  const fetchAuth = useAuthenticatedFetch();
  const redirect = Redirect.create(app);
  const resumeAttemptedRef = useRef(false);
  const reauthRecoveryTimeoutRef = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  const reauthRecoveryStartedRef = useRef(false);

  const shop = getCurrentShop();
  const host = getCurrentHost();
  const billingReturnState = getBillingReturnState();

  const tick = useMemo(
    () => <Icon source={CircleTickMinor} color="success" />,
    []
  );

  const [serverTier, setServerTier] = useState(
    /** @type {"free" | "premium" | null} */ (null)
  );
  const [loading, setLoading] = useState({ page: true, action: null });
  const [confirm, setConfirm] = useState({ open: false, target: null });
  const [banner, setBanner] = useState({ msg: "", status: null });

  const PRICE = "19";

  const selectedPlan = useMemo(() => {
    if (serverTier !== "free" && serverTier !== "premium") {
      return null;
    }

    return serverTier;
  }, [serverTier]);

  const withShopQuery = (path) => {
    if (!shop && !host) return path;
    const [base, existingQuery = ""] = path.split("?");
    const params = new URLSearchParams(existingQuery);
    if (shop && !params.has("shop")) params.set("shop", shop);
    if (host && !params.has("host")) params.set("host", host);
    const query = params.toString();
    return query ? `${base}?${query}` : base;
  };

  const getErrorMessage = (data, fallback) => {
    if (Array.isArray(data?.details) && data.details.length) {
      return data.details.join(" ");
    }

    return data?.error || fallback;
  };

  const parseJsonSafe = async (response) => {
    try {
      return await response.json();
    } catch {
      return {};
    }
  };

  const clearPendingPlan = () => {
    window.sessionStorage.removeItem(PENDING_PLAN_STORAGE_KEY);
  };

  const getPendingPlan = () =>
    window.sessionStorage.getItem(PENDING_PLAN_STORAGE_KEY) || "";

  const showResumeBanner = (pendingPlan) => {
    if (!pendingPlan) return;

    setBanner({
      msg:
        pendingPlan === "premium"
          ? "Authentication restored. Resuming the Premium billing flow."
          : "Authentication restored. Resuming the Free plan change.",
      status: "info",
    });
  };

  const clearReturnToRoute = () => {
    window.sessionStorage.removeItem(RETURN_TO_STORAGE_KEY);
  };

  const clearPendingBillingResume = () => {
    clearPendingPlan();
    clearReturnToRoute();
  };

  const clearReauthRecoveryTimeout = () => {
    if (reauthRecoveryTimeoutRef.current) {
      clearTimeout(reauthRecoveryTimeoutRef.current);
      reauthRecoveryTimeoutRef.current = null;
    }
  };

  const scheduleReauthRecovery = () => {
    if (reauthRecoveryStartedRef.current) {
      return;
    }

    reauthRecoveryStartedRef.current = true;
    clearReauthRecoveryTimeout();
    reauthRecoveryTimeoutRef.current = setTimeout(() => {
      setLoading((s) => ({ ...s, page: false }));
      // Do NOT fake a "free" tier here — leaving serverTier null keeps the plan
      // buttons disabled (hasResolvedPlan === false) and avoids the misleading
      // "no plan active" state while we are genuinely still connecting.
      setBanner((currentBanner) =>
        currentBanner.msg
          ? currentBanner
          : {
              msg: "We’re still connecting to Shopify. Reopen the app from Shopify admin or reload this page to finish loading your plan.",
              status: "info",
            }
      );
    }, REAUTH_RECOVERY_RETRY_MS);
  };

  const clearBillingReturnParams = () => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("billingReturn") && !params.has("plan")) {
      return;
    }

    params.delete("billingReturn");
    params.delete("plan");
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`;
    window.history.replaceState({}, "", nextUrl);
  };

  const handleAuthResponse = (response, data, fallback) => {
    if (response.status === 401 && data?.needsReauth) {
      if (data.requiresBillingScopes) {
        throw new Error(
          "Shopify needs fresh app authorization for billing scopes. Reopen the app from Shopify admin, approve access, and try Premium again."
        );
      }

      throw new Error(
        getErrorMessage(
          data,
          "Authentication is being restored. If the page does not recover, reopen the app from Shopify admin and try again."
        )
      );
    }

    if (!response.ok) {
      throw new Error(getErrorMessage(data, fallback));
    }
  };

  const loadPlanResponse = async () => {
    const response = await fetchAuth(withShopQuery("/api/hasActiveSubscription"));
    const data = await parseJsonSafe(response);
    return { response, data };
  };

  const postPlanAction = async (path, plan, fallback) => {
    const response = await fetchAuth(withShopQuery(path), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ plan, host }),
      reauthPlan: plan,
    });
    const data = await parseJsonSafe(response);
    handleAuthResponse(response, data, fallback);
    return data;
  };

  const performPlanAction = async (plan, { silent = false } = {}) => {
    if (plan === "free") {
      const data = await postPlanAction(
        "/api/cancelSubscription",
        "free",
        "We couldn’t switch you to the Free plan."
      );

      if (data?.tier !== "free") {
        throw new Error("The Free plan could not be confirmed after cancellation.");
      }

      clearPendingBillingResume();
      setServerTier("free");
      if (!silent) {
        setBanner({ msg: "Your store is now on the Free plan.", status: "success" });
      }
      return { redirected: false, tier: data.tier };
    }

    const data = await postPlanAction(
      "/api/createSubscription",
      "premium",
      "We couldn’t start the Premium subscription."
    );

    if (data.isActiveSubscription) {
      clearPendingBillingResume();
      setServerTier("premium");
      if (!silent) {
        setBanner({ msg: "Your Premium plan is already active.", status: "success" });
      }
      return { redirected: false, tier: data.tier };
    }

    if (data.confirmationUrl) {
      redirect.dispatch(Redirect.Action.REMOTE, String(data.confirmationUrl));
      return { redirected: true, tier: data.tier };
    }

    throw new Error("Shopify did not return a billing approval link.");
  };

  async function refreshTier({ allowSoftFailure = false } = {}) {
    try {
      setLoading((s) => ({ ...s, page: true }));

      const timeout = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("Loading plans took too long.")),
          REQUEST_TIMEOUT_MS
        );
      });

      const { response, data } = await Promise.race([loadPlanResponse(), timeout]);

      handleAuthResponse(
        response,
        data,
        "We couldn’t confirm your current plan."
      );

      if (data?.tier !== "premium" && data?.tier !== "free") {
        throw new Error("We couldn’t confirm your current plan.");
      }

      clearReauthRecoveryTimeout();
      reauthRecoveryStartedRef.current = false;
      setServerTier(data.tier);
      setBanner((currentBanner) => {
        if (currentBanner.status === "critical" || currentBanner.status === "warning") {
          return { msg: "", status: null };
        }

        return currentBanner;
      });

      return data.tier;
    } catch (error) {
      if (isReauthorizationInProgressError(error)) {
        scheduleReauthRecovery();
        return null;
      }

      if (!allowSoftFailure) {
        setServerTier(null);
        setBanner({
          msg:
            error instanceof Error
              ? error.message
              : "We couldn’t confirm your current plan.",
          status: "critical",
        });
      } else {
        setBanner({
          msg:
            error instanceof Error
              ? `${error.message} We’ll keep your previous plan selection visible while you retry.`
              : "We couldn’t confirm your current plan yet.",
          status: "warning",
        });
      }

      return null;
    } finally {
      setLoading((s) => ({ ...s, page: false }));
    }
  }

  useEffect(() => {
    const pendingPlan = getPendingPlan();

    const initialize = async () => {
      if (pendingPlan && !billingReturnState.isBillingReturn) {
        showResumeBanner(pendingPlan);
      }

      const tier = await refreshTier({
        allowSoftFailure: billingReturnState.isBillingReturn || !!pendingPlan,
      });

      if (billingReturnState.isBillingReturn) {
        clearBillingReturnParams();

        if (tier === "premium") {
          clearPendingBillingResume();
          setBanner({
            msg: "Premium billing approved. Your store is now on the Premium plan.",
            status: "success",
          });
          return;
        }

        clearPendingBillingResume();
        setBanner({
          msg:
            "We returned from Shopify billing, but Premium is not active yet. Review the approval result and try again if needed.",
          status: "warning",
        });
        return;
      }

      if (pendingPlan && !resumeAttemptedRef.current) {
        resumeAttemptedRef.current = true;

        try {
          setLoading((s) => ({ ...s, action: pendingPlan }));
          const result = await performPlanAction(pendingPlan, { silent: true });

          if (!result.redirected) {
            await refreshTier({ allowSoftFailure: true });
            setBanner({
              msg:
                pendingPlan === "premium"
                  ? "Premium plan restored after reauthorization."
                  : "Free plan restored after reauthorization.",
              status: "success",
            });
          }
        } catch (error) {
          if (!isReauthorizationInProgressError(error)) {
            clearPendingBillingResume();
            setBanner({
              msg:
                error instanceof Error
                  ? error.message
                  : "We couldn’t resume your plan change after reauthorization.",
              status: "critical",
            });
          }
        } finally {
          setLoading((s) => ({ ...s, action: null }));
        }
      }
    };

    initialize();

    return () => {
      clearReauthRecoveryTimeout();
    };
  }, []);

  const openConfirm = (plan) => {
    if (loading.page || loading.action || plan === selectedPlan || !selectedPlan) {
      return;
    }

    setConfirm({ open: true, target: plan });
  };

  const runConfirm = async () => {
    const plan = confirm.target;
    if (!plan || loading.page || loading.action) return;

    setConfirm({ open: false, target: null });
    setLoading((s) => ({ ...s, action: plan }));

    try {
      const result = await performPlanAction(plan);
      if (!result.redirected) {
        await refreshTier({ allowSoftFailure: true });
      }
    } catch (error) {
      if (!isReauthorizationInProgressError(error)) {
        clearPendingPlan();
        setBanner({
          msg:
            error instanceof Error
              ? error.message
              : "We couldn’t update your plan.",
          status: "critical",
        });
      }
    } finally {
      setLoading((s) => ({ ...s, action: null }));
    }
  };

  const isCurrent = (plan) => selectedPlan === plan;
  const hasResolvedPlan = selectedPlan === "free" || selectedPlan === "premium";

  const Feature = ({ children }) => (
    <Stack spacing="tight" alignment="center">
      {tick}
      <span style={{ fontSize: 14, color: promoMintColors.text }}>{children}</span>
    </Stack>
  );

  const cardStyle = (plan) => ({
    borderRadius: 20,
    border: isCurrent(plan)
      ? `2px solid ${promoMintColors.borderStrong}`
      : `1px solid ${promoMintColors.border}`,
    boxShadow: isCurrent(plan)
      ? `0 18px 45px ${promoMintColors.shadowStrong}`
      : `0 8px 24px ${promoMintColors.shadow}`,
    background:
      plan === "premium"
        ? `linear-gradient(180deg, #ffffff 0%, ${promoMintColors.indigoSoft} 100%)`
        : `linear-gradient(180deg, #ffffff 0%, ${promoMintColors.mintSoft} 100%)`,
    transform: isCurrent(plan) ? "translateY(-4px)" : "none",
    transition: "all 0.2s ease",
  });

  const currentBadge = {
    background: promoMintColors.indigo,
    color: "#fff",
    padding: "4px 12px",
    borderRadius: 999,
    fontSize: 12,
  };

  const popularBadge = {
    background: promoMintColors.mint,
    color: promoMintColors.text,
    padding: "4px 12px",
    borderRadius: 999,
    fontSize: 12,
  };

  const freeButtonStyle = promoMintStyles.secondaryButton;
  const premiumButtonStyle = promoMintStyles.primaryButton;
  const mutedTextStyle = { color: promoMintColors.mutedText };
  const pageIntroStyle = {
    color: promoMintColors.mutedText,
    marginBottom: 18,
  };
  const priceStyle = { fontSize: 34, color: promoMintColors.text };
  const sectionSpacingStyle = { marginTop: 14 };
  const actionSpacingStyle = { marginTop: 18 };
  const cardHeadingStyle = { color: promoMintColors.text };

  const planPageTitle = "Choose your PromoMint plan";
  const planIntro =
    "Pick the plan that matches how many coupon offers you want to feature on your product pages.";

  const pageContent = (
    <Layout>
      <Layout.Section oneHalf>
        <Card sectioned style={cardStyle("free")}>
          <Stack alignment="center" distribution="equalSpacing">
            <h2 style={cardHeadingStyle}>Free</h2>
            {isCurrent("free") && <span style={currentBadge}>Current</span>}
          </Stack>

          <h1 style={priceStyle}>$0</h1>
          <p style={mutedTextStyle}>A simple option for smaller catalogs</p>

          <Stack vertical spacing="loose" style={sectionSpacingStyle}>
            <Feature>Display coupon offers on product pages</Feature>
            <Feature>Show up to 3 active offers</Feature>
            <Feature>Adjust colors and layout</Feature>
            <Feature>Keep slider arrow navigation</Feature>
            <Feature>Support mobile-friendly browsing</Feature>
          </Stack>

          <div style={actionSpacingStyle}>
            <Button
              fullWidth
              style={freeButtonStyle}
              disabled={!hasResolvedPlan || isCurrent("free") || loading.page || !!loading.action}
              loading={loading.action === "free"}
              onClick={() => openConfirm("free")}
            >
              {isCurrent("free") ? "Active plan" : "Choose Free"}
            </Button>
          </div>
        </Card>
      </Layout.Section>

      <Layout.Section oneHalf>
        <Card sectioned style={cardStyle("premium")}>
          <Stack alignment="center" distribution="equalSpacing">
            <h2 style={cardHeadingStyle}>Premium</h2>
            {!isCurrent("premium") && (
              <span style={popularBadge}>Popular choice</span>
            )}
            {isCurrent("premium") && <span style={currentBadge}>Current</span>}
          </Stack>

          <h1 style={priceStyle}>${PRICE}</h1>
          <p style={mutedTextStyle}>
            More room for stores running multiple offers
          </p>

          <Stack vertical spacing="loose" style={sectionSpacingStyle}>
            <Feature>Display coupon offers on product pages</Feature>
            <Feature>Show up to 6 active offers</Feature>
            <Feature>Adjust colors and layout</Feature>
            <Feature>Keep slider arrow navigation</Feature>
            <Feature>Support mobile-friendly browsing</Feature>
          </Stack>

          <div style={actionSpacingStyle}>
            <Button
              fullWidth
              style={premiumButtonStyle}
              disabled={!hasResolvedPlan || isCurrent("premium") || loading.page || !!loading.action}
              loading={loading.action === "premium"}
              onClick={() => openConfirm("premium")}
            >
              {isCurrent("premium") ? "Premium is active" : "Choose Premium"}
            </Button>
          </div>
        </Card>
      </Layout.Section>
    </Layout>
  );

  return (
    <>
      <Modal
        open={confirm.open}
        onClose={() => setConfirm({ open: false, target: null })}
        accessibilityLabel="Plan change confirmation"
        title={
          confirm.target === "free"
            ? "Move to the Free plan?"
            : "Continue with Premium?"
        }
        primaryAction={{
          content:
            confirm.target === "free"
              ? "Confirm Free plan"
              : `Approve $${PRICE}/month`,
          onAction: runConfirm,
          loading: loading.action === confirm.target,
          disabled: !confirm.target || loading.page || !!loading.action,
        }}
      >
        <Modal.Section>
          <TextContainer>
            <p>
              {confirm.target === "free"
                ? "The Free plan supports up to 3 coupon offers."
                : "The Premium plan supports up to 6 coupon offers."}
            </p>
          </TextContainer>
        </Modal.Section>
      </Modal>

      <Page
        title={planPageTitle}
        subtitle={<div style={pageIntroStyle}>{planIntro}</div>}
      >
        {!!banner.msg && (
          <Banner
            status={banner.status}
            onDismiss={() => setBanner({ msg: "", status: null })}
          >
            {banner.msg}
          </Banner>
        )}

        {loading.page ? (
          <Banner status="info">
            We’re checking your current plan. You can still review the options
            below while that loads.
          </Banner>
        ) : null}

        {!loading.page && !hasResolvedPlan && !hasRecentReauthAttempt() ? (
          <Banner status="critical">
            We couldn’t confirm your current plan yet. Reopen the app from Shopify
            admin and try again.
          </Banner>
        ) : null}

        {pageContent}
      </Page>
    </>
  );
}
