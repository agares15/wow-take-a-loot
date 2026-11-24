import { MODULE_ID } from "../constants.js";
import { getSystemAdapter } from "../adapters/index.js";
import { lootSessionManager } from "../services/loot-session.js";
import { currencyService } from "../services/currency-service.js";
import {
  enrichItemDescription,
  isAmmunitionItem,
  getEffectiveItemQuantity,
  normalizeAmmunitionItemData,
  parseDropData,
  resolveDroppedItem,
  promptAmmunitionQuantity
} from "../utils/dom-helpers.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Aplicación de gestión de botín para el GM.
 */
export class GmLootApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);

    // Estado interno
    this.enemies = []; // Lista de { id, name, img, actor, selected: true }
    this.players = []; // Lista de { userId, userName, characterId, characterName, characterImg, selected: true }
    this.customItems = []; // Items agregados manualmente o tirados de tablas
    this.manualCurrencies = null; // Monedas modificadas manualmente si las hubiera
    this.excludedItemIds = new Set(); // Items de enemigos que el GM decidió remover individualmente
    this.itemQuantityOverrides = new Map(); // Cantidades editadas manualmente por el GM en el Loot Pool

    this._initializeEnemies(options.initialEnemies || []);
    this._initializePlayers(options.initialPlayers);
  }

  static DEFAULT_OPTIONS = {
    id: "wow-looter-gm",
    tag: "div",
    classes: ["wow-looter-app", "wow-looter-gm-app"],
    window: {
      title: "WOW_LOOTER.GM.Title",
      icon: "fas fa-treasure-chest",
      resizable: true
    },
    position: {
      width: 820,
      height: 700
    },
    actions: {
      "toggle-enemy": GmLootApp._onToggleEnemy,
      "toggle-player": GmLootApp._onTogglePlayer,
      "edit-item": GmLootApp._onEditItem,
      "remove-item": GmLootApp._onRemoveItem,
      "add-roll-table": GmLootApp._onAddRollTable,
      "toggle-item-desc": GmLootApp._onToggleItemDesc,
      "cancel": GmLootApp._onCancel,
      "distribute-to-players": GmLootApp._onDistributeToPlayers
    }
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/gm-loot.hbs`
    }
  };

  /**
   * Carga los enemigos iniciales detectados en el combate.
   */
  _initializeEnemies(actors) {
    const map = new Map();
    for (const a of actors) {
      if (!a) continue;
      const actor = a.actor || a;
      if (!actor) continue;
      const tokenDoc = a.documentName === "Token"
        ? a
        : (a.document?.documentName === "Token" ? a.document : (actor.token || null));
      const instanceId = tokenDoc?.uuid || actor.uuid || actor.id;
      if (map.has(instanceId)) continue;
      const tokenTex = tokenDoc?.texture || a.texture || actor.prototypeToken?.texture;
      const tokenImg = tokenTex?.src || actor.img;
      map.set(instanceId, {
        id: instanceId,
        name: tokenDoc?.name || a.name || actor.name,
        img: tokenImg,
        scaleX: tokenTex?.scaleX ?? 1,
        scaleY: tokenTex?.scaleY ?? 1,
        actor: actor,
        selected: true
      });
    }
    this.enemies = Array.from(map.values());
  }

  /**
   * Busca el usuario jugador propietario o asignado al actor.
   */
  static findPlayerOwner(actor) {
    if (!actor) return null;
    return game.users.find(
      (u) => !u.isGM && (u.character?.id === actor.id || actor.getUserLevel(u) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)
    ) || null;
  }

  /**
   * Verifica si un actor es un personaje jugable perteneciente a algún jugador.
   */
  static isPlayerOwnedCharacter(actor, adapter = getSystemAdapter()) {
    if (!actor || !adapter.isPlayerCharacter(actor)) return false;
    return actor.hasPlayerOwner || Boolean(GmLootApp.findPlayerOwner(actor));
  }

  /**
   * Construye la entrada de jugador para la lista de Player Characters.
   */
  _buildPlayerEntry(pc, tokenDoc = null) {
    const ownerUser = GmLootApp.findPlayerOwner(pc);
    const activeToken = tokenDoc || canvas?.tokens?.placeables?.find((t) => t.actor?.id === pc.id);
    const tokenTex = activeToken?.document?.texture || activeToken?.texture || pc.prototypeToken?.texture;
    const tokenImg = tokenTex?.src || pc.img;

    return {
      userId: ownerUser ? ownerUser.id : null,
      userName: ownerUser ? ownerUser.name : "Party",
      characterId: pc.id,
      characterName: pc.name,
      characterImg: tokenImg,
      scaleX: tokenTex?.scaleX ?? 1,
      scaleY: tokenTex?.scaleY ?? 1,
      selected: true
    };
  }

  /**
   * Carga los personajes jugables iniciales (los participantes del combate, o todos si se abre manualmente).
   */
  _initializePlayers(initialPlayers) {
    const list = [];
    const seenIds = new Set();
    const adapter = getSystemAdapter();

    if (Array.isArray(initialPlayers)) {
      for (const entry of initialPlayers) {
        if (!entry) continue;
        const pc = entry.actor || entry;
        if (!pc || seenIds.has(pc.id)) continue;
        if (!GmLootApp.isPlayerOwnedCharacter(pc, adapter)) continue;

        seenIds.add(pc.id);
        const tokenDoc = entry.documentName === "Token"
          ? entry
          : (entry.document?.documentName === "Token" ? entry.document : null);
        list.push(this._buildPlayerEntry(pc, tokenDoc));
      }
    } else {
      const pcs = game.actors.filter((a) => GmLootApp.isPlayerOwnedCharacter(a, adapter));
      for (const pc of pcs) {
        if (seenIds.has(pc.id)) continue;
        seenIds.add(pc.id);
        list.push(this._buildPlayerEntry(pc));
      }
    }

    this.players = list;
  }

  /**
   * Prepara los datos para la plantilla.
   */
  async _prepareContext() {
    const adapter = getSystemAdapter();

    // 1. Recopilar y apilar items idénticos de los enemigos seleccionados + personalizados
    const rawEntries = [];
    for (const enemyEntry of this.enemies) {
      if (!enemyEntry.selected) continue;
      const items = currencyService.filterLootableItems(adapter.getLootableItems(enemyEntry.actor));
      for (const item of items) {
        const uniqueItemId = `${enemyEntry.id}::${item.id}`;
        if (this.excludedItemIds.has(uniqueItemId)) continue;
        const itemQty = getEffectiveItemQuantity(item);
        const sysData = item.toObject();
        if (isAmmunitionItem(sysData)) {
          normalizeAmmunitionItemData(sysData, itemQty);
        }
        rawEntries.push({
          id: uniqueItemId,
          sourceItemId: item.id,
          name: item.name,
          type: item.type,
          img: item.img,
          quantity: itemQty,
          sourceActorId: enemyEntry.actor.id,
          sourceActorUuid: enemyEntry.actor.uuid,
          sourceName: enemyEntry.name,
          description: item.system?.description?.value || item.system?.description || "",
          systemData: sysData
        });
      }
    }

    for (const custom of this.customItems) {
      rawEntries.push({
        ...custom,
        type: custom.type || custom.systemData?.type || "loot"
      });
    }

    // Apilar siempre items idénticos (mismo nombre y tipo)
    const stackedMap = new Map();
    for (const entry of rawEntries) {
      const stackKey = `${(entry.name || "").trim().toLowerCase()}::${(entry.type || "").trim().toLowerCase()}`;
      if (this.excludedItemIds.has(stackKey)) continue;

      const existing = stackedMap.get(stackKey);
      if (existing) {
        existing.quantity += Math.max(1, Number(entry.quantity) || 1);
        if (entry.sourceName && !existing._sourceNames.includes(entry.sourceName)) {
          existing._sourceNames.push(entry.sourceName);
          existing.sourceName = existing._sourceNames.join(", ");
        }
        if (entry.sourceActorId) {
          existing.sourceChunks.push({
            sourceActorId: entry.sourceActorId,
            sourceActorUuid: entry.sourceActorUuid || null,
            sourceItemId: entry.sourceItemId || entry.id,
            quantity: Math.max(1, Number(entry.quantity) || 1)
          });
        }
      } else {
        const qty = Math.max(1, Number(entry.quantity) || 1);
        stackedMap.set(stackKey, {
          ...entry,
          id: stackKey,
          quantity: qty,
          _sourceNames: entry.sourceName ? [entry.sourceName] : [],
          sourceChunks: entry.sourceActorId
            ? [{
                sourceActorId: entry.sourceActorId,
                sourceActorUuid: entry.sourceActorUuid || null,
                sourceItemId: entry.sourceItemId || entry.id,
                quantity: qty
              }]
            : []
        });
      }
    }

    const aggregatedItems = Array.from(stackedMap.values()).map((entry) => {
      if (this.itemQuantityOverrides.has(entry.id)) {
        entry.quantity = Math.max(1, Number(this.itemQuantityOverrides.get(entry.id)) || 1);
      }
      return entry;
    });

    // Enriquecer descripciones con formato nativo del sistema y etiquetas (tags)
    await Promise.all(aggregatedItems.map(async (entry) => {
      entry.description = await enrichItemDescription(entry.description || "", entry.systemData || entry);
    }));

    // 2. Recopilar monedas (sumar primero las de los enemigos seleccionados y luego aplicar ediciones manuales del GM)
    const currencyTotals = {};
    for (const key of adapter.getCurrencyKeys()) {
      currencyTotals[key] = 0;
    }

    for (const enemyEntry of this.enemies) {
      if (!enemyEntry.selected) continue;
      const cur = currencyService.getActorCurrencies(enemyEntry.actor);
      for (const [k, v] of Object.entries(cur)) {
        currencyTotals[k] = (currencyTotals[k] || 0) + Number(v || 0);
      }
    }

    if (this.manualCurrencies) {
      for (const [k, v] of Object.entries(this.manualCurrencies)) {
        currencyTotals[k] = Math.max(0, Number(v || 0));
      }
    }

    const allCurrencyKeys = new Set([...adapter.getCurrencyKeys(), ...Object.keys(currencyTotals)]);
    const currencyPills = Array.from(allCurrencyKeys).map((k) => {
      const meta = currencyService.getCurrencyMetadata(k);
      return {
        key: k,
        label: meta.label,
        img: meta.img,
        value: currencyTotals[k] || 0
      };
    });

    const hasItems = aggregatedItems.length > 0;
    const hasMoney = Object.values(currencyTotals).some((v) => v > 0);
    const hasEligiblePlayers = this.players.some((p) => p.selected);

    // Agrupar items por categoría
    const groupOrder = ["Armor", "Weapons", "Consumables", "Equipment", "Containers", "Treasure"];
    const groupsMap = new Map();
    for (const item of aggregatedItems) {
      const cat = adapter.getItemCategory(item.systemData || item) || "Equipment";
      item.category = cat;
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

    return {
      enemies: this.enemies,
      players: this.players,
      items: aggregatedItems,
      groupedItems,
      currencies: currencyPills,
      canDistribute: (hasItems || hasMoney) && hasEligiblePlayers
    };
  }

  async _preRender(context, options) {
    await super._preRender?.(context, options);
    const html = this.element;
    if (!html) return;
    this._savedScroll = {
      loot: html.querySelector(".loot-items-list-container")?.scrollTop ?? 0,
      enemies: html.querySelector(".enemies-checklist")?.scrollTop ?? 0,
      players: html.querySelector(".players-checklist")?.scrollTop ?? 0
    };
  }

  /**
   * Configura eventos de arrastre (drag & drop) una vez renderizado.
   */
  _onRender(context, options) {
    super._onRender(context, options);

    const html = this.element;
    if (this._savedScroll) {
      const restore = () => {
        const lootEl = html.querySelector(".loot-items-list-container");
        const enemiesEl = html.querySelector(".enemies-checklist");
        const playersEl = html.querySelector(".players-checklist");
        if (lootEl && this._savedScroll.loot) lootEl.scrollTop = this._savedScroll.loot;
        if (enemiesEl && this._savedScroll.enemies) enemiesEl.scrollTop = this._savedScroll.enemies;
        if (playersEl && this._savedScroll.players) playersEl.scrollTop = this._savedScroll.players;
      };
      restore();
      requestAnimationFrame(restore);
    }
    const dropTargets = html.querySelectorAll(".drop-target");

    for (const target of dropTargets) {
      target.addEventListener("dragover", (ev) => ev.preventDefault());
      target.addEventListener("drop", (ev) => this._onDrop(ev));
    }

    const addTableBtn = html.querySelector("[data-action='add-roll-table']");
    if (addTableBtn) {
      addTableBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        GmLootApp._onAddRollTable.call(this, ev, addTableBtn);
      });
    }

    // Escuchar cambios en vivo en los inputs de monedas del GM
    html.querySelectorAll("input.coin-input[data-currency]").forEach((input) => {
      const updateCoin = (ev) => {
        GmLootApp._onEditCurrency.call(this, ev, ev.target);
        const distributeBtn = html.querySelector("[data-action='distribute-to-players']");
        if (distributeBtn) {
          const anyMoney = Array.from(html.querySelectorAll("input.coin-input[data-currency]"))
            .some((el) => Number(el.value || 0) > 0);
          const hasItems = this.enemies.some((e) => e.selected) || this.customItems.length > 0;
          const hasEligible = this.players.some((p) => p.selected);
          distributeBtn.disabled = !((hasItems || anyMoney) && hasEligible);
        }
      };
      input.addEventListener("input", updateCoin);
      input.addEventListener("change", updateCoin);
    });

    // Edición de cantidades de items en el Loot Pool (solo GM)
    html.querySelectorAll("input.gm-pool-qty-input[data-item-id]").forEach((input) => {
      input.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      input.addEventListener("mousedown", (ev) => ev.stopPropagation());
      input.addEventListener("click", (ev) => ev.stopPropagation());
      const syncItemQty = (ev) => {
        const itemId = ev.target.dataset.itemId;
        if (!itemId) return;
        const val = Math.max(1, Math.floor(Number(ev.target.value || 1)));
        ev.target.value = String(val);
        this.itemQuantityOverrides.set(itemId, val);
      };
      input.addEventListener("input", syncItemQty);
      input.addEventListener("change", syncItemQty);
    });

    // Ajustar alturas dinámicas de Defeated Enemies y Player Characters
    if (this._sideColObserver) {
      this._sideColObserver.disconnect();
      this._sideColObserver = null;
    }
    const sideCol = html.querySelector(".side-column");
    if (sideCol && typeof ResizeObserver !== "undefined") {
      this._sideColObserver = new ResizeObserver(() => this._updateSideColumnLayout());
      this._sideColObserver.observe(sideCol);
    }
    requestAnimationFrame(() => this._updateSideColumnLayout());
  }

  /**
   * Calcula la altura natural de un panel de checklist (sin recortar por scroll).
   */
  _measureBoxNaturalHeight(box) {
    if (!box) return 0;
    const style = getComputedStyle(box);
    const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const borderY = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
    const gap = parseFloat(style.rowGap || style.gap) || 0;
    const children = Array.from(box.children);
    let total = padY + borderY + Math.max(0, children.length - 1) * gap;

    for (const child of children) {
      if (child.classList.contains("actor-checklist")) {
        total += child.scrollHeight;
      } else {
        const cs = getComputedStyle(child);
        total += child.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
      }
    }
    return Math.ceil(total);
  }

  /**
   * Ajusta dinámicamente las alturas de Defeated Enemies y Player Characters:
   * - Llena el 100% vertical de la columna sin sobrepasar el footer.
   * - Si uno cabe en < 50% y el otro desborda, el pequeño usa su contenido y el otro el resto.
   * - Si ambos desbordan, se reparten 50% / 50%.
   */
  _updateSideColumnLayout() {
    const html = this.element;
    if (!html) return;
    const sideCol = html.querySelector(".side-column");
    const enemiesBox = sideCol?.querySelector(".enemies-box");
    const playersBox = sideCol?.querySelector(".players-box");
    if (!sideCol || !enemiesBox || !playersBox) return;

    const colStyle = getComputedStyle(sideCol);
    const gap = parseFloat(colStyle.rowGap || colStyle.gap) || 10;
    const available = Math.max(0, sideCol.clientHeight - gap);
    if (available <= 0) return;

    const c1 = this._measureBoxNaturalHeight(enemiesBox);
    const c2 = this._measureBoxNaturalHeight(playersBox);
    const half = available / 2;

    if (c1 + c2 <= available) {
      enemiesBox.style.flex = `1 1 ${c1}px`;
      playersBox.style.flex = `1 1 ${c2}px`;
    } else if (c1 <= half) {
      enemiesBox.style.flex = `0 0 ${c1}px`;
      playersBox.style.flex = "1 1 0px";
    } else if (c2 <= half) {
      enemiesBox.style.flex = "1 1 0px";
      playersBox.style.flex = `0 0 ${c2}px`;
    } else {
      enemiesBox.style.flex = "1 1 0px";
      playersBox.style.flex = "1 1 0px";
    }
  }

  /**
   * Maneja el evento de soltar entidades (Actor, Item o RollableTable).
   */
  async _onDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    const data = parseDropData(event);
    if (!data || !data.type) return;

    const dropType = event.currentTarget?.dataset?.dropType;
    if (dropType === "player") {
      if (data.type === "Actor") {
        await this._handlePlayerDrop(data);
      }
      return;
    }

    if (data.type === "Actor") {
      await this._handleActorDrop(data);
    } else if (data.type === "Item") {
      await this._handleItemDrop(data);
    } else if (data.type === "RollTable") {
      await this._handleRollTableDrop(data);
    }
  }

  /**
   * Procesa el arrastre de un personaje jugador al panel de Player Characters.
   */
  async _handlePlayerDrop(data) {
    const doc = await fromUuid(data.uuid);
    if (!doc) return;
    const actor = doc.actor || doc;
    if (!actor) return;

    if (!GmLootApp.isPlayerOwnedCharacter(actor)) {
      ui.notifications.warn(game.i18n.localize("WOW_LOOTER.Warning.NotAPlayerCharacter"));
      return;
    }

    const existing = this.players.find((p) => p.characterId === actor.id);
    if (existing) {
      if (!existing.selected) {
        existing.selected = true;
        this.render(true);
      }
      return;
    }

    const tokenDoc = doc.documentName === "Token"
      ? doc
      : (doc.document?.documentName === "Token" ? doc.document : null);
    this.players.push(this._buildPlayerEntry(actor, tokenDoc));
    this.render(true);
  }

  /**
   * Procesa el arrastre de un nuevo Actor a la ventana.
   */
  async _handleActorDrop(data) {
    const doc = await fromUuid(data.uuid);
    if (!doc) return;
    const actor = doc.actor || doc;
    if (!actor) return;
    const tokenDoc = doc.documentName === "Token"
      ? doc
      : (doc.document?.documentName === "Token" ? doc.document : (actor.token || null));
    const instanceId = tokenDoc?.uuid || actor.uuid || actor.id;

    if (!this.enemies.some((e) => e.id === instanceId)) {
      const tokenTex = tokenDoc?.texture || doc.texture || actor.prototypeToken?.texture;
      const tokenImg = tokenTex?.src || actor.img;
      this.enemies.push({
        id: instanceId,
        name: tokenDoc?.name || doc.name || actor.name,
        img: tokenImg,
        scaleX: tokenTex?.scaleX ?? 1,
        scaleY: tokenTex?.scaleY ?? 1,
        actor: actor,
        selected: true
      });
      this.render(true);
    }
  }

  /**
   * Procesa el arrastre de un Item individual.
   */
  async _handleItemDrop(data) {
    const item = await resolveDroppedItem(data);
    if (!item) return;

    let qty = getEffectiveItemQuantity(item);
    if (isAmmunitionItem(item)) {
      qty = await promptAmmunitionQuantity(item.name, 10);
      if (!qty) return;
    }

    const sysData = item.toObject();
    sysData.system = sysData.system || {};
    sysData.system.quantity = qty;
    if (isAmmunitionItem(sysData)) {
      normalizeAmmunitionItemData(sysData, qty);
    }

    this.customItems.push({
      id: foundry.utils.randomID(),
      name: item.name,
      type: item.type,
      img: item.img,
      quantity: qty,
      sourceActorId: null,
      sourceName: game.i18n.localize("WOW_LOOTER.GM.CustomAdded"),
      description: item.system?.description?.value || item.system?.description || "",
      systemData: sysData
    });
    this.render(true);
  }

  /**
   * Procesa el arrastre de una RollableTable (tira en la tabla y agrega los items).
   */
  async _handleRollTableDrop(data) {
    if (!data.uuid) return;
    await this._rollAndAddTable(data.uuid, 1);
  }

  /**
   * Tira una tabla dada N veces y añade los resultados a la reserva de botín.
   */
  async _rollAndAddTable(tableOrUuid, rollsCount = 1) {
    const table = typeof tableOrUuid === "string" ? await fromUuid(tableOrUuid) : tableOrUuid;
    if (!table) return;

    ui.notifications.info(game.i18n.format("WOW_LOOTER.Notification.RollingTable", { name: table.name }));

    for (let i = 0; i < rollsCount; i++) {
      const draw = await table.draw({ displayChat: false });

      for (const result of draw.results) {
        if (result.type === CONST.TABLE_RESULT_TYPES.DOCUMENT && result.documentCollection === "Item") {
          let item = await fromUuid(`Item.${result.documentId}`);
          if (!item && result.documentCollection) {
            item = await fromUuid(`${result.documentCollection}.${result.documentId}`).catch(() => null);
          }
          if (item) {
            this.customItems.push({
              id: foundry.utils.randomID(),
              name: item.name,
              img: item.img,
              quantity: 1,
              sourceActorId: null,
              sourceName: table.name,
              description: item.system?.description?.value || item.system?.description || "",
              systemData: item.toObject()
            });
            continue;
          }
        }

        // Si es un compendio de items
        if (result.type === CONST.TABLE_RESULT_TYPES.COMPENDIUM) {
          const compItem = await fromUuid(`Compendium.${result.documentCollection}.${result.documentId}`).catch(() => null);
          if (compItem) {
            this.customItems.push({
              id: foundry.utils.randomID(),
              name: compItem.name,
              img: compItem.img,
              quantity: 1,
              sourceActorId: null,
              sourceName: table.name,
              description: compItem.system?.description?.value || compItem.system?.description || "",
              systemData: compItem.toObject()
            });
            continue;
          }
        }

        // Resultado textual genérico
        this.customItems.push({
          id: foundry.utils.randomID(),
          name: result.text || result.name || "Loot",
          img: result.img || "icons/svg/item-bag.svg",
          quantity: 1,
          sourceActorId: null,
          sourceName: table.name,
          description: result.text || "",
          systemData: { type: "loot", system: {} }
        });
      }
    }

    this.render(true);
  }

  // --- Handlers de Acciones de la Interfaz ---

  static async _onAddRollTable(event, target) {
    const tables = [];

    // 1. Recoger tablas del mundo
    for (const t of game.tables) {
      tables.push({
        uuid: t.uuid,
        name: t.name,
        source: game.i18n.localize("WOW_LOOTER.GM.TableSourceWorld")
      });
    }

    // 2. Recoger tablas de compendios
    for (const pack of game.packs) {
      if (pack.metadata.type === "RollTable") {
        for (const entry of pack.index) {
          tables.push({
            uuid: `Compendium.${pack.collection}.${entry._id}`,
            name: `${entry.name} [${pack.metadata.label}]`,
            source: pack.metadata.label
          });
        }
      }
    }

    if (tables.length === 0) {
      ui.notifications.warn(game.i18n.localize("WOW_LOOTER.Warning.NoTablesFound"));
      return;
    }

    tables.sort((a, b) => a.name.localeCompare(b.name));

    const optionsHtml = tables.map((t) => `<option value="${t.uuid}">${t.name}</option>`).join("");
    const content = `
      <div class="wow-looter-dialog-table" style="display:flex; flex-direction:column; gap:10px; padding:6px 0;">
        <div class="form-group">
          <label style="display:block; margin-bottom:4px; font-weight:bold; color:#ffd700;">
            <i class="fas fa-list-check"></i> ${game.i18n.localize("WOW_LOOTER.GM.SelectTable")}:
          </label>
          <select id="roll-table-uuid" style="width:100%; padding:5px; background:#121620; color:#fff; border:1px solid #4a5568; border-radius:4px;">
            ${optionsHtml}
          </select>
        </div>
        <div class="form-group" style="display:flex; align-items:center; gap:10px;">
          <label style="font-weight:bold; color:#cbd5e1;">${game.i18n.localize("WOW_LOOTER.GM.RollCount")}:</label>
          <input type="number" id="roll-table-count" value="1" min="1" max="20" style="width:60px; text-align:center; padding:3px; background:#121620; color:#fff; border:1px solid #4a5568; border-radius:4px; font-weight:bold;" />
        </div>
      </div>
    `;

    let choice = null;

    if (foundry.applications?.api?.DialogV2) {
      choice = await foundry.applications.api.DialogV2.prompt({
        window: { title: game.i18n.localize("WOW_LOOTER.GM.AddRollTable") },
        content,
        ok: {
          label: game.i18n.localize("WOW_LOOTER.GM.RollAndAdd"),
          icon: "fas fa-dice-d20",
          callback: (ev, btn, dialog) => {
            const select = dialog.element.querySelector("#roll-table-uuid");
            const input = dialog.element.querySelector("#roll-table-count");
            return {
              uuid: select?.value,
              count: Math.max(1, Number(input?.value || 1))
            };
          }
        }
      });
    } else {
      choice = await new Promise((resolve) => {
        new Dialog({
          title: game.i18n.localize("WOW_LOOTER.GM.AddRollTable"),
          content,
          buttons: {
            roll: {
              icon: '<i class="fas fa-dice-d20"></i>',
              label: game.i18n.localize("WOW_LOOTER.GM.RollAndAdd"),
              callback: (html) => {
                const el = html instanceof HTMLElement ? html : html[0];
                const select = el.querySelector("#roll-table-uuid");
                const input = el.querySelector("#roll-table-count");
                resolve({
                  uuid: select?.value,
                  count: Math.max(1, Number(input?.value || 1))
                });
              }
            },
            cancel: {
              label: game.i18n.localize("WOW_LOOTER.Common.Cancel"),
              callback: () => resolve(null)
            }
          },
          default: "roll"
        }).render(true);
      });
    }

    if (choice && choice.uuid) {
      await this._rollAndAddTable(choice.uuid, choice.count);
    }
  }

  static _onToggleEnemy(event, target) {
    const actorId = target.dataset.actorId;
    const enemy = this.enemies.find((e) => e.id === actorId);
    if (enemy) {
      enemy.selected = target.checked;
      this.render(true);
    }
  }

  static _onTogglePlayer(event, target) {
    const charId = target.dataset.actorId;
    const player = this.players.find((p) => p.characterId === charId);
    if (player) {
      player.selected = target.checked;
      this.render(true);
    }
  }

  static async _onEditItem(event, target) {
    event.preventDefault();
    event.stopPropagation();
    if (!game.user.isGM) return;
    const itemId = target.dataset.itemId || target.closest("[data-item-id]")?.dataset.itemId;
    if (!itemId) return;

    const context = await this._prepareContext();
    const entry = context.items.find((i) => i.id === itemId);
    if (!entry) return;

    const chunk = entry.sourceChunks?.[0];
    if (chunk) {
      let actor = null;
      if (chunk.sourceActorUuid) {
        const doc = await fromUuid(chunk.sourceActorUuid).catch(() => null);
        actor = doc?.actor || doc;
      }
      if (!actor && chunk.sourceActorId) {
        actor = game.actors.get(chunk.sourceActorId);
      }
      const itemDoc = actor?.items?.get(chunk.sourceItemId);
      if (itemDoc?.sheet) {
        itemDoc.sheet.render(true);
        return;
      }
    }

    if (entry.uuid) {
      const doc = await fromUuid(entry.uuid).catch(() => null);
      if (doc?.sheet) {
        doc.sheet.render(true);
        return;
      }
    }
  }

  static _onRemoveItem(event, target) {
    const itemId = target.dataset.itemId;
    // Comprobar si es un item personalizado
    const customIdx = this.customItems.findIndex((i) => i.id === itemId);
    if (customIdx >= 0) {
      this.customItems.splice(customIdx, 1);
    } else {
      // Es un item de enemigo, excluirlo
      this.excludedItemIds.add(itemId);
    }
    this.render(true);
  }

  static _onEditCurrency(event, target) {
    const key = target.dataset.currency;
    const val = Math.max(0, Number(target.value || 0));
    if (!this.manualCurrencies) {
      this.manualCurrencies = {};
    }
    this.manualCurrencies[key] = val;
  }

  static _onToggleItemDesc(event, target) {
    const row = target.closest(".pool-item-card, .pool-item-row, .loot-item-entry");
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

  async close(options = {}) {
    if (this._sideColObserver) {
      this._sideColObserver.disconnect();
      this._sideColObserver = null;
    }
    options.animate = false;
    if (this.element) {
      this.element.style.display = "none";
    }
    return super.close(options);
  }

  static _onCancel(event, target) {
    this.close({ animate: false });
  }

  static async _onDistributeToPlayers(event, target) {
    // Sincronizar monedas y checkboxes directamente desde el DOM antes de construir la sesión
    if (this.element) {
      this.element.querySelectorAll("input.coin-input[data-currency]").forEach((input) => {
        const key = input.dataset.currency;
        if (!key) return;
        const val = Math.max(0, Number(input.value || 0));
        if (!this.manualCurrencies) this.manualCurrencies = {};
        this.manualCurrencies[key] = val;
      });

      this.element.querySelectorAll("input.gm-pool-qty-input[data-item-id]").forEach((input) => {
        const itemId = input.dataset.itemId;
        if (itemId) {
          this.itemQuantityOverrides.set(itemId, Math.max(1, Math.floor(Number(input.value || 1))));
        }
      });

      this.element.querySelectorAll("input[data-action='toggle-player']").forEach((cb) => {
        const charId = cb.dataset.actorId;
        const player = this.players.find((p) => p.characterId === charId);
        if (player) player.selected = Boolean(cb.checked);
      });

      this.element.querySelectorAll("input[data-action='toggle-enemy']").forEach((cb) => {
        const actorId = cb.dataset.actorId;
        const enemy = this.enemies.find((e) => e.id === actorId);
        if (enemy) enemy.selected = Boolean(cb.checked);
      });
    }

    const context = await this._prepareContext();
    const eligible = this.players.filter((p) => p.selected);

    if (eligible.length === 0) {
      ui.notifications.warn(game.i18n.localize("WOW_LOOTER.Warning.NoEligiblePlayers"));
      return;
    }

    const currencies = {};
    for (const c of context.currencies) {
      currencies[c.key] = c.value;
    }

    lootSessionManager.startSession({
      items: context.items,
      currencies,
      eligiblePlayers: eligible,
      sourceEnemies: this.enemies.filter((e) => e.selected).map((e) => ({
        id: e.actor?.id || e.id,
        uuid: e.actor?.uuid || null,
        name: e.name,
        img: e.img
      }))
    });

    this.close({ animate: false });
  }
}

