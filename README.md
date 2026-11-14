# Wow's Take a Loot (PF2e & D&D 5e)

A comprehensive loot, container, and merchant manager for **Foundry Virtual Tabletop** (compatible with **Foundry v12 – v14**), built for **Pathfinder 2e (`pf2e`)** and **D&D 5e (`dnd5e`)** in a single unified module.

Inspired by *World of Warcraft*'s party loot distribution and trading systems, it features real-time socket synchronization, `d100` contested roll resolution, proximity-based manual looting, interactive containers, full-featured merchants with item identification, and custom currencies.

---

## 📋 Requirements & Compatibility

- **Foundry VTT**: v12 (minimum) — v14 (verified)
- **Supported Systems**:
  - **D&D 5e** (`dnd5e` >= `3.0.0`)
  - **Pathfinder 2e** (`pf2e` >= `5.0.0`)
- **Included Languages**: English (`en`) and Spanish (`es`)

---

## 🌟 Feature Guide

### 1. Post-Combat Loot Distribution (GM Panel & Player Window)

When a combat encounter ends (`deleteCombat`), the module automatically detects defeated enemy combatants and opens the **Looter - GM Panel** for the Game Master:

- **Enemies & Duplicates**: Each defeated token is tracked as a separate instance in the enemy counter (even if there are multiple duplicate tokens of the same actor), allowing you to include or exclude each body individually.
- **Eligible Players**: Choose which player characters will participate in the loot session.
- **Loot Pool**:
  - Automatically aggregates items and currencies from all selected enemies.
  - Supports **Drag & Drop** of additional **Actors**, individual **Items**, or **Rollable Tables** directly into the pool without posting roll cards to chat.
  - Allows the GM to manually adjust total currencies before sending.
- **Real-Time Synchronized Claiming**:
  - Clicking **"Send Loot to Players"** opens the synchronized window for all eligible participants via sockets.
  - Players click items they want to claim (displaying their character avatar on the item). When two or more players claim the same item, it is highlighted as **Contested**.
  - Each player can choose to **split currencies evenly** or **request a specific amount**.
- **Contested Roll Resolution (`d100`)**:
  - **Automatic mode** (default): Once everyone is ready (or the GM forces resolution), the module rolls `d100` for each contender, posts the results to chat, and awards the item to the highest roller.
  - **Manual mode** (configurable in settings): Posts an interactive chat card where each involved player (or the GM) clicks a `d20` button to roll their `d100` individually, plus a GM-only button to roll for everyone at once; the item can only be distributed after all contenders have rolled.

---

### 2. Manual Looting, Containers & Token HUD

Using the coin-bag button on any token's **Token HUD**, the GM can configure per-instance behavior via **Loot Settings**:

- **Lootable**: Allows players to open that body or chest by double-clicking the token on the canvas (within the configured proximity range).
- **Require Death to Loot**: Configurable both globally and per actor instance; when enabled, players can only loot defeated NPCs (the GM can always inspect them).
- **Auto Lootable on Death**: Optionally marks NPCs as lootable automatically as soon as they die.
- **Interactive Containers**: Assign **closed** and **open** textures to chests, crates, or corpses so their canvas appearance updates automatically when opened or emptied.
- **Manual Loot Actions**: Take individual items, *"Take All"*, *"Take All Currency"*, or *"Split Currency with Party"*.

---

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

## 🧩 Public API (Macros)

The module exposes an API at `game.modules.get("wow-take-a-loot").api`:

```js
const wowLooter = game.modules.get("wow-take-a-loot").api;

// Open the GM Panel with an optional list of enemy actors/tokens
wowLooter.openGmLootApp(enemies);

// Open the Manual Loot window for a target token
wowLooter.openManualLoot(targetToken);

// Open the Merchant window
wowLooter.openMerchantApp({ targetToken, lootingToken });

// Open the Custom Currencies manager
wowLooter.openCustomCurrenciesApp();
```

---

## 📦 Module Structure

```text
wow-take-a-loot/
├── module.json                          # Manifest and compatibility (v12–v14)
├── README.md                            # Module documentation
├── languages/
│   ├── en.json                          # English localization
│   └── es.json                          # Spanish localization
├── styles/
│   └── wow-looter.css                   # Window, HUD, and chat card styles
├── templates/
│   ├── custom-currencies.hbs            # Custom currencies template
│   ├── gm-loot.hbs                      # GM Panel template
│   ├── loot-settings.hbs                # Per-instance/token settings template
│   ├── manual-loot.hbs                  # Manual loot template
│   ├── merchant.hbs                     # Merchant template
│   ├── player-loot.hbs                  # Player loot selection template
│   └── report-bug.hbs                   # Bug report template
└── scripts/
    ├── constants.js                     # IDs, flags, settings, and socket events
    ├── module.js                        # Settings registration, hooks, and public API
    ├── adapters/
    │   ├── base-adapter.js              # Base system adapter interface
    │   ├── dnd5e-adapter.js             # D&D 5e adapter
    │   ├── pf2e-adapter.js              # Pathfinder 2e adapter
    │   └── index.js                     # Dynamic adapter selector
    ├── apps/
    │   ├── custom-currencies-app.js     # Custom currencies manager
    │   ├── gm-loot-app.js               # GM loot panel application
    │   ├── loot-settings-app.js         # Per-token/actor settings (lootable/merchant/chest)
    │   ├── manual-loot-app.js           # Proximity manual loot window
    │   ├── merchant-app.js              # Merchant window (buy/sell/buyback/identify)
    │   ├── player-loot-app.js           # Synchronized player loot window
    │   └── report-bug-app.js            # Bug report form
    ├── features/
    │   ├── canvas-drop.js               # Drop items onto canvas to spawn containers
    │   ├── combat-listener.js           # Combat end detection
    │   ├── death-listener.js            # NPC death detection
    │   └── token-hud.js                 # Token HUD button, double-click, and socket listeners
    ├── services/
    │   ├── chat-announcer.js            # Loot and contested roll chat cards
    │   ├── currency-service.js          # Currency conversion and transfers
    │   ├── loot-session.js              # Loot session lifecycle and d100 rolls
    │   ├── merchant-service.js          # Merchant transactions and identification
    │   └── socket-service.js            # Client-server socket communication
    └── utils/
        ├── container-helpers.js         # Open/closed container texture helpers
        └── dom-helpers.js               # Dropdown protection and HTML enrichment
```
