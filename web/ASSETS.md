# Real photography

No AI-generated photographs or illustrations are included in this website.

| Asset | Photographer and original | License |
| --- | --- | --- |
| `dist/assets/mother-baby.webp` and `mother-baby-small.webp` | [Bethany Beck — woman carrying baby during daytime](https://unsplash.com/photos/woman-carrying-baby-during-daytime-I0p_LTtA9yI), published 9 April 2021, camera listed as Canon EOS 6D | [Unsplash License](https://unsplash.com/license) |
| `dist/assets/mother-child.webp` and `mother-child-small.webp` | [Helena Lopes — mother and baby smiling outdoors](https://www.pexels.com/photo/mother-and-baby-smiling-outdoors-27176239/), original capture listed as 21 August 2021, Canon EOS 6D | [Pexels License](https://www.pexels.com/license/) |

Sources and licenses checked 18 October 2026. Images were resized and compressed to WebP without generative processing. Desktop variants total 72,356 bytes; small variants total 26,388 bytes. The people pictured are illustrative, not represented as patients or endorsers. Photography credits are accessible in the website footer.

`icon.svg` is a code-drawn heart/leaf mark. PNG installation icons use the same simple geometric motif. The phone preview is HTML/CSS with explicitly fictional sample records; it is not a photograph or a screenshot of real patients. The live workspace starts empty.

No third-party web font, icon library, analytics script, image CDN, or runtime JavaScript dependency is requested by the website. Photos and app assets are hosted with the app and included in its offline cache.

## Interface reference and typography

Design direction adapted from [asklepios UI Kit](https://www.figma.com/community/file/1334783556016489959/asklepios-ui-kit-ai-healthcare-wellness-app) by strangehelix.bio, using the Hygieia Red palette provided by the user. The public community page lists CC BY 4.0. See DESIGN_SYSTEM.md for implementation details.

Plus Jakarta Sans by Tokotype is distributed from the official Google Fonts source under SIL OFL 1.1. The local font and complete license are included in dist/assets/. PWA icons and interface outline icons are code-native SVG; existing photography remains unchanged.

## Social link preview

assets/e-nay-social-red-v1.jpg is a 1200×630 card rendered from code-native HTML, E-Nay branding, local Plus Jakarta Sans and the existing Bethany Beck/Unsplash mother-and-baby photo credited above. No generated photography is used. Rebuild with node scripts/build-social-card.mjs from web/ after installing the existing Playwright development dependency. Open Graph and Twitter metadata in index.html reference this separate card. Messaging platforms may retain previously cached or already-sent previews.
