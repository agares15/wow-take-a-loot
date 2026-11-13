import { BaseSystemAdapter } from "./base-adapter.js";
import { MODULE_ID, FLAGS } from "../constants.js";

/**
 * Adaptador específico para D&D 5e.
 */
export class Dnd5eAdapter extends BaseSystemAdapter {
  get systemId() {
    return "dnd5e";
  }

  getCurrencyKeys() {
    return ["cp", "sp", "ep", "gp", "pp"];
  }

  getCurrencyImage(key) {
    const k = String(key).toLowerCase();
    if (CONFIG.DND5E?.currencies?.[k]?.icon) {
      return CONFIG.DND5E.currencies[k].icon;
    }
    const defaults = {
      cp: "icons/commodities/currency/coins-copper.webp",
      sp: "icons/commodities/currency/coins-silver.webp",
      ep: "icons/commodities/currency/coin-inlaid-bronze.webp",
      gp: "icons/commodities/currency/coins-gold.webp",
      pp: "icons/commodities/currency/coins-platinum.webp"
    };
    return defaults[k] || "icons/commodities/currency/coins-gold.webp";
  }

  getActorCurrencies(actor) {
    const currency = actor?.system?.currency || {};
    return {
      cp: Number(currency.cp || 0),
      sp: Number(currency.sp || 0),
      ep: Number(currency.ep || 0),
      gp: Number(currency.gp || 0),
      pp: Number(currency.pp || 0)
    };
  }

  async modifyActorCurrencies(actor, currencies) {
    if (!actor) return;
    const current = this.getActorCurrencies(actor);
    const updated = {};

    for (const key of this.getCurrencyKeys()) {
      const change = Number(currencies[key] || 0);
      updated[key] = Math.max(0, current[key] + change);
    }

    await actor.update({ "system.currency": updated });
  }

  getLootableItems(actor) {
    if (!actor) return [];
    const validTypes = new Set(["weapon", "equipment", "consumable", "tool", "loot", "container"]);
    return actor.items.filter((item) => {
      // Filtrar items no físicos o ataques naturales sin valor de inventario
      if (!validTypes.has(item.type)) return false;
      // Opcional: ignorar ataques de monstruos si vienen marcados como armas naturales
      if (item.system?.weaponType === "natural" || item.system?.type?.value === "natural") return false;
      return true;
    });
  }

  async transferItem(sourceActor, targetActor, itemOrId, quantity = 1) {
    const item = typeof itemOrId === "string" ? sourceActor.items.get(itemOrId) : itemOrId;
    if (!item) return null;

    const sourceQty = Number(item.system?.quantity ?? 1);
    const transferQty = Math.min(Math.max(1, quantity), sourceQty);

    const itemData = item.toObject();
    delete itemData._id;
    delete itemData._stats;
    itemData.system = itemData.system || {};
    itemData.system.quantity = transferQty;
    if (itemData.system.equipped !== undefined) {
      itemData.system.equipped = false;
    }

    // Verificar si el targetActor ya tiene un item idéntico apilable
    let createdItem = null;
    const existing = targetActor.items.find(
      (i) => i.name === item.name && i.type === item.type
    );

    if (existing && existing.system?.quantity !== undefined) {
      const newQty = Number(existing.system.quantity) + transferQty;
      await existing.update({ "system.quantity": newQty });
      createdItem = existing;
    } else {
      const created = await targetActor.createEmbeddedDocuments("Item", [itemData]);
      createdItem = created[0];
    }

    // Descontar o eliminar del actor de origen
    if (sourceQty <= transferQty) {
      await item.delete();
    } else {
      await item.update({ "system.quantity": sourceQty - transferQty });
    }

    return createdItem;
  }

  async createLootOnScene(name, coords, items = [], currencies = {}) {
    const isSingleItem = items.length === 1;
    const defaultIcon = isSingleItem ? items[0].img : "icons/containers/bags/pack-leather-brown.webp";
    const lootName = isSingleItem ? items[0].name : (name || "Loot Pile");

    // Usar actor dummy único en el mundo para evitar crear múltiples actores
    const dummyActor = await this.getOrCreateDummyActor();

    const tokenData = await dummyActor.getTokenDocument({
      x: coords.x,
      y: coords.y,
      name: lootName,
      texture: { src: defaultIcon },
      actorLink: false,
      disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
      displayBars: CONST.TOKEN_DISPLAY_MODES.NONE,
      displayName: CONST.TOKEN_DISPLAY_MODES.HOVER,
      flags: {
        [MODULE_ID]: {
          [FLAGS.IS_LOOTABLE]: true,
          [FLAGS.LOOT_GENERATED]: true,
          containerType: isSingleItem ? "item" : "bag"
        }
      }
    });

    const [createdToken] = await canvas.scene.createEmbeddedDocuments("Token", [tokenData]);
    const syntheticActor = createdToken.actor;

    // Actualizar nombre e imagen de la instancia desvinculada
    await syntheticActor.update({
      name: lootName,
      img: defaultIcon
    });

    if (items.length > 0) {
      const itemsData = items.map((i) => {
        const obj = i.toObject ? i.toObject() : i;
        delete obj._id;
        delete obj._stats;
        return obj;
      });
      await syntheticActor.createEmbeddedDocuments("Item", itemsData);
    }

    if (Object.values(currencies).some((v) => Number(v) > 0)) {
      await this.modifyActorCurrencies(syntheticActor, currencies);
    }

    return createdToken;
  }

  isItemIdentified(item) {
    if (!item) return true;
    if (item.getFlag?.(MODULE_ID, "unidentified") === true) return false;
    if (item.system?.identified !== undefined) {
      return Boolean(item.system.identified);
    }
    return true;
  }

  async identifyItem(item) {
    if (!item) return false;
    if (item.getFlag?.(MODULE_ID, "unidentified")) {
      await item.unsetFlag(MODULE_ID, "unidentified");
    }
    if (item.system?.identified !== undefined) {
      await item.update({ "system.identified": true });
    }
    return true;
  }

  getItemRarity(item) {
    const r = (item?.system?.rarity || "common").toLowerCase().replace(/\s+/g, "");
    if (["uncommon", "rare", "veryrare", "legendary", "artifact"].includes(r)) return r;
    return "common";
  }

  getUnidentifiedItemName(item) {
    return item?.system?.unidentified?.name || item?.name || "Objeto desconocido";
  }

  getUnidentifiedItemImg(item) {
    return item?.system?.unidentified?.img || item?.img || "icons/svg/mystery-man.svg";
  }

  getItemBulk(item) {
    if (!item) return "-";
    const raw = item.system?.weight;
    const w = (raw && typeof raw === "object") ? raw.value : raw;
    if (w !== undefined && w !== null && Number(w) !== 0) return String(w);
    return "-";
  }

  getItemCategory(item) {
    const type = (item?.type || "").toLowerCase();
    if (type === "weapon") return "Weapons";
    if (type === "consumable") return "Consumables";
    if (type === "container") return "Containers";
    if (type === "loot") return "Treasure";
    if (type === "equipment") {
      const armorType = item.system?.armor?.type || item.system?.type?.value;
      if (armorType && armorType !== "trinket") return "Armor";
      return "Equipment";
    }
    return "Equipment";
  }
}

