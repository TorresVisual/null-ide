---
name: Null IDE
description: A near-black VS Code-native workbench with one sparing accent — the ∅ mark and nothing else performing.
colors:
  bg-canvas: "#181818"
  bg-editor: "#1F1F1F"
  bg-widget: "#202020"
  bg-overlay: "#222222"
  bg-control: "#313131"
  border: "#2B2B2B"
  border-control: "#3C3C3C"
  signal-blue: "#0078D4"
  signal-blue-hover: "#026EC1"
  link-blue: "#4daafc"
  text-primary: "#CCCCCC"
  text-secondary: "#9D9D9D"
  text-disabled: "#6E7681"
  success: "#2EA043"
  warning: "#CCA700"
  error: "#F85149"
typography:
  code:
    fontFamily: "'Geist Mono', 'JetBrains Mono', 'Cascadia Code', monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.65
  terminal:
    fontFamily: "'Geist Mono', 'JetBrains Mono', 'Cascadia Code', monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.3
  ui:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: "4px"
  md: "6px"
  lg: "10px"
spacing:
  xs: "6px"
  sm: "8px"
components:
  button-primary:
    backgroundColor: "{colors.signal-blue}"
    textColor: "#ffffff"
  button-primary-hover:
    backgroundColor: "{colors.signal-blue-hover}"
  button-secondary:
    backgroundColor: "{colors.bg-control}"
    textColor: "{colors.text-primary}"
  button-secondary-hover:
    backgroundColor: "{colors.border-control}"
  input-field:
    backgroundColor: "{colors.bg-control}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
  command-palette:
    backgroundColor: "{colors.bg-overlay}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
  activity-bar-icon:
    height: "36px"
    size: "20px"
  editor-tab-active:
    backgroundColor: "{colors.bg-editor}"
    textColor: "#ffffff"
---

# Design System: Null IDE

## Overview

**Creative North Star: "The Void Workbench"**

Null IDE is a VS Code fork with the ornament sanded off, not a new visual language bolted on. The chrome sits in near-black grays (#181818 down to #000000 on the OLED variant) with a single accent — Signal Blue (#0078D4), stock VS Code blue kept deliberately rather than replaced — used only where the UI needs to say "this is active, this is focused, this is progress." The mark itself, the ∅ symbol, is monochrome: white stroke on a near-black gradient badge, no color at all. Emptiness is the aesthetic, not an absence of polish.

This is a personal daily-driver, not a marketing surface — [PRODUCT.md](PRODUCT.md) is explicit that the only user who matters is the developer running it. That shows up as restraint everywhere: no gradients, no decorative color, no shadow except where a floating surface genuinely needs to separate itself from the canvas beneath it. The workbench stays close to upstream VS Code conventions on purpose — familiar control shapes, default paddings, standard iconography — with edits concentrated on density (30px tabs, 36px activity-bar rows, a 6px scrollbar) and on removing default chrome that competed with the content (the activity bar's left-edge active-indicator is explicitly hidden in favor of a centered highlight square).

Earlier project notes described a teal/indigo brand palette. That palette does not exist anywhere in the shipped theme, icon set, or workbench CSS — the real, implemented accent is VS Code blue, and the app icon is achromatic. This file documents what is actually built.

**Key Characteristics:**
- Near-black, borderless-feeling chrome with 1px dividers, never a filled panel-on-panel look
- One accent color, used sparingly for state (focus, active, progress, links) — never decoratively
- Monospace everywhere code or terminal output appears; system UI font everywhere else — the two never mix
- Flat by default; the command palette is the system's one deliberate floating, blurred surface
- A separate, wide semantic color set (9 hues) exists only inside the file/folder icon theme — it never bleeds into the UI accent

## Colors

Near-black neutrals carry almost the entire surface; Signal Blue is rationed to state, not decoration.

### Primary
- **Signal Blue** (#0078D4): The one UI accent. Focus rings, active tab top-border, editor cursor, progress bar, badges, primary buttons, selection tints (used at ~20–33% alpha), the active activity-bar item's border. If it's blue, it means "this is what's active or actionable right now."
- **Signal Blue Hover** (#026EC1): Hover/pressed state for primary buttons and the extension "Install" button.

### Secondary
- **Link Blue** (#4daafc): A lighter, cooler blue reserved for hyperlinks and the terminal's cyan — visually related to Signal Blue but never substituted for it in controls.

### Neutral
- **Void Black** (#000000 / #0a0a0a, OLED variant): True-black chrome and editor surface on the OLED theme.
- **Canvas Gray** (#181818): The chrome layer — activity bar, sidebar, panel, status bar, title bar. The resting background of the whole app.
- **Editor Gray** (#1F1F1F): One step lighter than Canvas Gray; the editor surface and the active tab, so open content reads as slightly "raised" out of the chrome without a shadow.
- **Widget Gray** (#202020) / **Overlay Gray** (#222222): Popovers, hover widgets, and the command palette background — reserved for surfaces that float above the editor.
- **Control Gray** (#313131): Inputs, dropdowns, checkboxes, secondary buttons.
- **Divider** (#2B2B2B): The only border color used for structural chrome dividers (sidebar edge, panel edge, tab row).
- **Control Border** (#3C3C3C): Borders on inputs, dropdowns, and secondary-button hover fill.
- **Primary Text** (#CCCCCC): Default foreground everywhere.
- **Secondary Text** (#9D9D9D): Descriptions, inactive tab labels, breadcrumbs.
- **Disabled Text** (#6E7681): Disabled controls, unfocused-inactive tab labels, line numbers.
- **Success** (#2EA043) / **Warning** (#CCA700) / **Error** (#F85149): Git/diff/diagnostic state only — never used as UI accent color.

### Named Rules
**The One Accent Rule.** Signal Blue is the only color allowed to mean "interactive" or "active." Success/warning/error are reserved for git and diagnostic state and must never be reused as a UI accent, and no second brand color (teal, indigo, or otherwise) gets introduced — the accent stays singular.

## Typography

**Code/Terminal Font:** Geist Mono, falling back to JetBrains Mono, then Cascadia Code, then generic monospace.
**UI Font:** System UI stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`).

**Character:** A working monospace for anything that is code or output, and the platform's own system font for surrounding chrome — no display face, no branded typeface performing "identity." The pairing exists to disappear.

### Hierarchy
- **Code** (400, 13px, line-height 1.65): Editor content. The generous line-height is deliberate — denser than most IDEs elsewhere, roomier here, because this is where the eyes live all day.
- **Terminal** (400, 13px, line-height 1.3): Terminal output — tighter line-height than the editor, matching how terminal text is actually read (scanned, not composed).
- **UI Label** (400, 12px): Sidebar, status bar, title bar, panels, quick input, menus, notifications — explicitly forced onto the system font even where VS Code's default would use the editor font.

### Named Rules
**The Two-Font Rule.** Exactly two font roles exist: monospace for code/terminal, system UI font for chrome. Nothing else — no serif, no display weight, no third face — is introduced anywhere in the workbench.

## Layout

The workbench keeps VS Code's default panel geometry (activity bar, sidebar, editor groups, bottom panel, status bar) and tightens density rather than restructuring it. Editor tabs are compressed to 30px (from VS Code's ~35px default) with a 30px line-height on the label. Activity-bar icon rows are 36px tall with an 8px top padding and an 8px gap between icons, each icon container centering a 20px codicon. Scrollbars are slimmed to 6px in both directions. The secondary side bar (AI Agents panel) defaults to hidden, and the minimap is off by default — screen space goes to code and terminal, not to chrome.

## Elevation & Depth

The workbench is flat at rest: every surface separates from its neighbor with a 1px Divider border (#2B2B2B), never a shadow. Sash resize handles are invisible until hovered, appearing only as a thin Signal Blue line — depth cues are earned by interaction, not present by default.

### Shadow Vocabulary
- **Command Palette Float** (`box-shadow: 0 12px 40px rgba(0,0,0,0.55)` + `backdrop-filter: blur(20px)`): The one surface in the system that floats — used because the quick-input widget is a transient overlay, not a permanent panel.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest, separated only by 1px Divider borders. The command palette is the system's single deliberate exception, justified because it's an ephemeral overlay, not a docked panel — no other surface should adopt its shadow/blur treatment.

## Shapes

Corners are modest and functional, not a design statement: 10px on the command palette (the largest radius in the system, matching its status as the one floating surface), 6px on selection/hover highlight squares in the activity bar and editor-actions toolbar, 4px on quick-input list rows and input fields. The app icon itself uses a 22%-of-viewBox corner radius on its dark gradient badge. The ∅ mark is built from two primitives at fixed proportions — a stroked circle (r=27, stroke-width 7) and a 45°-diagonal stroke of the same weight, both round-capped — a precise geometric construction, not a hand-drawn glyph.

## Components

### Buttons
- **Shape:** VS Code's default control radius; no custom radius override in workbench CSS.
- **Primary:** Signal Blue background (#0078D4), white text. Hover darkens to #026EC1.
- **Secondary:** Control Gray background (#313131), Primary Text (#CCCCCC). Hover lightens to Control Border (#3C3C3C).

### Command Palette (signature)
The most customized surface in the workbench. Overlay Gray background (#222222), 10px radius, 1px `rgba(255,255,255,0.08)` border, 20px backdrop blur, and the system's only drop shadow. Rows and the filter input get their own inner 4–6px radii so the frosted-glass container reads as one continuous rounded shape.

### Activity Bar Icons (signature)
Icon glyphs render as translucent white at 55% opacity, brightening to 95% on hover or when checked — color communicates state, not hue. The default VS Code left-edge active-indicator is explicitly removed; instead, the checked/hovered icon gets a centered 34px rounded-square highlight at `rgba(255,255,255,0.10)`, so selection reads as a soft halo behind the glyph rather than a bar beside it.

### Editor Tabs
- **Height:** 30px, denser than VS Code's default.
- **Active tab:** Editor Gray background, white text, 2px Signal Blue top border.
- **Inactive tab:** Canvas Gray background, Secondary Text.
- **Close button:** Hidden until the tab is hovered or active (0.15s opacity transition) — no permanent close-button clutter on inactive tabs.

### Inputs / Fields
- **Style:** Control Gray background, Control Border stroke, 4–6px radius depending on context (quick-input filter vs. standard input box).
- **Focus:** 1px Signal Blue outline, offset -1px so it sits inside the control edge rather than floating outside it.

### File/Folder Icon Theme
A deliberately separate, wide semantic palette — Tailwind-scale blue, green, orange, pink, purple, red, sky, and yellow, plus a slate-gray (#64748B) base — used only to color-code folder purpose (e.g. `folder-database`, `folder-auth`, `folder-config`) in the sidebar. This palette never appears in the workbench UI itself; it is the one place in the system where hue is allowed to carry meaning beyond the single Signal Blue accent.

## Do's and Don'ts

### Do:
- **Do** treat Signal Blue (#0078D4) as the only UI accent — focus, active, progress, links, primary actions.
- **Do** keep code/terminal on the monospace stack and chrome on the system UI font; never let one bleed into the other's surfaces.
- **Do** keep new surfaces flat with a 1px Divider border; reserve shadow + blur for genuinely transient floating overlays, matching the command palette's justification.
- **Do** color folder/file icons only from the established 9-hue semantic set on the slate-gray base — don't invent a new hue for a new folder pattern.

### Don't:
- **Don't** introduce teal or indigo (or any second brand color) as a UI accent — despite older project notes, nothing in the shipped theme, icon set, or workbench CSS uses them; the mark itself is monochrome.
- **Don't** restore VS Code's default left-edge activity-bar active-indicator — it's deliberately replaced by the centered rounded-square highlight.
- **Don't** add drop shadows to docked, permanent panels (sidebar, bottom panel, status bar) — shadow is reserved for the command palette's transient-overlay case.
