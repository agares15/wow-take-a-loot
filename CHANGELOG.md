# Changelog

All notable changes to **Wow's Take a Loot** will be documented in this file.

## [0.8.2] - 2026-11-15

### Fixed
- **Manual Loot — Player Access on `loot` and `container` Tokens:** Wrapped `Token.prototype._canView` (and updated `mouseInteractionManager.permissions.clickLeft2`) for visible lootable tokens so players can double-click and open **Manual Loot** even when the underlying Actor has `NONE` ownership.
- **Manual Loot — GM Currency Editing:** Fixed an `ApplicationV2` `data-action` click conflict on the currency `<input>` fields that caused them to lose focus on mouseup.
- **Manual Loot — Header Avatar Sizing:** Added explicit `46×46` dimensions on the avatar element to prevent oversized rendering when a client has stale cached CSS.
- **GM Loot Panel — Missing Ammunition:** Added `ammo` (and `backpack` for 5e) to the lootable item types in the PF2e and D&D 5e adapters so arrows and ammunition appear in the **Loot Pool**.
- **Merchant — "Your Funds" Custom Currencies:** Updated `MerchantApp` to resolve currency icons and abbreviations via `currencyService.getCurrencyMetadata` instead of falling back to the default GP icon.

### Added
- **GM Loot Panel — Drag & Drop Player Characters:** Added Drag & Drop support to the **Player Characters** list so the GM can manually add extra characters (restricted strictly to player-owned characters, with a localized warning for NPCs or unowned actors).
- **GM Loot Panel — Item Source Tooltip:** Hovering over any item in the **Loot Pool** now displays its origin (`From [enemy name]` / `De [enemy name]`).
- **Custom Currencies — Abbreviations:** Added an abbreviation input field (max. 4 characters, e.g. `GP` for Gold Coins) with helper text in the **Custom Currencies** window, used across all loot and merchant interfaces.

### Changed
- **GM Loot Panel — Combat-Only Player Characters:** After combat ends, the **Player Characters** list now initializes only with player-owned characters who participated in that battle instead of all player characters in the world.
- **Manual Loot — Token Header Avatar:** The header now uses the token instance texture and automatically scales/centers visible (non-transparent) pixels to fill the `46×46` borderless container without overflowing.
- **Module Settings — Default Change:** `Require NPCs to be dead to loot` is now disabled (`false`) by default.


