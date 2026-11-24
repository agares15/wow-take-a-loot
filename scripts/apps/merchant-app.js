import { MODULE_ID, FLAGS, SOCKET_EVENTS } from "../constants.js";
import { getSystemAdapter } from "../adapters/index.js";
import { socketService } from "../services/socket-service.js";
import { currencyService } from "../services/currency-service.js";
import { merchantService } from "../services/merchant-service.js";
import { LootSettingsApp } from "./loot-settings-app.js";
import { ItemSettingsApp } from "./item-settings-app.js";
import {
  protectDropdowns,
  enrichItemDescription,
  isAmmunitionItem,
  getEffectiveItemQuantity,
  normalizeAmmunitionItemData,
  promptAmmunitionQuantity
} from "../utils/dom-helpers.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Ventana de Comercio (Merchant) inspirada en World of Warcraft y adaptada a Foundry V14.
 * Ofrece diseño en 2 columnas con avatar, descripción editable por el GM, pestañas de Compra/Venta/Recompra/Identificar,
 * filtros por categoría y ordenamiento, control de stock y visibilidad, drag & drop de items y roll tables.
 */
export class MerchantApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static activeInstance = null;
  static pendingIdentifyKeys = new Set();

  constructor(options = {}) {
    super(options);
    MerchantApp.activeInstance = this;
    this.targetToken = options.targetToken || null;
    this.lootingToken = options.lootingToken || null;
    this.targetActor = options.targetActor || this.targetToken?.actor;
    this.lootingActor = options.lootingActor || this.lootingToken?.actor;

    this.activeTab = "buy"; // "buy" | "sell" | "buyback" | "identify"
    this.searchTerm = "";
    this.filterType = "all";
    this.sortBy = "type";
    this.buyQuantities = new Map();
    this.sellQuantities = new Map();
    this.buybackQuantities = new Map();
    this.buybackList = [];
    this.editingItem = null;
  }

  get title() {
    const source = this.targetToken?.actor || this.targetActor;
    return `${game.i18n.localize("WOW_LOOTER.Merchant.Title")}: ${source?.name || "Mercader"}`;
  }

  static DEFAULT_OPTIONS = {
    id: "wow-looter-merchant",
    tag: "div",
    classes: ["wow-looter-app", "wow-looter-merchant-app"],
    window: {
      title: "WOW_LOOTER.Merchant.Title",
      icon: "fas fa-store",
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
      width: 880,
      height: 740
    },
    actions: {
      "switch-tab": MerchantApp._onSwitchTab,
      "buy-item": MerchantApp._onBuyItem,
      "sell-item": MerchantApp._onSellItem,
      "buyback-item": MerchantApp._onBuybackItem,
      "identify-item": MerchantApp._onIdentifyItem,
      "toggle-item-desc": MerchantApp._onToggleItemDesc,
      "open-actor-sheet": MerchantApp._onOpenActorSheet,
      "open-loot-settings": MerchantApp._onOpenLootSettings,
      "edit-description": MerchantApp._onEditDescription,
      "add-roll-table": MerchantApp._onAddRollTable,
      "toggle-item-visibility": MerchantApp._onToggleItemVisibility,
      "edit-item": MerchantApp._onEditItem,
      "item-settings": MerchantApp._onItemSettings,
      "edit-stock": MerchantApp._onEditStock,
      "step-stock": MerchantApp._onStepStock,
      "gm-delete-item": MerchantApp._onGmDeleteItem,
      "close": MerchantApp._onClose
    }
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/merchant.hbs`
    }
  };

  async _prepareContext() {
    const adapter = getSystemAdapter();
    const source = this.targetToken?.actor || this.targetActor;
    const isGM = game.user.isGM;

    // 1. Resolver personaje activo (Shopper)
    const candidateActors = game.actors.filter((a) => adapter.isPlayerCharacter(a));
    let shopper = this.lootingToken?.actor || this.lootingActor;

    if (!isGM) {
      const myOwned = game.user.character || candidateActors.find((a) => a.getUserLevel(game.user) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
      if (myOwned) {
        shopper = myOwned;
        this.lootingActor = shopper;
      }
    }

    if (!shopper && candidateActors.length > 0) {
      shopper = candidateActors[0];
      this.lootingActor = shopper;
    }

    // Opciones del selector de comprador
    const looterOptions = candidateActors.map((a) => ({
      id: a.id,
      name: a.name,
      img: a.img || "icons/svg/mystery-man.svg",
      selected: shopper?.id === a.id
    }));

    // Fondos del comprador
    const shopperCurrenciesRaw = shopper ? currencyService.getActorCurrencies(shopper) : {};
    const shopperTotalCopper = shopper ? currencyService.getActorTotalCopper(shopper) : 0;
    const shopperCurrenciesList = Object.entries(shopperCurrenciesRaw).map(([key, value]) => {
      const meta = currencyService.getCurrencyMetadata(key);
      return {
        key: meta.label,
        amount: value,
        icon: meta.img
      };
    });

    // 2. Configuración del Mercader
    const lootSettings = source?.getFlag?.(MODULE_ID, "lootSettings") || {};
    const buyModifier = Number(lootSettings.buyPriceModifier !== undefined ? lootSettings.buyPriceModifier : 100);
    const sellModifier = Number(lootSettings.sellPriceModifier !== undefined ? lootSettings.sellPriceModifier : 50);
    const infiniteFunds = lootSettings.infiniteFunds !== false;

    // 3. Preparación de Items de Compra (Inventario del Mercader)
    const rawMerchantItems = currencyService.filterLootableItems(adapter.getLootableItems(source));
    const processedBuyItems = [];

    for (const item of rawMerchantItems) {
      const isHidden = Boolean(item.getFlag?.(MODULE_ID, "hidden"));
      if (!isGM && isHidden) continue; // Jugadores no ven items ocultos

      const itemSettings = item.getFlag?.(MODULE_ID, "merchantItemSettings") || {};
      const isInfinite = Boolean(itemSettings.infiniteQuantity);
      const keepWhenSoldOut = Boolean(itemSettings.keepWhenSoldOut);
      const isService = Boolean(itemSettings.isService);

      const rawQty = Number(item.quantity ?? item.system?.quantity ?? 1);
      const stock = isInfinite ? 99 : (rawQty <= 0 ? 0 : getEffectiveItemQuantity(item));
      const isSoldOut = !isInfinite && rawQty <= 0;

      if (isSoldOut && !keepWhenSoldOut && !isGM) continue;

      const priceEval = currencyService.evaluateItemBuyPrice(item, buyModifier, itemSettings);
      const selectedQty = isSoldOut ? 1 : Math.min(Math.max(1, this.buyQuantities.get(item.id) || 1), stock);
      const canAfford = !isSoldOut && shopper ? currencyService.canActorAffordPrice(shopper, priceEval, selectedQty) : false;
      const bulk = adapter.getItemBulk(item);
      const category = adapter.getItemCategory(item);

      processedBuyItems.push({
        id: item.id,
        name: item.name,
        img: item.img || "icons/svg/item-bag.svg",
        description: await enrichItemDescription(item.system?.description?.value || item.system?.description || "", item),
        stock,
        isInfinite,
        isSoldOut,
        isService,
        isFree: priceEval.isFree,
        bulk,
        category,
        isHidden,
        selectedQty,
        unitCostCopper: priceEval.copperValue,
        formattedPrice: priceEval.formattedPrice,
        canAfford
      });
    }

    // 4. Preparación de Items de Venta (Inventario del Comprador)
    const rawShopperItems = shopper ? currencyService.filterLootableItems(adapter.getLootableItems(shopper)) : [];
    const processedSellItems = [];

    for (const item of rawShopperItems) {
      const stock = getEffectiveItemQuantity(item);
      const merchantMatch = source?.items?.find((i) => i.name === item.name && i.type === item.type);
      const itemSettings = item.getFlag?.(MODULE_ID, "merchantItemSettings")
        || merchantMatch?.getFlag?.(MODULE_ID, "merchantItemSettings")
        || {};
      const rawSellMod = itemSettings.sellPriceModifier;
      const effectiveSellMod = (rawSellMod !== null && rawSellMod !== undefined && rawSellMod !== "")
        ? Math.max(0, Number(rawSellMod))
        : sellModifier;
      const priceData = currencyService.getItemPriceData(item);
      const unitPayoutCopper = Math.round(priceData.copperValue * (effectiveSellMod / 100));
      const selectedQty = Math.min(Math.max(1, this.sellQuantities.get(item.id) || 1), stock);
      const bulk = adapter.getItemBulk(item);
      const category = adapter.getItemCategory(item);

      processedSellItems.push({
        id: item.id,
        name: item.name,
        img: item.img || "icons/svg/item-bag.svg",
        description: await enrichItemDescription(item.system?.description?.value || item.system?.description || "", item),
        stock,
        bulk,
        category,
        isHidden: false,
        selectedQty,
        unitCostCopper: unitPayoutCopper,
        formattedPrice: currencyService.formatCopperPrice(unitPayoutCopper),
        canAfford: true
      });
    }

    // 5. Preparación de Recompra (Buyback)
    const processedBuybackItems = [];
    for (const entry of this.buybackList.filter((b) => b.sellerActorId === shopper?.id)) {
      const selectedQty = Math.min(Math.max(1, this.buybackQuantities.get(entry.id) || entry.quantity), entry.quantity);
      const totalCostCopper = entry.unitCopper * selectedQty;
      const canAfford = shopper ? currencyService.canActorAfford(shopper, totalCostCopper) : false;

      processedBuybackItems.push({
        id: entry.id,
        name: entry.name,
        img: entry.img,
        description: "",
        stock: entry.quantity,
        bulk: entry.bulk || "-",
        category: entry.category || "Equipment",
        isHidden: false,
        selectedQty,
        unitCostCopper: entry.unitCopper,
        formattedPrice: entry.unitFormatted,
        canAfford
      });
    }

    // 6. Preparación de Identificar (el precio lo define manualmente el GM al aprobar)
    const canIdentify = lootSettings.canIdentify !== false;
    const unidentifiedItems = shopper
      ? shopper.items.filter((i) => !adapter.isItemIdentified(i))
      : [];

    const rarityLabels = {
      common: game.i18n.localize("WOW_LOOTER.Rarity.Common"),
      uncommon: game.i18n.localize("WOW_LOOTER.Rarity.Uncommon"),
      rare: game.i18n.localize("WOW_LOOTER.Rarity.Rare"),
      veryRare: game.i18n.localize("WOW_LOOTER.Rarity.VeryRare"),
      unique: game.i18n.localize("WOW_LOOTER.Rarity.Unique"),
      legendary: game.i18n.localize("WOW_LOOTER.Rarity.Legendary"),
      artifact: game.i18n.localize("WOW_LOOTER.Rarity.Artifact")
    };

    const processedIdentifyItems = [];
    for (const item of unidentifiedItems) {
      const rawRarity = adapter.getItemRarity(item);
      let mappedKey = "common";
      if (["uncommon"].includes(rawRarity)) mappedKey = "uncommon";
      else if (["rare"].includes(rawRarity)) mappedKey = "rare";
      else if (["veryrare", "veryRare", "unique"].includes(rawRarity)) mappedKey = "veryRare";
      else if (["legendary", "artifact"].includes(rawRarity)) mappedKey = "legendary";

      const bulk = adapter.getItemBulk(item);

      processedIdentifyItems.push({
        id: item.id,
        name: adapter.getUnidentifiedItemName(item),
        img: adapter.getUnidentifiedItemImg(item),
        description: "",
        stock: 1,
        bulk,
        category: rarityLabels[rawRarity] || rarityLabels[mappedKey] || "Magic",
        isHidden: false,
        selectedQty: 1,
        costCopper: 0,
        formattedPrice: "GM",
        canAfford: true,
        isPendingIdentify: Boolean(shopper && MerchantApp.pendingIdentifyKeys.has(`${shopper.id}:${item.id}`))
      });
    }

    // 7. Seleccionar la lista según la pestaña activa y aplicar filtros + agrupación
    let activeItemList = processedBuyItems;
    if (this.activeTab === "sell") activeItemList = processedSellItems;
    else if (this.activeTab === "buyback") activeItemList = processedBuybackItems;
    else if (this.activeTab === "identify") activeItemList = processedIdentifyItems;

    // Filtro por término de búsqueda
    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      activeItemList = activeItemList.filter((i) => i.name.toLowerCase().includes(term));
    }

    // Filtro por tipo/categoría
    if (this.filterType && this.filterType !== "all") {
      activeItemList = activeItemList.filter((i) => i.category === this.filterType);
    }

    // Ordenamiento
    activeItemList.sort((a, b) => {
      if (this.sortBy === "name") {
        return a.name.localeCompare(b.name);
      }
      if (this.sortBy === "price-asc") {
        return (a.unitCostCopper || a.costCopper || 0) - (b.unitCostCopper || b.costCopper || 0);
      }
      if (this.sortBy === "price-desc") {
        return (b.unitCostCopper || b.costCopper || 0) - (a.unitCostCopper || a.costCopper || 0);
      }
      // "type" default: orden por categoría y luego nombre
      const catCompare = (a.category || "").localeCompare(b.category || "");
      if (catCompare !== 0) return catCompare;
      return a.name.localeCompare(b.name);
    });

    // Agrupación por categoría
    const groupOrder = ["Armor", "Weapons", "Consumables", "Equipment", "Containers", "Treasure"];
    const groupsMap = new Map();

    for (const item of activeItemList) {
      const cat = item.category || "Equipment";
      if (!groupsMap.has(cat)) groupsMap.set(cat, []);
      groupsMap.get(cat).push(item);
    }

    // Ordenar los grupos siguiendo groupOrder o alfabéticamente
    const sortedCategories = Array.from(groupsMap.keys()).sort((a, b) => {
      const indexA = groupOrder.indexOf(a);
      const indexB = groupOrder.indexOf(b);
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      return a.localeCompare(b);
    });

    const activeGroupedItems = sortedCategories.map((cat, idx) => ({
      category: cat,
      items: groupsMap.get(cat),
      isFirst: idx === 0
    }));

    return {
      isGM,
      isBuyTab: this.activeTab === "buy",
      isSellTab: this.activeTab === "sell",
      isBuybackTab: this.activeTab === "buyback",
      isIdentifyTab: this.activeTab === "identify",
      canIdentify,
      searchTerm: this.searchTerm,
      filterType: this.filterType,
      sortBy: this.sortBy,
      targetName: source?.name || game.i18n.localize("WOW_LOOTER.Merchant.DefaultName"),
      targetImg: source?.img || "icons/containers/bags/pack-leather-brown.webp",
      merchantDescription: lootSettings.customDescription || source?.system?.details?.biography?.value || source?.system?.description?.value || "",
      looterOptions,
      shopperName: shopper?.name || game.i18n.localize("WOW_LOOTER.Manual.NoLooterSelected"),
      shopperCurrenciesList,
      activeGroupedItems,
      hasAnyItems: activeGroupedItems.length > 0
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;
    protectDropdowns(html);

    // Selectores dropdown (evento change para evitar que el click cierre el desplegable)
    const shoppingSelect = html.querySelector(".shopping-as-select");
    if (shoppingSelect) {
      shoppingSelect.addEventListener("change", (ev) => MerchantApp._onChangeLooter.call(this, ev, ev.target));
    }

    const filterSelect = html.querySelector(".merchant-filter-select");
    if (filterSelect) {
      filterSelect.addEventListener("change", (ev) => MerchantApp._onFilterType.call(this, ev, ev.target));
    }

    const sortSelect = html.querySelector(".merchant-sort-select");
    if (sortSelect) {
      sortSelect.addEventListener("change", (ev) => MerchantApp._onSortItems.call(this, ev, ev.target));
    }

    // Inputs de stock del GM (evento change + límite mínimo 1)
    html.querySelectorAll(".merchant-stock-input").forEach((input) => {
      input.addEventListener("change", (ev) => MerchantApp._onEditStock.call(this, ev, ev.target));
    });

    // 1. Sincronización en vivo de sliders de cantidad en cajón de descripción
    html.querySelectorAll(".item-qty-slider-row").forEach((row) => {
      const slider = row.querySelector(".qty-slider");
      const valLabel = row.querySelector(".qty-slider-val");
      const card = row.closest(".merchant-item-card");
      const itemId = row.dataset.itemId;
      const unitCopper = Number(row.dataset.unitCopper || 0);
      const buyBtn = card?.querySelector(".btn-buy-green, .btn-sell-green, .btn-buyback-green");

      if (slider) {
        slider.addEventListener("input", (ev) => {
          const val = Number(ev.target.value) || 1;
          const max = slider.max || val;
          if (valLabel) valLabel.textContent = `${val} / ${max}`;

          if (this.activeTab === "buy") {
            this.buyQuantities.set(itemId, val);
          } else if (this.activeTab === "sell") {
            this.sellQuantities.set(itemId, val);
          } else if (this.activeTab === "buyback") {
            this.buybackQuantities.set(itemId, val);
          }

          if (buyBtn) {
            buyBtn.dataset.quantity = val;
            const totalCopper = unitCopper * val;
            const shopper = this.lootingToken?.actor || this.lootingActor;
            if (this.activeTab === "buy" || this.activeTab === "buyback") {
              const canAfford = shopper ? currencyService.canActorAfford(shopper, totalCopper) : false;
              buyBtn.disabled = !canAfford;
            }
          }
        });
      }
    });

    // 2. Filtro de búsqueda en tiempo real
    const searchInput = html.querySelector(".merchant-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", (ev) => {
        this.searchTerm = ev.target.value.trim();
        const term = this.searchTerm.toLowerCase();
        html.querySelectorAll(".merchant-item-card").forEach((card) => {
          const name = card.querySelector(".item-name")?.textContent?.toLowerCase() || "";
          card.style.display = (!term || name.includes(term)) ? "" : "none";
        });
      });
    }

    // 3. Drag & Drop de items o roll tables a la dropzone del mercader (Solo GM)
    if (game.user.isGM) {
      const dropZone = html.querySelector(".merchant-dropzone");
      if (dropZone) {
        dropZone.addEventListener("dragover", (ev) => {
          ev.preventDefault();
          dropZone.classList.add("drag-hover");
        });
        dropZone.addEventListener("dragleave", () => {
          dropZone.classList.remove("drag-hover");
        });
        dropZone.addEventListener("drop", async (ev) => {
          ev.preventDefault();
          dropZone.classList.remove("drag-hover");
          try {
            const data = JSON.parse(ev.dataTransfer.getData("text/plain"));
            const source = this.targetToken?.actor || this.targetActor;
            if (!source) return;

            if (data?.type === "Item" && data.uuid) {
              const item = await fromUuid(data.uuid);
              if (item) {
                const itemData = item.toObject();
                delete itemData._id;
                delete itemData._stats;
                if (isAmmunitionItem(item)) {
                  const qty = await promptAmmunitionQuantity(item.name, 10);
                  if (!qty) return;
                  normalizeAmmunitionItemData(itemData, qty);
                }
                await merchantService.addMerchantItem(source, itemData);
                ui.notifications.info(`${item.name} añadido a la tienda.`);
                this.render(false);
              }
            } else if (data?.type === "RollTable" && data.uuid) {
              const table = await fromUuid(data.uuid);
              if (table) {
                const roll = await table.roll();
                for (const res of roll.results) {
                  let item = null;
                  if (res.type === CONST.TABLE_RESULT_TYPES.DOCUMENT) {
                    item = await fromUuid(`Item.${res.documentId}`).catch(() => null);
                  } else if (res.type === CONST.TABLE_RESULT_TYPES.COMPENDIUM) {
                    item = await fromUuid(`Compendium.${res.documentCollection}.${res.documentId}`).catch(() => null);
                  }
                  if (item) {
                    const itemData = item.toObject();
                    delete itemData._id;
                    delete itemData._stats;
                    await merchantService.addMerchantItem(source, itemData);
                  }
                }
                ui.notifications.info(`Objetos de '${table.name}' añadidos al mercader.`);
                this.render(false);
              }
            }
          } catch (err) {
            console.error("[wow-looter] Error al soltar objeto en el mercader:", err);
          }
        });
      }
    }
  }

  // --- Handlers de Acciones (ApplicationV2) ---

  static _onSwitchTab(event, target) {
    const tab = target.dataset.tab;
    if (tab && (tab === "buy" || tab === "sell" || tab === "buyback" || tab === "identify")) {
      this.activeTab = tab;
      this.render(false);
    }
  }

  static _onFilterType(event, target) {
    this.filterType = target.value;
    this.render(false);
  }

  static _onSortItems(event, target) {
    this.sortBy = target.value;
    this.render(false);
  }

  static async _onBuyItem(event, target) {
    const itemId = target.dataset.itemId;
    const qty = Number(target.dataset.quantity || 1);
    const source = this.targetToken?.actor || this.targetActor;
    const buyer = this.lootingToken?.actor || this.lootingActor;

    if (!source || !buyer || !itemId) return;

    await merchantService.buyItem({
      merchantActor: source,
      buyerActor: buyer,
      itemId,
      quantity: qty,
      targetTokenId: this.targetToken?.id,
      lootingTokenId: this.lootingToken?.id
    });

    this.buyQuantities.delete(itemId);
    this.render(false);
  }

  static async _onSellItem(event, target) {
    const itemId = target.dataset.itemId;
    const qty = Number(target.dataset.quantity || 1);
    const source = this.targetToken?.actor || this.targetActor;
    const seller = this.lootingToken?.actor || this.lootingActor;

    if (!source || !seller || !itemId) return;

    const item = seller.items.get(itemId);
    if (!item) return;

    const lootSettings = source.getFlag?.(MODULE_ID, "lootSettings") || {};
    const sellModifier = Number(lootSettings.sellPriceModifier !== undefined ? lootSettings.sellPriceModifier : 50) / 100;
    const priceData = currencyService.getItemPriceData(item);
    const unitPayoutCopper = Math.round(priceData.copperValue * sellModifier);
    const adapter = getSystemAdapter();

    const res = await merchantService.sellItem({
      merchantActor: source,
      sellerActor: seller,
      itemId,
      quantity: qty,
      targetTokenId: this.targetToken?.id,
      lootingTokenId: this.lootingToken?.id
    });

    if (res) {
      // Registrar en el historial de Recompra (Buyback) para esta sesión
      const existing = this.buybackList.find(
        (b) => b.name === item.name && b.unitCopper === unitPayoutCopper && b.sellerActorId === seller.id
      );
      if (existing) {
        existing.quantity += qty;
      } else {
        this.buybackList.push({
          id: foundry.utils.randomID(),
          name: item.name,
          img: item.img || "icons/svg/item-bag.svg",
          quantity: qty,
          bulk: adapter.getItemBulk(item),
          category: adapter.getItemCategory(item),
          unitCopper: unitPayoutCopper,
          unitFormatted: currencyService.formatCopperPrice(unitPayoutCopper),
          sellerActorId: seller.id
        });
      }
    }

    this.sellQuantities.delete(itemId);
    this.render(false);
  }

  static async _onBuybackItem(event, target) {
    const buybackId = target.dataset.buybackId;
    const entry = this.buybackList.find((b) => b.id === buybackId);
    if (!entry) return;

    const qty = Number(target.dataset.quantity || entry.quantity);
    const source = this.targetToken?.actor || this.targetActor;
    const buyer = this.lootingToken?.actor || this.lootingActor;
    if (!source || !buyer) return;

    const success = await merchantService.buybackItem({
      merchantActor: source,
      buyerActor: buyer,
      itemName: entry.name,
      quantity: qty,
      unitCopper: entry.unitCopper,
      targetTokenId: this.targetToken?.id,
      lootingTokenId: this.lootingToken?.id
    });

    if (success) {
      entry.quantity -= qty;
      if (entry.quantity <= 0) {
        this.buybackList = this.buybackList.filter((b) => b.id !== buybackId);
      }
      this.buybackQuantities.delete(buybackId);
      this.render(false);
    }
  }

  static async _onIdentifyItem(event, target) {
    const itemId = target.dataset.itemId;
    const costCopper = Number(target.dataset.costCopper || 0);
    const source = this.targetToken?.actor || this.targetActor;
    const shopper = this.lootingToken?.actor || this.lootingActor;
    if (!source || !shopper || !itemId) return;

    const pendingKey = `${shopper.id}:${itemId}`;
    if (MerchantApp.pendingIdentifyKeys.has(pendingKey)) return;

    MerchantApp.pendingIdentifyKeys.add(pendingKey);
    this.render(false);

    try {
      const requested = await merchantService.requestIdentifyItem({
        merchantActor: source,
        shopperActor: shopper,
        itemId,
        costCopper,
        targetTokenId: this.targetToken?.id,
        lootingTokenId: this.lootingToken?.id
      });
      if (!requested || game.user.isGM) {
        MerchantApp.pendingIdentifyKeys.delete(pendingKey);
        this.render(false);
      }
    } catch (err) {
      MerchantApp.pendingIdentifyKeys.delete(pendingKey);
      this.render(false);
      throw err;
    }
  }

  static _onChangeLooter(event, target) {
    const actorId = target.value;
    if (actorId) {
      const candidate = game.actors.get(actorId);
      if (candidate) {
        this.lootingActor = candidate;
        const liveToken = canvas.tokens.placeables.find((t) => t.actor?.id === actorId);
        this.lootingToken = liveToken || null;
      }
    }
    this.render(false);
  }

  static _onToggleItemDesc(event, target) {
    const card = target.closest(".merchant-item-card");
    const desc = card?.querySelector(".item-description-drawer");
    const chevron = card?.querySelector(".toggle-desc-icon");
    if (desc) {
      const isHidden = desc.style.display === "none" || !desc.style.display;
      desc.style.display = isHidden ? "block" : "none";
      if (chevron) {
        chevron.className = isHidden ? "fas fa-chevron-up toggle-desc-icon" : "fas fa-chevron-down toggle-desc-icon";
      }
    }
  }

  static _onOpenActorSheet(event, target) {
    const source = this.targetToken?.actor || this.targetActor;
    source?.sheet?.render(true);
  }

  static _onOpenLootSettings(event, target) {
    new LootSettingsApp({
      targetToken: this.targetToken,
      targetActor: this.targetActor,
      parentApp: this
    }).render(true);
  }

  static async _onEditDescription(event, target) {
    if (!game.user.isGM) return;
    const source = this.targetToken?.actor || this.targetActor;
    if (!source) return;

    const lootSettings = source.getFlag?.(MODULE_ID, "lootSettings") || {};
    const currentDesc = lootSettings.customDescription || source.system?.details?.biography?.value || source.system?.description?.value || "";

    const content = `
      <form class="wow-looter-dialog-form">
        <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
          <label style="font-weight: 700; color: var(--wow-accent, #f7ce65);">
            <i class="fas fa-pencil"></i> ${game.i18n.localize("WOW_LOOTER.Merchant.Description")}:
          </label>
          <textarea name="description" rows="5" style="width: 100%; box-sizing: border-box; background: #0f131a; color: #f1f5f9; border: 1px solid #283345; border-radius: 4px; padding: 8px;">${currentDesc}</textarea>
        </div>
      </form>
    `;

    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("WOW_LOOTER.Merchant.EditDescription") },
      content,
      ok: {
        label: game.i18n.localize("WOW_LOOTER.Merchant.SaveDescription"),
        callback: (event, button) => button.form.elements.description.value
      },
      rejectClose: false
    });

    if (result !== null && result !== undefined) {
      await merchantService.updateMerchantSettings(source, {
        customDescription: result
      });
      this.render(false);
    }
  }

  static async _onAddRollTable(event, target) {
    if (!game.user.isGM) return;
    const source = this.targetToken?.actor || this.targetActor;
    if (!source) return;

    const tables = game.tables.contents;
    if (tables.length === 0) {
      ui.notifications.warn("No hay tablas de tiradas disponibles en el mundo.");
      return;
    }

    const tableOptions = tables.map((t) => `<option value="${t.id}">${t.name}</option>`).join("");
    const content = `
      <form class="wow-looter-dialog-form">
        <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
          <label style="font-weight: 700; color: #f7ce65;">
            <i class="fas fa-dice-d20"></i> ${game.i18n.localize("WOW_LOOTER.GM.SelectTable")}:
          </label>
          <select name="tableId" style="width: 100%; background: #0f131a; color: #f1f5f9; border: 1px solid #283345; border-radius: 4px; padding: 6px;">
            ${tableOptions}
          </select>
        </div>
        <div class="form-group" style="display: flex; flex-direction: column; gap: 6px; margin-top: 10px;">
          <label style="font-weight: 700; color: #f7ce65;">
            <i class="fas fa-hashtag"></i> ${game.i18n.localize("WOW_LOOTER.GM.RollCount")}:
          </label>
          <input type="number" name="rollCount" value="1" min="1" max="20" style="width: 100%; background: #0f131a; color: #f1f5f9; border: 1px solid #283345; border-radius: 4px; padding: 6px;" />
        </div>
      </form>
    `;

    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("WOW_LOOTER.Merchant.AddRollTable") },
      content,
      ok: {
        label: game.i18n.localize("WOW_LOOTER.GM.RollAndAdd"),
        callback: (event, button) => ({
          tableId: button.form.elements.tableId.value,
          rollCount: parseInt(button.form.elements.rollCount.value) || 1
        })
      },
      rejectClose: false
    });

    if (!result?.tableId) return;
    const table = game.tables.get(result.tableId);
    if (!table) return;

    for (let i = 0; i < result.rollCount; i++) {
      const roll = await table.roll();
      for (const res of roll.results) {
        let item = null;
        if (res.type === CONST.TABLE_RESULT_TYPES.DOCUMENT) {
          item = await fromUuid(`Item.${res.documentId}`).catch(() => null);
        } else if (res.type === CONST.TABLE_RESULT_TYPES.COMPENDIUM) {
          item = await fromUuid(`Compendium.${res.documentCollection}.${res.documentId}`).catch(() => null);
        }
        if (item) {
          const itemData = item.toObject();
          delete itemData._id;
          delete itemData._stats;
          await merchantService.addMerchantItem(source, itemData);
          continue;
        }

        const fallbackData = {
          name: res.text || res.name || "Loot",
          type: "loot",
          img: res.img || "icons/svg/item-bag.svg",
          system: {
            description: { value: res.text || "" },
            quantity: 1
          }
        };
        await merchantService.addMerchantItem(source, fallbackData);
      }
    }

    ui.notifications.info(`Objetos de '${table.name}' añadidos al stock.`);
    this.render(false);
  }

  static async _onEditItem(event, target) {
    event.preventDefault();
    event.stopPropagation();
    if (!game.user.isGM) return;
    const itemId = target.dataset.itemId || target.closest("[data-item-id]")?.dataset.itemId;
    if (!itemId) return;

    const source = this.targetToken?.actor || this.targetActor;
    let item = source?.items?.get(itemId);
    if (!item && this.activeTab === "sell") {
      const shopper = this.lootingToken?.actor || this.lootingActor;
      item = shopper?.items?.get(itemId);
    }
    if (item?.sheet) {
      item.sheet.render(true);
    }
  }

  static async _onItemSettings(event, target) {
    event.preventDefault();
    event.stopPropagation();
    if (!game.user.isGM) return;

    const itemId = target.dataset.itemId || target.closest("[data-item-id]")?.dataset.itemId;
    const source = this.targetToken?.actor || this.targetActor;
    const item = source?.items?.get(itemId);
    if (!item) return;

    new ItemSettingsApp({
      item,
      source,
      targetToken: this.targetToken,
      parentApp: this
    }).render(true);
  }

  static async _onToggleItemVisibility(event, target) {
    if (!game.user.isGM) return;
    const itemId = target.dataset.itemId;
    const source = this.targetToken?.actor || this.targetActor;
    if (!itemId || !source) return;

    const item = source.items.get(itemId);
    if (!item) return;

    const currentHidden = Boolean(item.getFlag(MODULE_ID, "hidden"));
    await item.setFlag(MODULE_ID, "hidden", !currentHidden);
    this.render(false);
  }

  static async _onEditStock(event, target) {
    if (!game.user.isGM) return;
    const itemId = target.dataset.itemId;
    const parsed = parseInt(target.value, 10);
    const newQty = Number.isFinite(parsed) ? Math.max(1, parsed) : 1;
    target.value = newQty;

    const source = this.targetToken?.actor || this.targetActor;
    if (!itemId || !source) return;

    const item = source.items.get(itemId);
    if (item) {
      await item.update({ "system.quantity": newQty });
      socketService.emit(SOCKET_EVENTS.MERCHANT_UPDATED, {
        merchantActorId: source.id,
        targetTokenId: this.targetToken?.id
      });
      this.render(false);
    }
  }

  static async _onStepStock(event, target) {
    if (!game.user.isGM) return;
    const itemId = target.dataset.itemId;
    const delta = Number(target.dataset.delta || 0);
    const source = this.targetToken?.actor || this.targetActor;
    if (!itemId || !source || !delta) return;

    const item = source.items.get(itemId);
    if (!item) return;

    const currentQty = Math.max(1, Number(item.system?.quantity ?? item.quantity ?? 1));
    const newQty = Math.max(1, currentQty + delta);
    if (newQty === currentQty) return;

    await item.update({ "system.quantity": newQty });
    socketService.emit(SOCKET_EVENTS.MERCHANT_UPDATED, {
      merchantActorId: source.id,
      targetTokenId: this.targetToken?.id
    });
    this.render(false);
  }

  static async _onGmDeleteItem(event, target) {
    if (!game.user.isGM) return;
    const itemId = target.dataset.itemId;
    const source = this.targetToken?.actor || this.targetActor;
    if (itemId && source) {
      await merchantService.deleteMerchantItem(source, itemId);
      this.render(false);
    }
  }

  async close(options = {}) {
    this.buybackList = [];
    this.buybackQuantities.clear();
    this.buyQuantities.clear();
    this.sellQuantities.clear();
    options.animate = false;
    if (this.element) {
      this.element.style.display = "none";
    }
    MerchantApp.activeInstance = null;
    return super.close(options);
  }

  static _onClose(event, target) {
    this.close({ animate: false });
  }
}
