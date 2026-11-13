/**
 * Constantes utilizadas a lo largo del módulo Wow's Take a Loot.
 */
export const MODULE_ID = "wow-take-a-loot";

export const SOCKET_EVENTS = {
  // GM emite el inicio de sesión a jugadores
  START_SESSION: "startSession",
  // Jugador selecciona / deselecciona item
  CLAIM_ITEM: "claimItem",
  // Jugador cambia su preferencia de moneda
  UPDATE_CURRENCY_CHOICE: "updateCurrencyChoice",
  // Jugador marca "Listo"
  TOGGLE_READY: "toggleReady",
  // Sincronización del estado completo desde el GM
  SYNC_STATE: "syncState",
  // GM fuerza finalización y reparto
  FINALIZE_SESSION: "finalizeSession",
  // Cierre de la sesión de loot
  CLOSE_SESSION: "closeSession",
  // Petición de loot manual de un token por parte de un jugador
  MANUAL_LOOT_REQUEST: "manualLootRequest",
  // Ejecución de reparto manual por el GM a petición del jugador
  MANUAL_LOOT_EXECUTE: "manualLootExecute",
  // Notificación de que el loot manual fue actualizado tras una transacción
  MANUAL_LOOT_UPDATED: "manualLootUpdated",
  // Transacción de comerciante solicitada por un jugador al GM
  MERCHANT_TRANSACTION_REQUEST: "merchantTransactionRequest",
  // Notificación de actualización del inventario o fondos del comerciante
  MERCHANT_UPDATED: "merchantUpdated",
  // Petición de identificación de un item al GM
  MERCHANT_IDENTIFY_REQUEST: "merchantIdentifyRequest",
  // Resolución (aprobación/rechazo) de identificación por parte del GM
  MERCHANT_IDENTIFY_RESOLVED: "merchantIdentifyResolved",
  // Actualización de estado visual de contenedor (abrir/cerrar/vacío/bloqueado)
  CONTAINER_STATE_CHANGE: "containerStateChange",
  // Tirada manual de disputa d100 desde la tarjeta de chat
  CONTESTED_ROLL_ACTION: "contestedRollAction"
};

export const FLAGS = {
  IS_LOOTABLE: "isLootable",
  LOOT_GENERATED: "lootGenerated",
  ORIGINAL_ACTOR_ID: "originalActorId"
};

export const SETTINGS = {
  AUTO_OPEN_COMBAT: "autoOpenCombat",
  PROXIMITY_DISTANCE: "proximityDistance",
  ANNOUNCE_ROLLS_CHAT: "announceRollsChat",
  DEFAULT_BAG_ICON: "defaultBagIcon",
  AUTO_LOOTABLE_ON_DEATH: "autoLootableOnDeath",
  AUTO_CONTESTED_ROLL: "autoContestedRoll",
  REQUIRE_DEATH_TO_LOOT: "requireDeathToLoot",
  CUSTOM_CURRENCIES: "customCurrencies"
};

