import { MODULE_ID, SOCKET_EVENTS, SETTINGS } from "../constants.js";
import { socketService } from "./socket-service.js";
import { getSystemAdapter } from "../adapters/index.js";
import { currencyService } from "./currency-service.js";

/**
 * Gestor del ciclo de vida y resolución de la sesión de Looting.
 */
export class LootSessionManager {
  constructor() {
    this.session = null;
    this.customItemsData = new Map();
    this._registerSocketListeners();
  }

  get isGm() {
    return game.user.isGM;
  }

  get isPrimaryGm() {
    if (!game.user.isGM) return false;
    const activeGMs = game.users.filter((u) => u.isGM && u.active);
    const primaryGM = activeGMs[0] || game.users.find((u) => u.isGM);
    return primaryGM ? primaryGM.id === game.user.id : true;
  }

  /**
   * Registra los sockets necesarios para la interacción en tiempo real.
   */
  _registerSocketListeners() {
    // Escuchar inicio de sesión
    socketService.register(SOCKET_EVENTS.START_SESSION, (data) => {
      this.session = data;
    });

    // Escuchar sincronización de estado
    socketService.register(SOCKET_EVENTS.SYNC_STATE, (data) => {
      this.session = data;
    });

    // Escuchar peticiones de reclamo de item (procesadas por el GM primario)
    socketService.register(SOCKET_EVENTS.CLAIM_ITEM, (data, senderId) => {
      if (!this.isPrimaryGm || !this.session) return;
      this._handlePlayerClaim(data, senderId);
    });

    // Escuchar actualización de preferencia de dinero
    socketService.register(SOCKET_EVENTS.UPDATE_CURRENCY_CHOICE, (data, senderId) => {
      if (!this.isPrimaryGm || !this.session) return;
      this._handlePlayerCurrencyChoice(data, senderId);
    });

    // Escuchar estado "Listo" de un jugador
    socketService.register(SOCKET_EVENTS.TOGGLE_READY, (data, senderId) => {
      if (!this.isPrimaryGm || !this.session) return;
      this._handlePlayerToggleReady(data, senderId);
    });

    // Escuchar tiradas manuales d100 en tarjetas de disputa del chat
    socketService.register(SOCKET_EVENTS.CONTESTED_ROLL_ACTION, (data, senderId) => {
      if (!this.isPrimaryGm) return;
      this.handleContestedRollAction(data, senderId);
    });

    // Escuchar cierre de sesión
    socketService.register(SOCKET_EVENTS.CLOSE_SESSION, () => {
      this.session = null;
    });
  }

  /**
   * Crea una nueva sesión desde el panel del GM.
   * @param {object} params
   */
  startSession({ items, currencies, eligiblePlayers, sourceEnemies }) {
    if (!this.isGm) return;

    this.customItemsData.clear();

    const sanitizedItems = items.map((i) => {
      const id = i.id || foundry.utils.randomID();
      if (i.systemData) {
        this.customItemsData.set(id, i.systemData);
      }
      return {
        id,
        sourceItemId: i.sourceItemId || id,
        name: i.name,
        img: i.img,
        quantity: i.quantity || 1,
        sourceActorId: i.sourceActorId,
        sourceActorUuid: i.sourceActorUuid || null,
        sourceName: i.sourceName || "",
        description: i.description || i.systemData?.system?.description?.value || i.systemData?.system?.description || "",
        claims: [] // Array de { userId, characterId, characterName, characterImg, quantity }
      };
    });

    this.session = {
      id: foundry.utils.randomID(),
      items: sanitizedItems,
      currencies: { ...currencies },
      eligiblePlayers: eligiblePlayers.map((p) => ({
        userId: p.userId,
        characterId: p.characterId,
        characterName: p.characterName,
        characterImg: p.characterImg,
        scaleX: p.scaleX ?? 1,
        scaleY: p.scaleY ?? 1,
        isReady: false,
        currencyChoice: { splitEvenly: true, requested: 0, denom: "gp" }
      })),
      sourceEnemies: sourceEnemies.map((e) => ({
        id: e.id,
        uuid: e.uuid || e.actor?.uuid || null,
        name: e.name,
        img: e.img
      })),
      isResolving: false
    };

    console.log("[wow-looter] GM iniciando sesión de botín y emitiendo START_SESSION:", this.session);
    socketService.emit(SOCKET_EVENTS.START_SESSION, this.session);
  }

  /**
   * Procesa la selección, deselección o cambio de cantidad de un item por un jugador.
   */
  _handlePlayerClaim({ itemId, characterId, quantity = 1, updateOnly = false }, senderId) {
    if (!this.session?.items) return;
    const item = this.session.items.find((i) => i.id === itemId);
    if (!item) return;

    const actor = game.actors.get(characterId);
    if (!actor) return;

    const clampedQty = Math.min(Math.max(1, Number(item.quantity) || 1), Math.max(1, Number(quantity) || 1));
    const existingIndex = item.claims.findIndex(
      (c) => c.characterId === characterId
    );

    if (existingIndex >= 0) {
      if (updateOnly) {
        item.claims[existingIndex].quantity = clampedQty;
      } else {
        // Deseleccionar
        item.claims.splice(existingIndex, 1);
      }
    } else if (!updateOnly) {
      // Seleccionar
      const eligiblePlayer = this.session.eligiblePlayers?.find((p) => p.characterId === actor.id);
      item.claims.push({
        userId: senderId,
        characterId: actor.id,
        characterName: actor.name,
        characterImg: eligiblePlayer?.characterImg || actor.img,
        scaleX: eligiblePlayer?.scaleX ?? 1,
        scaleY: eligiblePlayer?.scaleY ?? 1,
        quantity: clampedQty
      });
    }

    // Si algún jugador quedó en estado "not enough", quitarle el estado Listo
    for (const p of this.session.eligiblePlayers || []) {
      if (p.isReady && this.hasOverAllocatedClaim(p.characterId)) {
        p.isReady = false;
      }
    }

    this._syncSession();
  }

  /**
   * Comprueba si un personaje tiene alguna elección que excede la cantidad disponible ("not enough").
   * @param {string} characterId
   * @returns {boolean}
   */
  hasOverAllocatedClaim(characterId) {
    if (!this.session?.items || !characterId) return false;
    for (const item of this.session.items) {
      const qty = Math.max(1, Number(item.quantity) || 1);
      if (qty <= 1) continue;
      let used = 0;
      for (const claim of item.claims || []) {
        used += Math.max(1, Number(claim.quantity) || 1);
        if (used > qty && claim.characterId === characterId) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Divide un item con cantidad > 1 en dos entradas dentro de la sesión (solo GM).
   * @param {string} itemId
   * @param {number} splitQty
   */
  splitItem(itemId, splitQty) {
    if (!this.isGm || !this.session?.items) return;
    const idx = this.session.items.findIndex((i) => i.id === itemId);
    if (idx < 0) return;

    const item = this.session.items[idx];
    const totalQty = Math.max(1, Number(item.quantity) || 1);
    const amount = Math.floor(Number(splitQty) || 0);
    if (totalQty <= 1 || amount < 1 || amount >= totalQty) return;

    const remainingQty = totalQty - amount;
    item.quantity = remainingQty;
    for (const c of item.claims || []) {
      c.quantity = Math.min(remainingQty, Math.max(1, Number(c.quantity) || 1));
    }

    const newId = foundry.utils.randomID();
    const newItem = {
      id: newId,
      sourceItemId: item.sourceItemId || item.id,
      name: item.name,
      img: item.img,
      quantity: amount,
      sourceActorId: item.sourceActorId,
      sourceActorUuid: item.sourceActorUuid || null,
      sourceName: item.sourceName || "",
      description: item.description || "",
      claims: []
    };

    const existingData = this.customItemsData.get(item.id) || this.customItemsData.get(item.sourceItemId);
    if (existingData) {
      this.customItemsData.set(newId, foundry.utils.deepClone(existingData));
    }

    this.session.items.splice(idx + 1, 0, newItem);
    this._syncSession();
  }

  /**
   * Procesa la elección de dinero de un jugador, restando del pool disponible.
   */
  _handlePlayerCurrencyChoice({ characterId, splitEvenly, requested, denom }, senderId) {
    if (!this.session?.eligiblePlayers) return;
    let player = this.session.eligiblePlayers.find((p) => p.characterId === characterId);
    if (!player) return;
    if (!player.userId) player.userId = senderId;

    const chosenDenom = denom || player.currencyChoice?.denom || "gp";

    if (splitEvenly) {
      player.currencyChoice = {
        splitEvenly: true,
        requested: 0,
        denom: chosenDenom
      };
    } else {
      const poolAmount = Number(this.session.currencies?.[chosenDenom] || 0);
      const othersRequested = this.session.eligiblePlayers.reduce((sum, p) => {
        if (p.characterId === characterId) return sum;
        if (p.currencyChoice?.splitEvenly === false && (p.currencyChoice?.denom || "gp") === chosenDenom) {
          return sum + Math.max(0, Number(p.currencyChoice.requested) || 0);
        }
        return sum;
      }, 0);
      const available = Math.max(0, poolAmount - othersRequested);
      const clampedRequested = Math.min(available, Math.max(0, Math.floor(Number(requested) || 0)));

      player.currencyChoice = {
        splitEvenly: false,
        requested: clampedRequested,
        denom: chosenDenom
      };
    }

    this._syncSession();
  }

  /**
   * Marca a un jugador como listo. Si todos están listos, evalúa auto-reparto.
   */
  _handlePlayerToggleReady({ characterId }, senderId) {
    if (!this.session?.eligiblePlayers) return;
    let player = this.session.eligiblePlayers.find((p) => p.characterId === characterId);
    if (!player) return;
    if (!player.userId) player.userId = senderId;

    if (!player.isReady && this.hasOverAllocatedClaim(characterId)) {
      return;
    }

    player.isReady = !player.isReady;
    this._syncSession();

    // Comprobar si todos los jugadores activos en la sesión están listos
    const allReady = this.session.eligiblePlayers.every((p) => p.isReady);
    if (allReady && this.session.eligiblePlayers.length > 0) {
      this.resolveAndDistribute();
    }
  }

  /**
   * Envía el estado actualizado a todos los clientes.
   */
  _syncSession() {
    socketService.emit(SOCKET_EVENTS.SYNC_STATE, this.session);
  }

  /**
   * Resuelve un actor por UUID (priorizando tokens no vinculados) o por ID.
   */
  async _resolveActor(uuid, actorId) {
    if (uuid) {
      let doc = null;
      try {
        doc = typeof fromUuidSync === "function" ? fromUuidSync(uuid) : null;
      } catch {
        doc = null;
      }
      if (!doc) {
        doc = await fromUuid(uuid).catch(() => null);
      }
      if (doc) {
        return doc.actor || doc;
      }
    }
    if (actorId) {
      const tokenMatch = canvas.tokens?.placeables?.find((t) => t.actor?.id === actorId);
      if (tokenMatch?.actor) return tokenMatch.actor;
      return game.actors.get(actorId) || null;
    }
    return null;
  }

  /**
   * Transfiere o crea una cantidad específica de un item en el actor destino.
   * @returns {Promise<boolean>}
   */
  async _grantItemToActor(adapter, sourceActor, targetActor, item, qty) {
    const grantQty = Math.max(1, Number(qty) || 1);
    if (!targetActor) return false;

    if (sourceActor) {
      const transferred = await adapter.transferItem(sourceActor, targetActor, item.sourceItemId || item.id, grantQty);
      if (transferred) return true;
    }

    const systemData = this.customItemsData.get(item.id)
      || this.customItemsData.get(item.sourceItemId)
      || item.systemData;
    if (systemData) {
      const itemData = {
        name: item.name,
        img: item.img,
        type: systemData.type || "loot",
        system: foundry.utils.deepClone(systemData.system || {})
      };
      if (itemData.system) itemData.system.quantity = grantQty;
      delete itemData._id;
      delete itemData._stats;
      const created = await targetActor.createEmbeddedDocuments("Item", [itemData]);
      return Boolean(created?.length);
    }

    return false;
  }

  /**
   * Finaliza la sesión y distribuye el botín (con resolución de disputas d100).
   */
  async resolveAndDistribute() {
    if (!this.isGm || !this.session || this.session.isResolving) return;
    this.session.isResolving = true;
    this._syncSession();

    const adapter = getSystemAdapter();
    const resolutionLog = [];

    ui.notifications.info(game.i18n.localize("WOW_LOOTER.Notification.ResolvingLoot"));

    // 1. Resolver Items
    for (const item of this.session.items) {
      const claims = item.claims || [];
      if (claims.length === 0) {
        // No fue reclamado por nadie: se queda en su actor original
        continue;
      }

      const itemQty = Math.max(1, Number(item.quantity) || 1);
      const sourceActor = await this._resolveActor(item.sourceActorUuid, item.sourceActorId);
      const totalClaimedQty = claims.reduce((sum, c) => sum + Math.max(1, Number(c.quantity) || 1), 0);

      if (itemQty === 1 && claims.length > 1) {
        // Disputa clásica de item único: Tirada d100 automática o manual
        const autoContestedRoll = game.settings.get(MODULE_ID, SETTINGS.AUTO_CONTESTED_ROLL);
        if (!autoContestedRoll) {
          await this._createPendingContestedMessage(item, claims);
          continue;
        }
        const winner = await this._resolveContestedItem(item, claims);
        if (winner) {
          const targetActor = game.actors.get(winner.characterId);
          const ok = await this._grantItemToActor(adapter, sourceActor, targetActor, item, 1);
          if (ok) {
            resolutionLog.push({
              itemName: item.name,
              winnerName: winner.characterName,
              wasContested: true
            });
          }
        }
      } else if (claims.length === 1) {
        // Un solo interesado: entregar la cantidad deseada (hasta el máximo disponible)
        const claim = claims[0];
        const qtyToGive = Math.min(itemQty, Math.max(1, Number(claim.quantity) || 1));
        const targetActor = game.actors.get(claim.characterId);
        const ok = await this._grantItemToActor(adapter, sourceActor, targetActor, item, qtyToGive);
        if (ok) {
          resolutionLog.push({
            itemName: qtyToGive > 1 ? `${item.name} x${qtyToGive}` : item.name,
            winnerName: claim.characterName,
            wasContested: false
          });
        }
      } else if (totalClaimedQty <= itemQty) {
        // Múltiples interesados dentro del stock disponible: cada uno recibe lo que pidió
        for (const claim of claims) {
          const qtyToGive = Math.max(1, Number(claim.quantity) || 1);
          const targetActor = game.actors.get(claim.characterId);
          const ok = await this._grantItemToActor(adapter, sourceActor, targetActor, item, qtyToGive);
          if (ok) {
            resolutionLog.push({
              itemName: qtyToGive > 1 ? `${item.name} x${qtyToGive}` : item.name,
              winnerName: claim.characterName,
              wasContested: false
            });
          }
        }
      } else {
        // Stock insuficiente (Not enough) forzado por el GM: repartir en orden hasta agotar
        let remaining = itemQty;
        for (const claim of claims) {
          if (remaining <= 0) break;
          const wanted = Math.max(1, Number(claim.quantity) || 1);
          const qtyToGive = Math.min(remaining, wanted);
          const targetActor = game.actors.get(claim.characterId);
          const ok = await this._grantItemToActor(adapter, sourceActor, targetActor, item, qtyToGive);
          if (ok) {
            remaining -= qtyToGive;
            resolutionLog.push({
              itemName: qtyToGive > 1 ? `${item.name} x${qtyToGive}` : item.name,
              winnerName: claim.characterName,
              wasContested: false
            });
          }
        }
      }
    }

    // 2. Resolver Monedas
    const currencyLog = await this._resolveCurrencies(adapter);

    // 3. Crear mensaje de resumen en el chat
    await this._postResolutionChatMessage(resolutionLog, currencyLog);

    // 4. Cerrar sesión
    socketService.emit(SOCKET_EVENTS.CLOSE_SESSION, {});
    this.session = null;
    ui.notifications.info(game.i18n.localize("WOW_LOOTER.Notification.LootDistributed"));
  }

  /**
   * Resuelve un conflicto entre jugadores tirando d100 para cada uno.
   */
  async _resolveContestedItem(item, claims) {
    const rolls = [];

    for (const claim of claims) {
      const roll = await new Roll("1d100").evaluate();
      rolls.push({
        claim,
        roll,
        total: roll.total
      });
    }

    // Ordenar de mayor a menor puntaje
    rolls.sort((a, b) => b.total - a.total);

    // Desempate si los dos primeros sacan el mismo número
    while (rolls.length >= 2 && rolls[0].total === rolls[1].total) {
      const tieBreaker1 = await new Roll("1d100").evaluate();
      const tieBreaker2 = await new Roll("1d100").evaluate();
      rolls[0].total += tieBreaker1.total * 0.001; // Ajuste decimal de desempate
      rolls[1].total += tieBreaker2.total * 0.001;
      rolls.sort((a, b) => b.total - a.total);
    }

    const winner = rolls[0].claim;

    // Publicar la disputa y tiradas en el chat
    let rollHtml = `
      <div class="wow-looter-chat-card">
        <div class="card-header">
          <img src="${item.img}" width="32" height="32"/>
          <div class="title">
            <strong>${item.name}</strong>
            <span class="badge dispute">${game.i18n.localize("WOW_LOOTER.Chat.ContestedRolls")}</span>
          </div>
        </div>
        <ul class="roll-list">
    `;

    for (const r of rolls) {
      const isWinner = r.claim.characterId === winner.characterId;
      rollHtml += `
        <li class="${isWinner ? 'winner' : ''}">
          <span class="char-name">${r.claim.characterName}:</span>
          <span class="roll-value"><strong>${Math.floor(r.total)}</strong> (d100) ${isWinner ? '🏆' : ''}</span>
        </li>
      `;
    }

    rollHtml += `
        </ul>
        <div class="card-footer">
          ${game.i18n.format("WOW_LOOTER.Chat.WonBy", { winner: winner.characterName })}
        </div>
      </div>
    `;

    await ChatMessage.create({
      speaker: { alias: "WoW Looter" },
      content: rollHtml
    });

    return winner;
  }

  /**
   * Publica una tarjeta de disputa pendiente en el chat para que cada jugador tire d100 manualmente.
   */
  async _createPendingContestedMessage(item, claims) {
    const systemData = this.customItemsData.get(item.id)
      || this.customItemsData.get(item.sourceItemId)
      || item.systemData
      || null;

    const pendingContest = {
      resolved: false,
      winnerId: null,
      winnerName: null,
      item: {
        id: item.id,
        sourceItemId: item.sourceItemId || null,
        name: item.name,
        img: item.img,
        quantity: 1,
        sourceActorId: item.sourceActorId || null,
        sourceActorUuid: item.sourceActorUuid || null,
        systemData
      },
      contenders: claims.map((c) => ({
        characterId: c.characterId,
        characterName: c.characterName,
        userId: c.userId || null,
        roll: null,
        tieBreaker: 0
      }))
    };

    await ChatMessage.create({
      speaker: { alias: "WoW Looter" },
      content: this._buildPendingContestHtml(pendingContest),
      flags: {
        [MODULE_ID]: {
          pendingContest
        }
      }
    });
  }

  /**
   * Construye el HTML de la tarjeta de disputa manual en el chat.
   */
  _buildPendingContestHtml(contest) {
    let html = `
      <div class="wow-looter-chat-card wow-looter-contested-card" data-resolved="${contest.resolved ? "true" : "false"}">
        <div class="card-header">
          <img src="${contest.item.img || "icons/svg/item-bag.svg"}" width="32" height="32"/>
          <div class="title">
            <strong>${contest.item.name}</strong>
            <span class="badge dispute">${game.i18n.localize("WOW_LOOTER.Chat.ContestedRolls")}</span>
          </div>
        </div>
        <ul class="roll-list">
    `;

    for (const c of contest.contenders) {
      const isWinner = contest.resolved && contest.winnerId === c.characterId;
      const hasRolled = c.roll !== null && c.roll !== undefined;
      html += `
        <li class="${isWinner ? "winner" : ""}">
          <span class="char-name">${c.characterName}:</span>
          <span class="roll-value">
            ${hasRolled
              ? `<strong>${Math.floor(c.roll)}</strong> (d100) ${isWinner ? "🏆" : ""}`
              : `<span class="roll-pending">${game.i18n.localize("WOW_LOOTER.Chat.PendingRoll")}</span>
                 <button type="button" class="btn-roll-contested" data-character-id="${c.characterId}" title="${game.i18n.localize("WOW_LOOTER.Chat.RollD100")}">
                   <i class="fas fa-dice-d20"></i>
                 </button>`
            }
          </span>
        </li>
      `;
    }

    html += `</ul>`;

    if (contest.resolved) {
      html += `
        <div class="card-footer">
          ${game.i18n.format("WOW_LOOTER.Chat.WonBy", { winner: contest.winnerName })}
        </div>
      `;
    } else {
      html += `
        <div class="card-footer wow-looter-gm-only">
          <button type="button" class="btn-roll-all-contested">
            <i class="fas fa-dice-d20"></i> ${game.i18n.localize("WOW_LOOTER.Chat.RollForAll")}
          </button>
        </div>
      `;
    }

    html += `</div>`;
    return html;
  }

  /**
   * Procesa una tirada manual d100 (individual o "tirar por todos") en una tarjeta de disputa.
   */
  async handleContestedRollAction({ messageId, action, characterId }, senderId = null) {
    if (!this.isPrimaryGm || !messageId) return;

    const message = game.messages.get(messageId);
    const rawContest = message?.getFlag?.(MODULE_ID, "pendingContest");
    if (!message || !rawContest || rawContest.resolved) return;

    const contest = foundry.utils.deepClone(rawContest);
    const sender = senderId ? game.users.get(senderId) : game.user;

    if (action === "roll-all") {
      if (!sender?.isGM) return;
      for (const c of contest.contenders) {
        if (c.roll === null || c.roll === undefined) {
          const r = await new Roll("1d100").evaluate();
          c.roll = r.total;
        }
      }
    } else if (action === "roll-one" && characterId) {
      const contender = contest.contenders.find((c) => c.characterId === characterId);
      if (!contender || (contender.roll !== null && contender.roll !== undefined)) return;

      if (!sender?.isGM) {
        const actor = game.actors.get(characterId);
        const isOwner = actor?.testUserPermission?.(sender, "OWNER") || sender?.character?.id === characterId;
        if (!isOwner) return;
      }

      const r = await new Roll("1d100").evaluate();
      contender.roll = r.total;
    } else {
      return;
    }

    const allRolled = contest.contenders.every((c) => c.roll !== null && c.roll !== undefined);
    if (allRolled) {
      const ranked = contest.contenders.map((c) => ({
        contender: c,
        score: Number(c.roll)
      }));
      ranked.sort((a, b) => b.score - a.score);

      while (ranked.length >= 2 && ranked[0].score === ranked[1].score) {
        const tb1 = await new Roll("1d100").evaluate();
        const tb2 = await new Roll("1d100").evaluate();
        ranked[0].score += tb1.total * 0.001;
        ranked[1].score += tb2.total * 0.001;
        ranked.sort((a, b) => b.score - a.score);
      }

      const winner = ranked[0].contender;
      contest.resolved = true;
      contest.winnerId = winner.characterId;
      contest.winnerName = winner.characterName;

      const adapter = getSystemAdapter();
      const sourceActor = await this._resolveActor(contest.item.sourceActorUuid, contest.item.sourceActorId);
      const targetActor = game.actors.get(winner.characterId);
      await this._grantItemToActor(adapter, sourceActor, targetActor, contest.item, 1);
    }

    await message.update({
      content: this._buildPendingContestHtml(contest),
      [`flags.${MODULE_ID}.pendingContest`]: contest
    });
  }

  /**
   * Reparte las monedas entre los jugadores según sus preferencias.
   * @returns {Promise<Array<{ characterId: string, characterName: string, amounts: Record<string, number> }>>}
   */
  async _resolveCurrencies(adapter) {
    const totalCurrencies = this.session.currencies || {};
    const eligible = this.session.eligiblePlayers;
    const currencyLog = [];
    if (eligible.length === 0) return currencyLog;

    // Deducción de fuentes originales
    for (const enemyData of this.session.sourceEnemies) {
      const enemyActor = await this._resolveActor(enemyData.uuid, enemyData.id);
      if (enemyActor) {
        const cur = adapter.getActorCurrencies(enemyActor);
        const toDeduct = {};
        for (const [k, v] of Object.entries(cur)) {
          if (v > 0) toDeduct[k] = -v;
        }
        await adapter.modifyActorCurrencies(enemyActor, toDeduct);
      }
    }

    // Calcular distribución: primero las solicitudes específicas, luego repartir el restante solo entre quienes eligieron "split evenly"
    const splitPlayers = eligible.filter((p) => p.currencyChoice?.splitEvenly !== false);

    for (const [currencyKey, totalAmount] of Object.entries(totalCurrencies)) {
      if (totalAmount <= 0) continue;

      let remainingPool = Number(totalAmount) || 0;

      // 1. Entregar montos solicitados específicamente (request specific amount)
      for (const player of eligible) {
        if (remainingPool <= 0) break;
        if (player.currencyChoice?.splitEvenly !== false) continue;
        const playerDenom = player.currencyChoice?.denom || "gp";
        if (playerDenom !== currencyKey) continue;

        const wanted = Math.max(0, Number(player.currencyChoice?.requested) || 0);
        const amountToGive = Math.min(remainingPool, wanted);
        if (amountToGive <= 0) continue;

        const targetActor = game.actors.get(player.characterId);
        if (!targetActor) continue;

        await currencyService.giveCurrency(targetActor, currencyKey, amountToGive);
        remainingPool -= amountToGive;

        let entry = currencyLog.find((c) => c.characterId === player.characterId);
        if (!entry) {
          entry = { characterId: player.characterId, characterName: targetActor.name, amounts: {} };
          currencyLog.push(entry);
        }
        entry.amounts[currencyKey] = (entry.amounts[currencyKey] || 0) + amountToGive;
      }

      // 2. Repartir el resto equitativamente SOLO entre los jugadores que eligieron "split evenly"
      if (remainingPool > 0 && splitPlayers.length > 0) {
        const perPlayer = Math.floor(remainingPool / splitPlayers.length);
        let remainder = remainingPool % splitPlayers.length;

        for (const player of splitPlayers) {
          const targetActor = game.actors.get(player.characterId);
          if (!targetActor) continue;

          let amountToGive = perPlayer;
          if (remainder > 0) {
            amountToGive += 1;
            remainder -= 1;
          }

          if (amountToGive > 0) {
            await currencyService.giveCurrency(targetActor, currencyKey, amountToGive);
            let entry = currencyLog.find((c) => c.characterId === player.characterId);
            if (!entry) {
              entry = { characterId: player.characterId, characterName: targetActor.name, amounts: {} };
              currencyLog.push(entry);
            }
            entry.amounts[currencyKey] = (entry.amounts[currencyKey] || 0) + amountToGive;
          }
        }
      }
    }

    return currencyLog;
  }

  /**
   * Publica un resumen consolidado en el chat.
   */
  async _postResolutionChatMessage(resolutionLog, currencyLog = []) {
    if (resolutionLog.length === 0 && currencyLog.length === 0) return;

    let content = `
      <div class="wow-looter-chat-card summary">
        <h3><i class="fas fa-treasure-chest"></i> ${game.i18n.localize("WOW_LOOTER.Chat.SummaryTitle")}</h3>
    `;

    if (resolutionLog.length > 0) {
      content += `<ul class="summary-list">`;
      for (const log of resolutionLog) {
        content += `
          <li>
            <strong>${log.winnerName}</strong> recibió <em>${log.itemName}</em> ${log.wasContested ? '⚔️' : ''}
          </li>
        `;
      }
      content += `</ul>`;
    }

    if (currencyLog.length > 0) {
      content += `
        <div class="summary-currencies">
          <h4><i class="fas fa-coins"></i> ${game.i18n.localize("WOW_LOOTER.Chat.CurrencyDistributed") || "Monedas Recibidas"}:</h4>
          <ul class="summary-list currency-list">
      `;
      for (const c of currencyLog) {
        const parts = Object.entries(c.amounts)
          .filter(([_, v]) => v > 0)
          .map(([k, v]) => `${v} ${currencyService.getCurrencyMetadata(k).label}`);
        if (parts.length > 0) {
          content += `
            <li>
              <strong>${c.characterName}</strong>: ${parts.join(", ")}
            </li>
          `;
        }
      }
      content += `</ul></div>`;
    }

    content += `</div>`;

    await ChatMessage.create({
      speaker: { alias: "WoW Looter" },
      content
    });
  }
}

export const lootSessionManager = new LootSessionManager();

