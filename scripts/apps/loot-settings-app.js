import { MODULE_ID, FLAGS, SOCKET_EVENTS, SETTINGS } from "../constants.js";
import { socketService } from "../services/socket-service.js";
import { protectDropdowns } from "../utils/dom-helpers.js";
import { resolveContainerTexture, preloadContainerTextures } from "../utils/container-helpers.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Ventana emergente independiente para configurar las opciones avanzadas de un botín/contenedor.
 */
export class LootSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.targetToken = options.targetToken || null;
    this.targetActor = options.targetActor || this.targetToken?.actor;
    this.parentApp = options.parentApp || null;

    const source = this.targetToken?.document || this.targetToken?.actor || this.targetActor;
    const existing = source?.getFlag?.(MODULE_ID, "lootSettings") || {};
    const systemLootSheetType = (this.targetActor?.system?.lootSheetType || source?.system?.lootSheetType || "")?.toLowerCase();

    const globalRequireDeath = game.settings.get(MODULE_ID, SETTINGS.REQUIRE_DEATH_TO_LOOT);
    this.currentLootType = existing.lootType || (systemLootSheetType === "merchant" ? "merchant" : "loot");
    this.settings = {
      lootType: this.currentLootType,
      interactionDistance: existing.interactionDistance !== undefined ? existing.interactionDistance : 1,
      macroOnInteract: existing.macroOnInteract || "",
      deleteWhenEmpty: Boolean(existing.deleteWhenEmpty),
      requireDeathToLoot: existing.requireDeathToLoot !== undefined ? Boolean(existing.requireDeathToLoot) : globalRequireDeath,
      customDescription: existing.customDescription || "",
      isClosed: existing.isClosed !== undefined ? Boolean(existing.isClosed) : true,
      isLocked: Boolean(this.targetToken?.document?.locked ?? existing.isLocked),
      closedImg: existing.closedImg || "icons/containers/chest/chest-elm-steel-brown.webp",
      openedImg: existing.openedImg || "",
      emptyImg: existing.emptyImg || "",
      lockedImg: existing.lockedImg || "",
      closingSound: existing.closingSound || "",
      openingSound: existing.openingSound || "",
      lockedSound: existing.lockedSound || "",
      buyPriceModifier: existing.buyPriceModifier !== undefined ? existing.buyPriceModifier : 100,
      sellPriceModifier: existing.sellPriceModifier !== undefined ? existing.sellPriceModifier : 50,
      infiniteFunds: existing.infiniteFunds !== undefined ? Boolean(existing.infiniteFunds) : true,
      canIdentify: existing.canIdentify !== undefined ? Boolean(existing.canIdentify) : true
    };
  }

  static DEFAULT_OPTIONS = {
    id: "wow-looter-settings",
    tag: "div",
    classes: ["wow-looter-app", "wow-looter-settings-app"],
    window: {
      title: "WOW_LOOTER.Settings.LootSettingsTitle",
      icon: "fas fa-cog",
      resizable: true
    },
    position: {
      width: 480,
      height: "auto"
    },
    actions: {
      "pick-file": LootSettingsApp._onPickFile,
      "save-settings": LootSettingsApp._onSaveSettings,
      "close": LootSettingsApp._onClose
    }
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/loot-settings.hbs`
    }
  };

  async _prepareContext() {
    const source = this.targetToken?.actor || this.targetActor;
    return {
      targetName: source?.name || game.i18n.localize("WOW_LOOTER.Manual.LootContainer"),
      targetImg: source?.img || "icons/containers/bags/pack-leather-brown.webp",
      settings: this.settings,
      isContainerType: this.currentLootType === "container",
      isMerchantType: this.currentLootType === "merchant"
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;
    protectDropdowns(html);
    const lootTypeSelect = html.querySelector("select[name='lootType']");
    const containerCard = html.querySelector(".container-options-card");
    const merchantCard = html.querySelector(".merchant-options-card");

    if (lootTypeSelect) {
      const toggleCardsView = () => {
        const val = lootTypeSelect.value;
        this.currentLootType = val;
        this.settings.lootType = this.currentLootType;

        if (containerCard) {
          containerCard.style.display = val === "container" ? "" : "none";
        }
        if (merchantCard) {
          merchantCard.style.display = val === "merchant" ? "" : "none";
        }

        // Si se cambia a container y el campo closedImg está vacío, sugerir default
        if (val === "container") {
          const closedImgInput = html.querySelector("input[name='closedImg']");
          if (closedImgInput && !closedImgInput.value.trim()) {
            closedImgInput.value = "icons/containers/chest/chest-elm-steel-brown.webp";
            this.settings.closedImg = closedImgInput.value;
          }
        }
      };

      lootTypeSelect.addEventListener("change", toggleCardsView);
      lootTypeSelect.addEventListener("input", toggleCardsView);
    }
  }

  static _onChangeLootType(event, target) {
    const select = target.tagName === "SELECT" ? target : target.closest("select") || this.element.querySelector("select[name='lootType']");
    if (!select) return;

    this.currentLootType = select.value;
    this.settings.lootType = this.currentLootType;

    const containerCard = this.element.querySelector(".container-options-card");
    if (containerCard) {
      containerCard.style.display = this.currentLootType === "container" ? "" : "none";
    }

    const merchantCard = this.element.querySelector(".merchant-options-card");
    if (merchantCard) {
      merchantCard.style.display = this.currentLootType === "merchant" ? "" : "none";
    }

    if (this.currentLootType === "container") {
      const closedImgInput = this.element.querySelector("input[name='closedImg']");
      if (closedImgInput && !closedImgInput.value.trim()) {
        closedImgInput.value = "icons/containers/chest/chest-elm-steel-brown.webp";
        this.settings.closedImg = closedImgInput.value;
      }
    }
  }

  static _onPickFile(event, target) {
    const fieldName = target.dataset.target || target.closest("[data-target]")?.dataset.target;
    const fileType = target.dataset.type || "image";
    const input = this.element.querySelector(`input[name='${fieldName}']`);
    const current = input?.value || "";

    new FilePicker({
      type: fileType,
      current,
      callback: (path) => {
        if (input) input.value = path;
        this.settings[fieldName] = path;
      }
    }).render(true);
  }

  static async _onSaveSettings(event, target) {
    const html = this.element;
    if (!html) return;

    const sourceActor = this.targetToken?.actor || this.targetActor;
    const tokenDoc = this.targetToken?.document;

    const nameInput = html.querySelector("input[name='name']");
    const imgInput = html.querySelector("input[name='img']");
    const lootTypeSelect = html.querySelector("select[name='lootType']");
    const distInput = html.querySelector("input[name='interactionDistance']");
    const macroInput = html.querySelector("input[name='macroOnInteract']");
    const delCheckbox = html.querySelector("input[name='deleteWhenEmpty']");
    const requireDeathCheckbox = html.querySelector("input[name='requireDeathToLoot']");
    const descTextarea = html.querySelector("textarea[name='customDescription']");

    const newName = nameInput?.value?.trim();
    const newImg = imgInput?.value?.trim();

    const isContainer = lootTypeSelect?.value === "container";
    const isMerchant = lootTypeSelect?.value === "merchant";
    const chosenLootType = isContainer ? "container" : (isMerchant ? "merchant" : "loot");

    const isClosed = html.querySelector("input[name='isClosed']")?.checked ?? false;
    const isLocked = html.querySelector("input[name='isLocked']")?.checked ?? false;
    const closedImg = html.querySelector("input[name='closedImg']")?.value?.trim() || "icons/containers/chest/chest-elm-steel-brown.webp";
    const openedImg = html.querySelector("input[name='openedImg']")?.value?.trim() || "";
    const emptyImg = html.querySelector("input[name='emptyImg']")?.value?.trim() || "";
    const lockedImg = html.querySelector("input[name='lockedImg']")?.value?.trim() || "";
    const openingSound = html.querySelector("input[name='openingSound']")?.value?.trim() || "";
    const closingSound = html.querySelector("input[name='closingSound']")?.value?.trim() || "";
    const lockedSound = html.querySelector("input[name='lockedSound']")?.value?.trim() || "";

    const buyPriceModifierInput = html.querySelector("input[name='buyPriceModifier']");
    const sellPriceModifierInput = html.querySelector("input[name='sellPriceModifier']");
    const infiniteFundsInput = html.querySelector("input[name='infiniteFunds']");

    const buyPriceModifier = buyPriceModifierInput ? Number(buyPriceModifierInput.value) : 100;
    const sellPriceModifier = sellPriceModifierInput ? Number(sellPriceModifierInput.value) : 50;
    const infiniteFunds = infiniteFundsInput ? infiniteFundsInput.checked : true;

    const canIdentifyInput = html.querySelector("input[name='canIdentify']");
    const canIdentify = canIdentifyInput ? canIdentifyInput.checked : true;

    const finalSettings = {
      lootType: chosenLootType,
      interactionDistance: distInput ? Number(distInput.value) : 1,
      macroOnInteract: macroInput ? macroInput.value.trim() : "",
      deleteWhenEmpty: delCheckbox ? delCheckbox.checked : false,
      requireDeathToLoot: requireDeathCheckbox ? requireDeathCheckbox.checked : game.settings.get(MODULE_ID, SETTINGS.REQUIRE_DEATH_TO_LOOT),
      customDescription: descTextarea ? descTextarea.value.trim() : "",
      isClosed,
      isLocked,
      closedImg,
      openedImg,
      emptyImg,
      lockedImg,
      openingSound,
      closingSound,
      lockedSound,
      buyPriceModifier,
      sellPriceModifier,
      infiniteFunds,
      canIdentify
    };

    // Determinar imagen activa del contenedor según estado (vacío > bloqueado > abierto > cerrado)
    let activeImg = newImg;
    if (isContainer) {
      preloadContainerTextures(finalSettings);
      const resolvedImg = resolveContainerTexture(finalSettings, sourceActor, isClosed ? "close" : "open");
      if (resolvedImg) activeImg = resolvedImg;
    }

    const actorUpdates = {
      flags: {
        [MODULE_ID]: {
          lootSettings: finalSettings,
          [FLAGS.IS_LOOTABLE]: true
        }
      }
    };
    if (newName) actorUpdates.name = newName;
    if (activeImg) actorUpdates.img = activeImg;

    // Sincronizar compatibilidad con PF2e lootSheetType ("Merchant" vs "Loot") si existe
    if (sourceActor?.system?.lootSheetType !== undefined) {
      actorUpdates["system.lootSheetType"] = chosenLootType === "merchant" ? "Merchant" : "Loot";
    }

    if (sourceActor) {
      await sourceActor.update(actorUpdates);
    }

    if (tokenDoc) {
      const tokenUpdates = {
        flags: {
          [MODULE_ID]: {
            lootSettings: finalSettings,
            [FLAGS.IS_LOOTABLE]: true
          }
        }
      };
      if (newName) tokenUpdates.name = newName;
      if (activeImg) tokenUpdates["texture.src"] = activeImg;
      if (isContainer) tokenUpdates.locked = isLocked;
      await tokenDoc.update(tokenUpdates, { animate: false, wowLooterSync: true });
    }

    ui.notifications.info(game.i18n.localize("WOW_LOOTER.Settings.SaveChanges") + ": OK");

    // Sincronizar por socket
    socketService.emit(SOCKET_EVENTS.MANUAL_LOOT_UPDATED, {
      targetActorId: sourceActor?.id,
      targetTokenId: tokenDoc?.id
    });
    if (chosenLootType === "merchant") {
      socketService.emit(SOCKET_EVENTS.MERCHANT_UPDATED, {
        merchantActorId: sourceActor?.id,
        targetTokenId: tokenDoc?.id
      });
    }

    if (this.parentApp && this.parentApp.rendered) {
      const isParentMerchant = this.parentApp.id === "wow-looter-merchant";
      const shouldBeMerchant = chosenLootType === "merchant";

      if (isParentMerchant !== shouldBeMerchant) {
        const reopenOpts = {
          targetToken: this.parentApp.targetToken,
          lootingToken: this.parentApp.lootingToken,
          targetActor: this.parentApp.targetActor,
          lootingActor: this.parentApp.lootingActor
        };
        await this.parentApp.close({ animate: false });
        if (shouldBeMerchant) {
          const { MerchantApp } = await import("./merchant-app.js");
          new MerchantApp(reopenOpts).render(true);
        } else {
          const { ManualLootApp } = await import("./manual-loot-app.js");
          new ManualLootApp(reopenOpts).render(true);
        }
      } else {
        this.parentApp.render(false);
      }
    }

    this.close({ animate: false });
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

