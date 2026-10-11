# ADR-0002: Brand assets are hand-drawn SVG; image models only for exploration and raster-only outputs

Date: 2026-10-11 · Status: accepted

## Context

The first icon was generated with an image model from a one-line brief and came out as the stock "database
cylinder plus sparkle" that every AI data product uses. A three-way exploration sheet produced a better direction
("talking database": cylinder with a chat-bubble tail and one amber band). Image models also produce messy
transparent edges, so the bare mark and the wordmark lockups were unusable as rasters.

## Decision

- The source of truth is `assets/brand/icon.svg` (squircle + mark) and the two lockups `logo.svg` /
  `logo-dark.svg`, hand-drawn to match the chosen direction. Every platform icon is regenerated with
  `pnpm tauri icon assets/brand/icon.svg`, never edited by hand.
- Lockups embed the full icon tile rather than the bare white mark, so the mark keeps its own background on
  light pages.
- Image generation is used for exploration sheets (to pick a direction from pictures) and for opaque raster
  outputs such as the social square, where edge quality does not matter.

## Consequences

- One change to `icon.svg` propagates to all 19 icon sizes via `tauri icon`. The README lockups are separate
  files that embed a copy of the same tile, so a change to the mark is applied to `logo.svg` and `logo-dark.svg`
  by hand in the same commit.
- Any future rebrand starts with a contact sheet, not a single render.
