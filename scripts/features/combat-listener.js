import { GmLootApp } from "../apps/gm-loot-app.js";
import { getSystemAdapter } from "../adapters/index.js";
import { MODULE_ID, SETTINGS } from "../constants.js";

/**
 * Escucha el fin de los combates para abrir la ventana de Loot del GM.
 */
export function registerCombatListener() {
  Hooks.on("deleteCombat", async (combat) => {
    console.log("[wow-looter] Hook deleteCombat disparado.", combat);

    // Solo un GM activo debe ejecutar esta lógica
    if (!game.user.isGM) return;

    const activeGM = game.users.activeGM || game.users.find((u) => u.isGM && u.active);
    if (activeGM && activeGM.id !== game.user.id) {
      console.log("[wow-looter] Otro GM activo se encargará del combate:", activeGM.name);
      return;
    }

    // Verificar setting de apertura automática
    const autoOpen = game.settings.get(MODULE_ID, SETTINGS.AUTO_OPEN_COMBAT);
    if (!autoOpen) {
      console.log("[wow-looter] Apertura automática desactivada en configuración.");
      return;
    }

    // Recoger solo los enemigos con denominación "opposition"
    const adapter = getSystemAdapter();
    const defeatedEnemies = [];

    if (combat.combatants && combat.combatants.size > 0) {
      for (const combatant of combat.combatants) {
        const actor = combatant.actor;
        if (!actor) continue;

        // Comprobar estrictamente si tiene la denominación "opposition"
        const isOpposition = adapter.isOpposition(combatant) || adapter.isOpposition(actor);
        if (isOpposition) {
          defeatedEnemies.push(combatant.token || actor);
        }
      }
    }

    console.log(`[wow-looter] Enemigos con denominación 'opposition' encontrados: ${defeatedEnemies.length}`);

    // Si hubo enemigos en la batalla, abrir la ventana del GM incluso si aún no tienen items
    // (para que el GM pueda ver el panel, añadir tablas, items o confirmar).
    if (defeatedEnemies.length > 0) {
      new GmLootApp({ initialEnemies: defeatedEnemies }).render(true);
    } else {
      console.log("[wow-looter] No se encontraron combatientes enemigos en este encuentro.");
    }
  });
}
