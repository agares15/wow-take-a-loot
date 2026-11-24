# Changelog

All notable changes to **Wow's Take a Loot** will be documented in this file.

## [0.8.3] - 2026-11-23

### Added
- **Item Descriptions — Trait & Property Tags:** Automatically extracts and renders item tags (PF2e rarity & traits; D&D 5e rarity, subtype, and properties) at the top of item descriptions across all loot and merchant windows.
- **Ammunition Quantity Prompt:** Dragging ammunition into loot or merchant windows opens a quantity prompt (default `x10`) and normalizes ammunition into individual units (`10` units instead of `1` bundle of 10).
- **Compact Quantity Stepper (`+` / `-`):** Added `+` and `-` buttons flanking a compact quantity input box in **Manual Loot** and **Loot Distribution**, supporting `Shift+Click` (`±5`) and `Alt+Click` (`±10`).
- **GM Live Item Quantity Editing:** The GM can now edit the quantity of any item directly in **Manual Loot** and **Loot Distribution - GM Panel**.
- **Universal Identical Item Stacking:** Identical items (same name and type) are now automatically consolidated and stacked across **Manual Loot**, **Loot Distribution**, and character inventories.
- **Manual Loot — Currency Section & `+ Add Money`:** Renamed the money section to `Currency` (`Monedas` in Spanish), hid 0-value currencies, and added a GM-only `+ Add Money` dialog to add any currency type and amount.
- **Loot Settings — Instant Window Switching:** Saving changes in **Loot Settings** now immediately swaps between **Manual Loot** and **Merchant** when the loot type changes, without having to close and reopen windows manually.
- **Merchant — Empty State Alignment & Tab Icons:** Centered the empty state horizontally and vertically inside the merchant items container and matched each tab's empty state icon and message (*Buy*, *Sell*, *Buyback*, *Identify*).
- **Scroll Position Preservation:** Preserved the items list scroll position across re-renders when editing quantities or claiming items in **Manual Loot**, **GM Loot Panel**, and **Loot Distribution**.
- **GM Item Sheet Edit Button:** Added an edit icon on every item row (GM only) across **Manual Loot**, **GM Loot Panel**, **Loot Distribution**, and **Merchant** to open the system item sheet directly.
- **Merchant — Per-Item Settings:** Added a per-item settings icon for the GM in **Merchant** with options for *Infinite Quantity*, *Keep When Sold Out* (disables Buy and shows *Sold Out*), *Is Service* (charges without granting the item), per-item *Price Modifier*, *Is Free* (shows *Free*), and *Set Custom Price* (supporting both standard and custom currencies).
- **Manual Loot — GM Delete Item Button:** Added a trash button on each item row (visible only to the GM) to delete items directly from the manual loot window.
- **Manual Loot — Player & GM Character Sheet Drag & Drop:** Fixed drag & drop from character sheets for both players and GMs (supporting `uuid` and `actorId`/`itemId` payloads); when dragging a multi-unit stack from an inventory, a slider dialog (default `x1`) asks how many units to deposit.
- **Loot Distribution — Stack Quantity Selection:** Players can now choose how many units of a multi-quantity item they want using the compact `-` / `+` stepper before or after claiming.

### Fixed
- **Loot Distribution — GM Extra Currency Persistence:** Fixed an issue where manually added/edited currencies in **Loot Distribution - GM Panel** were not persisted when sending the loot to players, causing the currency distribution section to disappear.
- **Loot Distribution — Selected Players Only in Money Split:** Ensured that currency distribution only counts the characters selected in the **Loot Distribution** window, excluding unselected characters.

## [0.8.2] - 2026-11-15

### Fixed
- **Manual Loot — Player Access on `loot` and `container` Tokens:** Wrapped `Token.prototype._canView` (and updated `mouseInteractionManager.permissions.clickLeft2`) for visible lootable tokens so players can double-click and open **Manual Loot** even when the underlying Actor has `NONE` ownership.
- **Manual Loot — GM Currency Editing:** Fixed an `ApplicationV2` `data-action` click conflict on the currency `<input>` fields that caused them to lose focus on mouseup.
- **Manual Loot — Header Avatar Sizing:** Added explicit `46×46` dimensions on the avatar element to prevent oversized rendering when a client has stale cached CSS.
- **Manual Loot — Drag & Drop Duplicate Items:** Guarded `_attachDropHandler` against binding duplicate `drop` listeners across re-renders (plus an in-flight drop lock).
- **Manual Loot — Items List Overflow & Scrolling:** Added `flex-shrink: 0` on `.manual-item-row` and `overflow-x: hidden; overflow-y: auto;` on `.manual-loot-list` so overflowing items scroll cleanly instead of overlapping.
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


