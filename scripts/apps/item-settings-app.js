import { MODULE_ID, SOCKET_EVENTS } from "../constants.js";
import { getSystemAdapter } from "../adapters/index.js";
import { currencyService } from "../services/currency-service.js";
import { socketService } from "../services/socket-service.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Ventana de configuración individual para un artículo dentro de un Comerciante.
 */
export class ItemSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.item = options.item;
    this.source = options.source || this.item?.actor;
    this.targetToken = options.targetToken || null;
    this.parentApp = options.parentApp || null;
  }

  static DEFAULT_OPTIONS = {
    id: "wow-looter-item-settings",
    tag: "div",
    classes: ["wow-looter-app", "wow-looter-settings-app", "wow-looter-item-settings-app"],
    window: {
      title: "WOW_LOOTER.Merchant.ItemSettings",
      icon: "fas fa-cog",
      resizable: false
    },
    position: {
      width: 480,
      height: "auto"
    },
    actions: {
      "toggle-custom-price": ItemSettingsApp._onToggleCustomPrice,
      "save-settings": ItemSettingsApp._onSaveSettings,
      "cancel": ItemSettingsApp._onCancel
    }
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/item-settings.hbs`
    }
  };

  async _prepareContext() {
    const existing = this.item?.getFlag?.(MODULE_ID, "merchantItemSettings") || {};
    const merchantLootSettings = this.source?.getFlag?.(MODULE_ID, "lootSettings") || {};
    const defaultBuyMod = Number(merchantLootSettings.buyPriceModifier !== undefined ? merchantLootSettings.buyPriceModifier : 100);
    const defaultSellMod = Number(merchantLootSettings.sellPriceModifier !== undefined ? merchantLootSettings.sellPriceModifier : 50);

    const rawBuy = existing.buyPriceModifier ?? existing.priceModifier;
    const buyPriceModifier = (rawBuy !== null && rawBuy !== undefined && rawBuy !== "") ? Number(rawBuy) : defaultBuyMod;
    const sellPriceModifier = (existing.sellPriceModifier !== null && existing.sellPriceModifier !== undefined && existing.sellPriceModifier !== "")
      ? Number(existing.sellPriceModifier)
      : defaultSellMod;

    const adapter = getSystemAdapter();
    const allCurrencyKeys = Array.from(new Set([
      ...adapter.getCurrencyKeys(),
      ...currencyService.getCustomCurrencies().map((c) => c.key)
    ]));

    const customMap = new Map();
    for (const entry of existing.customPrice || []) {
      if (entry?.key) customMap.set(entry.key, Number(entry.amount || 0));
    }
    const hasCustomPrice = Array.isArray(existing.customPrice) && existing.customPrice.some((c) => Number(c.amount) > 0);

    const customCurrencies = allCurrencyKeys.map((key) => {
      const meta = currencyService.getCurrencyMetadata(key);
      return {
        key,
        label: meta.label,
        img: meta.img,
        amount: customMap.get(key) || 0
      };
    });

    return {
      itemName: this.item?.name || "Item",
      infiniteQuantity: Boolean(existing.infiniteQuantity),
      keepWhenSoldOut: Boolean(existing.keepWhenSoldOut),
      isService: Boolean(existing.isService),
      isFree: Boolean(existing.isFree),
      buyPriceModifier,
      buySliderVal: Math.min(300, Math.max(0, buyPriceModifier)),
      sellPriceModifier,
      sellSliderVal: Math.min(300, Math.max(0, sellPriceModifier)),
      hasCustomPrice,
      customCurrencies
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;

    const bindSliderPair = (sliderSel, inputSel) => {
      const slider = html.querySelector(sliderSel);
      const numInput = html.querySelector(inputSel);
      if (!slider || !numInput) return;
      slider.addEventListener("input", () => {
        numInput.value = slider.value;
      });
      numInput.addEventListener("input", () => {
        const val = Math.max(0, Number(numInput.value || 0));
        slider.value = String(Math.min(300, val));
      });
    };
    bindSliderPair("#mis-buy-slider", "#mis-buy-mod");
    bindSliderPair("#mis-sell-slider", "#mis-sell-mod");
  }

  static _onToggleCustomPrice(event, target) {
    const panel = this.element?.querySelector("#mis-custom-price-panel");
    if (panel) {
      panel.style.display = panel.style.display === "none" ? "grid" : "none";
    }
  }

  static async _onSaveSettings(event, target) {
    if (!game.user.isGM || !this.item) return;
    const html = this.element;

    const infiniteQuantity = Boolean(html.querySelector("#mis-infinite")?.checked);
    const keepWhenSoldOut = Boolean(html.querySelector("#mis-keep-soldout")?.checked);
    const isService = Boolean(html.querySelector("#mis-service")?.checked);
    const isFree = Boolean(html.querySelector("#mis-free")?.checked);
    const rawBuy = html.querySelector("#mis-buy-mod")?.value;
    const rawSell = html.querySelector("#mis-sell-mod")?.value;
    const buyPriceModifier = (rawBuy !== "" && rawBuy !== undefined) ? Math.max(0, Number(rawBuy)) : null;
    const sellPriceModifier = (rawSell !== "" && rawSell !== undefined) ? Math.max(0, Number(rawSell)) : null;

    const customPrice = [];
    html.querySelectorAll(".custom-price-currency-input").forEach((inp) => {
      const amt = Math.max(0, Math.floor(Number(inp.value || 0)));
      if (amt > 0 && inp.dataset.currencyKey) {
        customPrice.push({ key: inp.dataset.currencyKey, amount: amt });
      }
    });

    await this.item.setFlag(MODULE_ID, "merchantItemSettings", {
      infiniteQuantity,
      keepWhenSoldOut,
      isService,
      isFree,
      buyPriceModifier,
      sellPriceModifier,
      customPrice: customPrice.length > 0 ? customPrice : null
    });

    socketService.emit(SOCKET_EVENTS.MERCHANT_UPDATED, {
      merchantActorId: this.source?.id,
      targetTokenId: this.targetToken?.id
    });

    if (this.parentApp && this.parentApp.rendered) {
      this.parentApp.render(false);
    }

    this.close({ animate: false });
  }

  async close(options = {}) {
    options.animate = false;
    if (this.element) {
      this.element.style.display = "none";
    }
    return super.close(options);
  }

  static _onCancel(event, target) {
    this.close({ animate: false });
  }
}
