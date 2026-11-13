import { MODULE_ID, SOCKET_EVENTS } from "../constants.js";

/**
 * Gestor de comunicación en tiempo real de alto rendimiento para WoW Looter.
 * Utiliza WebSockets nativos de Foundry (game.socket) para latencia ultra baja (memoria pura, 0 disco),
 * con respaldo no intrusivo mediante banderas de usuario (User Flags) sin generar mensajes de chat ni lag.
 */
class SocketService {
  constructor() {
    this.handlers = new Map();
    this.processedPacketIds = new Set();
  }

  /**
   * Inicializa la escucha de sockets nativos y el listener de sincronización ligero.
   */
  init() {
    // 1. Canal primario: WebSockets nativos de Foundry (ultra rápido, memoria pura, 0 disco)
    if (game.socket) {
      game.socket.on(`module.${MODULE_ID}`, (packet) => {
        this._onRawPacket(packet, "socket");
      });
      console.log(`[${MODULE_ID}] Canal de socket nativo activo en 'module.${MODULE_ID}'.`);
    }

    // 2. Canal de sincronización ligero mediante User Flags (0 chat, 0 disco NeDB/LevelDB, 0 lag)
    Hooks.on("updateUser", (user, changes, options, userId) => {
      const packet = changes.flags?.[MODULE_ID]?.packet;
      if (packet && userId !== game.user.id) {
        this._onRawPacket(packet, "user-sync");
      }
    });
  }

  /**
   * Registra un manejador para un tipo específico de evento.
   * @param {string} event
   * @param {Function} handler
   */
  register(event, handler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event).push(handler);
  }

  /**
   * Emite un evento a través de la red con mínima sobrecarga.
   * @param {string} event
   * @param {object} data
   */
  async emit(event, data = {}) {
    const packetId = `${game.user.id}-${Date.now()}-${foundry.utils.randomID(6)}`;
    const packet = {
      packetId,
      event,
      data,
      senderId: game.user.id
    };

    // Marcar localmente como procesado para deduplicar
    this.processedPacketIds.add(packetId);

    // 1. Enviar por WebSocket nativo (sub-milisegundo en memoria)
    if (game.socket) {
      try {
        game.socket.emit(`module.${MODULE_ID}`, packet);
      } catch (err) {
        // Silencioso
      }
    }

    // 2. Sincronizar por bandera de usuario como respaldo ligero (sin bloquear)
    game.user.setFlag(MODULE_ID, "packet", packet).catch(() => {});

    // 3. Despachar localmente si corresponde al GM o a eventos que deben reflejarse de inmediato
    const gmOnlyMutations = [
      SOCKET_EVENTS.MANUAL_LOOT_EXECUTE,
      SOCKET_EVENTS.CLAIM_ITEM,
      SOCKET_EVENTS.TOGGLE_READY,
      SOCKET_EVENTS.UPDATE_CURRENCY_CHOICE
    ];

    if (!gmOnlyMutations.includes(event) || game.user.isGM) {
      this._dispatch(event, data, game.user.id);
    }
  }

  /**
   * Procesa y deduplica paquetes entrantes a máxima velocidad.
   * @private
   */
  _onRawPacket(packet, channel = "socket") {
    if (!packet || !packet.event || !packet.packetId) return;

    if (this.processedPacketIds.has(packet.packetId)) {
      return; // Deduplicado instantáneo
    }

    this.processedPacketIds.add(packet.packetId);
    if (this.processedPacketIds.size > 100) {
      const first = this.processedPacketIds.values().next().value;
      this.processedPacketIds.delete(first);
    }

    this._dispatch(packet.event, packet.data, packet.senderId);
  }

  /**
   * Dispara los handlers suscritos al evento con bucle directo indexado.
   * @private
   */
  _dispatch(event, data, senderId) {
    const list = this.handlers.get(event);
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      try {
        list[i](data, senderId);
      } catch (err) {
        console.error(`[${MODULE_ID}] Error en handler '${event}':`, err);
      }
    }
  }
}

export const socketService = new SocketService();
