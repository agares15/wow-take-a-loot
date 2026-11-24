import { MODULE_ID, FLAGS, SOCKET_EVENTS, SETTINGS } from "../constants.js";
import { getSystemAdapter } from "../adapters/index.js";
import { ManualLootApp } from "../apps/manual-loot-app.js";
import { MerchantApp } from "../apps/merchant-app.js";
import { socketService } from "../services/socket-service.js";
import { ChatAnnouncer } from "../services/chat-announcer.js";
import { currencyService } from "../services/currency-service.js";
import { merchantService } from "../services/merchant-service.js";
import { applyContainerTexture, preloadContainerTextures } from "../utils/container-helpers.js";
import { getEffectiveItemQuantity } from "../utils/dom-helpers.js";

function _isTokenMarkedLootable(token) {
  const tokenFlag = token?.document?.getFlag(MODULE_ID, FLAGS.IS_LOOTABLE);
  if (tokenFlag !== undefined) return Boolean(tokenFlag);
  return Boolean(token?.actor?.getFlag(MODULE_ID, FLAGS.IS_LOOTABLE));
}

/**
 * Registra el botón de 'Looteable' en el Token HUD y la apertura de loot manual.
 */
export function registerTokenHud() {
  // 1. Agregar botón al Token HUD del GM (salida inmediata para no-GMs)
  Hooks.on("renderTokenHUD", (app, html, data) => {
    if (!game.user.isGM) return;

    const token = app.object;
    if (!token?.actor) return;

    const adapter = getSystemAdapter();
    // Excluir tokens de jugadores
    if (adapter.isPlayerCharacter(token.actor) || token.actor.hasPlayerOwner) return;

    const isLootable = _isTokenMarkedLootable(token);
    const title = isLootable
      ? game.i18n.localize("WOW_LOOTER.HUD.LootableActive")
      : game.i18n.localize("WOW_LOOTER.HUD.MakeLootable");

    const el = html instanceof HTMLElement ? html : html[0];
    const column = el.querySelector(".col.right") || el.querySelector(".column.right");

    if (column) {
      const btn = document.createElement("div");
      btn.className = `control-icon wow-looter-hud-btn ${isLootable ? "active" : ""}`;
      btn.title = title;
      btn.innerHTML = `<i class="fas fa-sack-dollar"></i>`;

      btn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const current = _isTokenMarkedLootable(token);
        const nextState = !current;

        await token.document.setFlag(MODULE_ID, FLAGS.IS_LOOTABLE, nextState);
        if (!nextState && token.actor?.getFlag(MODULE_ID, FLAGS.IS_LOOTABLE)) {
          await token.actor.unsetFlag(MODULE_ID, FLAGS.IS_LOOTABLE).catch(() => {});
        }
        btn.classList.toggle("active", nextState);
        btn.title = nextState
          ? game.i18n.localize("WOW_LOOTER.HUD.LootableActive")
          : game.i18n.localize("WOW_LOOTER.HUD.MakeLootable");

        // Opcional: mostrar u ocultar icono de estado en el token para que los jugadores lo identifiquen en el mapa
        const bagIcon = "icons/svg/item-bag.svg";
        if (nextState) {
          await token.actor.createEmbeddedDocuments("ActiveEffect", [{
            name: "Loot",
            img: bagIcon,
            flags: { [MODULE_ID]: { isLootMarker: true } }
          }]).catch(() => {});
        } else {
          const effects = token.actor.effects.filter((e) => e.flags?.[MODULE_ID]?.isLootMarker);
          for (const eff of effects) await eff.delete().catch(() => {});
        }
      });

      column.appendChild(btn);
    }
  });

  // 2. Interceptar doble clic en Token: si es looteable, abrir ManualLootApp en lugar de ActorSheet
  _wrapTokenDoubleClick();

  // Precargar texturas de contenedores presentes en la escena para cambios instantáneos
  Hooks.on("canvasReady", () => {
    for (const token of canvas.tokens?.placeables || []) {
      const actorSettings = token.actor?.getFlag(MODULE_ID, "lootSettings") || {};
      const tokenSettings = token.document?.getFlag(MODULE_ID, "lootSettings") || {};
      const lootSettings = { ...actorSettings, ...tokenSettings };
      if (lootSettings.lootType === "container") {
        preloadContainerTextures(lootSettings);
      }
    }
  });

  // Sincronizar el estado "locked" del Token del sistema con el flag del contenedor y su imagen
  Hooks.on("updateToken", async (tokenDoc, changes, options) => {
    if (!game.user.isGM || options?.wowLooterSync) return;
    if (changes.locked === undefined) return;

    const actorSettings = tokenDoc.actor?.getFlag(MODULE_ID, "lootSettings") || {};
    const tokenSettings = tokenDoc.getFlag(MODULE_ID, "lootSettings") || {};
    const lootSettings = { ...actorSettings, ...tokenSettings };
    if (lootSettings.lootType !== "container") return;

    const nextLocked = Boolean(changes.locked);
    const updatedSettings = { ...lootSettings, isLocked: nextLocked };
    await tokenDoc.update({ [`flags.${MODULE_ID}.lootSettings`]: updatedSettings }, { wowLooterSync: true }).catch(() => {});
    if (tokenDoc.actor) {
      await tokenDoc.actor.update({ [`flags.${MODULE_ID}.lootSettings`]: updatedSettings }).catch(() => {});
    }
    await applyContainerTexture(tokenDoc, tokenDoc.actor, "close");
  });

  // 3. GM maneja solicitudes de transferencias seguras por socket (evita permission denied)
  if (game.user.isGM) {
    socketService.register(SOCKET_EVENTS.MANUAL_LOOT_EXECUTE, async ({ action, data, targetActorId, lootingActorId, targetTokenId, lootingTokenId }, senderId) => {
      // Solo el GM primario activo procesa la petición para evitar transferencias duplicadas
      const activeGMs = game.users.filter((u) => u.isGM && u.active);
      const primaryGM = activeGMs[0] || game.users.find((u) => u.isGM);
      if (primaryGM && primaryGM.id !== game.user.id) return;

      console.log("[wow-looter] GM ejecutando MANUAL_LOOT_EXECUTE:", { action, data, targetTokenId, lootingActorId, senderId });

      // 1. Resolver targetActor (cuerpo del enemigo / contenedor)
      let targetActor = null;
      if (targetTokenId) {
        const liveToken = canvas.tokens?.get(targetTokenId) || canvas.tokens?.placeables.find((t) => t.id === targetTokenId);
        if (liveToken?.actor) {
          targetActor = liveToken.actor;
        } else {
          for (const scene of game.scenes) {
            const tokenDoc = scene.tokens.get(targetTokenId);
            if (tokenDoc?.actor) {
              targetActor = tokenDoc.actor;
              break;
            }
          }
        }
      }
      if (!targetActor && targetActorId) {
        targetActor = game.actors.get(targetActorId);
      }

      // 2. Resolver lootingActor (personaje que recibe el botín)
      let lootingActor = null;
      if (lootingActorId) {
        lootingActor = game.actors.get(lootingActorId);
      }
      if (!lootingActor && lootingTokenId) {
        const liveToken = canvas.tokens?.get(lootingTokenId) || canvas.tokens?.placeables.find((t) => t.id === lootingTokenId);
        if (liveToken?.actor) {
          lootingActor = liveToken.actor;
        } else {
          for (const scene of game.scenes) {
            const tokenDoc = scene.tokens.get(lootingTokenId);
            if (tokenDoc?.actor) {
              lootingActor = tokenDoc.actor;
              break;
            }
          }
        }
      }
      if (!lootingActor && senderId) {
        const sender = game.users.get(senderId);
        if (sender?.character) lootingActor = sender.character;
      }

      if (!targetActor || !lootingActor) {
        console.error("[wow-looter] Error en GM: No se pudo resolver targetActor o lootingActor.", { targetActor, lootingActor, targetTokenId, lootingActorId });
        return;
      }

      const adapter = getSystemAdapter();

      // 3. Procesar la acción autoritativamente
      try {
        let dropNotification = null;
        if (action === "take-item") {
          const item = targetActor.items.get(data.itemId);
          const itemName = item?.name || "Objeto";
          const itemImg = item?.img || "icons/svg/item-bag.svg";
          const qty = data.quantity || 1;
          await adapter.transferItem(targetActor, lootingActor, data.itemId, qty);
          await ChatAnnouncer.announceItemPickup(lootingActor, targetActor, itemName, itemImg, qty);
        } else if (action === "deposit-item") {
          let fromActor = null;
          if (data.sourceActorUuid) {
            const doc = await fromUuid(data.sourceActorUuid).catch(() => null);
            fromActor = doc?.actor || doc;
          }
          if (!fromActor && data.sourceActorId) {
            fromActor = game.actors.get(data.sourceActorId);
          }
          if (!fromActor) fromActor = lootingActor;
          if (fromActor && fromActor.id !== targetActor.id) {
            const item = fromActor.items?.get(data.itemId);
            const itemName = item?.name || "Objeto";
            const itemImg = item?.img || "icons/svg/item-bag.svg";
            const qty = Math.max(1, Number(data.quantity || 1));
            const transferred = await adapter.transferItem(fromActor, targetActor, data.itemId, qty, { silent: true });
            if (transferred) {
              const liveTargetToken = targetTokenId ? (canvas.tokens?.get(targetTokenId) || canvas.tokens?.placeables.find((t) => t.id === targetTokenId)) : null;
              const lootName = liveTargetToken?.name || targetActor.name;
              dropNotification = game.i18n.format("WOW_LOOTER.Chat.DroppedItemInLoot", {
                character: fromActor.name,
                item: qty > 1 ? `${itemName} (x${qty})` : itemName,
                loot: lootName
              });
              ui.notifications.info(dropNotification);
              await ChatAnnouncer.announceItemDrop(fromActor, targetActor, itemName, itemImg, qty);
            }
          }
        } else if (action === "loot-all-items") {
          const items = adapter.getLootableItems(targetActor);
          const itemsList = items.map((i) => ({
            name: i.name,
            img: i.img,
            quantity: getEffectiveItemQuantity(i)
          }));
          for (const item of items) {
            await adapter.transferItem(targetActor, lootingActor, item.id, getEffectiveItemQuantity(item));
          }
          if (itemsList.length > 0) {
            await ChatAnnouncer.announceAllItemsPickup(lootingActor, targetActor, itemsList);
          }
        } else if (action === "take-all-currency") {
          const currencies = currencyService.getActorCurrencies(targetActor);
          await currencyService.transferAllCurrencies(targetActor, lootingActor);
          const formatted = Object.entries(currencies)
            .filter(([_, v]) => v > 0)
            .map(([k, v]) => `${v} ${currencyService.getCurrencyMetadata(k).label}`)
            .join(", ");
          await ChatAnnouncer.announceCurrencyPickup(lootingActor, targetActor, formatted, false);
          ui.notifications.info(`${lootingActor.name} recogió todo el dinero.`);
        } else if (action === "take-specific-currency") {
          const amount = Number(data.amount || 0);
          if (amount > 0) {
            const currencies = currencyService.getActorCurrencies(targetActor);
            const nonZeroKeys = Object.keys(currencies).filter((k) => (currencies[k] || 0) > 0);
            let chosenKey = data.currencyKey;
            if (!chosenKey || !currencies[chosenKey]) {
              chosenKey = (currencies.gp && currencies.gp > 0) ? "gp" : (nonZeroKeys[0] || "gp");
            }
            const currentVal = currencies[chosenKey] || 0;
            const deduct = Math.min(amount, currentVal);
            if (deduct > 0) {
              await currencyService.transferCurrency(targetActor, lootingActor, chosenKey, deduct);
              const meta = currencyService.getCurrencyMetadata(chosenKey);
              const formatted = `${deduct} ${meta.label}`;
              await ChatAnnouncer.announceCurrencyPickup(lootingActor, targetActor, formatted, false);
              ui.notifications.info(`${lootingActor.name} tomó ${deduct} ${meta.label}.`);
            }
          }
        } else if (action === "split-currency-party") {
          const currencies = currencyService.getActorCurrencies(targetActor);
          const party = game.actors.filter((a) => adapter.isPlayerCharacter(a));
          if (party.length > 0) {
            await currencyService.splitCurrenciesWithParty(targetActor, party);
            const formatted = Object.entries(currencies)
              .filter(([_, v]) => v > 0)
              .map(([k, v]) => `${v} ${currencyService.getCurrencyMetadata(k).label}`)
              .join(", ");
            await ChatAnnouncer.announceCurrencyPickup(lootingActor, targetActor, formatted, true, party.length);
            ui.notifications.info(`Monedas repartidas con los ${party.length} miembros del grupo.`);
          }
        }

        // 4. Comprobar si el botín ha quedado vacío y debe eliminarse (deleteWhenEmpty)
        const liveToken = targetTokenId ? (canvas.tokens?.get(targetTokenId) || canvas.tokens?.placeables.find((t) => t.id === targetTokenId)) : null;
        const lootSettings = liveToken?.document?.getFlag(MODULE_ID, "lootSettings") 
          || targetActor.getFlag(MODULE_ID, "lootSettings") 
          || {};
        const remainingItems = adapter.getLootableItems(targetActor);
        const remainingCurrencies = adapter.getActorCurrencies(targetActor);
        const hasRemainingCoins = Object.values(remainingCurrencies).some((v) => Number(v) > 0);

        if (remainingItems.length === 0 && !hasRemainingCoins) {
          if (lootSettings.deleteWhenEmpty && liveToken?.document) {
            ui.notifications.info("El contenedor está vacío y ha desaparecido.");
            await liveToken.document.delete().catch(() => {});
          } else if (lootSettings.lootType === "container") {
            await applyContainerTexture(liveToken?.document, targetActor, "open");
          }
        }

        // 5. Notificar a todos los clientes para que actualicen sus ventanas abiertas
        socketService.emit(SOCKET_EVENTS.MANUAL_LOOT_UPDATED, {
          targetActorId: targetActor.id,
          targetTokenId,
          dropNotification
        });
      } catch (err) {
        console.error("[wow-looter] Error en GM al procesar MANUAL_LOOT_EXECUTE:", err);
      }
    });

    // 4. GM maneja transacciones de compra/venta de mercaderes
    socketService.register(SOCKET_EVENTS.MERCHANT_TRANSACTION_REQUEST, async (payload, senderId) => {
      const activeGMs = game.users.filter((u) => u.isGM && u.active);
      const primaryGM = activeGMs[0] || game.users.find((u) => u.isGM);
      if (primaryGM && primaryGM.id !== game.user.id) return;

      await merchantService.handleSocketTransactionRequest(payload, senderId);
    });

    // 5. GM actualiza la textura del contenedor cuando un jugador lo abre o cierra
    socketService.register(SOCKET_EVENTS.CONTAINER_STATE_CHANGE, async ({ tokenId, actorId, state }) => {
      const activeGMs = game.users.filter((u) => u.isGM && u.active);
      const primaryGM = activeGMs[0] || game.users.find((u) => u.isGM);
      if (primaryGM && primaryGM.id !== game.user.id) return;

      const liveToken = tokenId
        ? (canvas.tokens?.get(tokenId) || canvas.tokens?.placeables.find((t) => t.id === tokenId))
        : null;
      const targetActor = liveToken?.actor || (actorId ? game.actors.get(actorId) : null);
      await applyContainerTexture(liveToken?.document, targetActor, state || "close");
    });

    // 5. GM maneja solicitudes de identificación de objetos
    socketService.register(SOCKET_EVENTS.MERCHANT_IDENTIFY_REQUEST, async (payload, senderId) => {
      const activeGMs = game.users.filter((u) => u.isGM && u.active);
      const primaryGM = activeGMs[0] || game.users.find((u) => u.isGM);
      if (primaryGM && primaryGM.id !== game.user.id) return;

      let merchantActor = null;
      if (payload.targetTokenId) {
        const liveToken = canvas.tokens?.get(payload.targetTokenId) || canvas.tokens?.placeables.find((t) => t.id === payload.targetTokenId);
        if (liveToken?.actor) merchantActor = liveToken.actor;
      }
      if (!merchantActor && payload.merchantActorId) {
        merchantActor = game.actors.get(payload.merchantActorId);
      }

      let shopperActor = payload.shopperActorId ? game.actors.get(payload.shopperActorId) : null;
      if (!shopperActor && payload.lootingTokenId) {
        const liveToken = canvas.tokens?.get(payload.lootingTokenId) || canvas.tokens?.placeables.find((t) => t.id === payload.lootingTokenId);
        if (liveToken?.actor) shopperActor = liveToken.actor;
      }

      if (!merchantActor || !shopperActor) return;

      merchantService.openIdentifyApprovalDialog({
        merchantActor,
        shopperActor,
        itemId: payload.itemId,
        itemName: payload.itemName,
        itemImg: payload.itemImg,
        targetTokenId: payload.targetTokenId,
        requestId: payload.requestId,
        emitResolution: true
      });
    });
  }

  // 6. Escuchar actualizaciones de mercader en cualquier cliente para refrescar ventana abierta
  socketService.register(SOCKET_EVENTS.MERCHANT_UPDATED, ({ merchantActorId, targetTokenId }) => {
    if (MerchantApp.activeInstance && MerchantApp.activeInstance.rendered) {
      const app = MerchantApp.activeInstance;
      if (app.targetActor?.id === merchantActorId || app.targetToken?.id === targetTokenId) {
        app.render(false);
      }
    }
  });

  // 7. Escuchar resolución de solicitud de identificación
  socketService.register(SOCKET_EVENTS.MERCHANT_IDENTIFY_RESOLVED, ({ shopperActorId, itemId, success, itemName }) => {
    if (shopperActorId && itemId) {
      MerchantApp.pendingIdentifyKeys.delete(`${shopperActorId}:${itemId}`);
    } else if (shopperActorId) {
      for (const key of MerchantApp.pendingIdentifyKeys) {
        if (key.startsWith(`${shopperActorId}:`)) MerchantApp.pendingIdentifyKeys.delete(key);
      }
    }

    if (MerchantApp.activeInstance && MerchantApp.activeInstance.rendered) {
      const app = MerchantApp.activeInstance;
      if (app.lootingActor?.id === shopperActorId) {
        if (success) {
          ui.notifications.info(game.i18n.format("WOW_LOOTER.Merchant.IdentifyApproved", { item: itemName }));
        } else {
          ui.notifications.warn(game.i18n.format("WOW_LOOTER.Merchant.IdentifyRejected", { item: itemName }));
        }
        app.render(false);
      }
    }
  });
}

/**
 * Sobrescribe el doble clic en tokens para abrir la ventana simple de botín sin tocar la hoja del sistema.
 */
export function _wrapTokenDoubleClick() {
  const tokenClasses = new Set([
    CONFIG.Token?.objectClass,
    globalThis.Token,
    foundry?.canvas?.placeables?.Token
  ].filter(Boolean));

  for (const TokenClass of tokenClasses) {
    const proto = TokenClass.prototype;
    if (!proto || proto._wowLooterClickWrapped) continue;

    const originalCanView = proto._canView;
    const originalOnClickLeft2 = proto._onClickLeft2;
    proto._wowLooterClickWrapped = true;

    proto._canView = function (user, event) {
      if (!this.document?.hidden && _isTokenMarkedLootable(this)) {
        return true;
      }
      if (originalCanView) {
        return originalCanView.apply(this, arguments);
      }
      return false;
    };

    proto._onClickLeft2 = function (event) {
      const isLootable = _isTokenMarkedLootable(this);
      if (isLootable) {
        // Prevenir apertura de la hoja de personaje del NPC y abrir el loot manual
        _tryOpenManualLoot(this);
        return;
      }

      if (originalOnClickLeft2) {
        return originalOnClickLeft2.apply(this, arguments);
      }
    };
  }

  // Si ya hay tokens dibujados en el canvas (ej. cuando ready corre después de canvasReady), actualizar su callback y permiso
  for (const token of canvas?.tokens?.placeables || []) {
    if (token.mouseInteractionManager?.permissions) {
      token.mouseInteractionManager.permissions.clickLeft2 = token._canView.bind(token);
    }
    if (token.mouseInteractionManager?.callbacks) {
      token.mouseInteractionManager.callbacks.clickLeft2 = token._onClickLeft2.bind(token);
    }
  }
}

/**
 * Verifica proximidad y abre la ventana de botín manual sencilla.
 */
export function _tryOpenManualLoot(targetToken) {
  const adapter = getSystemAdapter();
  if (!adapter.canActivateManualLoot(targetToken?.actor, targetToken?.document)) {
    ui.notifications.warn(game.i18n.localize("WOW_LOOTER.Warning.MustBeDeadToLoot"));
    return;
  }

  // 1. Buscar un token controlado que NO sea el targetToken y sea un personaje
  let playerToken = canvas.tokens.controlled.find(
    (t) => t.id !== targetToken.id && (adapter.isPlayerCharacter(t.actor) || t.actor?.hasPlayerOwner)
  );

  // 2. Si no hay token controlado, buscar por el personaje asignado al usuario actual
  if (!playerToken && game.user.character) {
    playerToken = canvas.tokens.placeables.find(
      (t) => t.id !== targetToken.id && t.actor?.id === game.user.character.id
    );
  }

  // 3. Si es un jugador y aún no tiene token, buscar cualquier token en la escena que posea
  if (!playerToken && !game.user.isGM) {
    playerToken = canvas.tokens.placeables.find(
      (t) => t.id !== targetToken.id && t.actor?.isOwner && (adapter.isPlayerCharacter(t.actor) || t.actor?.hasPlayerOwner)
    );
  }

  // 4. Si es el GM, buscar los personajes jugadores en la escena y elegir el más cercano
  if (!playerToken && game.user.isGM) {
    const candidateTokens = canvas.tokens.placeables.filter(
      (t) => t.id !== targetToken.id && (adapter.isPlayerCharacter(t.actor) || t.actor?.hasPlayerOwner)
    );

    if (candidateTokens.length > 0) {
      candidateTokens.sort(
        (a, b) => _calculateTokenDistance(a, targetToken) - _calculateTokenDistance(b, targetToken)
      );
      playerToken = candidateTokens[0];
    }
  }

  // 5. Fallback si no hay ningún token de jugador en la escena pero hay un Actor de jugador en el mundo
  let fallbackActor = playerToken?.actor;
  if (!fallbackActor) {
    if (!game.user.isGM) {
      fallbackActor = game.user.character || game.actors.find((a) => a.getUserLevel(game.user) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER && adapter.isPlayerCharacter(a)) || null;
    } else {
      fallbackActor = game.actors.find((a) => adapter.isPlayerCharacter(a)) || null;
    }
  }

  if (!playerToken && !fallbackActor) {
    ui.notifications.warn(game.i18n.localize("WOW_LOOTER.Warning.SelectYourTokenFirst"));
    return;
  }

  const actorSettings = targetToken.actor?.getFlag(MODULE_ID, "lootSettings") || {};
  const tokenSettings = targetToken.document?.getFlag(MODULE_ID, "lootSettings") || {};
  const lootSettings = { ...actorSettings, ...tokenSettings };
  preloadContainerTextures(lootSettings);

  // Medir distancia entre tokens (si no es el GM y ambos tokens están en el canvas)
  if (!game.user.isGM && playerToken) {
    const configuredDistance = lootSettings.interactionDistance !== undefined && lootSettings.interactionDistance !== null
      ? Number(lootSettings.interactionDistance)
      : (game.settings.get(MODULE_ID, SETTINGS.PROXIMITY_DISTANCE) || 1.5);

    // 0 = distancia infinita
    if (configuredDistance > 0) {
      const dist = _calculateTokenDistance(playerToken, targetToken);
      if (dist > configuredDistance) {
        ui.notifications.warn(game.i18n.localize("WOW_LOOTER.Warning.TooFarToLoot"));
        return;
      }
    }
  }

  // Verificación de contenedor cerrado con llave (isLocked o token.document.locked)
  const isLocked = Boolean(targetToken.document?.locked || lootSettings.isLocked);
  if (isLocked && !game.user.isGM) {
    if (lootSettings.lockedSound) {
      foundry.audio.AudioHelper.play({ src: lootSettings.lockedSound, volume: 0.8 }, true);
    }
    const actorName = targetToken.actor?.name || targetToken.name || "Container";
    ui.notifications.warn(game.i18n.format("WOW_LOOTER.Warning.ContainerLockedNamed", { name: actorName }));
    return;
  }

  // Sonido de apertura si está configurado
  if (lootSettings.openingSound) {
    foundry.audio.AudioHelper.play({ src: lootSettings.openingSound, volume: 0.8 }, true);
  }

  // Ejecución de Macro al interactuar
  if (lootSettings.macroOnInteract) {
    const macroNameOrUuid = lootSettings.macroOnInteract.trim();
    let macro = game.macros.getName(macroNameOrUuid);
    if (!macro && (macroNameOrUuid.startsWith("Macro.") || macroNameOrUuid.includes("."))) {
      fromUuid(macroNameOrUuid).then((m) => {
        if (m) m.execute({ actor: playerToken?.actor, token: playerToken, target: targetToken });
      }).catch(() => {});
    } else if (macro) {
      try {
        macro.execute({ actor: playerToken?.actor, token: playerToken, target: targetToken });
      } catch (err) {
        console.error("[wow-looter] Error ejecutando macro on interact:", err);
      }
    }
  }

  // Si es contenedor, actualizar imagen en el mapa (vía GM si el usuario es jugador)
  if (lootSettings.lootType === "container") {
    if (game.user.isGM) {
      applyContainerTexture(targetToken.document, targetToken.actor, "open");
    } else {
      socketService.emit(SOCKET_EVENTS.CONTAINER_STATE_CHANGE, {
        tokenId: targetToken.id,
        actorId: targetToken.actor?.id,
        state: "open"
      });
    }
  }

  // Detectar si el actor es un Comerciante (Merchant)
  const isMerchant = lootSettings.lootType === "merchant"
    || targetToken.actor?.system?.lootSheetType?.toLowerCase() === "merchant"
    || targetToken.actor?.getFlag?.(MODULE_ID, "lootSettings")?.lootType === "merchant";

  if (isMerchant) {
    new MerchantApp({
      targetToken,
      lootingToken: playerToken,
      targetActor: targetToken.actor,
      lootingActor: fallbackActor
    }).render(true);
    return;
  }

  new ManualLootApp({
    targetToken,
    lootingToken: playerToken,
    targetActor: targetToken.actor,
    lootingActor: fallbackActor
  }).render(true);
}

/**
 * Calcula la distancia en casillas o unidades de grid entre dos tokens.
 */
function _calculateTokenDistance(t1, t2) {
  const p1 = { x: t1.center.x, y: t1.center.y };
  const p2 = { x: t2.center.x, y: t2.center.y };
  const dx = Math.abs(p1.x - p2.x);
  const dy = Math.abs(p1.y - p2.y);
  const gridSize = canvas.grid.size || 100;

  return Math.hypot(dx, dy) / gridSize;
}
