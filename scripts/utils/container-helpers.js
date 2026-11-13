import { MODULE_ID } from "../constants.js";
import { getSystemAdapter } from "../adapters/index.js";

/**
 * Precarga una textura en la caché de PIXI/Foundry para evitar parpadeos al cambiar de imagen.
 * @param {string} src
 */
export async function preloadTextureSrc(src) {
  if (!src) return;
  const loader = foundry.canvas?.loadTexture || globalThis.loadTexture;
  if (typeof loader === "function") {
    try {
      await loader(src);
    } catch {
      // Ignorar errores de precarga
    }
  }
}

/**
 * Precarga todas las imágenes configuradas para un contenedor.
 * @param {object} lootSettings
 */
export function preloadContainerTextures(lootSettings) {
  if (!lootSettings || lootSettings.lootType !== "container") return;
  const srcs = [
    lootSettings.closedImg,
    lootSettings.openedImg,
    lootSettings.emptyImg,
    lootSettings.lockedImg
  ].filter(Boolean);
  for (const src of srcs) {
    preloadTextureSrc(src);
  }
}

/**
 * Determina la textura correspondiente al estado actual de un contenedor:
 * emptyImg (si vacío) > lockedImg (si cerrado con llave) > openedImg (si abierto) > closedImg (default).
 * @param {object} lootSettings
 * @param {Actor|null} actor
 * @param {"open"|"close"} state
 * @returns {string|null}
 */
export function resolveContainerTexture(lootSettings, actor, state = "close") {
  if (!lootSettings || lootSettings.lootType !== "container") return null;

  let isEmpty = false;
  if (actor) {
    const adapter = getSystemAdapter();
    const remainingItems = adapter.getLootableItems(actor);
    const remainingCurrencies = adapter.getActorCurrencies(actor);
    const hasCoins = Object.values(remainingCurrencies).some((v) => Number(v) > 0);
    isEmpty = remainingItems.length === 0 && !hasCoins;
  }

  if (isEmpty && lootSettings.emptyImg) return lootSettings.emptyImg;
  if (lootSettings.isLocked && lootSettings.lockedImg) return lootSettings.lockedImg;
  if (state === "open" && lootSettings.openedImg) return lootSettings.openedImg;
  if (lootSettings.closedImg) return lootSettings.closedImg;
  return null;
}

/**
 * Aplica la textura calculada al token del contenedor (solo GM tiene permisos de escritura).
 * Precarga la textura antes de aplicarla para que el cambio sea instantáneo y sin desaparición.
 * @param {TokenDocument|null} tokenDoc
 * @param {Actor|null} actor
 * @param {"open"|"close"} state
 */
export async function applyContainerTexture(tokenDoc, actor, state = "close") {
  if (!game.user.isGM || !tokenDoc) return;
  const actorSettings = actor?.getFlag(MODULE_ID, "lootSettings") || {};
  const tokenSettings = tokenDoc.getFlag(MODULE_ID, "lootSettings") || {};
  const lootSettings = {
    ...actorSettings,
    ...tokenSettings,
    isLocked: Boolean(tokenDoc.locked ?? tokenSettings.isLocked ?? actorSettings.isLocked)
  };

  const nextImg = resolveContainerTexture(lootSettings, actor, state);
  if (!nextImg || tokenDoc.texture?.src === nextImg) return;

  await preloadTextureSrc(nextImg);
  await tokenDoc.update({ "texture.src": nextImg }, { animate: false }).catch(() => {});
}
