# Kasa visual style sheet

## Foundation

- **Primary:** Indigo `#444E94`; hover `#353D7A`; tint `#ECEEF8`.
- **Accent:** Salmon `#DB7679` for art, shapes and markers; tint `#FDEFEF`; text-safe salmon `#A63F44`.
- **Surfaces:** White `#FFFFFF`; warm canvas `#FFF8F7`; subtle surface `#F2F3FA`.
- **Text:** Heading `#1F2347`; body `#4A5070`; muted `#5C6283`.
- **Status:** Green `#15803D`, amber `#B45309`, red `#B91C1C`, always paired with an icon or words.

## Type and spacing

- System sans-serif stack for fast, native rendering.
- Display: `40–72px`; page title: `28–43px`; section title: `29–44px`; card title: `18px`; body: `16px`; supporting: `12–14px`.
- Spacing scale: `4, 8, 12, 16, 24, 32, 48px`.
- Minimum interactive target: `44px`.

## Shape and depth

- Controls: `8–14px` radius.
- Cards: `16–20px` radius.
- Feature/hero art: `24–42px` radius.
- Dialogs: `16px` radius.
- Card shadow: `0 14px 34px rgba(31,35,71,.08)` plus a subtle close shadow.

## Components

- **Primary button:** Indigo fill, white label, 44px minimum height, clear darker hover.
- **Secondary button:** White fill, visible gray-indigo border, dark label.
- **Cards:** White, fine cool border, restrained shadow, generous padding.
- **Chips:** Pill shape, tinted background, semibold 12px label.
- **Rows:** 52px minimum, separator or bounded card, full-row hover and focus.
- **Progress:** Rounded track; green normal, amber over-budget, always accompanied by written status.
- **Calendar cells:** Fine grid borders, indigo today/selection treatment, category icon plus tint.
- **Icons:** One 24px rounded-stroke family; never use color as the only meaning.
- **Illustration:** Simple geometric homes and people; indigo structure, salmon highlights, white space, softly rounded shapes.

## Responsive behavior

- Desktop content targets about `1280px`, with 1116px working width.
- Phone design targets `390px` and remains usable at `360px`.
- Welcome sections stack; dashboard tiles reduce from four to two to one column.
- Product shell keeps the desktop sidebar and phone bottom bar with centered Add action.
