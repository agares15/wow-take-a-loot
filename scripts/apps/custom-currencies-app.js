import { MODULE_ID } from "../constants.js";
import { currencyService } from "../services/currency-service.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Ventana de configuración de monedas personalizadas para WoW Looter.
 * Permite arrastrar y soltar cualquier Item para registrarlo como moneda en el módulo.
 */
export class CustomCurrenciesApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "wow-looter-custom-currencies",
    tag: "div",
    classes: ["wow-looter-app", "wow-looter-custom-currencies-app"],
    window: {
      title: "WOW_LOOTER.CustomCurrencies.Title",
      icon: "fas fa-coins",
      resizable: true
    },
    position: {
      width: 460,
      height: "auto"
    },
    actions: {
      "remove-currency": CustomCurrenciesApp._onRemoveCurrency,
      "close": CustomCurrenciesApp._onClose
    }
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/custom-currencies.hbs`
    }
  };

  async _prepareContext() {
    return {
      customCurrencies: currencyService.getCustomCurrencies()
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);

    // Manejador de edición de abreviación (máximo 4 caracteres)
    this.element.querySelectorAll(".custom-currency-abbr-input").forEach((input) => {
      input.addEventListener("input", (ev) => {
        if (ev.target.value.length > 4) {
          ev.target.value = ev.target.value.slice(0, 4);
        }
      });

      input.addEventListener("change", async (ev) => {
        const idx = Number(ev.target.dataset.index);
        if (isNaN(idx)) return;
        const cleanAbbr = ev.target.value.trim().slice(0, 4);
        ev.target.value = cleanAbbr;
        await currencyService.updateCustomCurrencyAbbr(idx, cleanAbbr);
      });
    });

    const dropZone = this.element.querySelector(".currency-drop-zone");
    if (!dropZone) return;

    // Manejador de Drag & Drop
    dropZone.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      dropZone.classList.add("drag-hover");
    });

    dropZone.addEventListener("dragleave", (ev) => {
      ev.preventDefault();
      dropZone.classList.remove("drag-hover");
    });

    dropZone.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      dropZone.classList.remove("drag-hover");

      try {
        const data = TextEditor.getDragEventData(ev);
        if (!data || data.type !== "Item") {
          ui.notifications.warn(game.i18n.localize("WOW_LOOTER.CustomCurrencies.WarnOnlyItems"));
          return;
        }

        const item = await Item.implementation.fromDropData(data);
        if (!item) return;

        const result = await currencyService.addCustomCurrency(item);
        if (result) {
          ui.notifications.info(`${game.i18n.localize("WOW_LOOTER.CustomCurrencies.Added")}: ${result.name}`);
          await this.render(false);
          const inputs = this.element?.querySelectorAll(".custom-currency-abbr-input");
          const lastInput = inputs?.[inputs.length - 1];
          lastInput?.focus();
        } else {
          ui.notifications.warn(game.i18n.localize("WOW_LOOTER.CustomCurrencies.AlreadyExists"));
        }
      } catch (err) {
        console.error("[wow-looter] Error al procesar drop de moneda:", err);
      }
    });
  }

  static async _onRemoveCurrency(event, target) {
    const idx = Number(target.dataset.index || target.closest("[data-index]")?.dataset.index);
    if (isNaN(idx)) return;
    await currencyService.removeCustomCurrency(idx);
    this.render(false);
  }

  async close(options = {}) {
    options.animate = false;
    if (this.element) {
      this.element.style.display = "none";
    }
    return super.close(options);
  }

  static _onClose(event, target) {
    this.close({ animate: false });
  }
}

