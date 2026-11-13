import { MODULE_ID, SOCKET_EVENTS } from "../constants.js";
import { getSystemAdapter } from "../adapters/index.js";
import { socketService } from "../services/socket-service.js";
import { lootSessionManager } from "../services/loot-session.js";
import { currencyService } from "../services/currency-service.js";
import { protectDropdowns, enrichItemDescription } from "../utils/dom-helpers.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

let activePlayerApp = null;

/**
 * Ventana interactiva de selección de botín para los jugadores y vista en tiempo real para el GM.
 */
export class PlayerLootApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.selectedCharacterId = options.selectedCharacterId || null;
  }

  static DEFAULT_OPTIONS = {
    id: "wow-looter-player",
    tag: "div",
    classes: ["wow-looter-app", "wow-looter-player-app"],
    window: {
      title: "WOW_LOOTER.Player.Title",
      icon: "fas fa-gem",
      resizable: true
    },
    position: {
      width: 760,
      height: 700
    },
    actions: {
      "toggle-claim": PlayerLootApp._onToggleClaim,
      "toggle-item-desc": PlayerLootApp._onToggleItemDesc,
      "set-currency-split": PlayerLootApp._onSetCurrencySplit,
      "set-currency-custom": PlayerLootApp._onSetCurrencyCustom,
      "toggle-my-ready": PlayerLootApp._onToggleMyReady,
      "gm-force-resolve": PlayerLootApp._onGmForceResolve,
      "split-item": PlayerLootApp._onSplitItem
    }
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/player-loot.hbs`
    }
  };

  /**
   * Abre o actualiza la ventana activa del jugador/GM de forma limpia.
   */
  static open(session) {
    if (activePlayerApp) {
      if (activePlayerApp.rendered) {
        activePlayerApp.render(false);
        return activePlayerApp;
      }
      try {
        activePlayerApp.close();
      } catch (err) {}
      activePlayerApp = null;
    }
    activePlayerApp = new PlayerLootApp();
    activePlayerApp.render(true);
    return activePlayerApp;
  }

  /**
   * Actualización ligera de la ventana sin reconstruir todo el DOM si ya está abierta.
   */
  static update(session) {
    if (activePlayerApp && activePlayerApp.rendered) {
      activePlayerApp.render(false);
    } else if (session) {
      PlayerLootApp.open(session);
    }
  }

  /**
   * Cierra la ventana activa.
   */
  static closeApp() {
    if (activePlayerApp) {
      try {
        activePlayerApp.close({ animate: false });
      } catch (err) {}
      activePlayerApp = null;
    }
  }

  async close(options = {}) {
    options.animate = false;
    if (this.element) {
      this.element.style.display = "none";
    }
    if (activePlayerApp === this) {
      activePlayerApp = null;
    }
    return super.close(options);
  }

  /**
   * Obtiene el personaje asociado al usuario actual que participa en esta sesión.
   */
  static getMyParticipatingCharacter(session) {
    if (!session || !session.eligiblePlayers || session.eligiblePlayers.length === 0) return null;

    // 1. Buscar coincidencia por userId
    let match = session.eligiblePlayers.find((p) => p.userId && p.userId === game.user.id);
    if (match) return match;

    // 2. Si tiene personaje asignado en Foundry (game.user.character)
    if (game.user.character) {
      match = session.eligiblePlayers.find((p) => p.characterId === game.user.character.id);
      if (match) return match;
    }

    // 3. Si no es GM, buscar si es dueño de alguno de los personajes elegibles
    if (!game.user.isGM) {
      const ownedChar = session.eligiblePlayers.find((p) => {
        const actor = game.actors.get(p.characterId);
        return actor && actor.getUserLevel(game.user) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
      });
      if (ownedChar) return ownedChar;
    }

    // 4. Fallback: primer participante
    return session.eligiblePlayers[0] || null;
  }

  async _prepareContext() {
    const session = lootSessionManager.session;
    if (!session || !session.eligiblePlayers) {
      return { session: null };
    }

    // Filtrar personajes accesibles (el GM ve todos; los jugadores solo los suyos con permiso OWNER)
    const accessiblePlayers = game.user.isGM
      ? session.eligiblePlayers
      : session.eligiblePlayers.filter((p) => {
          const actor = game.actors.get(p.characterId);
          if (actor && actor.getUserLevel(game.user) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) return true;
          if (game.user.character?.id === p.characterId) return true;
          return Boolean(p.userId && p.userId === game.user.id);
        });

    // Determinar personaje activo seleccionado para interactuar
    let activeChar = accessiblePlayers.find((p) => p.characterId === this.selectedCharacterId);
    if (!activeChar) {
      activeChar = PlayerLootApp.getMyParticipatingCharacter({ eligiblePlayers: accessiblePlayers })
        || accessiblePlayers[0]
        || PlayerLootApp.getMyParticipatingCharacter(session);
      this.selectedCharacterId = activeChar?.characterId || null;
    }

    const looterOptions = accessiblePlayers.map((p) => ({
      id: p.characterId,
      name: p.characterName,
      selected: p.characterId === this.selectedCharacterId
    }));

    // Monedas: calcular solicitudes específicas y saldo restante del pool
    const requestedByDenom = {};
    const currencyRequestsList = [];
    for (const p of session.eligiblePlayers) {
      if (p.currencyChoice?.splitEvenly === false && Number(p.currencyChoice?.requested) > 0) {
        const denom = p.currencyChoice.denom || "gp";
        const req = Math.max(0, Number(p.currencyChoice.requested) || 0);
        requestedByDenom[denom] = (requestedByDenom[denom] || 0) + req;
        const meta = currencyService.getCurrencyMetadata(denom);
        currencyRequestsList.push({
          characterId: p.characterId,
          characterName: p.characterName,
          characterImg: p.characterImg,
          scaleX: p.scaleX ?? 1,
          scaleY: p.scaleY ?? 1,
          requested: req,
          denom,
          denomLabel: meta.label
        });
      }
    }

    const myCurrencyChoice = activeChar?.currencyChoice || { splitEvenly: true, requested: 0, denom: "gp" };
    const availableKeys = Object.entries(session.currencies || {})
      .filter(([_, val]) => Number(val) > 0)
      .map(([k]) => k);
    const selectedDenom = (myCurrencyChoice.denom && availableKeys.includes(myCurrencyChoice.denom))
      ? myCurrencyChoice.denom
      : (availableKeys[0] || myCurrencyChoice.denom || "gp");

    const currenciesList = [];
    const remainingCurrencies = {};
    let hasCurrencies = false;
    let hasAnyRemainingCurrency = false;
    for (const [key, rawValue] of Object.entries(session.currencies || {})) {
      const totalVal = Number(rawValue) || 0;
      if (totalVal > 0) {
        hasCurrencies = true;
        const remaining = Math.max(0, totalVal - (requestedByDenom[key] || 0));
        remainingCurrencies[key] = remaining;
        if (remaining > 0) hasAnyRemainingCurrency = true;
        const meta = currencyService.getCurrencyMetadata(key);
        currenciesList.push({
          key,
          label: meta.label,
          img: meta.img,
          value: remaining,
          totalValue: totalVal,
          selected: key === selectedDenom,
          isCustom: meta.isCustom
        });
      }
    }

    const myExistingForDenom = (!myCurrencyChoice.splitEvenly && selectedDenom === (myCurrencyChoice.denom || "gp"))
      ? (Number(myCurrencyChoice.requested) || 0)
      : 0;
    const myMaxRequestable = (remainingCurrencies[selectedDenom] || 0) + myExistingForDenom;
    const canUseCustomCurrency = hasAnyRemainingCurrency || (myCurrencyChoice.splitEvenly === false && (Number(myCurrencyChoice.requested) || 0) > 0);

    const adapter = getSystemAdapter();

    // Items con flags visuales calculadas relativas al personaje activo
    let isReadyBlocked = false;
    const items = await Promise.all((session.items || []).map(async (item) => {
      const claims = item.claims || [];
      const itemQty = Math.max(1, Number(item.quantity) || 1);
      const totalClaimedQty = claims.reduce((sum, c) => sum + Math.max(1, Number(c.quantity) || 1), 0);

      const isClaimedByMe = Boolean(this.selectedCharacterId && claims.some((c) => c.characterId === this.selectedCharacterId));
      const myClaim = claims.find((c) => c.characterId === this.selectedCharacterId);
      const isSingleClaim = claims.length === 1;
      const isContested = itemQty === 1 && claims.length > 1;
      const isMultiDesired = itemQty > 1 && claims.length > 1 && totalClaimedQty <= itemQty;
      const isNotEnough = itemQty > 1 && claims.length > 1 && totalClaimedQty > itemQty;

      // Comprobar si el personaje activo fue quien excedió el stock disponible
      let isMyClaimOverAllocated = false;
      if (isNotEnough && this.selectedCharacterId) {
        let used = 0;
        for (const c of claims) {
          used += Math.max(1, Number(c.quantity) || 1);
          if (used > itemQty && c.characterId === this.selectedCharacterId) {
            isMyClaimOverAllocated = true;
            isReadyBlocked = true;
            break;
          }
        }
      }

      const category = adapter.getItemCategory(item.systemData || item) || "Equipment";

      return {
        ...item,
        description: await enrichItemDescription(item.description || ""),
        isClaimedByMe,
        isSingleClaim,
        isContested,
        isMultiDesired,
        isNotEnough,
        isMyClaimOverAllocated,
        canSplit: game.user.isGM && itemQty > 1,
        myClaimQty: myClaim?.quantity || 1,
        category,
        claims
      };
    }));

    // Agrupar items por categoría
    const groupOrder = ["Armor", "Weapons", "Consumables", "Equipment", "Containers", "Treasure"];
    const groupsMap = new Map();
    for (const item of items) {
      const cat = item.category || "Equipment";
      if (!groupsMap.has(cat)) groupsMap.set(cat, []);
      groupsMap.get(cat).push(item);
    }

    const sortedCats = Array.from(groupsMap.keys()).sort((a, b) => {
      const iA = groupOrder.indexOf(a);
      const iB = groupOrder.indexOf(b);
      if (iA !== -1 && iB !== -1) return iA - iB;
      if (iA !== -1) return -1;
      if (iB !== -1) return 1;
      return a.localeCompare(b);
    });

    const groupedItems = sortedCats.map((cat) => ({
      category: cat,
      items: groupsMap.get(cat)
    }));

    const isMyPlayerReady = Boolean(activeChar?.isReady);

    return {
      session,
      items,
      groupedItems,
      currenciesList,
      hasCurrencies,
      currencyRequestsList,
      canUseCustomCurrency,
      myMaxRequestable,
      currentCharacter: activeChar,
      looterOptions,
      isMyPlayerReady,
      isReadyBlocked,
      myCurrencyChoice,
      isGM: game.user.isGM
    };
  }

  /**
   * Conecta listeners directos del DOM para máxima robustez ante clics de jugadores.
   */
  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;
    protectDropdowns(html);

    // Selector de personaje para lootear (evento change)
    const looterSelect = html.querySelector(".looting-as-select, .looter-select");
    if (looterSelect) {
      looterSelect.addEventListener("change", (ev) => {
        this.selectedCharacterId = ev.target.value;
        this.render(false);
      });
    }

    // Desplegable de descripción
    html.querySelectorAll("[data-action='toggle-item-desc']").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const card = btn.closest(".player-loot-card");
        if (!card) return;
        const drawer = card.querySelector(".item-description-drawer");
        if (drawer) {
          const isHidden = drawer.style.display === "none" || !drawer.style.display;
          drawer.style.display = isHidden ? "block" : "none";
          const icon = card.querySelector(".toggle-desc-icon");
          if (icon) {
            icon.classList.toggle("fa-chevron-down", !isHidden);
            icon.classList.toggle("fa-chevron-up", isHidden);
          }
        }
      });
    });

    // Clic directo en reparto de monedas
    html.querySelectorAll("input[name='currencyChoice']").forEach((radio) => {
      radio.addEventListener("change", (ev) => {
        const session = lootSessionManager.session;
        if (!session) return;
        const charId = this.selectedCharacterId || PlayerLootApp.getMyParticipatingCharacter(session)?.characterId;
        if (!charId) return;
        const splitEvenly = ev.target.value === "split";
        const input = html.querySelector(".custom-money-input");
        const denomSelect = html.querySelector(".custom-denom-select");
        const denom = denomSelect?.value || "gp";
        if (input) input.disabled = splitEvenly;
        if (denomSelect) denomSelect.disabled = splitEvenly;
        socketService.emit(SOCKET_EVENTS.UPDATE_CURRENCY_CHOICE, {
          characterId: charId,
          splitEvenly,
          requested: splitEvenly ? 0 : Number(input?.value || 0),
          denom
        });
      });
    });

    const moneyInput = html.querySelector(".custom-money-input");
    if (moneyInput) {
      moneyInput.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      moneyInput.addEventListener("mousedown", (ev) => ev.stopPropagation());
      moneyInput.addEventListener("click", (ev) => ev.stopPropagation());
      moneyInput.addEventListener("change", (ev) => {
        const session = lootSessionManager.session;
        if (!session) return;
        const charId = this.selectedCharacterId || PlayerLootApp.getMyParticipatingCharacter(session)?.characterId;
        if (!charId) return;
        const denom = html.querySelector(".custom-denom-select")?.value || "gp";
        socketService.emit(SOCKET_EVENTS.UPDATE_CURRENCY_CHOICE, {
          characterId: charId,
          splitEvenly: false,
          requested: Math.max(0, Number(ev.target.value || 0)),
          denom
        });
      });
    }

    const denomSelect = html.querySelector(".custom-denom-select");
    if (denomSelect) {
      denomSelect.addEventListener("change", (ev) => {
        const session = lootSessionManager.session;
        if (!session) return;
        const charId = this.selectedCharacterId || PlayerLootApp.getMyParticipatingCharacter(session)?.characterId;
        if (!charId) return;
        const requested = Math.max(0, Number(html.querySelector(".custom-money-input")?.value || 0));
        socketService.emit(SOCKET_EVENTS.UPDATE_CURRENCY_CHOICE, {
          characterId: charId,
          splitEvenly: false,
          requested,
          denom: ev.target.value || "gp"
        });
      });
    }

    // Actualizar cantidad reclamada en vivo si el jugador ya había seleccionado el item
    html.querySelectorAll(".player-claim-qty-input").forEach((input) => {
      input.addEventListener("change", (ev) => {
        const session = lootSessionManager.session;
        if (!session) return;
        const card = ev.target.closest(".player-loot-card");
        const itemId = card?.dataset.itemId;
        const item = session.items?.find((i) => i.id === itemId);
        const charId = this.selectedCharacterId || PlayerLootApp.getMyParticipatingCharacter(session)?.characterId;
        if (!item || !charId) return;
        const alreadyClaimed = item.claims?.some((c) => c.characterId === charId);
        if (!alreadyClaimed) return;

        const qty = Math.min(Math.max(1, Number(item.quantity) || 1), Math.max(1, parseInt(ev.target.value) || 1));
        socketService.emit(SOCKET_EVENTS.CLAIM_ITEM, {
          itemId,
          characterId: charId,
          quantity: qty,
          updateOnly: true
        });
      });
    });
  }

  // --- Handlers de Interfaz (ApplicationV2) ---

  static _onChangeLooter(event, target) {
    const actorId = target.value;
    if (actorId) {
      this.selectedCharacterId = actorId;
      this.render(false);
    }
  }

  static _onToggleItemDesc(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const card = target.closest(".player-loot-card");
    if (!card) return;
    const drawer = card.querySelector(".item-description-drawer");
    if (drawer) {
      const isHidden = drawer.style.display === "none" || !drawer.style.display;
      drawer.style.display = isHidden ? "block" : "none";
      const icon = card.querySelector(".toggle-desc-icon");
      if (icon) {
        icon.classList.toggle("fa-chevron-down", !isHidden);
        icon.classList.toggle("fa-chevron-up", isHidden);
      }
    }
  }

  static _onToggleClaim(event, target) {
    event.preventDefault();
    event.stopPropagation();

    const session = lootSessionManager.session;
    if (!session) return;

    const card = target.closest(".player-loot-card");
    const itemId = target.dataset.itemId || card?.dataset.itemId;
    if (!itemId) return;

    const charId = this.selectedCharacterId || PlayerLootApp.getMyParticipatingCharacter(session)?.characterId;
    if (!charId) {
      ui.notifications.warn(game.i18n.localize("WOW_LOOTER.Warning.NoAssignedCharacter"));
      return;
    }

    const qtyInput = card?.querySelector(".player-claim-qty-input");
    const quantity = qtyInput ? Math.max(1, parseInt(qtyInput.value) || 1) : 1;

    socketService.emit(SOCKET_EVENTS.CLAIM_ITEM, {
      itemId,
      characterId: charId,
      quantity
    });
  }

  static _onSetCurrencySplit(event, target) {
    const session = lootSessionManager.session;
    if (!session) return;
    const charId = this.selectedCharacterId || PlayerLootApp.getMyParticipatingCharacter(session)?.characterId;
    if (!charId) return;

    socketService.emit(SOCKET_EVENTS.UPDATE_CURRENCY_CHOICE, {
      characterId: charId,
      splitEvenly: true,
      requested: 0
    });
  }

  static _onSetCurrencyCustom(event, target) {
    const session = lootSessionManager.session;
    if (!session) return;
    const charId = this.selectedCharacterId || PlayerLootApp.getMyParticipatingCharacter(session)?.characterId;
    if (!charId) return;

    const input = this.element.querySelector(".custom-money-input");
    const denom = this.element.querySelector(".custom-denom-select")?.value || "gp";
    const requested = Number(input?.value || 0);

    socketService.emit(SOCKET_EVENTS.UPDATE_CURRENCY_CHOICE, {
      characterId: charId,
      splitEvenly: false,
      requested,
      denom
    });
  }

  static _onEditRequestedCurrency(event, target) {
    const session = lootSessionManager.session;
    if (!session) return;
    const charId = this.selectedCharacterId || PlayerLootApp.getMyParticipatingCharacter(session)?.characterId;
    if (!charId) return;

    const requested = Math.max(0, Number(target.value || 0));
    const denom = this.element.querySelector(".custom-denom-select")?.value || "gp";

    socketService.emit(SOCKET_EVENTS.UPDATE_CURRENCY_CHOICE, {
      characterId: charId,
      splitEvenly: false,
      requested,
      denom
    });
  }

  static _onToggleMyReady(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const session = lootSessionManager.session;
    if (!session) return;
    const charId = this.selectedCharacterId || PlayerLootApp.getMyParticipatingCharacter(session)?.characterId;
    if (!charId) return;

    if (lootSessionManager.hasOverAllocatedClaim(charId)) {
      ui.notifications.warn(game.i18n.localize("WOW_LOOTER.Player.NotEnoughBlocked"));
      return;
    }

    socketService.emit(SOCKET_EVENTS.TOGGLE_READY, {
      characterId: charId
    });
  }

  static async _onGmForceResolve(event, target) {
    if (!game.user.isGM) return;
    await lootSessionManager.resolveAndDistribute();
  }

  static async _onSplitItem(event, target) {
    event.preventDefault();
    event.stopPropagation();
    if (!game.user.isGM) return;

    const session = lootSessionManager.session;
    const itemId = target.dataset.itemId || target.closest(".player-loot-card")?.dataset.itemId;
    const item = session?.items?.find((i) => i.id === itemId);
    if (!item || item.quantity <= 1) return;

    const maxSplit = item.quantity - 1;
    const defaultSplit = Math.max(1, Math.floor(item.quantity / 2));
    const content = `
      <div style="display:flex; align-items:center; gap:10px; padding:6px 0;">
        <label style="font-weight:600; color:#cbd5e1;">${game.i18n.localize("WOW_LOOTER.GM.SplitAmountLabel")} (1 - ${maxSplit}):</label>
        <input type="number" id="split-item-qty" value="${defaultSplit}" min="1" max="${maxSplit}" style="width:70px; text-align:center;" />
      </div>
    `;

    let splitQty = null;
    if (foundry.applications?.api?.DialogV2) {
      splitQty = await foundry.applications.api.DialogV2.prompt({
        window: { title: `${game.i18n.localize("WOW_LOOTER.GM.SplitTitle")}: ${item.name}` },
        content,
        ok: {
          label: game.i18n.localize("WOW_LOOTER.GM.SplitItem"),
          icon: "fas fa-code-branch",
          callback: (ev, btn, dialog) => {
            const val = Number(dialog.element.querySelector("#split-item-qty")?.value || 0);
            return val;
          }
        }
      });
    } else {
      splitQty = await new Promise((resolve) => {
        new Dialog({
          title: `${game.i18n.localize("WOW_LOOTER.GM.SplitTitle")}: ${item.name}`,
          content,
          buttons: {
            split: {
              label: game.i18n.localize("WOW_LOOTER.GM.SplitItem"),
              callback: (html) => {
                const el = html instanceof HTMLElement ? html : html[0];
                resolve(Number(el.querySelector("#split-item-qty")?.value || 0));
              }
            },
            cancel: { label: game.i18n.localize("WOW_LOOTER.Common.Cancel"), callback: () => resolve(null) }
          },
          default: "split"
        }).render(true);
      });
    }

    if (splitQty && splitQty >= 1 && splitQty < item.quantity) {
      lootSessionManager.splitItem(item.id, splitQty);
    }
  }
}

// Escuchar eventos de sesión directamente desde el servicio de sockets (sin sobrecarga de Hooks globales)
socketService.register(SOCKET_EVENTS.START_SESSION, (session) => {
  PlayerLootApp.open(session);
});

socketService.register(SOCKET_EVENTS.SYNC_STATE, (session) => {
  PlayerLootApp.update(session);
});

socketService.register(SOCKET_EVENTS.CLOSE_SESSION, () => {
  PlayerLootApp.closeApp();
});
