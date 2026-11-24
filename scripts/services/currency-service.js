import { MODULE_ID, SETTINGS } from "../constants.js";
import { getSystemAdapter } from "../adapters/index.js";

/**
 * Servicio centralizado para gestionar monedas estándar y monedas personalizadas (Items como Currency).
 */
export class CurrencyService {
  /**
   * Obtiene la lista de monedas personalizadas registradas en el mundo.
   * @returns {Array<{id: string, uuid: string, name: string, img: string, key: string, type: string, system: object}>}
   */
  static getCustomCurrencies() {
    try {
      return game.settings.get(MODULE_ID, SETTINGS.CUSTOM_CURRENCIES) || [];
    } catch {
      return [];
    }
  }

  /**
   * Registra un nuevo item como moneda personalizada.
   * @param {Item|object} item 
   * @returns {Promise<object|null>}
   */
  static async addCustomCurrency(item, abbr = "") {
    if (!item) return null;
    const list = [...this.getCustomCurrencies()];
    const key = (item.slug || item.system?.slug || item.name || "custom-coin")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]/g, "-");

    const alreadyExists = list.some((c) => c.key === key || c.name.toLowerCase() === item.name.toLowerCase());
    if (alreadyExists) return null;

    const cleanAbbr = String(abbr || "").trim().slice(0, 4);

    const entry = {
      id: item.id || foundry.utils.randomID(),
      uuid: item.uuid || "",
      name: item.name,
      abbr: cleanAbbr,
      img: item.img || "icons/commodities/currency/coins-gold.webp",
      key,
      type: item.type || (game.system.id === "pf2e" ? "treasure" : "loot"),
      system: foundry.utils.duplicate(item.system || {})
    };

    list.push(entry);
    await game.settings.set(MODULE_ID, SETTINGS.CUSTOM_CURRENCIES, list);
    return entry;
  }

  /**
   * Actualiza la abreviación (máx. 4 caracteres) de una moneda personalizada registrada.
   * @param {number} index
   * @param {string} abbr
   */
  static async updateCustomCurrencyAbbr(index, abbr) {
    const list = [...this.getCustomCurrencies()];
    if (index < 0 || index >= list.length) return null;
    const cleanAbbr = String(abbr || "").trim().slice(0, 4);
    list[index] = { ...list[index], abbr: cleanAbbr };
    await game.settings.set(MODULE_ID, SETTINGS.CUSTOM_CURRENCIES, list);
    return list[index];
  }

  /**
   * Elimina una moneda personalizada por índice o clave.
   * @param {number|string} identifier 
   */
  static async removeCustomCurrency(identifier) {
    let list = [...this.getCustomCurrencies()];
    if (typeof identifier === "number") {
      list.splice(identifier, 1);
    } else {
      list = list.filter((c) => c.key !== identifier && c.name !== identifier);
    }
    await game.settings.set(MODULE_ID, SETTINGS.CUSTOM_CURRENCIES, list);
  }

  /**
   * Determina si un objeto/item del inventario corresponde a una moneda personalizada.
   * @param {Item|object} item 
   * @param {string} [specificKey] 
   * @returns {boolean}
   */
  static isCustomCurrencyItem(item, specificKey = null) {
    if (!item) return false;
    const customList = this.getCustomCurrencies();
    if (customList.length === 0) return false;

    const itemName = item.name?.toLowerCase().trim();
    const itemSlug = (item.slug || item.system?.slug || "").toLowerCase().trim();

    return customList.some((c) => {
      if (specificKey && c.key !== specificKey) return false;
      return c.key === itemSlug || c.name.toLowerCase() === itemName || (item.flags?.[MODULE_ID]?.currencyKey === c.key);
    });
  }

  /**
   * Obtiene la clave de moneda personalizada para un item si coincide.
   * @param {Item|object} item 
   * @returns {string|null}
   */
  static getCustomCurrencyKeyForItem(item) {
    if (!item) return null;
    const customList = this.getCustomCurrencies();
    const itemName = item.name?.toLowerCase().trim();
    const itemSlug = (item.slug || item.system?.slug || "").toLowerCase().trim();

    const match = customList.find((c) => {
      return c.key === itemSlug || c.name.toLowerCase() === itemName || (item.flags?.[MODULE_ID]?.currencyKey === c.key);
    });
    return match ? match.key : null;
  }

  /**
   * Devuelve los metadatos completos (clave, etiqueta, icono, isCustom) de una moneda.
   * @param {string} key 
   * @returns {{key: string, label: string, img: string, isCustom: boolean}}
   */
  static getCurrencyMetadata(key) {
    const k = String(key).toLowerCase();
    const custom = this.getCustomCurrencies().find((c) => c.key === k || c.name.toLowerCase() === k);
    if (custom) {
      return {
        key: custom.key,
        label: custom.abbr || custom.name,
        img: custom.img || "icons/commodities/currency/coins-gold.webp",
        isCustom: true
      };
    }

    const adapter = getSystemAdapter();
    return {
      key: k,
      label: k.toUpperCase(),
      img: adapter.getCurrencyImage(k),
      isCustom: false
    };
  }

  /**
   * Lee todas las monedas (estándar + personalizadas) de un actor.
   * @param {Actor} actor 
   * @returns {Record<string, number>}
   */
  static getActorCurrencies(actor) {
    if (!actor) return {};
    const adapter = getSystemAdapter();
    const currencies = { ...adapter.getActorCurrencies(actor) };

    const customList = this.getCustomCurrencies();
    for (const c of customList) {
      currencies[c.key] = 0;
    }

    if (actor.items) {
      for (const item of actor.items) {
        const cKey = this.getCustomCurrencyKeyForItem(item);
        if (cKey) {
          const qty = Number(item.system?.quantity ?? item.quantity ?? 1);
          currencies[cKey] = (currencies[cKey] || 0) + qty;
        }
      }
    }

    return currencies;
  }

  /**
   * Filtra los objetos de botín excluyendo aquellos que son monedas personalizadas.
   * @param {Item[]} items 
   * @returns {Item[]}
   */
  static filterLootableItems(items) {
    if (!items || items.length === 0) return [];
    return items.filter((i) => !this.isCustomCurrencyItem(i));
  }

  /**
   * Otorga una cantidad de moneda (estándar o personalizada) a un actor.
   * @param {Actor} destinationActor 
   * @param {string} currencyKey 
   * @param {number} amount 
   */
  static async giveCurrency(destinationActor, currencyKey, amount) {
    if (!destinationActor || amount <= 0) return;
    const adapter = getSystemAdapter();
    const meta = this.getCurrencyMetadata(currencyKey);

    if (!meta.isCustom) {
      await adapter.modifyActorCurrencies(destinationActor, { [currencyKey]: amount });
      return;
    }

    // Moneda personalizada como Item
    const existing = destinationActor.items.find((i) => this.isCustomCurrencyItem(i, currencyKey));
    if (existing) {
      const curQty = Number(existing.system?.quantity ?? existing.quantity ?? 1);
      await existing.update({ "system.quantity": curQty + amount });
    } else {
      const customDef = this.getCustomCurrencies().find((c) => c.key === currencyKey);
      let itemData = null;
      if (customDef?.uuid) {
        const original = await fromUuid(customDef.uuid).catch(() => null);
        if (original) itemData = original.toObject();
      }
      if (!itemData) {
        itemData = {
          name: customDef?.name || meta.label,
          type: customDef?.type || (game.system.id === "pf2e" ? "treasure" : "loot"),
          img: customDef?.img || meta.img,
          system: foundry.utils.duplicate(customDef?.system || {}),
          flags: {
            [MODULE_ID]: { currencyKey }
          }
        };
      }
      foundry.utils.setProperty(itemData, "system.quantity", amount);
      await destinationActor.createEmbeddedDocuments("Item", [itemData]);
    }
  }

  /**
   * Descuenta una cantidad de moneda (estándar o personalizada) de un actor.
   * @param {Actor} sourceActor 
   * @param {string} currencyKey 
   * @param {number} amount 
   */
  static async deductCurrency(sourceActor, currencyKey, amount) {
    if (!sourceActor || amount <= 0) return;
    const adapter = getSystemAdapter();
    const meta = this.getCurrencyMetadata(currencyKey);

    if (!meta.isCustom) {
      await adapter.modifyActorCurrencies(sourceActor, { [currencyKey]: -amount });
      return;
    }

    // Moneda personalizada como Item
    const matchingItems = sourceActor.items.filter((i) => this.isCustomCurrencyItem(i, currencyKey));
    let remaining = amount;
    for (const item of matchingItems) {
      if (remaining <= 0) break;
      const curQty = Number(item.system?.quantity ?? item.quantity ?? 1);
      if (curQty <= remaining) {
        remaining -= curQty;
        await item.delete();
      } else {
        await item.update({ "system.quantity": curQty - remaining });
        remaining = 0;
      }
    }
  }

  /**
   * Establece directamente el monto absoluto de una moneda en un actor.
   * @param {Actor} actor 
   * @param {string} currencyKey 
   * @param {number} targetAmount 
   */
  static async setActorCurrency(actor, currencyKey, targetAmount) {
    if (!actor || !currencyKey) return;
    const current = (this.getActorCurrencies(actor)[currencyKey]) || 0;
    const target = Math.max(0, Number(targetAmount) || 0);
    const diff = target - current;
    if (diff > 0) {
      await this.giveCurrency(actor, currencyKey, diff);
    } else if (diff < 0) {
      await this.deductCurrency(actor, currencyKey, Math.abs(diff));
    }
  }

  /**
   * Transfiere una cantidad específica de moneda entre dos actores.
   */
  static async transferCurrency(sourceActor, destinationActor, currencyKey, amount) {
    if (!sourceActor || !destinationActor || amount <= 0) return;
    const available = this.getActorCurrencies(sourceActor)[currencyKey] || 0;
    const toTransfer = Math.min(amount, available);
    if (toTransfer <= 0) return;

    await this.deductCurrency(sourceActor, currencyKey, toTransfer);
    await this.giveCurrency(destinationActor, currencyKey, toTransfer);
  }

  /**
   * Transfiere todo el dinero (estándar y personalizado) de sourceActor a destinationActor.
   */
  static async transferAllCurrencies(sourceActor, destinationActor) {
    if (!sourceActor || !destinationActor) return;
    const currencies = this.getActorCurrencies(sourceActor);

    for (const [key, value] of Object.entries(currencies)) {
      if (value > 0) {
        await this.transferCurrency(sourceActor, destinationActor, key, value);
      }
    }
  }

  /**
   * Divide todas las monedas disponibles entre los actores elegibles.
   */
  static async splitCurrenciesWithParty(sourceActor, eligibleActors) {
    if (!sourceActor || !eligibleActors || eligibleActors.length === 0) return;
    const currencies = this.getActorCurrencies(sourceActor);
    const count = eligibleActors.length;

    for (const [key, total] of Object.entries(currencies)) {
      if (total <= 0) continue;
      const perActor = Math.floor(total / count);
      let remainder = total % count;

      for (const actor of eligibleActors) {
        let give = perActor;
        if (remainder > 0) {
          give += 1;
          remainder -= 1;
        }
        if (give > 0) {
          await this.transferCurrency(sourceActor, actor, key, give);
        }
      }
    }
  }

  /**
   * Obtiene los datos de precio de un item en cobre (unidad base común) y su desglose.
   * @param {Item} item
   * @returns {{ copperValue: number, label: string, rawValue: number, denomination: string }}
   */
  static getItemPriceData(item) {
    if (!item) return { copperValue: 0, label: "0 GP", rawValue: 0, denomination: "gp" };

    // 1. Comprobar si hay un override de precio personalizado establecido por el GM en el módulo
    const customPrice = item.getFlag?.(MODULE_ID, "customPrice");
    if (customPrice !== undefined && customPrice !== null) {
      if (typeof customPrice === "number") {
        return {
          copperValue: Math.max(0, customPrice),
          label: this.formatCopperPrice(customPrice),
          rawValue: customPrice,
          denomination: "cp"
        };
      }
      if (typeof customPrice === "object") {
        const val = Number(customPrice.value || 0);
        const denom = (customPrice.denomination || "gp").toLowerCase();
        const mult = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 }[denom] || 100;
        const copperValue = Math.round(val * mult);
        return {
          copperValue: Math.max(0, copperValue),
          label: this.formatCopperPrice(copperValue),
          rawValue: val,
          denomination: denom
        };
      }
    }

    // 2. Sistema PF2e
    if (game.system.id === "pf2e") {
      if (item.price?.copperValue !== undefined) {
        const copperValue = Number(item.price.copperValue || 0);
        return {
          copperValue,
          label: item.price.value?.toString?.() || this.formatCopperPrice(copperValue),
          rawValue: copperValue,
          denomination: "cp"
        };
      }
      const priceVal = item.system?.price?.value;
      if (priceVal && typeof priceVal === "object") {
        const cp = Number(priceVal.cp || 0);
        const sp = Number(priceVal.sp || 0);
        const gp = Number(priceVal.gp || 0);
        const pp = Number(priceVal.pp || 0);
        const copperValue = cp + sp * 10 + gp * 100 + pp * 1000;
        return {
          copperValue,
          label: this.formatCopperPrice(copperValue),
          rawValue: copperValue,
          denomination: "cp"
        };
      }
      if (typeof priceVal === "string") {
        const parts = priceVal.trim().split(" ");
        if (parts.length === 2) {
          const num = parseFloat(parts[0]) || 0;
          const denom = parts[1].toLowerCase();
          const mult = { cp: 1, sp: 10, gp: 100, pp: 1000 }[denom] || 100;
          const copperValue = Math.round(num * mult);
          return {
            copperValue,
            label: priceVal,
            rawValue: num,
            denomination: denom
          };
        }
      }
    }

    // 3. Sistema D&D 5e
    if (game.system.id === "dnd5e") {
      const priceObj = item.system?.price;
      const val = Number(priceObj?.value || 0);
      const denom = (priceObj?.denomination || "gp").toLowerCase();
      const mult = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 }[denom] || 100;
      const copperValue = Math.round(val * mult);
      return {
        copperValue,
        label: `${val} ${denom.toUpperCase()}`,
        rawValue: val,
        denomination: denom
      };
    }

    // Fallback genérico
    const rawVal = Number(item.system?.price?.value ?? item.system?.price ?? 0);
    const copperValue = Math.round(rawVal * 100);
    return {
      copperValue,
      label: `${rawVal} GP`,
      rawValue: rawVal,
      denomination: "gp"
    };
  }

  /**
   * Evalúa el precio efectivo de compra de un item en el mercader,
   * considerando isFree, customPrice (incluyendo monedas personalizadas) y priceModifier.
   */
  static evaluateItemBuyPrice(item, globalBuyModifier = 100, itemSettings = null) {
    const settings = itemSettings || item?.getFlag?.(MODULE_ID, "merchantItemSettings") || {};
    if (settings.isFree) {
      return {
        isFree: true,
        isCustomPrice: false,
        copperValue: 0,
        customAmounts: {},
        formattedPrice: game.i18n.localize("WOW_LOOTER.Merchant.Free")
      };
    }

    const rawBuyMod = settings.buyPriceModifier ?? settings.priceModifier;
    const hasCustomModifier = rawBuyMod !== null && rawBuyMod !== undefined && rawBuyMod !== "";
    const effectiveModifier = hasCustomModifier ? Math.max(0, Number(rawBuyMod)) : Number(globalBuyModifier ?? 100);

    if (Array.isArray(settings.customPrice) && settings.customPrice.length > 0) {
      const mult = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 };
      let copperValue = 0;
      const customAmounts = {};
      const parts = [];
      const modFactor = hasCustomModifier ? (effectiveModifier / 100) : 1;

      for (const entry of settings.customPrice) {
        const rawAmt = Number(entry?.amount || 0);
        const amt = Math.max(0, Math.round(rawAmt * modFactor));
        if (!entry?.key || amt <= 0) continue;
        const k = String(entry.key).toLowerCase();
        const meta = this.getCurrencyMetadata(k);
        if (meta.isCustom) {
          customAmounts[meta.key] = (customAmounts[meta.key] || 0) + amt;
        } else {
          copperValue += amt * (mult[k] || 100);
        }
        parts.push(`${amt} ${meta.label}`);
      }

      if (parts.length > 0) {
        return {
          isFree: false,
          isCustomPrice: true,
          copperValue,
          customAmounts,
          formattedPrice: parts.join(", ")
        };
      }
    }

    const basePriceData = this.getItemPriceData(item);
    const copperValue = Math.max(0, Math.round(basePriceData.copperValue * (effectiveModifier / 100)));
    return {
      isFree: copperValue === 0,
      isCustomPrice: false,
      copperValue,
      customAmounts: {},
      formattedPrice: copperValue === 0 ? game.i18n.localize("WOW_LOOTER.Merchant.Free") : this.formatCopperPrice(copperValue)
    };
  }

  /**
   * Comprueba si un actor puede pagar una evaluación de precio (monedas estándar + personalizadas).
   */
  static canActorAffordPrice(actor, priceEval, quantity = 1) {
    if (!actor || !priceEval) return false;
    if (priceEval.isFree) return true;
    const qty = Math.max(1, Number(quantity) || 1);

    if (priceEval.copperValue > 0 && !this.canActorAfford(actor, priceEval.copperValue * qty)) {
      return false;
    }

    const customEntries = Object.entries(priceEval.customAmounts || {});
    if (customEntries.length > 0) {
      const actorCurrencies = this.getActorCurrencies(actor);
      for (const [key, amt] of customEntries) {
        if (Number(actorCurrencies[key] || 0) < amt * qty) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Formatea un valor en cobre a una cadena legible (ej: "15 GP", "2 SP, 5 CP").
   */
  static formatCopperPrice(copperValue) {
    if (!copperValue || copperValue <= 0) return "0 GP";
    const copper = Math.round(copperValue);
    if (copper % 100 === 0) {
      return `${copper / 100} GP`;
    }
    if (copper >= 100) {
      const gp = Math.floor(copper / 100);
      const rem = copper % 100;
      if (rem % 10 === 0) {
        return `${gp} GP, ${rem / 10} SP`;
      }
      const sp = Math.floor(rem / 10);
      const cp = rem % 10;
      return sp > 0 ? `${gp} GP, ${sp} SP, ${cp} CP` : `${gp} GP, ${cp} CP`;
    }
    if (copper % 10 === 0) {
      return `${copper / 10} SP`;
    }
    if (copper >= 10) {
      return `${Math.floor(copper / 10)} SP, ${copper % 10} CP`;
    }
    return `${copper} CP`;
  }

  /**
   * Calcula el total de fondos en cobre de un actor.
   */
  static getActorTotalCopper(actor) {
    if (!actor) return 0;
    const currencies = this.getActorCurrencies(actor);
    let totalCopper = 0;
    const rates = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 };

    for (const [key, amount] of Object.entries(currencies)) {
      if (amount <= 0) continue;
      const rate = rates[key.toLowerCase()] || 100;
      totalCopper += amount * rate;
    }
    return totalCopper;
  }

  /**
   * Comprueba si el actor puede pagar una cantidad en cobre.
   */
  static canActorAfford(actor, copperCost) {
    if (copperCost <= 0) return true;
    return this.getActorTotalCopper(actor) >= copperCost;
  }

  /**
   * Deduce una cantidad de fondos en cobre de un actor, haciendo cambio si es necesario.
   */
  static async deductCopperFromActor(actor, copperCost) {
    if (!actor || copperCost <= 0) return;
    const adapter = getSystemAdapter();

    // En PF2e para Player Characters
    if (game.system.id === "pf2e" && adapter.isPlayerCharacter(actor) && actor.inventory?.removeCoins) {
      const gp = Math.floor(copperCost / 100);
      const sp = Math.floor((copperCost % 100) / 10);
      const cp = copperCost % 10;
      const coins = {};
      if (gp > 0) coins.gp = gp;
      if (sp > 0) coins.sp = sp;
      if (cp > 0) coins.cp = cp;
      try {
        await actor.inventory.removeCoins(coins);
        return;
      } catch (err) {
        console.warn("[wow-looter] Fallback a deducción manual en PF2e:", err);
      }
    }

    // Deducción manual estándar para D&D 5e o NPCs/Loot de PF2e
    const current = this.getActorCurrencies(actor);
    const rates = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 };
    let currentTotal = 0;
    for (const [k, v] of Object.entries(current)) {
      currentTotal += (v || 0) * (rates[k.toLowerCase()] || 100);
    }

    const remainingTotal = Math.max(0, currentTotal - copperCost);

    let rem = remainingTotal;
    const updated = {};
    for (const key of adapter.getCurrencyKeys()) {
      updated[key] = 0;
    }

    const sortedKeys = [...adapter.getCurrencyKeys()].sort((a, b) => (rates[b] || 100) - (rates[a] || 100));
    for (const key of sortedKeys) {
      const rate = rates[key] || 100;
      if (key === "cp") {
        updated[key] = rem;
        rem = 0;
      } else {
        const count = Math.floor(rem / rate);
        updated[key] = count;
        rem %= rate;
      }
    }

    const delta = {};
    for (const key of adapter.getCurrencyKeys()) {
      delta[key] = updated[key] - (current[key] || 0);
    }
    await adapter.modifyActorCurrencies(actor, delta);
  }

  /**
   * Añade una cantidad de fondos en cobre a un actor.
   */
  static async addCopperToActor(actor, copperAmount) {
    if (!actor || copperAmount <= 0) return;
    const adapter = getSystemAdapter();

    // En PF2e para PCs
    if (game.system.id === "pf2e" && adapter.isPlayerCharacter(actor) && actor.inventory?.addCoins) {
      const gp = Math.floor(copperAmount / 100);
      const sp = Math.floor((copperAmount % 100) / 10);
      const cp = copperAmount % 10;
      const coins = {};
      if (gp > 0) coins.gp = gp;
      if (sp > 0) coins.sp = sp;
      if (cp > 0) coins.cp = cp;
      try {
        await actor.inventory.addCoins(coins);
        return;
      } catch (err) {
        console.warn("[wow-looter] Fallback a adición manual en PF2e:", err);
      }
    }

    const gp = Math.floor(copperAmount / 100);
    const sp = Math.floor((copperAmount % 100) / 10);
    const cp = copperAmount % 10;
    const delta = { gp, sp, cp };
    await adapter.modifyActorCurrencies(actor, delta);
  }
}
export const currencyService = CurrencyService;

