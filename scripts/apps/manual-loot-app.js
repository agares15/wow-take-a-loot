import { MODULE_ID, FLAGS, SOCKET_EVENTS } from "../constants.js";
import { getSystemAdapter } from "../adapters/index.js";
import { socketService } from "../services/socket-service.js";
import { ChatAnnouncer } from "../services/chat-announcer.js";
import { currencyService } from "../services/currency-service.js";
import { LootSettingsApp } from "./loot-settings-app.js";
import {
  protectDropdowns,
  enrichItemDescription,
  bindQuantitySteppers,
  isAmmunitionItem,
  getEffectiveItemQuantity,
  normalizeAmmunitionItemData,
  parseDropData,
  resolveDroppedItem,
  promptAmmunitionQuantity,
  promptItemQuantitySlider
} from "../utils/dom-helpers.js";
import { applyContainerTexture } from "../utils/container-helpers.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Ventana emergente ultra simple para lootear un cuerpo o contenedor de forma manual.
 * Completamente aislada de la hoja de personaje del sistema.
 */
export class ManualLootApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static activeInstance = null;
  static _avatarBoundsCache = new Map();

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
      "add-money": ManualLootApp._onAddMoney,
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

    let rawItems = currencyService.filterLootableItems(adapter.getLootableItems(source));
    if (game.user.isGM && source && rawItems.length > 1) {
      const merged = await this._consolidateDuplicateItems(source, rawItems);
      if (merged) {
        rawItems = currencyService.filterLootableItems(adapter.getLootableItems(source));
      }
    }
    const currencies = currencyService.getActorCurrencies(source);

    // Agrupar visualmente también en caso de que un jugador abra antes de que el GM consolide
    const stackedMap = new Map();
    for (const i of rawItems) {
      const key = `${(i.name || "").trim().toLowerCase()}::${(i.type || "").trim().toLowerCase()}`;
      const qty = getEffectiveItemQuantity(i);
      const existing = stackedMap.get(key);
      if (existing) {
        existing.quantity += qty;
      } else {
        stackedMap.set(key, {
          id: i.id,
          name: i.name,
          img: i.img,
          quantity: qty,
          bulk: adapter.getItemBulk(i),
          description: await enrichItemDescription(i.system?.description?.value || i.system?.description || "", i)
        });
      }
    }
    const items = Array.from(stackedMap.values());

    const currenciesList = [];
    let hasCurrencies = false;
    for (const [key, value] of Object.entries(currencies)) {
      if (Number(value) > 0) {
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

    const tokenTex = this.targetToken?.document?.texture
      || this.targetToken?.texture
      || source?.token?.texture
      || source?.prototypeToken?.texture;
    const targetImg = tokenTex?.src || source?.img || "icons/containers/bags/pack-leather-brown.webp";
    const targetScaleX = tokenTex?.scaleX ?? 1;
    const targetScaleY = tokenTex?.scaleY ?? 1;

    return {
      isGM: game.user.isGM,
      isLootActor,
      customDescription: lootSettings.customDescription || "",
      targetName: this.targetToken?.name || source?.name || game.i18n.localize("WOW_LOOTER.Manual.LootContainer"),
      targetImg,
      targetScaleX,
      targetScaleY,
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
   * Analiza los píxeles no transparentes de la imagen del token y ajusta la escala
   * para recortar automáticamente márgenes vacíos hasta tocar los bordes del contenedor.
   */
  _fitAvatarToContent(img, baseScaleX = 1, baseScaleY = 1) {
    const applyFit = ({ autoScale, offsetX, offsetY }) => {
      const signX = baseScaleX < 0 ? -1 : 1;
      const signY = baseScaleY < 0 ? -1 : 1;
      const scaleX = signX * autoScale;
      const scaleY = signY * autoScale;
      img.style.transform = `scale(${scaleX}, ${scaleY}) translate(${offsetX}%, ${offsetY}%)`;
    };

    const computeAndApply = () => {
      const src = img.currentSrc || img.src;
      if (!src || !img.naturalWidth || !img.naturalHeight) return;

      const cached = ManualLootApp._avatarBoundsCache.get(src);
      if (cached) {
        applyFit(cached);
        return;
      }

      try {
        const maxDim = 128;
        const ratio = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * ratio));
        const h = Math.max(1, Math.round(img.naturalHeight * ratio));

        const canvasEl = document.createElement("canvas");
        canvasEl.width = w;
        canvasEl.height = h;
        const ctx = canvasEl.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;

        ctx.drawImage(img, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);

        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const alpha = data[(y * w + x) * 4 + 3];
            if (alpha > 10) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        if (maxX < minX || maxY < minY) return;

        const contentW = (maxX - minX + 1) / w;
        const contentH = (maxY - minY + 1) / h;
        const maxNat = Math.max(img.naturalWidth, img.naturalHeight);
        const normW = img.naturalWidth / maxNat;
        const normH = img.naturalHeight / maxNat;
        const boxW = contentW * normW;
        const boxH = contentH * normH;

        // Escalar para que los píxeles visibles cubran el contenedor hasta sus bordes sin hacer overflow
        const autoScale = Math.min(4, Math.max(1, 1 / Math.max(boxW, boxH)));
        const centerX = ((minX + maxX) / 2) / w - 0.5;
        const centerY = ((minY + maxY) / 2) / h - 0.5;
        const result = {
          autoScale,
          offsetX: -(centerX * normW * 100),
          offsetY: -(centerY * normH * 100)
        };

        ManualLootApp._avatarBoundsCache.set(src, result);
        applyFit(result);
      } catch {
        // Si la imagen es cross-origin sin CORS, mantener la escala del token
      }
    };

    if (img.complete && img.naturalWidth > 0) {
      computeAndApply();
    } else {
      img.addEventListener("load", computeAndApply, { once: true });
    }
  }

  /**
   * Consolida automáticamente ítems idénticos (mismo nombre y tipo) dentro del actor de botín.
   */
  async _consolidateDuplicateItems(source, rawItems) {
    if (!source || !Array.isArray(rawItems) || rawItems.length < 2) return false;
    const groups = new Map();
    for (const item of rawItems) {
      const key = `${(item.name || "").trim().toLowerCase()}::${(item.type || "").trim().toLowerCase()}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }

    let didMerge = false;
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      didMerge = true;
      const primary = group[0];
      const totalQty = group.reduce((sum, it) => sum + getEffectiveItemQuantity(it), 0);
      const updateData = { "system.quantity": totalQty };
      if (isAmmunitionItem(primary)) {
        updateData["system._wowNormalizedAmmo"] = true;
        if (primary.system?.uses && Number(primary.system.uses.max) > 1) {
          updateData["system.uses.value"] = 1;
          updateData["system.uses.max"] = 1;
        }
        if (primary.system?.price && Number(primary.system.price.per) > 1) {
          updateData["system.price.per"] = 1;
        }
      }
      await primary.update(updateData).catch(() => {});
      const dupIds = group.slice(1).map((d) => d.id).filter(Boolean);
      if (dupIds.length > 0) {
        await source.deleteEmbeddedDocuments("Item", dupIds).catch(() => {});
      }
    }
    return didMerge;
  }

  async _preRender(context, options) {
    await super._preRender?.(context, options);
    const html = this.element;
    if (!html) return;
    this._savedScroll = {
      list: html.querySelector(".manual-loot-list")?.scrollTop ?? 0,
      win: html.querySelector(".window-content")?.scrollTop ?? 0
    };
  }

  /**
   * Conecta los listeners del DOM tras renderizar.
   */
  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;
    protectDropdowns(html);
    bindQuantitySteppers(html);

    if (this._savedScroll) {
      const restore = () => {
        const listEl = html.querySelector(".manual-loot-list");
        const winEl = html.querySelector(".window-content");
        if (listEl && this._savedScroll.list) listEl.scrollTop = this._savedScroll.list;
        if (winEl && this._savedScroll.win) winEl.scrollTop = this._savedScroll.win;
      };
      restore();
      requestAnimationFrame(restore);
    }

    const avatarImg = html.querySelector(".target-avatar-img");
    if (avatarImg) {
      const baseScaleX = Number(avatarImg.dataset.scaleX ?? 1) || 1;
      const baseScaleY = Number(avatarImg.dataset.scaleY ?? 1) || 1;
      this._fitAvatarToContent(avatarImg, baseScaleX, baseScaleY);
    }

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

    // Botón para editar la ficha del item (solo GM)
    html.querySelectorAll("[data-action='edit-item']").forEach((btn) => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (!game.user.isGM) return;
        const row = btn.closest(".manual-item-row") || btn.closest("[data-item-id]");
        const itemId = btn.dataset.itemId || row?.dataset.itemId;
        const source = this.targetToken?.actor || this.targetActor;
        const item = source?.items?.get(itemId);
        if (item?.sheet) {
          item.sheet.render(true);
        }
      });
    });

    // Botón para borrar un item (solo GM)
    html.querySelectorAll("[data-action='delete-item']").forEach((btn) => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (!game.user.isGM) return;
        const row = btn.closest(".manual-item-row") || btn.closest("[data-item-id]");
        const itemId = btn.dataset.itemId || row?.dataset.itemId;
        const source = this.targetToken?.actor || this.targetActor;
        const item = source?.items?.get(itemId);
        if (!item) return;
        await item.delete();
        socketService.emit(SOCKET_EVENTS.MANUAL_LOOT_UPDATED, {
          targetActorId: source.id,
          targetTokenId: this.targetToken?.id
        });
        this.render(false);
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

    // Edición de cantidades de item en vivo (solo GM)
    html.querySelectorAll("input.gm-item-qty-input[data-item-id]").forEach((input) => {
      input.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      input.addEventListener("mousedown", (ev) => ev.stopPropagation());
      input.addEventListener("click", (ev) => ev.stopPropagation());
      input.addEventListener("change", async (ev) => {
        if (!game.user.isGM) return;
        const itemId = ev.target.dataset.itemId;
        const newQty = Math.max(1, Math.floor(Number(ev.target.value || 1)));
        ev.target.value = String(newQty);
        const source = this.targetToken?.actor || this.targetActor;
        const item = source?.items?.get(itemId);
        if (!item) return;

        const updateData = { "system.quantity": newQty };
        if (isAmmunitionItem(item)) {
          updateData["system._wowNormalizedAmmo"] = true;
          if (item.system?.uses && Number(item.system.uses.max) > 1) {
            updateData["system.uses.value"] = 1;
            updateData["system.uses.max"] = 1;
          }
          if (item.system?.price && Number(item.system.price.per) > 1) {
            updateData["system.price.per"] = 1;
          }
        }
        await item.update(updateData);
        socketService.emit(SOCKET_EVENTS.MANUAL_LOOT_UPDATED, {
          targetActorId: source.id,
          targetTokenId: this.targetToken?.id
        });
        this.render(false);
      });
    });

    // Edición de monedas en vivo por parte del GM
    html.querySelectorAll("input.coin-input[data-currency]").forEach((input) => {
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
    if (!html || html.dataset.wowDropBound === "true") return;
    html.dataset.wowDropBound = "true";

    html.addEventListener("dragenter", (ev) => {
      ev.preventDefault();
    });

    html.addEventListener("dragover", (ev) => {
      ev.preventDefault();
    });

    html.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (this._isProcessingDrop) return;
      this._isProcessingDrop = true;
      try {
        const dragData = parseDropData(ev);
        if (!dragData || dragData.type !== "Item") return;

        const item = await resolveDroppedItem(dragData);
        if (!item) return;

        const source = this.targetToken?.actor || this.targetActor;
        if (!source) return;

        const fromActor = item.actor || (dragData.actorId ? game.actors?.get(dragData.actorId) : null);
        if (fromActor && fromActor.id === source.id) return;

        // Si el usuario es jugador, solo puede arrastrar items desde un personaje que le pertenezca
        if (!game.user.isGM) {
          const isOwnedByPlayer = Boolean(
            fromActor && (
              fromActor.isOwner
              || fromActor.getUserLevel?.(game.user) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
              || game.user.character?.id === fromActor.id
            )
          );
          if (!isOwnedByPlayer) {
            ui.notifications.warn(game.i18n.localize("WOW_LOOTER.Warning.OnlyOwnInventoryDrop"));
            return;
          }
        }

        const availableQty = getEffectiveItemQuantity(item);

        // Caso 1: El ítem proviene del inventario de un Actor (ej. jugador o GM dejando un objeto en el botín)
        if (fromActor) {
          let chosenQty = 1;
          if (availableQty > 1) {
            chosenQty = await promptItemQuantitySlider(item.name, availableQty, 1);
            if (!chosenQty) return;
          }
          await this._executeTransfer("deposit-item", {
            sourceActorId: fromActor.id,
            sourceActorUuid: fromActor.uuid || null,
            itemId: item.id,
            quantity: chosenQty
          });
          return;
        }

        // Caso 2: El GM arrastra un ítem desde Compendio o Directorio de Items
        if (!game.user.isGM) return;

        let chosenQty = availableQty;
        if (isAmmunitionItem(item)) {
          chosenQty = await promptAmmunitionQuantity(item.name, 10);
          if (!chosenQty) return;
        } else if (availableQty > 1) {
          chosenQty = await promptItemQuantitySlider(item.name, availableQty, 1);
          if (!chosenQty) return;
        }

        // Apilar siempre items idénticos en el botín
        const existing = source.items.find((i) => i.name === item.name && i.type === item.type);
        if (existing) {
          const nextQty = getEffectiveItemQuantity(existing) + chosenQty;
          const updateData = { "system.quantity": nextQty };
          if (isAmmunitionItem(existing)) {
            updateData["system._wowNormalizedAmmo"] = true;
            if (existing.system?.uses && Number(existing.system.uses.max) > 1) {
              updateData["system.uses.value"] = 1;
              updateData["system.uses.max"] = 1;
            }
            if (existing.system?.price && Number(existing.system.price.per) > 1) {
              updateData["system.price.per"] = 1;
            }
          }
          await existing.update(updateData);
        } else {
          const itemData = item.toObject();
          delete itemData._id;
          delete itemData._stats;
          if (itemData.system?.containerId) itemData.system.containerId = null;
          itemData.system = itemData.system || {};
          itemData.system.quantity = chosenQty;
          if (isAmmunitionItem(itemData)) {
            normalizeAmmunitionItemData(itemData, chosenQty);
          }
          await source.createEmbeddedDocuments("Item", [itemData]);
        }

        ui.notifications.info(`${item.name} (x${chosenQty}) añadido al botín.`);

        // Notificar por socket y refrescar
        socketService.emit(SOCKET_EVENTS.MANUAL_LOOT_UPDATED, {
          targetActorId: source.id,
          targetTokenId: this.targetToken?.id
        });
        this.render(false);
      } finally {
        this._isProcessingDrop = false;
      }
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

    if (!source) return;

    if (action !== "deposit-item") {
      if (!destination) {
        ui.notifications.warn(game.i18n.localize("WOW_LOOTER.Warning.SelectYourTokenFirst"));
        return;
      }

      if (source.id === destination.id) {
        ui.notifications.warn("El personaje receptor no puede ser el mismo objetivo que el saqueado. Selecciona un personaje jugador receptor.");
        return;
      }
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
        lootingActorId: destination?.id || data.sourceActorId
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

    if (!source) return;
    if (action !== "deposit-item" && !destination) return;

    if (action === "take-item") {
      const item = source.items.get(data.itemId);
      const itemName = item?.name || "Objeto";
      const itemImg = item?.img || "icons/svg/item-bag.svg";
      const qty = Math.max(1, Number(data.quantity || 1));
      await adapter.transferItem(source, destination, data.itemId, qty);
      await ChatAnnouncer.announceItemPickup(destination, source, itemName, itemImg, qty);
    } else if (action === "deposit-item") {
      let fromActor = null;
      if (data.sourceActorUuid) {
        const doc = await fromUuid(data.sourceActorUuid).catch(() => null);
        fromActor = doc?.actor || doc;
      }
      if (!fromActor && data.sourceActorId) {
        fromActor = game.actors.get(data.sourceActorId);
      }
      if (!fromActor) fromActor = destination;
      if (fromActor && fromActor.id !== source.id) {
        const item = fromActor.items?.get(data.itemId);
        const itemName = item?.name || "Objeto";
        const itemImg = item?.img || "icons/svg/item-bag.svg";
        const qty = Math.max(1, Number(data.quantity || 1));
        const transferred = await adapter.transferItem(fromActor, source, data.itemId, qty, { silent: true });
        if (transferred) {
          const lootName = this.targetToken?.name || source.name;
          const dropMsg = game.i18n.format("WOW_LOOTER.Chat.DroppedItemInLoot", {
            character: fromActor.name,
            item: qty > 1 ? `${itemName} (x${qty})` : itemName,
            loot: lootName
          });
          ui.notifications.info(dropMsg);
          this._pendingDropNotification = dropMsg;
          await ChatAnnouncer.announceItemDrop(fromActor, source, itemName, itemImg, qty);
        }
      }
    } else if (action === "loot-all-items") {
      const items = adapter.getLootableItems(source);
      const itemsList = items.map((i) => ({
        name: i.name,
        img: i.img,
        quantity: getEffectiveItemQuantity(i)
      }));
      for (const item of items) {
        await adapter.transferItem(source, destination, item.id, getEffectiveItemQuantity(item));
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
    const dropNotification = this._pendingDropNotification || null;
    this._pendingDropNotification = null;
    socketService.emit(SOCKET_EVENTS.MANUAL_LOOT_UPDATED, {
      targetActorId: source.id,
      targetTokenId: this.targetToken?.id,
      dropNotification
    });

    this.render(false);
  }

  // --- Handlers de Interfaz (ApplicationV2) ---

  static async _onAddMoney(event, target) {
    if (!game.user.isGM) return;
    const source = this.targetToken?.actor || this.targetActor;
    if (!source) return;

    const adapter = getSystemAdapter();
    const standardKeys = adapter.getCurrencyKeys();
    const customKeys = currencyService.getCustomCurrencies().map((c) => c.key);
    const allKeys = Array.from(new Set([...standardKeys, ...customKeys]));

    const optionsHtml = allKeys.map((k) => {
      const meta = currencyService.getCurrencyMetadata(k);
      return `<option value="${k}">${foundry.utils.escapeHTML(meta.label)}</option>`;
    }).join("");

    const content = `
      <div style="display:flex; flex-direction:column; gap:10px; padding:6px 0;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <label style="font-weight:600; color:#e2e8f0;">${game.i18n.localize("WOW_LOOTER.Manual.CurrencyType")}:</label>
          <select id="wow-add-money-key" style="min-width:140px;">${optionsHtml}</select>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <label style="font-weight:600; color:#e2e8f0;">${game.i18n.localize("WOW_LOOTER.Manual.AddMoneyAmount")}:</label>
          <input type="number" id="wow-add-money-amount" value="10" min="1" style="width:140px; text-align:center;" />
        </div>
      </div>
    `;

    let result = null;
    if (foundry.applications?.api?.DialogV2) {
      result = await foundry.applications.api.DialogV2.prompt({
        window: { title: game.i18n.localize("WOW_LOOTER.Manual.AddMoneyTitle") },
        content,
        ok: {
          label: game.i18n.localize("WOW_LOOTER.Manual.AddMoney"),
          icon: "fas fa-plus",
          callback: (ev, btn, dialog) => ({
            key: dialog.element.querySelector("#wow-add-money-key")?.value,
            amount: Math.max(0, Math.floor(Number(dialog.element.querySelector("#wow-add-money-amount")?.value || 0)))
          })
        },
        rejectClose: false
      });
    } else {
      result = await new Promise((resolve) => {
        new Dialog({
          title: game.i18n.localize("WOW_LOOTER.Manual.AddMoneyTitle"),
          content,
          buttons: {
            add: {
              icon: '<i class="fas fa-plus"></i>',
              label: game.i18n.localize("WOW_LOOTER.Manual.AddMoney"),
              callback: (html) => {
                const el = html instanceof HTMLElement ? html : html[0];
                resolve({
                  key: el.querySelector("#wow-add-money-key")?.value,
                  amount: Math.max(0, Math.floor(Number(el.querySelector("#wow-add-money-amount")?.value || 0)))
                });
              }
            },
            cancel: { label: game.i18n.localize("WOW_LOOTER.Common.Cancel"), callback: () => resolve(null) }
          },
          default: "add"
        }).render(true);
      });
    }

    if (!result || !result.key || result.amount <= 0) return;

    await currencyService.giveCurrency(source, result.key, result.amount);
    socketService.emit(SOCKET_EVENTS.MANUAL_LOOT_UPDATED, {
      targetActorId: source.id,
      targetTokenId: this.targetToken?.id
    });
    this.render(false);
  }

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
  if (data?.dropNotification) {
    ui.notifications.info(data.dropNotification);
  }
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
