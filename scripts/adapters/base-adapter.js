import { MODULE_ID, SETTINGS } from "../constants.js";

/**
 * Interfaz base para los adaptadores de sistema (PF2e y D&D 5e).
 */
export class BaseSystemAdapter {
  constructor() {
    if (new.target === BaseSystemAdapter) {
      throw new TypeError("No se puede instanciar directamente BaseSystemAdapter.");
    }
  }

  /**
   * Obtiene o crea el actor dummy base en el mundo para evitar crear múltiples actores.
   * Las instancias en escenas serán tokens desvinculados derivados de este dummy actor.
   * @returns {Promise<Actor>}
   */
  async getOrCreateDummyActor() {
    let dummy = game.actors.find(
      (a) => a.getFlag(MODULE_ID, "isDummyLootActor") || a.name === "WoW Looter Pile"
    );
    if (!dummy) {
      const isPf2e = this.systemId === "pf2e";
      const type = isPf2e ? "loot" : "npc";
      const systemData = isPf2e ? { lootSheetType: "Loot" } : {};
      dummy = await Actor.create({
        name: "WoW Looter Pile",
        type,
        img: "icons/containers/bags/pack-leather-brown.webp",
        system: systemData,
        prototypeToken: {
          name: "WoW Looter Pile",
          texture: { src: "icons/containers/bags/pack-leather-brown.webp" },
          disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
          actorLink: false,
          displayBars: CONST.TOKEN_DISPLAY_MODES.NONE,
          displayName: CONST.TOKEN_DISPLAY_MODES.HOVER
        },
        flags: {
          [MODULE_ID]: {
            isDummyLootActor: true
          }
        }
      });
      console.log(`[${MODULE_ID}] Actor dummy único de botín creado:`, dummy.id);
    }
    return dummy;
  }

  /** Identificador del sistema (ej: 'dnd5e', 'pf2e') */
  get systemId() {
    return "base";
  }

  /**
   * Obtiene la lista de monedas estándar del sistema en orden de menor a mayor valor.
   * @returns {string[]} ej: ['cp', 'sp', 'gp', 'pp']
   */
  getCurrencyKeys() {
    return ["cp", "sp", "gp", "pp"];
  }

  /**
   * Obtiene la ruta de imagen del icono de moneda para el sistema actual.
   * @param {string} key - Clave de la moneda (cp, sp, gp, pp, etc.)
   * @returns {string} Ruta de imagen
   */
  getCurrencyImage(key) {
    return "icons/commodities/currency/coins-gold.webp";
  }

  /**
   * Lee las monedas disponibles de un actor.
   * @param {Actor} actor
   * @returns {Record<string, number>} { cp: 0, sp: 0, gp: 10, pp: 0 }
   */
  getActorCurrencies(actor) {
    throw new Error("getActorCurrencies debe ser implementado.");
  }

  /**
   * Añade o resta monedas a un actor.
   * @param {Actor} actor
   * @param {Record<string, number>} currencies - Cantidades (positivas para sumar, negativas para restar)
   * @returns {Promise<void>}
   */
  async modifyActorCurrencies(actor, currencies) {
    throw new Error("modifyActorCurrencies debe ser implementado.");
  }

  /**
   * Obtiene los items transferibles/looteables de un actor (ignora ataques naturales, dotes, etc.).
   * @param {Actor} actor
   * @returns {Item[]}
   */
  getLootableItems(actor) {
    throw new Error("getLootableItems debe ser implementado.");
  }

  /**
   * Transfiere un item o parte de su cantidad desde un actor de origen a un actor destino.
   * @param {Actor} sourceActor
   * @param {Actor} targetActor
   * @param {string|Item} itemOrId
   * @param {number} quantity
   * @returns {Promise<Item|null>} Item creado en el destino
   */
  async transferItem(sourceActor, targetActor, itemOrId, quantity = 1) {
    throw new Error("transferItem debe ser implementado.");
  }

  /**
   * Crea un actor de tipo Loot o contenedor en la escena con items dados.
   * @param {string} name
   * @param {object} coords - { x, y }
   * @param {Item[]} items
   * @param {Record<string, number>} currencies
   * @returns {Promise<TokenDocument>}
   */
  async createLootOnScene(name, coords, items = [], currencies = {}) {
    throw new Error("createLootOnScene debe ser implementado.");
  }

  /**
   * Determina si un combatiente o actor tiene la denominación de "opposition" / enemigo.
   * @param {Actor|Combatant} entity
   * @returns {boolean}
   */
  isOpposition(entity) {
    const actor = entity?.actor || entity;
    if (!actor) return false;
    return !actor.hasPlayerOwner;
  }

  /**
   * Devuelve si un actor o token es considerado un enemigo / NPC susceptible de ser loteado.
   * @param {Actor|TokenDocument} entity
   * @returns {boolean}
   */
  isHostileOrNPC(entity) {
    const actor = entity.actor || entity;
    if (!actor) return false;
    if (actor.hasPlayerOwner) return false;
    return true;
  }

  /**
   * Devuelve si el actor corresponde a un personaje jugable (PC).
   * @param {Actor} actor
   * @returns {boolean}
   */
  isPlayerCharacter(actor) {
    if (!actor) return false;
    return actor.type === "character";
  }

  /**
   * Determina si el objetivo es un contenedor, pila de botín o comerciante (no requiere estar muerto).
   * @param {Actor|null} actor
   * @param {TokenDocument|null} tokenDoc
   * @returns {boolean}
   */
  isLootContainerOrMerchant(actor, tokenDoc = null) {
    const actorSettings = actor?.getFlag?.(MODULE_ID, "lootSettings") || {};
    const tokenSettings = tokenDoc?.getFlag?.(MODULE_ID, "lootSettings") || {};
    const lootType = tokenSettings.lootType || actorSettings.lootType;

    if (lootType === "container" || lootType === "merchant") return true;
    if (actor?.type === "loot") return true;
    if (actor?.system?.lootSheetType?.toLowerCase() === "merchant") return true;
    if (actor?.getFlag?.(MODULE_ID, "isDummyLootActor")) return true;
    if (actor?.getFlag?.(MODULE_ID, "lootGenerated") || tokenDoc?.getFlag?.(MODULE_ID, "lootGenerated")) return true;
    return false;
  }

  /**
   * Determina si un actor o token está muerto/derrotado.
   * @param {Actor|null} actor
   * @param {TokenDocument|null} tokenDoc
   * @returns {boolean}
   */
  isDead(actor, tokenDoc = null) {
    if (!actor && !tokenDoc) return false;

    if (actor?.statuses?.has?.("dead") || actor?.statuses?.has?.("defeated")) {
      return true;
    }

    const hasDeadEffect = actor?.effects?.some((e) =>
      !e.disabled && (
        e.statuses?.has?.("dead")
        || e.statuses?.has?.("defeated")
        || e.flags?.core?.statusId === "dead"
        || e.flags?.core?.statusId === "defeated"
      )
    );
    if (hasDeadEffect) return true;

    if (tokenDoc?.combatant?.defeated === true) return true;
    const combatDefeated = game.combat?.combatants?.some((c) => {
      const matches = tokenDoc ? c.tokenId === tokenDoc.id : c.actorId === actor?.id;
      return matches && c.defeated === true;
    });
    if (combatDefeated) return true;

    const hp = actor?.system?.attributes?.hp;
    if (hp && hp.value !== undefined && hp.value !== null && Number(hp.max) > 0 && Number(hp.value) <= 0) {
      return true;
    }

    return false;
  }

  /**
   * Indica si el usuario actual puede abrir/usar el botín manual sobre el objetivo.
   * El GM siempre puede ver la ventana. Contenedores, pilas de botín y mercaderes siempre pueden.
   * Para jugadores sobre NPCs, respeta la opción requireDeathToLoot (instancia o global).
   * @param {Actor|null} actor
   * @param {TokenDocument|null} tokenDoc
   * @returns {boolean}
   */
  canActivateManualLoot(actor, tokenDoc = null) {
    if (game.user.isGM) return true;
    if (this.isLootContainerOrMerchant(actor, tokenDoc)) return true;

    const actorSettings = actor?.getFlag?.(MODULE_ID, "lootSettings") || {};
    const tokenSettings = tokenDoc?.getFlag?.(MODULE_ID, "lootSettings") || {};
    let globalRequireDeath = true;
    try {
      globalRequireDeath = game.settings.get(MODULE_ID, SETTINGS.REQUIRE_DEATH_TO_LOOT);
    } catch {
      globalRequireDeath = true;
    }

    const requireDeath = tokenSettings.requireDeathToLoot
      ?? actorSettings.requireDeathToLoot
      ?? globalRequireDeath;

    if (!requireDeath) return true;
    return this.isDead(actor, tokenDoc);
  }

  /**
   * Formatea un valor monetario para mostrar en la interfaz.
   * @param {Record<string, number>} currencies
   * @returns {string} ej: "15 gp, 4 sp"
   */
  formatCurrencies(currencies) {
    if (!currencies) return "0";
    const parts = [];
    for (const [key, value] of Object.entries(currencies)) {
      if (value > 0) parts.push(`${value} ${key.toUpperCase()}`);
    }
    return parts.length > 0 ? parts.join(", ") : "0";
  }

  /**
   * Determina si un item está identificado.
   * @param {Item} item
   * @returns {boolean}
   */
  isItemIdentified(item) {
    if (!item) return true;
    if (item.getFlag?.(MODULE_ID, "unidentified") === true) return false;
    return true;
  }

  /**
   * Identifica un item en el sistema.
   * @param {Item} item
   * @returns {Promise<boolean>}
   */
  async identifyItem(item) {
    if (!item) return false;
    if (item.getFlag?.(MODULE_ID, "unidentified")) {
      await item.unsetFlag(MODULE_ID, "unidentified");
    }
    return true;
  }

  /**
   * Obtiene la clave normalizada de rareza del item.
   * @param {Item} item
   * @returns {string} 'common' | 'uncommon' | 'rare' | 'veryRare' | 'legendary' | 'unique'
   */
  getItemRarity(item) {
    return "common";
  }

  /**
   * Obtiene el nombre del item cuando aún no está identificado.
   * @param {Item} item
   * @returns {string}
   */
  getUnidentifiedItemName(item) {
    return item?.name || "Objeto desconocido";
  }

  /**
   * Obtiene la imagen del item cuando no está identificado.
   * @param {Item} item
   * @returns {string}
   */
  getUnidentifiedItemImg(item) {
    return item?.img || "icons/svg/mystery-man.svg";
  }

  /**
   * Obtiene la representación de bulk o peso de un item.
   * @param {Item} item
   * @returns {string}
   */
  getItemBulk(item) {
    if (!item) return "-";
    if (item.system?.bulk?.value !== undefined) {
      const b = item.system.bulk.value;
      if (b === 0.1) return "L";
      return b === 0 ? "-" : String(b);
    }
    const w = item.system?.weight?.value ?? item.system?.weight;
    if (w !== undefined && w !== null && w !== 0) return String(w);
    return "-";
  }

  /**
   * Obtiene la categoría de inventario para agrupar en tiendas (Armor, Weapons, Consumables, etc.).
   * @param {Item} item
   * @returns {string}
   */
  getItemCategory(item) {
    const type = (item?.type || "").toLowerCase();
    if (type === "weapon") return "Weapons";
    if (type === "armor" || type === "shield") return "Armor";
    if (type === "consumable" || type === "potion" || type === "scroll") return "Consumables";
    if (type === "backpack" || type === "container") return "Containers";
    if (type === "treasure" || type === "loot") return "Treasure";
    if (type === "equipment") {
      if (item.system?.armor?.type || item.system?.type?.value === "armor") return "Armor";
      return "Equipment";
    }
    return "Equipment";
  }
}

