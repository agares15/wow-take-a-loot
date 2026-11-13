import { Dnd5eAdapter } from "./dnd5e-adapter.js";
import { PF2eAdapter } from "./pf2e-adapter.js";

let currentAdapter = null;

/**
 * Inicializa y retorna el adaptador apropiado para el sistema actual.
 * @returns {BaseSystemAdapter}
 */
export function getSystemAdapter() {
  if (currentAdapter) return currentAdapter;

  const systemId = game.system.id;
  if (systemId === "dnd5e") {
    currentAdapter = new Dnd5eAdapter();
  } else if (systemId === "pf2e") {
    currentAdapter = new PF2eAdapter();
  } else {
    // Si se corre en un sistema no soportado formalmente, usamos D&D5e como fallback razonable
    console.warn(`[wow-looter] Sistema '${systemId}' no reconocido formalmente. Usando adaptador D&D 5e por defecto.`);
    currentAdapter = new Dnd5eAdapter();
  }

  return currentAdapter;
}

