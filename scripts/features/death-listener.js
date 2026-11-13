import { MODULE_ID, FLAGS, SOCKET_EVENTS, SETTINGS } from "../constants.js";
import { getSystemAdapter } from "../adapters/index.js";
import { socketService } from "../services/socket-service.js";

/**
 * Escucha la muerte o derrota de NPCs para marcarlos automáticamente como looteables
 * si el ajuste de configuración está activado.
 */
export function registerDeathListener() {
  // 1. Cuando se actualizan los puntos de vida de un actor (HP <= 0)
  Hooks.on("updateActor", async (actor, changes, options, userId) => {
    if (!game.user.isGM) return;
    const activeGM = game.users.activeGM || game.users.find((u) => u.isGM && u.active);
    if (activeGM && activeGM.id !== game.user.id) return;

    const enabled = game.settings.get(MODULE_ID, SETTINGS.AUTO_LOOTABLE_ON_DEATH);
    if (!enabled) return;

    const adapter = getSystemAdapter();
    if (adapter.isPlayerCharacter(actor) || actor.hasPlayerOwner) return;

    const tokenDoc = actor.parent instanceof TokenDocument ? actor.parent : null;
    const alreadyLootable = tokenDoc
      ? Boolean(tokenDoc.getFlag(MODULE_ID, FLAGS.IS_LOOTABLE))
      : Boolean(actor.getFlag(MODULE_ID, FLAGS.IS_LOOTABLE));
    if (alreadyLootable) return;

    // Verificar si el HP cayó a 0
    let hpDied = false;
    const hpValue = changes.system?.attributes?.hp?.value;
    if (hpValue !== undefined && Number(hpValue) <= 0) {
      hpDied = true;
    }

    if (hpDied) {
      console.log(`[wow-looter] NPC ${actor.name} llegó a 0 HP. Marcando como looteable automáticamente.`);
      await _makeActorAndTokensLootable(actor, tokenDoc);
    }
  });

  // 2. Cuando un combatiente es marcado como derrotado en combate
  Hooks.on("updateCombatant", async (combatant, changes, options, userId) => {
    if (!game.user.isGM) return;
    const activeGM = game.users.activeGM || game.users.find((u) => u.isGM && u.active);
    if (activeGM && activeGM.id !== game.user.id) return;

    const enabled = game.settings.get(MODULE_ID, SETTINGS.AUTO_LOOTABLE_ON_DEATH);
    if (!enabled) return;

    if (changes.defeated === true) {
      const actor = combatant.actor;
      if (!actor) return;
      const adapter = getSystemAdapter();
      if (adapter.isPlayerCharacter(actor) || actor.hasPlayerOwner) return;

      console.log(`[wow-looter] Combatiente ${actor.name} marcado como derrotado. Marcando como looteable automáticamente.`);
      await _makeActorAndTokensLootable(actor, combatant.token);
    }
  });

  // 3. Cuando se aplica un efecto de estado de muerte o derrota
  Hooks.on("createActiveEffect", async (effect, options, userId) => {
    if (!game.user.isGM) return;
    const activeGM = game.users.activeGM || game.users.find((u) => u.isGM && u.active);
    if (activeGM && activeGM.id !== game.user.id) return;

    const enabled = game.settings.get(MODULE_ID, SETTINGS.AUTO_LOOTABLE_ON_DEATH);
    if (!enabled) return;

    const isDeadStatus = effect.statuses?.has?.("dead")
      || effect.statuses?.has?.("defeated")
      || effect.flags?.core?.statusId === "dead"
      || effect.flags?.core?.statusId === "defeated";
    if (isDeadStatus) {
      const actor = effect.parent;
      if (!actor || !(actor instanceof Actor)) return;
      const adapter = getSystemAdapter();
      if (adapter.isPlayerCharacter(actor) || actor.hasPlayerOwner) return;

      console.log(`[wow-looter] NPC ${actor.name} recibió estado de muerte/derrota. Marcando como looteable automáticamente.`);
      const tokenDoc = actor.parent instanceof TokenDocument ? actor.parent : null;
      await _makeActorAndTokensLootable(actor, tokenDoc);
    }
  });
}

/**
 * Marca autoritativamente un actor y sus tokens asociados como looteables.
 */
async function _makeActorAndTokensLootable(actor, specificTokenDoc = null) {
  const tokens = specificTokenDoc
    ? [specificTokenDoc]
    : (canvas.tokens?.placeables.filter((t) => t.actor?.id === actor.id).map((t) => t.document) || []);

  for (const tokenDoc of tokens) {
    if (!tokenDoc.getFlag(MODULE_ID, FLAGS.IS_LOOTABLE)) {
      await tokenDoc.setFlag(MODULE_ID, FLAGS.IS_LOOTABLE, true);
    }
  }

  if ((actor.isToken || tokens.length === 0) && !actor.getFlag(MODULE_ID, FLAGS.IS_LOOTABLE)) {
    await actor.setFlag(MODULE_ID, FLAGS.IS_LOOTABLE, true);
  }

  // Añadir marcador de bolsa sobre el token
  const bagIcon = "icons/svg/item-bag.svg";
  const hasMarker = actor.effects.some((e) => e.flags?.[MODULE_ID]?.isLootMarker);
  if (!hasMarker) {
    await actor.createEmbeddedDocuments("ActiveEffect", [{
      name: "Loot",
      img: bagIcon,
      flags: { [MODULE_ID]: { isLootMarker: true } }
    }]).catch(() => {});
  }

  // Notificar a todos los clientes para refrescar Token HUD y ventanas de botín
  socketService.emit(SOCKET_EVENTS.MANUAL_LOOT_UPDATED, {
    targetActorId: actor.id,
    targetTokenId: specificTokenDoc?.id || tokens[0]?.id
  });
}

