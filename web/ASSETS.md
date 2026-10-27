# Real photography

No AI-generated photographs or illustrations are included. The current family-facing pages use photographs documented as taken in the Philippines. Nationality is not inferred from appearance.

| Asset | Photographer and original | License |
| --- | --- | --- |
| dist/assets/philippines-mother-baby.webp and small variant | [Zachary Angeles — Mother holding baby on a Manila street](https://www.pexels.com/photo/asia-fujifilm-street-photo-street-photography-27848687/), published 18 August 2024; source lists Manila, Philippines and Fujifilm X-T3 | [Pexels License](https://www.pexels.com/license/) |
| dist/assets/philippines-mother-child.webp and small variant | [Sharmaine Monticalbo — Mother and child in Cagayan Valley](https://www.pexels.com/photo/mother-and-child-overlooking-cagayan-valley-view-29698711/), published 9 December 2024; source lists Cagayan Valley, Philippines and Fujifilm X-T30 II | [Pexels License](https://www.pexels.com/license/) |

Sources and licenses checked 19 October 2026. Images were cropped, resized and compressed to WebP with ordinary image processing. No generative processing was used. The people pictured are illustrative, not represented as patients or endorsers. Photography credits are accessible in the website footer in either language. The large variants and lighter mobile variants are hosted with the app and included in its public offline cache; no external photo CDN is needed during use.

The existing e-nay-social-red-v1.jpg is retained for old shared links only. It uses the previously credited [Bethany Beck / Unsplash photo](https://unsplash.com/photos/woman-carrying-baby-during-daytime-I0p_LTtA9yI) under the [Unsplash License](https://unsplash.com/license). It is not referenced by current share metadata or cached offline. The former page-photo variants are removed.

## Interface reference and typography

Design direction adapted from [Asklepios UI Kit](https://www.figma.com/community/file/1334783556016489959/asklepios-ui-kit-ai-healthcare-wellness-app) by strangehelix.bio, using the user-supplied Hygieia Red palette. The public community page lists CC BY 4.0. See DESIGN_SYSTEM.md for implementation details.

Plus Jakarta Sans by Tokotype comes from the official Google Fonts source under SIL OFL 1.1. The local font and complete license are included in dist/assets/. Icons and decorative motifs are code-native SVG. The phone illustration is HTML/CSS with explicitly fictional records.

## Social link preview

assets/e-nay-social-ph-v2.jpg is a 1200×630 card rendered from code-native HTML, E-Nay branding, the local font and the Zachary Angeles photograph above. It includes welcoming English/Filipino wording. Rebuild with node scripts/build-social-card.mjs from web/ after installing the existing Playwright development dependency. Open Graph and Twitter metadata reference this versioned card. Messaging platforms may retain already-cached or already-sent previews.
