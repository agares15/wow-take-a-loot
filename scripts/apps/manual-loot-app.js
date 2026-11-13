import { MODULE_ID, FLAGS, SOCKET_EVENTS } from "../constants.js";
import { getSystemAdapter } from "../adapters/index.js";
import { socketService } from "../services/socket-service.js";
import { ChatAnnouncer } from "../services/chat-announcer.js";
import { currencyService } from "../services/currency-service.js";
import { LootSettingsApp } from "./loot-settings-app.js";
import { protectDropdowns, enrichItemDescription } from "../utils/dom-helpers.js";
import { applyContainerTexture } from "../utils/container-helpers.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Ventana emergente ultra simple para lootear un cuerpo o contenedor de forma manual.
 * Completamente aislada de la hoja de personaje del sistema.
 */
export class ManualLootApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static activeInstance = null;

  constructor(options = {}) {
    super(options);
    ManualLootApp.activeInstance = this;
    this.targetToken = options.targetToken || null;
    this.lootingToken = options.lootingToken || null;
    this.targetActor = options.targetActor || this.targetToken?.actor;
    this.lootingActor = options.lootingActor || this.lootingToken?.actor;
    this.takeAmountInput = "";
  }

  async render(options = {}, _options = {}) {
    const adapter = getSystemAdapter();
    const source = this.targetToken?.actor || this.targetActor;
    if (!adapter.canActivateManualLoot(source, this.targetToken?.document)) {
      ui.notifications.warn(game.i18n.localize("WOW_LOOTER.Warning.MustBeDeadToLoot"));
      this._closingContainerHandled = true;
      return this;
    }
    const actorSettings = source?.getFlag?.(MODULE_ID, "lootSettings") || {};
    const tokenSettings = this.targetToken?.document?.getFlag?.(MODULE_ID, "lootSettings") || {};
    const lootSettings = { ...actorSettings, ...tokenSettings };
    const isLocked = Boolean(this.targetToken?.document?.locked || lootSettings.isLocked);
    if (isLocked && !game.user.isGM) {
      if (lootSettings.lockedSound) {
        foundry.audio.AudioHelper.play({ src: lootSettings.lockedSound, volume: 0.8 }, true);
      }
      const actorName = source?.name || this.targetToken?.name || "Container";
      ui.notifications.warn(game.i18n.format("WOW_LOOTER.Warning.ContainerLockedNamed", { name: actorName }));
      this._closingContainerHandled = true;
      return this;
    }
    return super.render(options, _options);
  }

  get title() {
    const source = this.targetToken?.actor || this.targetActor;
    const isLoot = source?.type === "loot" 
      || Boolean(source?.getFlag?.(MODULE_ID, FLAGS.LOOT_GENERATED)) 
      || Boolean(source?.getFlag?.(MODULE_ID, "isDummyLootActor"))
      || Boolean(this.targetToken?.document?.getFlag?.(MODULE_ID, FLAGS.LOOT_GENERATED));
    return isLoot
      ? game.i18n.localize("WOW_LOOTER.Manual.TitleInspectingLoot")
      : game.i18n.localize("WOW_LOOTER.Manual.TitleLootingNPC");
  }

  static DEFAULT_OPTIONS = {
    id: "wow-looter-manual",
    tag: "div",
    classes: ["wow-looter-app", "wow-looter-manual-app"],
    window: {
      title: "WOW_LOOTER.Manual.Title",
      icon: "fas fa-sack-dollar",
      resizable: true,
      controls: [
        {
          icon: "fas fa-user",
          label: "WOW_LOOTER.Manual.OpenSheet",
          action: "open-actor-sheet"
        }
      ]
    },
    position: {
      width: 480,
      height: "auto"
    },
    actions: {
      "take-item": ManualLootApp._onTakeItem,
      "loot-all-items": ManualLootApp._onLootAllItems,
      "take-all-currency": ManualLootApp._onTakeAllCurrency,
      "take-specific-currency": ManualLootApp._onTakeSpecificCurrency,
      "edit-take-amount": ManualLootApp._onEditTakeAmount,
      "split-currency-party": ManualLootApp._onSplitCurrencyParty,
      "open-loot-settings": ManualLootApp._onOpenLootSettings,
      "open-actor-sheet": ManualLootApp._onOpenActorSheet,
      "edit-currency": ManualLootApp._onEditCurrency,
      "toggle-item-desc": ManualLootApp._onToggleItemDesc,
      "close": ManualLootApp._onClose
    }
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/manual-loot.hbs`
    }
  };

  async _prepareContext() {
    const adapter = getSystemAdapter();
    const source = this.targetToken?.actor || this.targetActor;

    // Personajes disponibles
    const candidateActors = game.actors.filter((a) => adapter.isPlayerCharacter(a));

    let destination = this.lootingToken?.actor || this.lootingActor;
    if (!game.user.isGM) {
      // Para un jugador, priorizar su propio personaje asignado o un personaje que posea
      const myOwned = game.user.character || candidateActors.find((a) => a.getUserLevel(game.user) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
      if (myOwned) {
        destination = myOwned;
        this.lootingActor = destination;
      }
    }

    if (!destination && candidateActors.length > 0) {
      destination = candidateActors[0];
      this.lootingActor = destination;
    }

    const rawItems = currencyService.filterLootableItems(adapter.getLootableItems(source));
    const currencies = currencyService.getActorCurrencies(source);

    const items = await Promise.all(rawItems.map(async (i) => ({
      id: i.id,
      name: i.name,
      img: i.img,
      quantity: Number(i.quantity ?? i.system?.quantity ?? 1),
      bulk: adapter.getItemBulk(i),
      description: await enrichItemDescription(i.system?.description?.value || i.system?.description || "", i)
    })));

    const currenciesList = [];
    let hasCurrencies = false;
    for (const [key, value] of Object.entries(currencies)) {
      if (value > 0 || game.user.isGM) {
        hasCurrencies = true;
        const meta = currencyService.getCurrencyMetadata(key);
        currenciesList.push({
          key,
          label: meta.label,
          img: meta.img,
          value,
          isCustom: meta.isCustom
        });
      }
    }

    const userCandidates = game.user.isGM
      ? candidateActors
      : candidateActors.filter((a) => a.getUserLevel(game.user) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER || (game.user.character && a.id === game.user.character.id));

    const looterPool = userCandidates.length > 0 ? userCandidates : candidateActors;
    const looterOptions = looterPool.map((a) => ({
      id: a.id,
      name: a.name,
      selected: destination?.id === a.id
    }));

    const isLootActor = source?.type === "loot" 
      || Boolean(source?.getFlag?.(MODULE_ID, FLAGS.LOOT_GENERATED)) 
      || Boolean(source?.getFlag?.(MODULE_ID, "isDummyLootActor"))
      || Boolean(this.targetToken?.document?.getFlag?.(MODULE_ID, FLAGS.LOOT_GENERATED));

    const lootSettings = this.targetToken?.document?.getFlag?.(MODULE_ID, "lootSettings") 
      || source?.getFlag?.(MODULE_ID, "lootSettings") 
      || {};

    return {
      isGM: game.user.isGM,
      isLootActor,
      customDescription: lootSettings.customDescription || "",
      targetName: source?.name || game.i18n.localize("WOW_LOOTER.Manual.LootContainer"),
      targetImg: source?.img || "icons/containers/bags/pack-leather-brown.webp",
      lootingActorName: destination?.name || game.i18n.localize("WOW_LOOTER.Manual.NoLooterSelected"),
      lootingActorId: destination?.id,
      looterOptions,
      items,
      currenciesList,
      hasCurrencies,
      takeAmountInput: this.takeAmountInput
    };
  }

  /**
   * Conecta los listeners del DOM tras renderizar.
   */
  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;
    protectDropdowns(html);

    // Selector de destinatario del botín (evento change)
    const looterSelect = html.querySelector(".looter-select");
    if (looterSelect) {
      looterSelect.addEventListener("change", (ev) => {
        const actorId = ev.target.value;
        const actor = game.actors.get(actorId);
        if (actor) {
          this.lootingActor = actor;
          this.lootingToken = canvas.tokens.placeables.find((t) => t.actor?.id === actorId) || null;
          this.render(false);
        }
      });
    }

    // Soporte para arrastrar y soltar Items directamente en la ventana de botín
    this._attachDropHandler();

    // Delegación directa para botones de loot de item
    html.querySelectorAll("[data-action='take-item']").forEach((btn) => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const row = btn.closest(".manual-item-row") || btn.closest("[data-item-id]");
        const itemId = btn.dataset.itemId || row?.dataset.itemId;
        const qtyInput = row?.querySelector(".item-take-qty-input");
        const quantity = qtyInput ? Math.max(1, Number(qtyInput.value || 1)) : 1;
        await this._executeTransfer("take-item", { itemId, quantity });
      });
    });

    // Delegación directa para Loot All
    const lootAllBtn = html.querySelector("[data-action='loot-all-items']");
    if (lootAllBtn) {
      lootAllBtn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        await this._executeTransfer("loot-all-items", {});
      });
    }

    // Monedas: Tomar cantidad específica con selector de tipo de moneda
    const takeSpecificBtn = html.querySelector("[data-action='take-specific-currency']");
    if (takeSpecificBtn) {
      takeSpecificBtn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const input = html.querySelector(".manual-money-input");
        const amount = Number(input?.value || 0);
        if (amount <= 0) {
          ui.notifications.warn(game.i18n.localize("WOW_LOOTER.Warning.EnterValidAmount"));
          return;
        }
        const currencySelect = html.querySelector(".manual-currency-select");
        const currencyKey = currencySelect?.value || "gp";

        await this._executeTransfer("take-specific-currency", { amount, currencyKey });
      });
    }

    // Monedas: Tomar todo
    const takeAllCoinsBtn = html.querySelector("[data-action='take-all-currency']");
    if (takeAllCoinsBtn) {
      takeAllCoinsBtn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        await this._executeTransfer("take-all-currency", {});
      });
    }

    // Monedas: Repartir con el grupo
    const splitCoinsBtn = html.querySelector("[data-action='split-currency-party']");
    if (splitCoinsBtn) {
      splitCoinsBtn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        await this._executeTransfer("split-currency-party", {});
      });
    }

    // Input de monedas: mantener sincronizado el valor
    const moneyInput = html.querySelector(".manual-money-input");
    if (moneyInput) {
      moneyInput.addEventListener("input", (ev) => {
        this.takeAmountInput = ev.target.value;
      });
    }

    // Toggle de descripciones desplegables
    html.querySelectorAll("[data-action='toggle-item-desc']").forEach((el) => {
      el.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        ManualLootApp._onToggleItemDesc.call(this, ev, el);
      });
    });

    // Edición de monedas en vivo por parte del GM
    html.querySelectorAll("input[data-action='edit-currency']").forEach((input) => {
      input.addEventListener("change", (ev) => {
        ManualLootApp._onEditCurrency.call(this, ev, ev.target);
      });
    });

    // Botón de cerrar
    const closeBtn = html.querySelector("[data-action='close']");
    if (closeBtn) {
      closeBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        this.close();
      });
    }
  }

  /**
   * Conecta el manejador de soltar items (drag and drop) sobre la ventana para agregar nuevos objetos.
   */
  _attachDropHandler() {
    const html = this.element;
    html.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "copy";
    });

    html.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      let dragData;
      try {
        dragData = TextEditor.getDragEventData(ev);
      } catch (err) {
        return;
      }
      if (dragData?.type !== "Item" || !dragData.uuid) return;

      const item = await fromUuid(dragData.uuid);
      if (!item) return;

      const source = this.targetToken?.actor || this.targetActor;
      if (!source) return;

      const itemData = item.toObject();
      delete itemData._id;
      delete itemData._stats;
      if (itemData.system?.containerId) itemData.system.containerId = null;

      await source.createEmbeddedDocuments("Item", [itemData]);
      ui.notifications.info(`${item.name} añadido al botín.`);

      // Notificar por socket y refrescar
      socketService.emit(SOCKET_EVENTS.MANUAL_LOOT_UPDATED, {
        targetActorId: source.id,
        targetTokenId: this.targetToken?.id
      });
      this.render(false);
    });
  }

  /**
   * Ejecuta la transferencia de forma local si es GM, o por socket si es un jugador.
   */
  async _executeTransfer(action, data = {}) {
    const source = this.targetToken?.actor || this.targetActor;
    let destination = this.lootingToken?.actor || this.lootingActor;

    if (!destination) {
      const adapter = getSystemAdapter();
      const pcs = game.actors.filter((a) => adapter.isPlayerCharacter(a));
      const myOwned = !game.user.isGM
        ? (game.user.character || pcs.find((a) => a.getUserLevel(game.user) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER))
        : null;
      destination = myOwned || pcs[0] || null;
      this.lootingActor = destination;
    }

    if (!source || !destination) {
      ui.notifications.warn(game.i18n.localize("WOW_LOOTER.Warning.SelectYourTokenFirst"));
      return;
    }

    if (source.id === destination.id) {
      ui.notifications.warn("El personaje receptor no puede ser el mismo objetivo que el saqueado. Selecciona un personaje jugador receptor.");
      return;
    }

    if (game.user.isGM) {
      await this._handleTransferDirectly(action, data);
    } else {
      await socketService.emit(SOCKET_EVENTS.MANUAL_LOOT_EXECUTE, {
        action,
        data,
        targetTokenId: this.targetToken?.id,
        lootingTokenId: this.lootingToken?.id,
        targetActorId: source.id,
        lootingActorId: destination.id
      });
    }
  }

  /**
   * Ejecución autoritativa por parte del GM.
   */
  async _handleTransferDirectly(action, data) {
    const adapter = getSystemAdapter();
    const source = this.targetToken?.actor || this.targetActor;
    let destination = this.lootingToken?.actor || this.lootingActor;

    if (!destination) {
      const pcs = game.actors.filter((a) => adapter.isPlayerCharacter(a));
      if (pcs.length > 0) destination = pcs[0];
    }

    if (!source || !destination) return;

    if (action === "take-item") {
      const item = source.items.get(data.itemId);
      const itemName = item?.name || "Objeto";
      const itemImg = item?.img || "icons/svg/item-bag.svg";
      const qty = Math.max(1, Number(data.quantity || 1));
      await adapter.transferItem(source, destination, data.itemId, qty);
      await ChatAnnouncer.announceItemPickup(destination, source, itemName, itemImg, qty);
    } else if (action === "loot-all-items") {
      const items = adapter.getLootableItems(source);
      const itemsList = items.map((i) => ({
        name: i.name,
        img: i.img,
        quantity: Number(i.quantity ?? i.system?.quantity ?? 1)
      }));
      for (const item of items) {
        await adapter.transferItem(source, destination, item.id, item.system?.quantity || 1);
      }
      if (itemsList.length > 0) {
        await ChatAnnouncer.announceAllItemsPickup(destination, source, itemsList);
      }
    } else if (action === "take-all-currency") {
      const currencies = currencyService.getActorCurrencies(source);
      await currencyService.transferAllCurrencies(source, destination);
      const formatted = Object.entries(currencies)
        .filter(([_, v]) => v > 0)
        .map(([k, v]) => `${v} ${currencyService.getCurrencyMetadata(k).label}`)
        .join(", ");
      await ChatAnnouncer.announceCurrencyPickup(destination, source, formatted, false);
      ui.notifications.info(`${destination.name} recogió todo el dinero.`);
    } else if (action === "take-specific-currency") {
      const amount = Number(data.amount || 0);
      if (amount <= 0) return;

      const currencies = currencyService.getActorCurrencies(source);
      const nonZeroKeys = Object.keys(currencies).filter((k) => (currencies[k] || 0) > 0);
      let chosenKey = data.currencyKey;
      if (!chosenKey || !currencies[chosenKey]) {
        chosenKey = (currencies.gp && currencies.gp > 0) ? "gp" : (nonZeroKeys[0] || "gp");
      }
      const currentVal = currencies[chosenKey] || 0;
      const deduct = Math.min(amount, currentVal);

      if (deduct > 0) {
        await currencyService.transferCurrency(source, destination, chosenKey, deduct);
        const meta = currencyService.getCurrencyMetadata(chosenKey);
        const formatted = `${deduct} ${meta.label}`;
        await ChatAnnouncer.announceCurrencyPickup(destination, source, formatted, false);
        ui.notifications.info(`${destination.name} tomó ${deduct} ${meta.label}.`);
      }
    } else if (action === "split-currency-party") {
      const currencies = currencyService.getActorCurrencies(source);
      const party = game.actors.filter((a) => adapter.isPlayerCharacter(a));
      if (party.length === 0) return;

      await currencyService.splitCurrenciesWithParty(source, party);

      const formatted = Object.entries(currencies)
        .filter(([_, v]) => v > 0)
        .map(([k, v]) => `${v} ${currencyService.getCurrencyMetadata(k).label}`)
        .join(", ");
      await ChatAnnouncer.announceCurrencyPickup(destination, source, formatted, true, party.length);
      ui.notifications.info(`El dinero fue repartido equitativamente entre los ${party.length} miembros del grupo.`);
    }

    // Comprobar si el contenedor ha quedado vacío y debe eliminarse (deleteWhenEmpty)
    const lootSettings = this.targetToken?.document?.getFlag(MODULE_ID, "lootSettings") 
      || source.getFlag(MODULE_ID, "lootSettings") 
      || {};
    const remainingItems = adapter.getLootableItems(source);
    const remainingCurrencies = adapter.getActorCurrencies(source);
    const hasRemainingCoins = Object.values(remainingCurrencies).some((v) => Number(v) > 0);

    if (remainingItems.length === 0 && !hasRemainingCoins) {
      if (lootSettings.deleteWhenEmpty && this.targetToken?.document) {
        ui.notifications.info("El contenedor está vacío y ha desaparecido.");
        await this.targetToken.document.delete().catch(() => {});
        this.close();
        return;
      } else if (lootSettings.lootType === "container") {
        await applyContainerTexture(this.targetToken?.document, source, "open");
      }
    }

    // Notificar a todos los clientes para que actualicen sus ventanas abiertas
    socketService.emit(SOCKET_EVENTS.MANUAL_LOOT_UPDATED, {
      targetActorId: source.id,
      targetTokenId: this.targetToken?.id
    });

    this.render(false);
  }

  // --- Handlers de Interfaz (ApplicationV2) ---

  static _onOpenLootSettings(event, target) {
    new LootSettingsApp({
      targetToken: this.targetToken,
      targetActor: this.targetActor,
      parentApp: this
    }).render(true);
  }

  static _onOpenActorSheet(event, target) {
    const actor = this.targetToken?.actor || this.targetActor;
    if (actor?.sheet) {
      actor.sheet.render(true);
    }
  }

  static _onToggleItemDesc(event, target) {
    const row = target.closest(".manual-item-row");
    if (!row) return;
    const drawer = row.querySelector(".item-description-drawer");
    if (drawer) {
      const isHidden = drawer.style.display === "none" || !drawer.style.display;
      drawer.style.display = isHidden ? "block" : "none";
      const icon = row.querySelector(".toggle-desc-icon");
      if (icon) {
        icon.classList.toggle("fa-chevron-down", !isHidden);
        icon.classList.toggle("fa-chevron-up", isHidden);
      }
    }
  }

  static async _onTakeItem(event, target) {
    const row = target.closest(".manual-item-row") || target.closest("[data-item-id]");
    const itemId = target.dataset.itemId || row?.dataset.itemId;
    if (!itemId) {
      console.warn("[wow-looter] No se encontró itemId en el elemento clickeado.", target);
      return;
    }
    const qtyInput = row?.querySelector(".item-take-qty-input");
    const quantity = qtyInput ? Math.max(1, Number(qtyInput.value || 1)) : 1;
    await this._executeTransfer("take-item", { itemId, quantity });
  }

  static async _onLootAllItems(event, target) {
    await this._executeTransfer("loot-all-items", {});
  }

  static async _onTakeAllCurrency(event, target) {
    await this._executeTransfer("take-all-currency", {});
  }

  static _onEditTakeAmount(event, target) {
    this.takeAmountInput = target.value;
  }

  static async _onTakeSpecificCurrency(event, target) {
    const input = this.element.querySelector(".manual-money-input");
    const amount = Number(input?.value || 0);
    if (amount <= 0) {
      ui.notifications.warn(game.i18n.localize("WOW_LOOTER.Warning.EnterValidAmount"));
      return;
    }
    const currencySelect = this.element.querySelector(".manual-currency-select");
    const currencyKey = currencySelect?.value || "gp";

    await this._executeTransfer("take-specific-currency", { amount, currencyKey });
  }

  static async _onSplitCurrencyParty(event, target) {
    await this._executeTransfer("split-currency-party", {});
  }

  static _onChangeLooter(event, target) {
    const actorId = target.value;
    const actor = game.actors.get(actorId);
    if (actor) {
      this.lootingActor = actor;
      this.lootingToken = canvas.tokens.placeables.find((t) => t.actor?.id === actorId) || null;
      this.render(false);
    }
  }

  static async _onEditCurrency(event, target) {
    if (!game.user.isGM) return;
    const currencyKey = target.dataset.currency;
    const newAmount = Math.max(0, Number(target.value || 0));
    const source = this.targetToken?.actor || this.targetActor;
    if (!source || !currencyKey) return;

    await currencyService.setActorCurrency(source, currencyKey, newAmount);
    socketService.emit(SOCKET_EVENTS.MANUAL_LOOT_UPDATED, {
      tokenId: this.targetToken?.id,
      actorId: source.id
    });
    this.render(false);
  }

  async close(options = {}) {
    options.animate = false;
    if (!this._closingContainerHandled) {
      this._closingContainerHandled = true;
      const source = this.targetToken?.actor || this.targetActor;
      const lootSettings = this.targetToken?.document?.getFlag(MODULE_ID, "lootSettings")
        || source?.getFlag(MODULE_ID, "lootSettings")
        || {};

      if (lootSettings.lootType === "container") {
        if (lootSettings.closingSound) {
          foundry.audio.AudioHelper.play({ src: lootSettings.closingSound, volume: 0.8 }, true);
        }
        if (game.user.isGM) {
          applyContainerTexture(this.targetToken?.document, source, "close");
        } else {
          socketService.emit(SOCKET_EVENTS.CONTAINER_STATE_CHANGE, {
            tokenId: this.targetToken?.id,
            actorId: source?.id,
            state: "close"
          });
        }
      }
    }
    if (this.element) {
      this.element.style.display = "none";
    }
    if (ManualLootApp.activeInstance === this) {
      ManualLootApp.activeInstance = null;
    }
    return super.close(options);
  }

  static _onClose(event, target) {
    this.close({ animate: false });
  }
}

// Sincronizar en tiempo real el refresco de ventanas de loot manual de forma ligera
socketService.register(SOCKET_EVENTS.MANUAL_LOOT_UPDATED, (data) => {
  if (ManualLootApp.activeInstance && ManualLootApp.activeInstance.rendered) {
    const source = ManualLootApp.activeInstance.targetToken?.actor || ManualLootApp.activeInstance.targetActor;
    // Si el actor o token fue eliminado, cerrar la ventana
    if (!source || (ManualLootApp.activeInstance.targetToken && !canvas.tokens.get(ManualLootApp.activeInstance.targetToken.id))) {
      ManualLootApp.activeInstance.close();
      return;
    }
    ManualLootApp.activeInstance.render(false);
  }
  const appV2 = foundry.applications.instances?.get("wow-looter-manual");
  if (appV2 && appV2 !== ManualLootApp.activeInstance && appV2.rendered) {
    appV2.render(false);
  }
});
