// PromoMint design tokens.
//
// The palette is built around Shopify Polaris' own primary green (#008060), so
// the app reads as native inside Shopify admin and the green success ticks in
// the plan cards stop clashing with the surrounding chrome. Every foreground
// token below clears WCAG AA (4.5:1) against the surface it is used on.
//
// IMPORTANT: Polaris' <Card>, <Button> and <Stack> IGNORE a `style` prop — they
// do not forward it to the DOM. Anything here that is meant to be seen must be
// applied to a plain element (a wrapping <div>, <p>, <span>, heading, ...).

const primary = "#008060";
const primaryDark = "#004c3f";
const primaryDarker = "#003d33";

export const promoMintColors = {
  // --- semantic names (prefer these) ---
  primary,
  primaryDark,
  primaryDarker,
  accent: "#b7ecd8",
  accentSoft: "#e3f7ee",
  surface: "#ffffff",
  surfaceSoft: "#f4fbf8",

  text: "#1a1f1d",
  // 5.6:1 on white, 5.0:1 on surfaceSoft.
  mutedText: "#55655f",
  onPrimary: "#ffffff",

  border: "#d4e6de",
  borderStrong: primary,

  shadow: "rgba(0, 77, 63, 0.10)",
  shadowStrong: "rgba(0, 77, 63, 0.20)",

  // --- legacy aliases ---
  // Older pages (index, support, Coupons, NotFound) import these names. They
  // now resolve to the green palette so the whole app shifts together instead
  // of leaving those pages on the old brown scheme.
  indigo: primary,
  indigoDark: primaryDark,
  indigoSoft: "#e3f7ee",
  mint: "#b7ecd8",
  mintSoft: "#f4fbf8",
};

// Type scale. Polaris sets a FIXED px line-height on body copy, so any font
// size we set inline MUST carry its own lineHeight or the glyphs overflow their
// line box and collide with the next element. That is exactly what made the
// plan prices ($0 / $19 / $190) overlap the text beneath them.
export const promoMintType = {
  price: {
    fontSize: 36,
    lineHeight: 1.15,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    margin: 0,
  },
  cadence: {
    fontSize: 13,
    lineHeight: 1.4,
    fontWeight: 500,
    margin: 0,
  },
  sectionHeading: {
    fontSize: 20,
    lineHeight: 1.35,
    fontWeight: 650,
    margin: "0 0 4px",
  },
  cardHeading: {
    fontSize: 17,
    lineHeight: 1.4,
    fontWeight: 650,
    margin: 0,
  },
  blurb: {
    fontSize: 14,
    lineHeight: 1.5,
    margin: 0,
  },
  feature: {
    fontSize: 14,
    lineHeight: 1.45,
  },
  badge: {
    fontSize: 12,
    lineHeight: 1.5,
    fontWeight: 600,
  },
};

export const promoMintStyles = {
  appFrame: {
    minHeight: "100vh",
    background: `linear-gradient(180deg, ${promoMintColors.accentSoft} 0%, ${promoMintColors.surfaceSoft} 30%, #ffffff 100%)`,
    color: promoMintColors.text,
  },
  heroCard: {
    borderRadius: 16,
    border: `1px solid ${promoMintColors.border}`,
    boxShadow: `0 10px 28px ${promoMintColors.shadow}`,
    background: `linear-gradient(135deg, #ffffff 0%, ${promoMintColors.surfaceSoft} 100%)`,
  },
  accentCard: {
    borderRadius: 16,
    border: `1px solid ${promoMintColors.border}`,
    boxShadow: `0 8px 22px ${promoMintColors.shadow}`,
    background: promoMintColors.surface,
  },
  primaryButton: {
    background: `linear-gradient(135deg, ${promoMintColors.primary} 0%, ${promoMintColors.primaryDark} 100%)`,
    color: promoMintColors.onPrimary,
    border: "none",
    fontWeight: 600,
  },
  secondaryButton: {
    background: promoMintColors.accentSoft,
    color: promoMintColors.primaryDarker,
    border: `1px solid ${promoMintColors.borderStrong}`,
    fontWeight: 600,
  },
};
