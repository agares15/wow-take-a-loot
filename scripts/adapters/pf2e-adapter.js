import { BaseSystemAdapter } from "./base-adapter.js";
import { MODULE_ID, FLAGS } from "../constants.js";
import { getEffectiveItemQuantity, isAmmunitionItem, normalizeAmmunitionItemData } from "../utils/dom-helpers.js";

// Tipos de items físicos en el inventario de PF2e
const PHYSICAL_ITEM_TYPES = new Set([
  "weapon",
  "armor",
  "shield",
  "equipment",
  "consumable",
  "ammo",
  "treasure",
  "backpack",
  "book",
  "kit"
]);

// Metadatos para crear monedas en PF2e
const COIN_METADATA = {
  cp: {
    name: "Copper Pieces",
    slug: "copper-pieces",
    img: "systems/pf2e/icons/equipment/treasure/currency/copper-pieces.webp"
  },
  sp: {
    name: "Silver Pieces",
    slug: "silver-pieces",
    img: "systems/pf2e/icons/equipment/treasure/currency/silver-pieces.webp"
  },
  gp: {
    name: "Gold Pieces",
    slug: "gold-pieces",
    img: "systems/pf2e/icons/equipment/treasure/currency/gold-pieces.webp"
  },
  pp: {
    name: "Platinum Pieces",
    slug: "platinum-pieces",
    img: "systems/pf2e/icons/equipment/treasure/currency/platinum-pieces.webp"
  }
};

/**
 * Adaptador específico para Pathfinder 2e.
 */
export class PF2eAdapter extends BaseSystemAdapter {
  get systemId() {
    return "pf2e";
  }

  getCurrencyKeys() {
    return ["cp", "sp", "gp", "pp"];
  }

  getCurrencyImage(key) {
    const k = String(key).toLowerCase();
    if (COIN_METADATA[k]?.img) {
      return COIN_METADATA[k].img;
    }
    return "systems/pf2e/icons/equipment/treasure/currency/gold-pieces.webp";
  }

  /**
   * Determina si un combatiente o actor tiene la denominación de "opposition" en PF2e.
   */
  isOpposition(entity) {
    const actor = entity?.actor || entity;
    if (!actor) return false;

    // Denominación nativa de alianza en PF2e
    if (actor.alliance === "opposition" || actor.system?.details?.alliance === "opposition") {
      return true;
    }

    if (entity?.alliance === "opposition") {
      return true;
    }

    return false;
  }

  /**
   * Determina si un item es una moneda física de tesoro.
   */
  _isCoinTreasure(item) {
    if (!item) return false;
    if (item.type !== "treasure") return false;

    // Getter nativo de PF2e
    if (item.isCoinage === true) return true;
    if (item.system?.stackGroup === "coins") return true;

    const slug = (item.slug || "").toLowerCase();
    const name = (item.name || "").toLowerCase();

    if (
      slug.includes("copper-piece") ||
      slug.includes("silver-piece") ||
      slug.includes("gold-piece") ||
      slug.includes("platinum-piece") ||
      name.includes("copper piece") ||
      name.includes("silver piece") ||
      name.includes("gold piece") ||
      name.includes("platinum piece")
    ) {
      return true;
    }

    return false;
  }

  /**
   * Obtiene la denominación ('cp', 'sp', 'gp', 'pp') de un item de tesoro de moneda.
   */
  _getCoinDenomination(item) {
    if (item.system?.denomination) return item.system.denomination;

    const slug = (item.slug || "").toLowerCase();
    const name = (item.name || "").toLowerCase();

    if (slug.includes("platinum") || name.includes("platinum")) return "pp";
    if (slug.includes("gold") || name.includes("gold")) return "gp";
    if (slug.includes("silver") || name.includes("silver")) return "sp";
    if (slug.includes("copper") || name.includes("copper")) return "cp";

    const coinsVal = item.system?.value?.coins;
    if (coinsVal) {
      for (const k of ["pp", "gp", "sp", "cp"]) {
        if (coinsVal[k] > 0) return k;
      }
    }

    return "gp";
  }

  /**
   * Lee las monedas disponibles de un actor en PF2e.
   * Soporta tanto Personajes (Character) como NPCs y Loot actors.
   */
  getActorCurrencies(actor) {
    const result = { cp: 0, sp: 0, gp: 0, pp: 0 };
    if (!actor) return result;

    // 1. Si el actor tiene inventory.coins (Personajes y algunos Loot)
    if (actor.inventory?.coins) {
      const c = actor.inventory.coins;
      result.cp += Number(c.cp || 0);
      result.sp += Number(c.sp || 0);
      result.gp += Number(c.gp || 0);
      result.pp += Number(c.pp || 0);
    }

    // 2. Si el actor tiene system.wealth.coins o system.currencies
    if (actor.system?.wealth?.coins) {
      const c = actor.system.wealth.coins;
      result.cp = Math.max(result.cp, Number(c.cp || 0));
      result.sp = Math.max(result.sp, Number(c.sp || 0));
      result.gp = Math.max(result.gp, Number(c.gp || 0));
      result.pp = Math.max(result.pp, Number(c.pp || 0));
    }

    // 3. Revisar items de tipo 'treasure' (como se almacenan las monedas en NPCs)
    // Solo si no se obtuvieron ya desde actor.inventory.coins
    const hasInventoryCoins = result.cp > 0 || result.sp > 0 || result.gp > 0 || result.pp > 0;
    if (!hasInventoryCoins && actor.items) {
      for (const item of actor.items) {
        if (this._isCoinTreasure(item)) {
          const den = this._getCoinDenomination(item);
          const qty = Number(item.quantity ?? item.system?.quantity ?? 1);
          if (result[den] !== undefined) {
            result[den] += qty;
          }
        }
      }
    }

    return result;
  }

  /**
   * Añade o resta monedas a un actor en PF2e.
   */
  async modifyActorCurrencies(actor, currencies) {
    if (!actor) return;

    // Caso A: Si el actor tiene la API nativa de inventario (Characters y Loot sheets)
    if (actor.inventory?.addCoins && actor.inventory?.removeCoins) {
      const positiveCoins = {};
      const negativeCoins = {};

      for (const key of this.getCurrencyKeys()) {
        const val = Number(currencies[key] || 0);
        if (val > 0) positiveCoins[key] = val;
        if (val < 0) negativeCoins[key] = Math.abs(val);
      }

      if (Object.keys(positiveCoins).length > 0) {
        await actor.inventory.addCoins(positiveCoins);
      }
      if (Object.keys(negativeCoins).length > 0) {
        await actor.inventory.removeCoins(negativeCoins);
      }
      return;
    }

    // Caso B: NPCs de PF2e (almacenan monedas como items de tipo 'treasure')
    for (const key of this.getCurrencyKeys()) {
      const change = Number(currencies[key] || 0);
      if (change === 0) continue;

      if (change < 0) {
        // Reducir o eliminar monedas
        let toRemove = Math.abs(change);
        const coinItems = actor.items.filter((i) => this._isCoinTreasure(i) && this._getCoinDenomination(i) === key);

        for (const item of coinItems) {
          if (toRemove <= 0) break;
          const currentQty = Number(item.quantity ?? item.system?.quantity ?? 1);
          if (currentQty <= toRemove) {
            toRemove -= currentQty;
            await item.delete();
          } else {
            await item.update({ "system.quantity": currentQty - toRemove });
            toRemove = 0;
          }
        }
      } else {
        // Añadir monedas
        const existingItem = actor.items.find(
          (i) => this._isCoinTreasure(i) && this._getCoinDenomination(i) === key
        );

        if (existingItem) {
          const currentQty = Number(existingItem.quantity ?? existingItem.system?.quantity ?? 1);
          await existingItem.update({ "system.quantity": currentQty + change });
        } else {
          // Crear un nuevo item de tesoro para la moneda
          const meta = COIN_METADATA[key] || COIN_METADATA.gp;
          const coinData = {
            name: meta.name,
            type: "treasure",
            img: meta.img,
            system: {
              slug: meta.slug,
              quantity: change,
              denomination: key,
              stackGroup: "coins",
              value: { coins: { [key]: 1 } },
              equipped: { carryType: "worn" }
            }
          };
          await actor.createEmbeddedDocuments("Item", [coinData]);
        }
      }
    }

    // Fallback adicional si tiene system.currencies sin inventario de tesoro
    if (actor.system?.currencies && !actor.items) {
      const current = this.getActorCurrencies(actor);
      await actor.update({ "system.currencies": current });
    }
  }

  /**
   * Obtiene todos los items de inventario looteables de un actor.
   */
  getLootableItems(actor) {
    if (!actor || !actor.items) return [];

    return actor.items.filter((item) => {
      // Excluir acciones, dotes, hechizos o ataques naturales
      if (!PHYSICAL_ITEM_TYPES.has(item.type) && !item.isPhysical) {
        return false;
      }

      // Excluir ataques de armas naturales de monstruos (tipo 'melee' en PF2e)
      if (item.type === "melee") {
        return false;
      }

      // Excluir monedas (se muestran y manejan en la sección de monedas)
      if (this._isCoinTreasure(item)) {
        return false;
      }

      return true;
    });
  }

  /**
   * Transfiere un item entre actores en PF2e.
   */
  async transferItem(sourceActor, targetActor, itemOrId, quantity = 1, { silent = false } = {}) {
    const source = sourceActor instanceof Actor ? sourceActor : (sourceActor?.actor || sourceActor);
    const target = targetActor instanceof Actor ? targetActor : (targetActor?.actor || targetActor);

    if (!source || !target) {
      console.error("[wow-looter] transferItem: sourceActor o targetActor inválidos.", { source, target });
      ui.notifications.error("No se pudo identificar el actor origen o destino.");
      return null;
    }

    const item = typeof itemOrId === "string" ? source.items.get(itemOrId) : itemOrId;
    if (!item) {
      console.warn("[wow-looter] transferItem: No se encontró el item en el actor origen.", itemOrId, source.name);
      return null;
    }

    const sourceQty = getEffectiveItemQuantity(item);
    const transferQty = Math.min(Math.max(1, quantity), sourceQty);

    try {
      const itemData = item.toObject();
      // Limpiar _id y _stats para que Foundry genere un documento limpio en el destino
      delete itemData._id;
      delete itemData._stats;

      itemData.system = itemData.system || {};
      itemData.system.quantity = transferQty;
      if (isAmmunitionItem(itemData)) {
        normalizeAmmunitionItemData(itemData, transferQty);
      }

      // Limpiar contenedor y normalizar estado de equipado
      if (itemData.system.containerId) {
        itemData.system.containerId = null;
      }
      if (itemData.system.equipped) {
        itemData.system.equipped = {
          carryType: "worn",
          handsHeld: 0,
          inSlot: false,
          invested: null
        };
      }

      let createdItem = null;

      // Apilar siempre todos los items idénticos (mismo nombre y tipo)
      const existing = target.items.find((i) => i.name === item.name && i.type === item.type);

      if (existing) {
        const currentTargetQty = getEffectiveItemQuantity(existing);
        const updateData = { "system.quantity": currentTargetQty + transferQty };
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
        createdItem = existing;
      } else {
        const created = await target.createEmbeddedDocuments("Item", [itemData]);
        createdItem = created[0];
      }

      // Reducir o eliminar del origen
      if (sourceQty <= transferQty) {
        await item.delete();
      } else {
        const remainUpdate = { "system.quantity": sourceQty - transferQty };
        if (isAmmunitionItem(item)) {
          remainUpdate["system._wowNormalizedAmmo"] = true;
          if (item.system?.uses && Number(item.system.uses.max) > 1) {
            remainUpdate["system.uses.value"] = 1;
            remainUpdate["system.uses.max"] = 1;
          }
          if (item.system?.price && Number(item.system.price.per) > 1) {
            remainUpdate["system.price.per"] = 1;
          }
        }
        await item.update(remainUpdate);
      }

      console.log(`[wow-looter] Item '${item.name}' transferido con éxito de '${source.name}' a '${target.name}'.`);
      if (!silent) {
        ui.notifications.info(`${target.name} recogió ${item.name}`);
      }
      return createdItem;
    } catch (err) {
      console.error("[wow-looter] Error durante transferItem:", err);
      ui.notifications.error(`Error al transferir item: ${err.message}`);
      return null;
    }
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
        if (obj.system?.containerId) obj.system.containerId = null;
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
    if (item.isIdentified !== undefined) return Boolean(item.isIdentified);
    if (item.system?.identification?.status) {
      return item.system.identification.status === "identified";
    }
    return true;
  }

  async identifyItem(item) {
    if (!item) return false;
    if (item.getFlag?.(MODULE_ID, "unidentified")) {
      await item.unsetFlag(MODULE_ID, "unidentified");
    }
    if (item.system?.identification?.status !== undefined) {
      await item.update({ "system.identification.status": "identified" });
    }
    if (item.actor?.changeItemIdentificationStatus) {
      await item.actor.changeItemIdentificationStatus(item, "identified").catch(() => {});
    }
    return true;
  }

  getItemRarity(item) {
    const r = (item?.system?.traits?.rarity || item?.rarity || "common").toLowerCase();
    if (r === "unique") return "unique";
    if (["common", "uncommon", "rare"].includes(r)) return r;
    return "common";
  }

  getUnidentifiedItemName(item) {
    return item?.system?.identification?.unidentified?.data?.name || item?.name || "Objeto no identificado";
  }

  getUnidentifiedItemImg(item) {
    return item?.system?.identification?.unidentified?.data?.img || item?.img || "icons/svg/mystery-man.svg";
  }

  getItemBulk(item) {
    if (!item) return "-";
    const bulk = item.bulk || item.system?.bulk;
    if (bulk) {
      if (typeof bulk.toString === "function") {
        const str = bulk.toString();
        if (str && str !== "0") return str;
      }
      if (bulk.normal === 0 && bulk.light > 0) return "L";
      if (bulk.normal !== undefined && bulk.normal > 0) return String(bulk.normal);
      if (bulk.value === 0.1) return "L";
      if (bulk.value !== undefined && bulk.value > 0) return String(bulk.value);
    }
    return "-";
  }

  getItemCategory(item) {
    const type = (item?.type || "").toLowerCase();
    if (type === "weapon") return "Weapons";
    if (type === "armor" || type === "shield") return "Armor";
    if (type === "consumable") return "Consumables";
    if (type === "ammo") return "Ammunition";
    if (type === "equipment") return "Equipment";
    if (type === "backpack") return "Containers";
    if (type === "treasure") return "Treasure";
    return "Equipment";
  }
}
