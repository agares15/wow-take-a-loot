import { getSystemAdapter } from "../adapters/index.js";

/**
 * Permite al GM arrastrar un Item al Canvas para crear instantáneamente un contenedor de Loot en esa posición.
 */
export function registerCanvasDropHandler() {
  Hooks.on("dropCanvasData", async (canvas, data) => {
    // Solo permitir al GM
    if (!game.user.isGM) return true;

    // Solo reaccionar cuando se arrastra un Item
    if (data.type !== "Item" || !data.uuid) return true;

    try {
      const item = await fromUuid(data.uuid);
      if (!item) return true;

      // Obtener coordenadas de suelta
      let coords = { x: data.x, y: data.y };

      // Ajustar a la rejilla si canvas.grid está disponible
      if (canvas.grid) {
        coords = canvas.grid.getSnappedPosition
          ? canvas.grid.getSnappedPosition(data.x, data.y)
          : { x: data.x, y: data.y };
      }

      const adapter = getSystemAdapter();
      const lootName = game.i18n.format("WOW_LOOTER.SceneDrop.LootName", { itemName: item.name });

      ui.notifications.info(game.i18n.format("WOW_LOOTER.SceneDrop.CreatingLoot", { name: item.name }));

      await adapter.createLootOnScene(lootName, coords, [item]);

      // Evitar que otros módulos o el core intenten manejar el drop de forma duplicada
      return false;
    } catch (err) {
      console.error("[wow-looter] Error creando contenedor de loot en la escena:", err);
      return true;
    }
  });
}

