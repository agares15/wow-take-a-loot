import { MODULE_ID, FLAGS, SOCKET_EVENTS } from "../constants.js";
import { getSystemAdapter } from "../adapters/index.js";
import { socketService } from "./socket-service.js";
import { currencyService } from "./currency-service.js";
import { ChatAnnouncer } from "./chat-announcer.js";
import { enrichItemDescription } from "../utils/dom-helpers.js";

/**
 * Servicio centralizado para transacciones de compra, venta y gestión del comerciante.
 */
export class MerchantService {
  /**
   * Ejecuta o solicita la compra de un item del comerciante.
   */
  static async buyItem({ merchantActor, buyerActor, itemId, quantity = 1, targetTokenId = null, lootingTokenId = null }) {
    if (!merchantActor || !buyerActor || !itemId || quantity <= 0) return false;

    // Si el usuario actual es GM o es dueño del mercader, ejecuta directamente.
    // De lo contrario, solicita al GM primario ejecutar la transacción vía socket.
    if (game.user.isGM || merchantActor.isOwner) {
      return this._executeBuyInternal({ merchantActor, buyerActor, itemId, quantity, targetTokenId });
    } else {
      socketService.emit(SOCKET_EVENTS.MERCHANT_TRANSACTION_REQUEST, {
        action: "buy",
        merchantActorId: merchantActor.id,
        buyerActorId: buyerActor.id,
        itemId,
        quantity,
        targetTokenId,
        lootingTokenId
      });
      return true;
    }
  }

  /**
   * Ejecuta o solicita la venta de un item al comerciante.
   */
  static async sellItem({ merchantActor, sellerActor, itemId, quantity = 1, targetTokenId = null, lootingTokenId = null }) {
    if (!merchantActor || !sellerActor || !itemId || quantity <= 0) return false;

    if (game.user.isGM || merchantActor.isOwner) {
      return this._executeSellInternal({ merchantActor, sellerActor, itemId, quantity, targetTokenId });
    } else {
      socketService.emit(SOCKET_EVENTS.MERCHANT_TRANSACTION_REQUEST, {
        action: "sell",
        merchantActorId: merchantActor.id,
        sellerActorId: sellerActor.id,
        itemId,
        quantity,
        targetTokenId,
        lootingTokenId
      });
      return true;
    }
  }

  /**
   * Resuelve y procesa una petición de compra, venta o recompra recibida vía socket por el GM.
   */
  static async handleSocketTransactionRequest(payload, senderId = null) {
    let merchantActor = null;
    if (payload.targetTokenId) {
      const liveToken = canvas.tokens?.get(payload.targetTokenId) || canvas.tokens?.placeables.find((t) => t.id === payload.targetTokenId);
      if (liveToken?.actor) merchantActor = liveToken.actor;
    }
    if (!merchantActor && payload.merchantActorId) {
      merchantActor = game.actors.get(payload.merchantActorId);
    }

    let customerActor = null;
    const customerId = payload.buyerActorId || payload.sellerActorId;
    if (customerId) {
      customerActor = game.actors.get(customerId);
    }
    if (!customerActor && payload.lootingTokenId) {
      const liveToken = canvas.tokens?.get(payload.lootingTokenId) || canvas.tokens?.placeables.find((t) => t.id === payload.lootingTokenId);
      if (liveToken?.actor) customerActor = liveToken.actor;
    }
    if (!customerActor && senderId) {
      const sender = game.users.get(senderId);
      if (sender?.character) customerActor = sender.character;
    }

    if (!merchantActor || !customerActor) {
      console.error("[wow-looter] Error resolviendo actores para merchant transaction request:", payload);
      return false;
    }

    if (payload.action === "buy") {
      return this._executeBuyInternal({
        merchantActor,
        buyerActor: customerActor,
        itemId: payload.itemId,
        quantity: payload.quantity,
        targetTokenId: payload.targetTokenId
      });
    } else if (payload.action === "sell") {
      return this._executeSellInternal({
        merchantActor,
        sellerActor: customerActor,
        itemId: payload.itemId,
        quantity: payload.quantity,
        targetTokenId: payload.targetTokenId
      });
    } else if (payload.action === "buyback") {
      return this._executeBuybackInternal({
        merchantActor,
        buyerActor: customerActor,
        itemName: payload.itemName,
        quantity: payload.quantity,
        unitCopper: payload.unitCopper,
        targetTokenId: payload.targetTokenId
      });
    }
    return false;
  }

  /**
   * Ejecuta o solicita la recompra de un item vendido durante la sesión actual.
   */
  static async buybackItem({ merchantActor, buyerActor, itemName, quantity = 1, unitCopper, targetTokenId = null, lootingTokenId = null }) {
    if (!merchantActor || !buyerActor || !itemName || quantity <= 0) return false;

    if (game.user.isGM || merchantActor.isOwner) {
      return this._executeBuybackInternal({ merchantActor, buyerActor, itemName, quantity, unitCopper, targetTokenId });
    } else {
      socketService.emit(SOCKET_EVENTS.MERCHANT_TRANSACTION_REQUEST, {
        action: "buyback",
        merchantActorId: merchantActor.id,
        buyerActorId: buyerActor.id,
        itemName,
        quantity,
        unitCopper,
        targetTokenId,
        lootingTokenId
      });
      return true;
    }
  }

  /**
   * Ejecución autoritativa de recompra (lado GM).
   */
  static async _executeBuybackInternal({ merchantActor, buyerActor, itemName, quantity, unitCopper, targetTokenId }) {
    // Buscar el item en el mercader por nombre
    const item = merchantActor.items.find((i) => i.name === itemName);
    if (!item) {
      ui.notifications.warn(game.i18n.localize("WOW_LOOTER.Merchant.ItemNotFound"));
      return false;
    }

    const availableQty = Number(item.quantity ?? item.system?.quantity ?? 1);
    const toBuyback = Math.min(quantity, availableQty);
    if (toBuyback <= 0) {
      ui.notifications.warn(game.i18n.localize("WOW_LOOTER.Merchant.OutOfStock"));
      return false;
    }

    const totalCostCopper = unitCopper * toBuyback;

    // Verificar si el comprador puede pagar
    if (!currencyService.canActorAfford(buyerActor, totalCostCopper)) {
      ui.notifications.warn(game.i18n.localize("WOW_LOOTER.Merchant.CannotAfford"));
      return false;
    }

    const lootSettings = merchantActor.getFlag(MODULE_ID, "lootSettings") || {};
    const adapter = getSystemAdapter();

    // 1. Deducir fondos del comprador
    await currencyService.deductCopperFromActor(buyerActor, totalCostCopper);

    // 2. Si el mercader no tiene fondos infinitos, devolver las monedas al mercader
    if (lootSettings.infiniteFunds === false) {
      await currencyService.addCopperToActor(merchantActor, totalCostCopper);
    }

    // 3. Transferir item del mercader al comprador
    const itemImg = item.img;
    await adapter.transferItem(merchantActor, buyerActor, item.id, toBuyback);

    // 4. Sonido
    foundry.audio.AudioHelper.play({ src: "sounds/coins.wav", volume: 0.8 }, true);

    // 5. Anuncio en Chat
    const formattedCost = currencyService.formatCopperPrice(totalCostCopper);
    await ChatAnnouncer.announceMerchantBuyback(buyerActor, merchantActor, itemName, itemImg, toBuyback, formattedCost);

    ui.notifications.info(game.i18n.format("WOW_LOOTER.Merchant.BoughtBackNotice", {
      actor: buyerActor.name,
      qty: toBuyback,
      item: itemName,
      price: formattedCost
    }));

    // 6. Notificar actualización
    socketService.emit(SOCKET_EVENTS.MERCHANT_UPDATED, {
      merchantActorId: merchantActor.id,
      targetTokenId
    });

    return true;
  }

  /**
   * Muestra al GM la ventana de aprobación de identificación con precio manual.
   * Muestra el ítem en cuestión, el personaje solicitante y el mercader.
   */
  static async openIdentifyApprovalDialog({ merchantActor, shopperActor, itemId, itemName, itemImg, targetTokenId = null, requestId = null, emitResolution = false }) {
    const adapter = getSystemAdapter();
    const currencyKeys = adapter.getCurrencyKeys();
    const defaultKey = currencyKeys.includes("gp") ? "gp" : (currencyKeys[0] || "gp");
    const currencyOptionsHtml = currencyKeys.map((key) => {
      const label = currencyService.getCurrencyMetadata(key).label;
      return `<option value="${key}" ${key === defaultKey ? "selected" : ""}>${label}</option>`;
    }).join("");

    const rates = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 };
    const item = shopperActor.items.get(itemId);
    const realName = item?._source?.name || item?.name || itemName;
    const realImg = item?._source?.img || item?.img || itemImg;
    const rawDescription = item?._source?.system?.description?.value || item?.system?.description?.value || "";
    const realDescription = await enrichItemDescription(rawDescription, item);

    const content = `
      <div style="display: flex; flex-direction: column; gap: 10px; padding: 4px;">
        <p style="margin: 0;"><strong>${shopperActor.name}</strong> solicita a <strong>${merchantActor.name}</strong> identificar el siguiente objeto:</p>
        <div style="display: flex; align-items: center; gap: 10px; background: #1a2230; padding: 8px; border-radius: 6px; border: 1px solid #3c4c6a;">
          <img src="${itemImg}" style="width: 38px; height: 38px; border-radius: 4px; object-fit: cover;" />
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <strong style="color: #f3f4f6;">${itemName}</strong>
            <span style="color: #94a3b8; font-size: 0.85em;">No identificado • Mercader: <strong>${merchantActor.name}</strong></span>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px; background: #121722; padding: 8px 10px; border-radius: 6px; border: 1px solid #2c384e;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <img src="${realImg}" style="width: 28px; height: 28px; border-radius: 4px; object-fit: cover;" />
            <div style="display: flex; flex-direction: column;">
              <span style="color: #94a3b8; font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.04em;">Objeto identificado (Referencia GM)</span>
              <strong style="color: #f8fafc;">${realName}</strong>
            </div>
          </div>
          ${realDescription
            ? `<div style="max-height: 140px; overflow-y: auto; font-size: 0.85em; color: #cbd5e1; border-top: 1px solid #263144; padding-top: 6px; line-height: 1.35;">${realDescription}</div>`
            : `<span style="color: #64748b; font-size: 0.8em; font-style: italic;">Sin descripción disponible.</span>`
          }
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <label style="font-weight: 600; white-space: nowrap;">Precio:</label>
          <input type="number" name="identifyPriceAmount" value="0" min="0" step="1" style="width: 90px;" />
          <select name="identifyPriceCurrency" style="width: 90px;">${currencyOptionsHtml}</select>
        </div>
      </div>
    `;

    return new Promise((resolve) => {
      let settled = false;
      const finish = (val) => {
        if (!settled) {
          settled = true;
          resolve(val);
        }
      };

      new Dialog({
        title: game.i18n.localize("WOW_LOOTER.Merchant.IdentifyRequestTitle"),
        content,
        buttons: {
          approve: {
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize("WOW_LOOTER.Merchant.Approve"),
            callback: async (html) => {
              const root = html instanceof HTMLElement ? html : html[0];
              const amount = Math.max(0, Number(root?.querySelector("input[name='identifyPriceAmount']")?.value || 0));
              const currencyKey = (root?.querySelector("select[name='identifyPriceCurrency']")?.value || defaultKey).toLowerCase();
              const rate = rates[currencyKey] || 100;
              const costCopper = Math.round(amount * rate);

              const success = await MerchantService._executeIdentifyInternal({
                merchantActor,
                shopperActor,
                itemId,
                costCopper,
                targetTokenId
              });

              if (emitResolution) {
                socketService.emit(SOCKET_EVENTS.MERCHANT_IDENTIFY_RESOLVED, {
                  requestId,
                  shopperActorId: shopperActor.id,
                  itemId,
                  success,
                  itemName
                });
              }
              finish(success);
            }
          },
          reject: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize("WOW_LOOTER.Merchant.Reject"),
            callback: () => {
              if (emitResolution) {
                socketService.emit(SOCKET_EVENTS.MERCHANT_IDENTIFY_RESOLVED, {
                  requestId,
                  shopperActorId: shopperActor.id,
                  itemId,
                  success: false,
                  itemName
                });
              }
              finish(false);
            }
          }
        },
        default: "approve",
        close: () => {
          if (!settled && emitResolution) {
            socketService.emit(SOCKET_EVENTS.MERCHANT_IDENTIFY_RESOLVED, {
              requestId,
              shopperActorId: shopperActor.id,
              itemId,
              success: false,
              itemName
            });
          }
          finish(false);
        }
      }).render(true);
    });
  }

  /**
   * Solicita o ejecuta la identificación de un item a través del mercader.
   */
  static async requestIdentifyItem({ merchantActor, shopperActor, itemId, costCopper = 0, targetTokenId = null, lootingTokenId = null }) {
    if (!merchantActor || !shopperActor || !itemId) return false;

    const item = shopperActor.items.get(itemId);
    if (!item) return false;

    const adapter = getSystemAdapter();
    const itemName = adapter.getUnidentifiedItemName(item);
    const itemImg = adapter.getUnidentifiedItemImg(item);

    // Si el usuario actual es el GM, abrir diálogo para definir precio manualmente y aprobar/rechazar
    if (game.user.isGM) {
      return this.openIdentifyApprovalDialog({
        merchantActor,
        shopperActor,
        itemId,
        itemName,
        itemImg,
        targetTokenId,
        emitResolution: false
      });
    }

    // Si es jugador, enviar solicitud por socket al GM activo
    const requestId = foundry.utils.randomID();
    ui.notifications.info(game.i18n.localize("WOW_LOOTER.Merchant.IdentifyRequestSent"));

    socketService.emit(SOCKET_EVENTS.MERCHANT_IDENTIFY_REQUEST, {
      requestId,
      merchantActorId: merchantActor.id,
      targetTokenId,
      shopperActorId: shopperActor.id,
      lootingTokenId,
      itemId,
      itemName,
      itemImg
    });

    return true;
  }

  /**
   * Ejecución autoritativa de la identificación de un item (lado GM).
   */
  static async _executeIdentifyInternal({ merchantActor, shopperActor, itemId, costCopper, targetTokenId }) {
    const item = shopperActor.items.get(itemId);
    if (!item) {
      ui.notifications.warn(game.i18n.localize("WOW_LOOTER.Merchant.ItemNotFound"));
      return false;
    }

    // Verificar si el jugador puede pagar
    if (!currencyService.canActorAfford(shopperActor, costCopper)) {
      ui.notifications.warn(game.i18n.localize("WOW_LOOTER.Merchant.CannotAfford"));
      return false;
    }

    const adapter = getSystemAdapter();
    const lootSettings = merchantActor.getFlag(MODULE_ID, "lootSettings") || {};

    // 1. Deducir fondos del jugador
    await currencyService.deductCopperFromActor(shopperActor, costCopper);

    // 2. Si el mercader no tiene fondos infinitos, añadir el pago al mercader
    if (lootSettings.infiniteFunds === false) {
      await currencyService.addCopperToActor(merchantActor, costCopper);
    }

    // 3. Identificar el item en el sistema
    await adapter.identifyItem(item);

    // 4. Sonido
    foundry.audio.AudioHelper.play({ src: "sounds/enchant.wav", volume: 0.8 }, true).catch(() => {
      foundry.audio.AudioHelper.play({ src: "sounds/coins.wav", volume: 0.8 }, true);
    });

    // 5. Anuncio en Chat
    const formattedCost = currencyService.formatCopperPrice(costCopper);
    await ChatAnnouncer.announceItemIdentified(shopperActor, merchantActor, item.name, item.img, formattedCost);

    ui.notifications.info(game.i18n.format("WOW_LOOTER.Merchant.ItemIdentifiedSuccess", {
      item: item.name,
      price: formattedCost
    }));

    // 6. Notificar a todos los clientes
    socketService.emit(SOCKET_EVENTS.MERCHANT_UPDATED, {
      merchantActorId: merchantActor.id,
      targetTokenId
    });

    return true;
  }

  /**
   * Ejecución autoritativa de compra (lado GM).
   */
  static async _executeBuyInternal({ merchantActor, buyerActor, itemId, quantity, targetTokenId }) {
    const item = merchantActor.items.get(itemId);
    if (!item) {
      ui.notifications.warn(game.i18n.localize("WOW_LOOTER.Merchant.ItemNotFound"));
      return false;
    }

    const itemSettings = item.getFlag?.(MODULE_ID, "merchantItemSettings") || {};
    const isInfinite = Boolean(itemSettings.infiniteQuantity);
    const keepWhenSoldOut = Boolean(itemSettings.keepWhenSoldOut);
    const isService = Boolean(itemSettings.isService);

    const availableQty = isInfinite ? Infinity : Number(item.quantity ?? item.system?.quantity ?? 1);
    const toBuy = isInfinite ? Math.max(1, quantity) : Math.min(quantity, availableQty);
    if (toBuy <= 0) {
      ui.notifications.warn(game.i18n.localize("WOW_LOOTER.Merchant.OutOfStock"));
      return false;
    }

    const lootSettings = merchantActor.getFlag(MODULE_ID, "lootSettings") || {};
    const buyModifier = Number(lootSettings.buyPriceModifier !== undefined ? lootSettings.buyPriceModifier : 100);
    const priceEval = currencyService.evaluateItemBuyPrice(item, buyModifier, itemSettings);

    // Verificar si el comprador puede pagar
    if (!currencyService.canActorAffordPrice(buyerActor, priceEval, toBuy)) {
      ui.notifications.warn(game.i18n.localize("WOW_LOOTER.Merchant.CannotAfford"));
      return false;
    }

    const adapter = getSystemAdapter();

    // 1. Deducir fondos del comprador y pagar al mercader si aplica
    const totalCopper = priceEval.copperValue * toBuy;
    if (!priceEval.isFree && totalCopper > 0) {
      await currencyService.deductCopperFromActor(buyerActor, totalCopper);
      if (lootSettings.infiniteFunds === false) {
        await currencyService.addCopperToActor(merchantActor, totalCopper);
      }
    }
    if (!priceEval.isFree) {
      for (const [cKey, cAmt] of Object.entries(priceEval.customAmounts || {})) {
        const totalCustom = cAmt * toBuy;
        if (totalCustom <= 0) continue;
        await currencyService.deductCurrency(buyerActor, cKey, totalCustom);
        if (lootSettings.infiniteFunds === false) {
          await currencyService.giveCurrency(merchantActor, cKey, totalCustom);
        }
      }
    }

    // 2. Transferir o entregar el item (si es servicio, no se añade al inventario del comprador)
    const itemName = item.name;
    const itemImg = item.img;
    if (isService) {
      if (!isInfinite) {
        const nextQty = Math.max(0, availableQty - toBuy);
        if (nextQty <= 0 && !keepWhenSoldOut) {
          await item.delete();
        } else {
          await item.update({ "system.quantity": nextQty });
        }
      }
    } else if (isInfinite || (keepWhenSoldOut && availableQty <= toBuy)) {
      // Clonar y apilar en el comprador sin eliminar el documento del mercader
      const existingOnBuyer = buyerActor.items.find((i) => i.name === item.name && i.type === item.type);
      if (existingOnBuyer) {
        const curQty = Number(existingOnBuyer.quantity ?? existingOnBuyer.system?.quantity ?? 1);
        await existingOnBuyer.update({ "system.quantity": curQty + toBuy });
      } else {
        const itemData = item.toObject();
        delete itemData._id;
        delete itemData._stats;
        itemData.system = itemData.system || {};
        itemData.system.quantity = toBuy;
        if (itemData.system.containerId) itemData.system.containerId = null;
        await buyerActor.createEmbeddedDocuments("Item", [itemData]);
      }
      if (!isInfinite) {
        await item.update({ "system.quantity": 0 });
      }
    } else {
      await adapter.transferItem(merchantActor, buyerActor, itemId, toBuy);
    }

    // 3. Sonido de compra
    foundry.audio.AudioHelper.play({ src: "sounds/coins.wav", volume: 0.8 }, true);

    // 4. Anuncio en Chat
    const formattedCost = priceEval.isFree
      ? game.i18n.localize("WOW_LOOTER.Merchant.Free")
      : (priceEval.isCustomPrice
        ? Object.entries({ ...(totalCopper > 0 ? { _copper: totalCopper } : {}), ...(priceEval.customAmounts || {}) })
            .map(([k, v]) => k === "_copper" ? currencyService.formatCopperPrice(v) : `${v * toBuy} ${currencyService.getCurrencyMetadata(k).label}`)
            .join(", ")
        : currencyService.formatCopperPrice(totalCopper));
    await ChatAnnouncer.announceMerchantPurchase(buyerActor, merchantActor, itemName, itemImg, toBuy, formattedCost);

    ui.notifications.info(game.i18n.format("WOW_LOOTER.Merchant.BoughtNotice", {
      actor: buyerActor.name,
      qty: toBuy,
      item: itemName,
      price: formattedCost
    }));

    // 6. Notificar a todos los clientes para que actualicen sus ventanas abiertas
    socketService.emit(SOCKET_EVENTS.MERCHANT_UPDATED, {
      merchantActorId: merchantActor.id,
      targetTokenId
    });

    return true;
  }

  /**
   * Ejecución autoritativa de venta (lado GM).
   */
  static async _executeSellInternal({ merchantActor, sellerActor, itemId, quantity, targetTokenId }) {
    const item = sellerActor.items.get(itemId);
    if (!item) {
      ui.notifications.warn(game.i18n.localize("WOW_LOOTER.Merchant.ItemNotFound"));
      return false;
    }

    const ownedQty = Number(item.quantity ?? item.system?.quantity ?? 1);
    const toSell = Math.min(quantity, ownedQty);
    if (toSell <= 0) return false;

    const lootSettings = merchantActor.getFlag(MODULE_ID, "lootSettings") || {};
    const merchantMatch = merchantActor.items.find((i) => i.name === item.name && i.type === item.type);
    const itemSettings = item.getFlag?.(MODULE_ID, "merchantItemSettings")
      || merchantMatch?.getFlag?.(MODULE_ID, "merchantItemSettings")
      || {};
    const rawSellMod = itemSettings.sellPriceModifier;
    const effectiveSellMod = (rawSellMod !== null && rawSellMod !== undefined && rawSellMod !== "")
      ? Math.max(0, Number(rawSellMod))
      : Number(lootSettings.sellPriceModifier !== undefined ? lootSettings.sellPriceModifier : 50);
    const sellModifier = effectiveSellMod / 100;
    const basePriceData = currencyService.getItemPriceData(item);
    const unitPayoutCopper = Math.round(basePriceData.copperValue * sellModifier);
    const totalPayoutCopper = unitPayoutCopper * toSell;

    // Si el mercader no tiene fondos infinitos, verificar si el mercader puede pagar
    if (lootSettings.infiniteFunds === false) {
      if (!currencyService.canActorAfford(merchantActor, totalPayoutCopper)) {
        ui.notifications.warn(game.i18n.localize("WOW_LOOTER.Merchant.MerchantCannotAfford"));
        return false;
      }
      await currencyService.deductCopperFromActor(merchantActor, totalPayoutCopper);
    }

    const adapter = getSystemAdapter();

    // 1. Transferir el item del vendedor al mercader
    const itemName = item.name;
    const itemImg = item.img;
    await adapter.transferItem(sellerActor, merchantActor, itemId, toSell);

    // 2. Dar fondos al vendedor
    await currencyService.addCopperToActor(sellerActor, totalPayoutCopper);

    // 3. Sonido
    foundry.audio.AudioHelper.play({ src: "sounds/coins.wav", volume: 0.8 }, true);

    // 4. Anuncio en Chat
    const formattedPayout = currencyService.formatCopperPrice(totalPayoutCopper);
    await ChatAnnouncer.announceMerchantSale(sellerActor, merchantActor, itemName, itemImg, toSell, formattedPayout);

    ui.notifications.info(game.i18n.format("WOW_LOOTER.Merchant.SoldNotice", {
      actor: sellerActor.name,
      qty: toSell,
      item: itemName,
      price: formattedPayout
    }));

    // 5. Notificar a todos los clientes
    socketService.emit(SOCKET_EVENTS.MERCHANT_UPDATED, {
      merchantActorId: merchantActor.id,
      targetTokenId
    });

    return {
      success: true,
      itemName,
      itemImg,
      quantity: toSell,
      unitPayoutCopper,
      totalPayoutCopper,
      formattedPayout
    };
  }

  /**
   * Permite al GM ajustar el precio o cantidad personalizada de un item en el inventario del mercader.
   */
  static async updateItemCustomPrice(merchantActor, itemId, { customPrice = null, quantity = null }) {
    if (!merchantActor || !itemId) return;
    const item = merchantActor.items.get(itemId);
    if (!item) return;

    const updates = {};
    if (quantity !== null && !isNaN(quantity)) {
      updates["system.quantity"] = Math.max(1, Number(quantity));
    }

    if (customPrice !== null) {
      await item.setFlag(MODULE_ID, "customPrice", customPrice);
    }

    if (Object.keys(updates).length > 0) {
      await item.update(updates);
    }

    socketService.emit(SOCKET_EVENTS.MERCHANT_UPDATED, {
      merchantActorId: merchantActor.id
    });
  }

  /**
   * Permite al GM eliminar un item del inventario del mercader rápidamente.
   */
  static async deleteMerchantItem(merchantActor, itemId) {
    if (!merchantActor || !itemId) return;
    const item = merchantActor.items.get(itemId);
    if (item) {
      await item.delete();
      socketService.emit(SOCKET_EVENTS.MERCHANT_UPDATED, {
        merchantActorId: merchantActor.id
      });
    }
  }

  /**
   * Añade un item nuevo al inventario del mercader (ej. por Drag & Drop).
   */
  static async addMerchantItem(merchantActor, itemData) {
    if (!merchantActor || !itemData) return null;
    const created = await merchantActor.createEmbeddedDocuments("Item", [itemData]);
    socketService.emit(SOCKET_EVENTS.MERCHANT_UPDATED, {
      merchantActorId: merchantActor.id
    });
    return created?.[0] || null;
  }

  /**
   * Actualiza los modificadores globales de compra/venta del mercader.
   */
  static async updateMerchantSettings(merchantActor, { buyPriceModifier, sellPriceModifier, infiniteFunds, customDescription }) {
    if (!merchantActor) return;
    const current = merchantActor.getFlag(MODULE_ID, "lootSettings") || {};
    const updated = {
      ...current,
      lootType: "merchant",
      buyPriceModifier: buyPriceModifier !== undefined ? Number(buyPriceModifier) : current.buyPriceModifier,
      sellPriceModifier: sellPriceModifier !== undefined ? Number(sellPriceModifier) : current.sellPriceModifier,
      infiniteFunds: infiniteFunds !== undefined ? Boolean(infiniteFunds) : current.infiniteFunds,
      customDescription: customDescription !== undefined ? String(customDescription) : current.customDescription
    };

    await merchantActor.setFlag(MODULE_ID, "lootSettings", updated);
    socketService.emit(SOCKET_EVENTS.MERCHANT_UPDATED, {
      merchantActorId: merchantActor.id
    });
  }
}
export const merchantService = MerchantService;

