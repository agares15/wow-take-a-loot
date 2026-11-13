import { MODULE_ID } from "../constants.js";

/**
 * Servicio encargado de publicar anuncios estilizados en el chat de Foundry VTT
 * cuando los personajes recogen botín o dinero, visible para todos los jugadores.
 */
export class ChatAnnouncer {
  /**
   * Anuncia en el chat la recogida de un item individual.
   * @param {Actor} lootingActor - Personaje que recoge
   * @param {Actor} targetActor - Cuerpo o contenedor de origen
   * @param {string} itemName - Nombre del objeto
   * @param {string} itemImg - Imagen del objeto
   * @param {number} quantity - Cantidad recogida
   */
  static async announceItemPickup(lootingActor, targetActor, itemName, itemImg, quantity = 1) {
    const qtyStr = quantity > 1 ? ` (x${quantity})` : "";
    const content = `
      <div class="wow-looter-chat-card loot-pickup-card">
        <div class="card-header">
          <img src="${itemImg || 'icons/svg/item-bag.svg'}" class="item-chat-img" />
          <div class="card-text">
            <span class="pickup-title"><strong>${lootingActor.name}</strong> ${game.i18n.localize("WOW_LOOTER.Chat.LootedItem")}</span>
            <span class="pickup-item-name">${itemName}${qtyStr}</span>
          </div>
        </div>
        <div class="card-footer">
          <span><i class="fas fa-box-open"></i> ${targetActor.name}</span>
        </div>
      </div>
    `;

    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: lootingActor }),
      content
    });
  }

  /**
   * Anuncia en el chat la recogida de múltiples items (Loot All).
   * @param {Actor} lootingActor
   * @param {Actor} targetActor
   * @param {Array<{ name: string, img: string, quantity: number }>} itemEntries
   */
  static async announceAllItemsPickup(lootingActor, targetActor, itemEntries = []) {
    if (itemEntries.length === 0) return;
    const itemsHtml = itemEntries
      .map((i) => `<li><img src="${i.img || 'icons/svg/item-bag.svg'}" class="mini-chat-icon" /> <span>${i.name}</span> ${i.quantity > 1 ? `(x${i.quantity})` : ''}</li>`)
      .join("");

    const content = `
      <div class="wow-looter-chat-card loot-pickup-card">
        <div class="card-header">
          <img src="${lootingActor.img || 'icons/svg/mystery-man.svg'}" class="item-chat-img" />
          <div class="card-text">
            <span class="pickup-title"><strong>${lootingActor.name}</strong> ${game.i18n.localize("WOW_LOOTER.Manual.LootAll")}:</span>
          </div>
        </div>
        <ul class="pickup-items-list">
          ${itemsHtml}
        </ul>
        <div class="card-footer">
          <span><i class="fas fa-box-open"></i> ${targetActor.name}</span>
        </div>
      </div>
    `;

    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: lootingActor }),
      content
    });
  }

  /**
   * Anuncia en el chat la recogida de monedas o su reparto en grupo.
   * @param {Actor} lootingActor
   * @param {Actor} targetActor
   * @param {string} formattedCurrencies
   * @param {boolean} isSplit
   * @param {number} numMembers
   */
  static async announceCurrencyPickup(lootingActor, targetActor, formattedCurrencies, isSplit = false, numMembers = 0) {
    const iconClass = isSplit ? "fa-users" : "fa-coins";
    const title = isSplit
      ? `${game.i18n.localize("WOW_LOOTER.Chat.SplitCoinsParty")} (${numMembers} miembros)`
      : `<strong>${lootingActor.name}</strong> ${game.i18n.localize("WOW_LOOTER.Chat.LootedCoins")}`;

    const content = `
      <div class="wow-looter-chat-card loot-pickup-card">
        <div class="card-header">
          <i class="fas ${iconClass} fa-2x" style="margin-right: 8px;"></i>
          <div class="card-text">
            <span class="pickup-title">${title}:</span>
            <span class="pickup-item-name">${formattedCurrencies}</span>
          </div>
        </div>
        <div class="card-footer">
          <span><i class="fas fa-box-open"></i> ${targetActor.name}</span>
        </div>
      </div>
    `;

    return ChatMessage.create({
      speaker: isSplit ? { alias: "WoW Looter" } : ChatMessage.getSpeaker({ actor: lootingActor }),
      content
    });
  }

  /**
   * Anuncia en el chat una compra en el comerciante.
   * @param {Actor} buyerActor
   * @param {Actor} merchantActor
   * @param {string} itemName
   * @param {string} itemImg
   * @param {number} quantity
   * @param {string} formattedCost
   */
  static async announceMerchantPurchase(buyerActor, merchantActor, itemName, itemImg, quantity, formattedCost) {
    const qtyStr = quantity > 1 ? ` (x${quantity})` : "";
    const content = `
      <div class="wow-looter-chat-card loot-pickup-card merchant-chat-card">
        <div class="card-header">
          <img src="${itemImg || 'icons/svg/item-bag.svg'}" class="item-chat-img" />
          <div class="card-text">
            <span class="pickup-title"><strong>${buyerActor.name}</strong> ${game.i18n.localize("WOW_LOOTER.Merchant.ChatBought")}</span>
            <span class="pickup-item-name">${itemName}${qtyStr}</span>
          </div>
        </div>
        <div class="card-footer merchant-footer">
          <span><i class="fas fa-store"></i> ${merchantActor.name}</span>
          <span class="merchant-price-badge"><i class="fas fa-coins"></i> ${formattedCost}</span>
        </div>
      </div>
    `;

    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: buyerActor }),
      content
    });
  }

  /**
   * Anuncia en el chat una venta de item al comerciante.
   * @param {Actor} sellerActor
   * @param {Actor} merchantActor
   * @param {string} itemName
   * @param {string} itemImg
   * @param {number} quantity
   * @param {string} formattedPayout
   */
  static async announceMerchantSale(sellerActor, merchantActor, itemName, itemImg, quantity, formattedPayout) {
    const qtyStr = quantity > 1 ? ` (x${quantity})` : "";
    const content = `
      <div class="wow-looter-chat-card loot-pickup-card merchant-chat-card">
        <div class="card-header">
          <img src="${itemImg || 'icons/svg/item-bag.svg'}" class="item-chat-img" />
          <div class="card-text">
            <span class="pickup-title"><strong>${sellerActor.name}</strong> ${game.i18n.localize("WOW_LOOTER.Merchant.ChatSold")}</span>
            <span class="pickup-item-name">${itemName}${qtyStr}</span>
          </div>
        </div>
        <div class="card-footer merchant-footer">
          <span><i class="fas fa-store"></i> ${merchantActor.name}</span>
          <span class="merchant-payout-badge"><i class="fas fa-coins"></i> +${formattedPayout}</span>
        </div>
      </div>
    `;

    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: sellerActor }),
      content
    });
  }

  /**
   * Anuncia en el chat la recompra de un item vendido durante la sesión.
   * @param {Actor} buyerActor
   * @param {Actor} merchantActor
   * @param {string} itemName
   * @param {string} itemImg
   * @param {number} quantity
   * @param {string} formattedCost
   */
  static async announceMerchantBuyback(buyerActor, merchantActor, itemName, itemImg, quantity, formattedCost) {
    const qtyStr = quantity > 1 ? ` (x${quantity})` : "";
    const content = `
      <div class="wow-looter-chat-card loot-pickup-card merchant-chat-card">
        <div class="card-header">
          <img src="${itemImg || 'icons/svg/item-bag.svg'}" class="item-chat-img" />
          <div class="card-text">
            <span class="pickup-title"><strong>${buyerActor.name}</strong> ${game.i18n.localize("WOW_LOOTER.Merchant.ChatBoughtBack")}</span>
            <span class="pickup-item-name">${itemName}${qtyStr}</span>
          </div>
        </div>
        <div class="card-footer merchant-footer">
          <span><i class="fas fa-rotate-left"></i> ${merchantActor.name}</span>
          <span class="merchant-price-badge"><i class="fas fa-coins"></i> ${formattedCost}</span>
        </div>
      </div>
    `;

    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: buyerActor }),
      content
    });
  }

  /**
   * Anuncia en el chat la identificación de un item a través del mercader.
   * @param {Actor} shopperActor
   * @param {Actor} merchantActor
   * @param {string} itemName
   * @param {string} itemImg
   * @param {string} formattedCost
   */
  static async announceItemIdentified(shopperActor, merchantActor, itemName, itemImg, formattedCost) {
    const content = `
      <div class="wow-looter-chat-card loot-pickup-card merchant-chat-card">
        <div class="card-header">
          <img src="${itemImg || 'icons/svg/item-bag.svg'}" class="item-chat-img" />
          <div class="card-text">
            <span class="pickup-title"><strong>${shopperActor.name}</strong> ${game.i18n.localize("WOW_LOOTER.Merchant.ChatIdentified")}</span>
            <span class="pickup-item-name">${itemName}</span>
          </div>
        </div>
        <div class="card-footer merchant-footer">
          <span><i class="fas fa-wand-magic-sparkles"></i> ${merchantActor.name}</span>
          <span class="merchant-price-badge"><i class="fas fa-coins"></i> ${formattedCost}</span>
        </div>
      </div>
    `;

    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: shopperActor }),
      content
    });
  }
}

