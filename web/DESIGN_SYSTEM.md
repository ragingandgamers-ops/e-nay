# E-Nay design system

Reference: [asklepios UI Kit: AI Healthcare & Wellness App](https://www.figma.com/community/file/1334783556016489959/asklepios-ui-kit-ai-healthcare-wellness-app), by strangehelix.bio. The public community preview was inspected. This implementation adapts its bold sans typography, rounded component shapes, outline icons, neutral surfaces and healthcare dashboard hierarchy to E-Nay. It does not redistribute the kit's source library or import its AI product features. The community page lists CC BY 4.0.

The Hygieia Red palette was supplied by the user. All ten stops are defined in dist/tokens.css: 10 #FFF1F3, 20 #FFD7DD, 30 #FFB3BD, 40 #FF8391, 50 #FA4D5E, 60 #DA1B2E, 70 #A21922, 80 #750E13, 90 #520407, 100 #2D0708. Stop 60 is the accessible filled control color; 50 is used for decorative accents and 10/20 for pale surfaces/borders. Status badges retain distinct success/warning/error meanings and text labels.

Plus Jakarta Sans by Tokotype is hosted locally as a variable TTF, licensed under SIL OFL; the full license is in dist/assets/Plus-Jakarta-Sans-OFL.txt. It loads once and is included in the verified offline shell. No remote font/CDN request is required at runtime. No AI-generated images are used. The existing real licensed mother/child photography is preserved; see ASSETS.md.

Components share primary/hover/text/surface/border/status tokens, a 4-pixel spacing scale, radii from 10 to 32 pixels and subtle card/float shadows. dist/styles.css retains the responsive layout and behavioral styles; dist/design-system.css applies the shared component appearance. dist/icons.mjs provides small code-native outline icons. Existing data, role permissions, import recovery and motion preferences remain active.

Design verification covers actual computed palette/font loading, readable primary/status text contrast, active navigation and all phone/desktop workflows. Mobile tables become compact cards; forms use 16px inputs on phones to prevent iOS focus zoom. Physical Safari has not been independently tested.

## Language and Philippine context

The English interface keeps Filipino greetings and short supportive phrases. The English / Filipino control is available on every screen and inside dialogs. The Filipino interface uses familiar local wording and retains common borrowed terms such as account, offline, backup and health worker. Longer text wraps on mobile; medical units and IDs remain canonical. Literal UI annotations allow in-place language changes without rebuilding forms or translating personal data.

Real photographs documented as taken in Manila and Cagayan Valley replace the former page photographs. ASSETS.md records photographer credits, licenses and processing. The versioned share card uses the same new Manila photograph. No AI-generated images are used.
