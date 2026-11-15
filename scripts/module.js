import { MODULE_ID, SETTINGS, SOCKET_EVENTS } from "./constants.js";
import { socketService } from "./services/socket-service.js";
import { getSystemAdapter } from "./adapters/index.js";
import { registerCombatListener } from "./features/combat-listener.js";
import { registerDeathListener } from "./features/death-listener.js";
import { registerCanvasDropHandler } from "./features/canvas-drop.js";
import { registerTokenHud, _tryOpenManualLoot, _wrapTokenDoubleClick } from "./features/token-hud.js";
import { GmLootApp } from "./apps/gm-loot-app.js";
import { PlayerLootApp } from "./apps/player-loot-app.js";
import { CustomCurrenciesApp } from "./apps/custom-currencies-app.js";
import { ReportBugApp } from "./apps/report-bug-app.js";
import { MerchantApp } from "./apps/merchant-app.js";
import { lootSessionManager } from "./services/loot-session.js";
import { currencyService } from "./services/currency-service.js";
import { merchantService } from "./services/merchant-service.js";

// Inicialización de Foundry
Hooks.once("init", () => {
  console.log(`[${MODULE_ID}] Inicializando Wow's Take a Loot para Foundry V14...`);

  // Registrar Ajustes del Módulo
  game.settings.register(MODULE_ID, SETTINGS.AUTO_OPEN_COMBAT, {
    name: "WOW_LOOTER.Settings.AutoOpenCombatName",
    hint: "WOW_LOOTER.Settings.AutoOpenCombatHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.AUTO_LOOTABLE_ON_DEATH, {
    name: "WOW_LOOTER.Settings.AutoLootableOnDeathName",
    hint: "WOW_LOOTER.Settings.AutoLootableOnDeathHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, SETTINGS.PROXIMITY_DISTANCE, {
    name: "WOW_LOOTER.Settings.ProximityDistanceName",
    hint: "WOW_LOOTER.Settings.ProximityDistanceHint",
    scope: "world",
    config: true,
    type: Number,
    default: 1.5
  });

  game.settings.register(MODULE_ID, SETTINGS.ANNOUNCE_ROLLS_CHAT, {
    name: "WOW_LOOTER.Settings.AnnounceRollsName",
    hint: "WOW_LOOTER.Settings.AnnounceRollsHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.AUTO_CONTESTED_ROLL, {
    name: "WOW_LOOTER.Settings.AutoContestedRollName",
    hint: "WOW_LOOTER.Settings.AutoContestedRollHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.REQUIRE_DEATH_TO_LOOT, {
    name: "WOW_LOOTER.Settings.RequireDeathToLootName",
    hint: "WOW_LOOTER.Settings.RequireDeathToLootHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  // Menú y configuración para Monedas Personalizadas
  game.settings.registerMenu(MODULE_ID, "customCurrenciesMenu", {
    name: "WOW_LOOTER.CustomCurrencies.MenuName",
    label: "WOW_LOOTER.CustomCurrencies.MenuLabel",
    hint: "WOW_LOOTER.CustomCurrencies.MenuHint",
    icon: "fas fa-coins",
    type: CustomCurrenciesApp,
    restricted: true
  });

  // Menú para Reportar Bug
  game.settings.registerMenu(MODULE_ID, "reportBugMenu", {
    name: "WOW_LOOTER.ReportBug.MenuName",
    label: "WOW_LOOTER.ReportBug.MenuLabel",
    hint: "WOW_LOOTER.ReportBug.MenuHint",
    icon: "fas fa-bug",
    type: ReportBugApp,
    restricted: false
  });

  game.settings.register(MODULE_ID, SETTINGS.CUSTOM_CURRENCIES, {
    name: "Custom Currencies Data",
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  // Registrar helpers de Handlebars adicionales si se requieren
  Handlebars.registerHelper("gt", (a, b) => a > b);
  Handlebars.registerHelper("eq", (a, b) => a === b);
});

Hooks.once("setup", () => {
  // Envolver el doble clic antes de que el canvas dibuje los tokens iniciales
  _wrapTokenDoubleClick();
});

Hooks.once("ready", () => {
  // Inicializar servicio de comunicación por sockets
  socketService.init();

  // Validar y activar adaptador de sistema
  const adapter = getSystemAdapter();
  document.body?.classList.add(`wow-looter-system-${adapter.systemId}`);
  console.log(`[${MODULE_ID}] Adaptador activo: ${adapter.constructor.name} (${adapter.systemId})`);

  // Registrar módulos funcionales
  registerCombatListener();
  registerDeathListener();
  registerCanvasDropHandler();
  registerTokenHud();

  // Exponer API pública en `game.modules`
  game.modules.get(MODULE_ID).api = {
    openGmLootApp: (enemies = [], players = undefined) => new GmLootApp({ initialEnemies: enemies, initialPlayers: players }).render(true),
    openPlayerLootApp: (session) => PlayerLootApp.open(session || lootSessionManager.session),
    openManualLoot: (targetToken) => _tryOpenManualLoot(targetToken),
    openMerchantApp: (options = {}) => new MerchantApp(options).render(true),
    openCustomCurrenciesApp: () => new CustomCurrenciesApp().render(true),
    currencyService,
    merchantService,
    lootSessionManager,
    getSystemAdapter
  };

  console.log(`[${MODULE_ID}] Wow's Take a Loot listo para usar.`);
});

function _bindContestedChatCardListeners(message, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  const card = root.querySelector(".wow-looter-contested-card");
  if (!card || card.dataset.wowLooterBound) return;
  card.dataset.wowLooterBound = "1";

  // Ocultar controles exclusivos del GM para jugadores
  if (!game.user.isGM) {
    card.querySelectorAll(".wow-looter-gm-only").forEach((el) => {
      el.style.display = "none";
    });
  }

  // Botón de tirada d100 por jugador (visible/activo solo para el dueño o el GM)
  card.querySelectorAll(".btn-roll-contested").forEach((btn) => {
    const characterId = btn.dataset.characterId;
    const actor = characterId ? game.actors.get(characterId) : null;
    const canRoll = game.user.isGM || actor?.isOwner || game.user.character?.id === characterId;
    if (!canRoll) {
      btn.style.display = "none";
      return;
    }

    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      btn.disabled = true;
      if (game.user.isGM) {
        await lootSessionManager.handleContestedRollAction({
          messageId: message.id,
          action: "roll-one",
          characterId
        });
      } else {
        socketService.emit(SOCKET_EVENTS.CONTESTED_ROLL_ACTION, {
          messageId: message.id,
          action: "roll-one",
          characterId
        });
      }
    });
  });

  // Botón "Tirar por todos" solo para el GM
  const rollAllBtn = card.querySelector(".btn-roll-all-contested");
  if (rollAllBtn && game.user.isGM) {
    rollAllBtn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      rollAllBtn.disabled = true;
      await lootSessionManager.handleContestedRollAction({
        messageId: message.id,
        action: "roll-all"
      });
    });
  }
}

Hooks.on("renderChatMessageHTML", _bindContestedChatCardListeners);
Hooks.on("renderChatMessage", _bindContestedChatCardListeners);

