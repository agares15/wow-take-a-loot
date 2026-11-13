# Wow's Take a Loot (PF2e & D&D 5e)

Gestor integral de botín, cofres y mercaderes para **Foundry Virtual Tabletop** (compatible con **Foundry v12 – v14**), diseñado para **Pathfinder 2e (`pf2e`)** y **D&D 5e (`dnd5e`)** en un único módulo unificado.

Inspirado en el sistema de botín grupal y comercio de *World of Warcraft*, incluye distribución en tiempo real por sockets, resolución de disputas con `d100`, loot manual por proximidad, contenedores interactivos, mercaderes completos con identificación de objetos y monedas personalizadas.

---

## 📋 Requisitos y Compatibilidad

- **Foundry VTT**: v12 (mínimo) — v14 (verificado)
- **Sistemas soportados**:
  - **D&D 5e** (`dnd5e` >= `3.0.0`)
  - **Pathfinder 2e** (`pf2e` >= `5.0.0`)
- **Idiomas incluidos**: Español (`es`) e Inglés (`en`)

---

## 🌟 Guía de Funcionalidades

### 1. Distribución de Botín de Combate (GM Panel & Ventana de Jugadores)

Al finalizar un combate (`deleteCombat`), el módulo detecta automáticamente a los combatientes enemigos y abre el **Looter - GM Panel** para el Director de Juego:

- **Enemigos y duplicados**: Cada token derrotado aparece como una instancia independiente en el contador de enemigos (incluso si hay varios tokens duplicados del mismo actor), permitiéndote incluir o excluir cada cuerpo individualmente.
- **Jugadores elegibles**: Selecciona qué personajes jugadores participarán en el reparto.
- **Reserva de botín (*Loot Pool*)**:
  - Agrupa automáticamente los objetos y monedas de los enemigos seleccionados.
  - Permite arrastrar (**Drag & Drop**) nuevos **Actores**, **Ítems** individuales o **Tablas de Tiradas (*Rollable Tables*)** directamente al panel sin generar tarjetas de tirada en el chat.
  - Permite ajustar manualmente el total de monedas antes de enviar.
- **Selección sincronizada en tiempo real**:
  - Al pulsar **"Enviar a los Jugadores"**, todos los participantes ven la misma ventana sincronizada mediante sockets.
  - Cada jugador selecciona los ítems que desea (mostrando su avatar sobre el objeto). Si dos o más jugadores eligen el mismo objeto, se marca visualmente como **en disputa**.
  - Cada jugador decide si **repartir las monedas equitativamente** o **solicitar una cantidad específica**.
- **Resolución de disputas (`d100`)**:
  - **Modo automático** (por defecto): Al finalizar, el sistema tira `d100` por cada participante en disputa, anuncia el resultado en el chat y entrega el ítem al ganador.
  - **Modo manual** (configurable en ajustes): Publica una tarjeta interactiva en el chat donde cada jugador implicado (o el GM) tira su `d100` manualmente, más un botón exclusivo para el GM para tirar por todos a la vez; solo cuando todos han tirado se habilita la distribución del ítem.

---

### 2. Loot Manual, Contenedores y Token HUD

Desde el **Token HUD** de cualquier token (botón con ícono de saco de monedas), el GM puede configurar el comportamiento individual del actor/token mediante **Loot Settings**:

- **Looteable**: Permite que los jugadores abran el inventario de ese cuerpo o cofre haciendo doble clic sobre el token en la escena (dentro del rango de proximidad configurado).
- **Requerir muerte para lootear**: Configurable tanto a nivel global como por instancia de actor; cuando está activo, los jugadores solo pueden lootear NPCs derrotados (el GM siempre puede inspeccionarlos).
- **Detección automática de muerte**: Opcionalmente, marca automáticamente a los NPCs como looteables en cuanto mueren.
- **Contenedores interactivos**: Permite asignar texturas de **cerrado** y **abierto** para cofres, cajas o cadáveres, cambiando su apariencia en escena al abrirlos o vaciarlos.
- **Opciones en la ventana manual**: Recoger ítems individuales, *"Recoger Todo"*, *"Tomar todo el dinero"* o *"Repartir dinero con el grupo"*.

---

### 3. Sistema de Mercaderes (*Merchant*)

Convierte cualquier token o actor en un **Mercader** desde sus *Loot Settings*:

- **Pestañas disponibles**:
  - **Comprar (*Buy*)**: Catálogo con búsqueda, filtro por categoría, ordenamiento, multiplicador de precio de compra, control de stock (`+` / `-` y entrada manual), visibilidad por ítem (ocultar/mostrar objetos para jugadores) y arrastre de ítems o *Rollable Tables*.
  - **Vender (*Sell*)**: Los jugadores venden objetos de su inventario aplicando el multiplicador de venta del mercader.
  - **Recompra (*Buyback*)**: Permite recuperar objetos vendidos recientemente durante la sesión.
  - **Identificar (*Identify*)**: Los jugadores envían solicitudes de identificación de objetos no identificados. El botón cambia a estado **Pendiente** con un ícono animado mientras el GM recibe una ventana de aviso con la vista previa (sin identificar e identificada como referencia) para fijar el precio manualmente y **Aprobar** o **Rechazar**.
- **Descripción personalizada**: El GM puede editar la descripción del mercader; los jugadores solo verán la descripción cuando el GM haya guardado una personalizada.
- **Tarjetas en el chat**: Registra compras, ventas, recompras e identificaciones con el precio pagado.

---

### 4. Creación Rápida de Botín en Escena

- El GM puede arrastrar cualquier **Ítem** desde la barra lateral o compendios directamente sobre el lienzo de la escena para crear automáticamente un token contenedor en esa posición con el objeto dentro.

---

### 5. Monedas Personalizadas y Formato de Descripciones

- **Monedas Personalizadas (*Custom Currencies*)**: Desde los ajustes del módulo, el GM puede crear divisas personalizadas con nombre, abreviatura, valor equivalente en cobre e ícono propio, integrándose con el reparto de botín y los mercaderes.
- **Descripciones Enriquecidas**: Todas las ventanas de botín y mercaderes procesan las descripciones con `TextEditor.enrichHTML`, conservando **negritas**, *cursivas*, código `inline`, enlaces, tiradas e íconos/glifos nativos de PF2e y D&D 5e.

---

## ⚙️ Configuración del Módulo

En **Configuración del Juego → Ajustes del Módulo → Wow's Take a Loot**:

| Ajuste | Descripción | Valor por defecto |
| :--- | :--- | :--- |
| **Auto Open on Combat End** | Abre automáticamente el GM Panel al finalizar un combate con enemigos. | `Activado` |
| **Auto Lootable on Death** | Marca automáticamente a los NPCs como looteables al morir. | `Desactivado` |
| **Proximity Distance** | Distancia máxima (en casillas de cuadrícula) para que los jugadores abran cuerpos o mercaderes. | `1.5` |
| **Announce Rolls in Chat** | Publica en el chat los resultados de distribución, tiradas y transacciones. | `Activado` |
| **Automatic Contested Rolls** | Si está activo, las disputas `d100` se tiran automáticamente; si no, se resuelven manualmente en el chat. | `Activado` |
| **Require Death to Loot** | Exige que los NPCs estén muertos para que los jugadores puedan lootearlos (configurable por instancia). | `Activado` |
| **Custom Currencies** *(Menú)* | Administrador para crear, editar o eliminar monedas personalizadas. | — |
| **Report Bug** *(Menú)* | Abre un formulario para reportar errores directamente por correo. | — |

---

## 🧩 API Pública (Macros)

El módulo expone una API en `game.modules.get("wow-take-a-loot").api`:

```js
const wowLooter = game.modules.get("wow-take-a-loot").api;

// Abrir el GM Panel con una lista opcional de actores/tokens enemigos
wowLooter.openGmLootApp(enemies);

// Abrir la ventana de Loot Manual para un token objetivo
wowLooter.openManualLoot(targetToken);

// Abrir la ventana de Mercader
wowLooter.openMerchantApp({ targetToken, lootingToken });

// Abrir el gestor de Monedas Personalizadas
wowLooter.openCustomCurrenciesApp();
```

---

## 📦 Estructura del Módulo

```text
wow-take-a-loot/
├── module.json                          # Manifiesto y compatibilidad (v12–v14)
├── README.md                            # Documentación del módulo
├── languages/
│   ├── en.json                          # Traducción al inglés
│   └── es.json                          # Traducción al español
├── styles/
│   └── wow-looter.css                   # Estilos de ventanas, HUD y tarjetas de chat
├── templates/
│   ├── custom-currencies.hbs            # Plantilla de monedas personalizadas
│   ├── gm-loot.hbs                      # Plantilla del GM Panel
│   ├── loot-settings.hbs                # Plantilla de ajustes por instancia/token
│   ├── manual-loot.hbs                  # Plantilla de loot manual
│   ├── merchant.hbs                     # Plantilla del mercader
│   ├── player-loot.hbs                  # Plantilla de selección de jugadores
│   └── report-bug.hbs                   # Plantilla de reporte de errores
└── scripts/
    ├── constants.js                     # IDs, flags, ajustes y eventos de socket
    ├── module.js                        # Registro de ajustes, hooks y API pública
    ├── adapters/
    │   ├── base-adapter.js              # Interfaz base para sistemas
    │   ├── dnd5e-adapter.js             # Adaptador para D&D 5e
    │   ├── pf2e-adapter.js              # Adaptador para Pathfinder 2e
    │   └── index.js                     # Selector automático de adaptador
    ├── apps/
    │   ├── custom-currencies-app.js     # Gestor de monedas personalizadas
    │   ├── gm-loot-app.js               # Ventana principal de loot del GM
    │   ├── loot-settings-app.js         # Ajustes por token/actor (looteable/mercader/cofre)
    │   ├── manual-loot-app.js           # Ventana de loot manual por proximidad
    │   ├── merchant-app.js              # Ventana de comercio (comprar/vender/identificar)
    │   ├── player-loot-app.js           # Ventana sincronizada de botín para jugadores
    │   └── report-bug-app.js            # Formulario de reporte de errores
    ├── features/
    │   ├── canvas-drop.js               # Soltar ítems en la escena para crear cofres
    │   ├── combat-listener.js           # Detección de fin de combate
    │   ├── death-listener.js            # Detección de muerte de NPCs
    │   └── token-hud.js                 # Botón en Token HUD, doble clic y listeners socket
    ├── services/
    │   ├── chat-announcer.js            # Tarjetas de chat de loot y disputas
    │   ├── currency-service.js          # Conversión y transferencia de divisas
    │   ├── loot-session.js              # Ciclo de vida de sesión de botín y tiradas d100
    │   ├── merchant-service.js          # Transacciones de mercader e identificación
    │   └── socket-service.js            # Comunicación cliente-servidor por sockets
    └── utils/
        ├── container-helpers.js         # Gestión de texturas abierto/cerrado en contenedores
        └── dom-helpers.js               # Protección de dropdowns y enriquecimiento HTML
```
