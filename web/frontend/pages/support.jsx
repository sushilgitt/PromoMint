import { Card, Layout, Page, TextContainer } from "@shopify/polaris";
import { promoMintColors, promoMintStyles, promoMintType } from "../brand";

export default function SupportPage() {
  return (
    <Page title="PromoMint Help">
      <Layout>
        <Layout.Section>
          <Card sectioned style={promoMintStyles.heroCard}>
            <TextContainer spacing="loose">
              <h2 style={{ ...promoMintType.sectionHeading, color: promoMintColors.text }}>
                Need a quick PromoMint check?
              </h2>
              <p style={{ ...promoMintType.blurb, color: promoMintColors.mutedText }}>
                Make sure the PromoMint Coupon Offers app block is added to
                the correct product template and that your offer wording and
                coupon codes are saved in the theme editor.
              </p>
              <p style={{ ...promoMintType.blurb, color: promoMintColors.mutedText }}>
                If your offers are not showing, review the product template
                changes, save again, and preview a live product page to confirm
                the block is visible.
              </p>
              <p style={{ ...promoMintType.blurb, color: promoMintColors.mutedText }}>
                If you are reviewing billing, open the Plans page to check your
                current option and compare available upgrades.
              </p>
            </TextContainer>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
