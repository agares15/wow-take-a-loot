# Wow's Take a Loot (PF2e & D&D 5e)

[![Support me on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/workshopofwonders)

A comprehensive loot, container, and merchant manager for **Foundry Virtual Tabletop** (compatible with **Foundry v12 – v14**), built for **Pathfinder 2e (`pf2e`)** and **D&D 5e (`dnd5e`)** in a single unified module.

Inspired by videogames party loot distribution and trading systems, it features real-time socket synchronization, d100 contested roll resolution, proximity-based manual looting, interactive containers, full-featured merchants with item identification, and more.

---

## 📋 Requirements & Compatibility

- **Foundry VTT**: v12 (minimum) — v14 (verified)
- **Supported Systems**:
  - **D&D 5e** (`dnd5e`)
  - **Pathfinder 2e** (`pf2e`)
- **Included Languages**: English (`en`) and Spanish (`es`)

---

## 🌟 Feature Guide

![Loot Distribution](https://c10.patreonusercontent.com/4/patreon-media/p/post/175325109/ed0f4c9a167f4c7188baa0a48eb3811a/eyJhIjoxLCJ3Ijo4MjB9/1.png?token-hash=R3NPRcrpndDSWr3ZWz13z38M9BWzx0FNpj97BvQYYoM%3D&token-time=1795910400)

### 1. Post-Combat Loot Distribution (GM Panel & Player Window)

When a combat encounter ends (`deleteCombat`), the module automatically detects defeated enemy combatants and opens the **Looter - GM Panel** for the Game Master:

- **Enemies**: Each defeated token is tracked here, allowing you to include or exclude them from the loot pool.
- **Eligible Players**: Choose which player characters will participate in the loot session.
- **Loot Pool**:
  - Automatically aggregates items and currencies from all selected enemies.
  - Supports **Drag & Drop** of additional **Actors**, individual **Items**, or **Rollable Tables** directly into the pool without posting roll cards to chat.
  - Allows the GM to manually adjust total currencies before sending.
- **Real-Time Synchronized Claiming**:
  - Clicking **"Send Loot to Players"** opens the synchronized window for all eligible participants.
  - Players click items they want to claim (displaying their character avatar on the item). When two or more players claim the same item, it is highlighted as **Contested**.
  - Each player can choose to **split currencies evenly** or **request a specific amount**.
- **Contested Roll Resolution (`d100`)**:
  - **Automatic mode** (default): Once everyone is ready (or the GM forces resolution), the module rolls `d100` for each contender, posts the results to chat, and awards the item to the highest roller.
  - **Manual mode** (configurable in settings): Posts an interactive chat card where each involved player (or the GM) clicks a button to roll their `d100` individually, plus a GM-only button to roll for everyone at once; the item can only be distributed after all contenders have rolled.

---

![Manual Looting](https://c10.patreonusercontent.com/4/patreon-media/p/post/175325109/27dab1f4b7c9489aa01cb89699f5e915/eyJhIjoxLCJ3Ijo4MjB9/1.png?token-hash=RnGUjfkvWbhEt1JQxwC7lgGrOmCBnYXZttIJAXCph5g%3D&token-time=1795910400)

### 2. Manual Looting, Containers & Token HUD

Using the coin-bag button on any token's **Token HUD**, the GM can configure per-instance behavior via **Loot Settings**:

- **Lootable**: Allows players to open that body or chest by double-clicking the token on the canvas (within the configured proximity range).
- **Require Death to Loot**: Configurable both globally and per actor instance; when enabled, players can only loot defeated NPCs (the GM can always inspect them).
- **Auto Lootable on Death**: Optionally marks NPCs as lootable automatically as soon as they die.
- **Interactive Containers**: Assign **closed** and **open** textures to chests, crates, or corpses so their canvas appearance updates automatically when opened or emptied.
- **Manual Loot Actions**: Take individual items, *"Take All"*, *"Take All Currency"*, or *"Split Currency with Party"*.

---

![Merchant System](https://c10.patreonusercontent.com/4/patreon-media/p/post/175325109/3fc96db9de6b4befa983e6e852388a90/eyJhIjoxLCJ3Ijo4MjB9/1.png?token-hash=LgP6el1RpWxcp_OxYVREGUTui1McnoFtZUH4GDNpXX0%3D&token-time=1795910400)

### 3. Merchant System

Turn any token or actor into a **Merchant** from its *Loot Settings*:

- **Available Tabs**:
  - **Buy**: Item catalog with search, category filter, sorting, buy price multiplier, stock controls (`+` / `-` and manual input), per-item visibility toggle (hide/show items from players), and Drag & Drop support for items and *Rollable Tables*.
  - **Sell**: Players can sell items from their inventory using the merchant's sell multiplier.
  - **Buyback**: Lets players repurchase items recently sold during the session.
  - **Identify**: Players can request identification for unidentified items. The button switches to an animated **Pending** state while the GM receives an approval dialog showing both the unidentified item and its identified reference details to set a custom price and **Approve** or **Reject**.
- **Custom Description**: The GM can edit the merchant's description; players only see a description once the GM saves a custom one.
- **Chat Cards**: Logs purchases, sales, buybacks, and identifications with the price paid.

---

### 4. Quick Canvas Loot Creation

- The GM can drag any **Item** from the sidebar or compendiums directly onto the canvas scene to automatically spawn a loot container token at the cursor's position with that item inside.

---

### 5. Custom Currencies & Rich Item Descriptions

- **Custom Currencies**: From module settings, the GM can create custom currencies with a name, abbreviation, copper conversion rate, and custom icon, integrated across loot distribution and merchants.
- **Enriched Descriptions**: All loot and merchant windows process item descriptions through `TextEditor.enrichHTML`, preserving **bold**, *italic*, `inline` code, content links, inline rolls, and native PF2e/D&D 5e action icons/glyphs.

---

## ⚙️ Module Settings

Under **Game Settings → Configure Settings → Wow's Take a Loot**:

| Setting | Description | Default |
| :--- | :--- | :--- |
| **Auto Open on Combat End** | Automatically opens the GM Panel when a combat with enemies ends. | `Enabled` |
| **Auto Lootable on Death** | Automatically marks NPCs as lootable when they die. | `Disabled` |
| **Proximity Distance** | Maximum distance (in grid squares) for players to open bodies or merchants. | `1.5` |
| **Announce Rolls in Chat** | Posts distribution results, rolls, and merchant transactions to chat. | `Enabled` |
| **Automatic Contested Rolls** | When enabled, `d100` contested rolls are automatic; otherwise resolved manually in chat. | `Enabled` |
| **Require Death to Loot** | Requires NPCs to be dead before players can loot them (also configurable per instance). | `Enabled` |
| **Custom Currencies** *(Menu)* | Manager to create, edit, or delete custom currencies. | — |
| **Report Bug** *(Menu)* | Opens a form to send bug reports directly via email. | — |

---

[![Support me on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/workshopofwonders)