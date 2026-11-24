/**
 * Evita que los manejadores de ventana o delegación de acciones de ApplicationV2
 * intercepten clics sobre elementos <select> y cierren el desplegable nativo.
 * @param {HTMLElement} html
 */
export function protectDropdowns(html) {
  if (!html) return;
  html.querySelectorAll("select").forEach((select) => {
    if (select.dataset.dropdownProtected === "true") return;
    select.dataset.dropdownProtected = "true";
    select.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    select.addEventListener("mousedown", (ev) => ev.stopPropagation());
    select.addEventListener("click", (ev) => ev.stopPropagation());
  });
}

/**
 * Determina si un documento o datos de ítem corresponden a munición (PF2e y D&D 5e).
 * @param {object|null} itemOrData
 * @returns {boolean}
 */
export function isAmmunitionItem(itemOrData) {
  if (!itemOrData) return false;
  if (itemOrData.isAmmo === true) return true;
  const type = String(itemOrData.type || "").toLowerCase();
  if (type === "ammo") return true;

  const sys = itemOrData.system || {};
  if (type === "consumable") {
    const subType = String(sys.consumableType || sys.type?.value || sys.category || "").toLowerCase();
    if (subType === "ammo" || subType === "ammunition") return true;
  }

  const stackGroup = String(sys.stackGroup || "").toLowerCase();
  if (["arrows", "bolts", "slingbullets", "blowgundarts", "rounds", "ammo"].includes(stackGroup)) {
    return true;
  }

  return false;
}

/**
 * Obtiene la cantidad efectiva en unidades individuales de un ítem.
 * En PF2e, las municiones de compendio o bestiario suelen traer quantity=1 con uses.value=10 o price.per=10.
 * @param {object|null} itemOrData
 * @returns {number}
 */
export function getEffectiveItemQuantity(itemOrData) {
  if (!itemOrData) return 1;
  const sys = itemOrData.system || {};
  const rawQty = Number(itemOrData.quantity ?? sys.quantity ?? 1);

  if (isAmmunitionItem(itemOrData) && !sys._wowNormalizedAmmo) {
    const usesVal = Number(sys.uses?.value ?? 0);
    const usesMax = Number(sys.uses?.max ?? 0);
    if (usesMax > 1 && usesVal > 0) {
      return rawQty > 1 ? rawQty * usesVal : usesVal;
    }
    const pricePer = Number(sys.price?.per ?? 0);
    if (rawQty === 1 && pricePer > 1) {
      return pricePer;
    }
  }

  return Math.max(1, rawQty || 1);
}

/**
 * Normaliza los datos de un ítem de munición para que `system.quantity` represente
 * unidades individuales (ej. 10 flechas = quantity 10, no 1 paquete de 10).
 * @param {object} itemData
 * @param {number} quantity
 * @returns {object}
 */
export function normalizeAmmunitionItemData(itemData, quantity) {
  if (!itemData) return itemData;
  const qty = Math.max(1, Number(quantity) || 1);
  itemData.system = itemData.system || {};
  itemData.system.quantity = qty;
  itemData.system._wowNormalizedAmmo = true;

  if (isAmmunitionItem(itemData)) {
    if (itemData.system.uses && Number(itemData.system.uses.max) > 1) {
      itemData.system.uses.value = 1;
      itemData.system.uses.max = 1;
    }
    if (itemData.system.price && Number(itemData.system.price.per) > 1) {
      itemData.system.price.per = 1;
    }
  }
  return itemData;
}

/**
 * Extrae las etiquetas (traits/tags/propiedades/rareza) de un ítem en PF2e o D&D 5e.
 * @param {object|null} itemOrData
 * @returns {Array<{label: string, cssClass: string}>}
 */
export function extractItemTags(itemOrData) {
  if (!itemOrData) return [];
  if (Array.isArray(itemOrData.tags) && itemOrData.tags.length > 0) {
    return itemOrData.tags;
  }

  const sys = itemOrData.system || itemOrData.systemData?.system || {};
  const tags = [];
  const seen = new Set();

  const addTag = (rawLabel, cssClass = "tag-trait") => {
    if (!rawLabel) return;
    let label = String(rawLabel).trim();
    if (!label) return;
    if (game?.i18n && (label.includes(".") || game.i18n.has?.(label))) {
      label = game.i18n.localize(label);
    }
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    tags.push({ label, cssClass });
  };

  const localizePf2eTrait = (slug) => {
    const cfg = globalThis.CONFIG?.PF2E || {};
    const dicts = [
      cfg.weaponTraits,
      cfg.armorTraits,
      cfg.equipmentTraits,
      cfg.consumableTraits,
      cfg.actionTraits,
      cfg.kingmakerTraits,
      cfg.npcAttackTraits,
      cfg.PreciousMaterials,
      cfg.traitsDescriptions
    ];
    for (const dict of dicts) {
      if (dict && dict[slug]) {
        return game.i18n.localize(dict[slug]);
      }
    }
    return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  };

  // 1. PF2e: traits.rarity y traits.value
  if (sys.traits) {
    const rarity = sys.traits.rarity;
    if (rarity && typeof rarity === "string") {
      const rarityKey = globalThis.CONFIG?.PF2E?.rarityTraits?.[rarity];
      const rarityLabel = rarityKey ? game.i18n.localize(rarityKey) : rarity.replace(/\b\w/g, (c) => c.toUpperCase());
      addTag(rarityLabel, `tag-rarity rarity-${rarity.toLowerCase()}`);
    }

    const traitValues = Array.isArray(sys.traits.value)
      ? sys.traits.value
      : (sys.traits.value instanceof Set ? Array.from(sys.traits.value) : []);
    for (const t of traitValues) {
      addTag(localizePf2eTrait(String(t)), "tag-trait");
    }

    const otherTags = Array.isArray(sys.traits.otherTags) ? sys.traits.otherTags : [];
    for (const t of otherTags) {
      addTag(localizePf2eTrait(String(t)), "tag-trait");
    }
  }

  // 2. D&D 5e: rarity, weapon/armor/consumable type y properties
  if (sys.rarity && typeof sys.rarity === "string" && !sys.traits) {
    const rarityCfg = globalThis.CONFIG?.DND5E?.itemRarity?.[sys.rarity];
    const rarityLabel = rarityCfg
      ? game.i18n.localize(rarityCfg)
      : sys.rarity.replace(/([A-Z])/g, " $1").replace(/\b\w/g, (c) => c.toUpperCase());
    addTag(rarityLabel, `tag-rarity rarity-${sys.rarity.toLowerCase()}`);
  }

  if (sys.type?.value && typeof sys.type.value === "string") {
    const dndCfg = globalThis.CONFIG?.DND5E || {};
    const typeSlug = sys.type.value;
    const typeEntry = dndCfg.weaponTypes?.[typeSlug]
      || dndCfg.equipmentTypes?.[typeSlug]
      || dndCfg.consumableTypes?.[typeSlug]?.label
      || dndCfg.consumableTypes?.[typeSlug]
      || dndCfg.toolTypes?.[typeSlug];
    if (typeEntry && typeof typeEntry === "string") {
      addTag(game.i18n.localize(typeEntry), "tag-type");
    }
  }

  if (sys.properties) {
    const props = Array.isArray(sys.properties)
      ? sys.properties
      : (sys.properties instanceof Set
        ? Array.from(sys.properties)
        : Object.entries(sys.properties).filter(([_, v]) => Boolean(v)).map(([k]) => k));
    const dndCfg = globalThis.CONFIG?.DND5E || {};
    for (const p of props) {
      const propCfg = dndCfg.itemProperties?.[p] || dndCfg.weaponProperties?.[p];
      const propLabel = typeof propCfg === "object" ? propCfg?.label : propCfg;
      addTag(propLabel ? game.i18n.localize(propLabel) : String(p).toUpperCase(), "tag-trait");
    }
  }

  return tags;
}

/**
 * Construye el bloque HTML de etiquetas (tags) para insertar al inicio de la descripción.
 * @param {object|null} itemOrData
 * @returns {string}
 */
export function buildItemTagsHtml(itemOrData) {
  const tags = extractItemTags(itemOrData);
  if (!tags || tags.length === 0) return "";
  const pills = tags
    .map((t) => `<span class="wow-item-tag ${t.cssClass || "tag-trait"}">${foundry.utils.escapeHTML(t.label)}</span>`)
    .join("");
  return `<div class="wow-item-tags">${pills}</div>`;
}

/**
 * Enriquece el HTML de la descripción de un ítem usando el TextEditor de Foundry
 * e inyecta en la parte superior las etiquetas (tags/traits) correspondientes al objeto.
 * @param {string} rawHtml
 * @param {object|null} [relativeTo=null]
 * @returns {Promise<string>}
 */
export async function enrichItemDescription(rawHtml, relativeTo = null) {
  const hasAlreadyInjectedTags = typeof rawHtml === "string" && rawHtml.includes("wow-item-tags");
  const tagsHtml = hasAlreadyInjectedTags ? "" : buildItemTagsHtml(relativeTo);

  let bodyHtml = typeof rawHtml === "string" ? rawHtml : "";
  if (bodyHtml) {
    const editor = foundry.applications?.ux?.TextEditor?.implementation || globalThis.TextEditor;
    if (editor?.enrichHTML) {
      try {
        bodyHtml = await editor.enrichHTML(bodyHtml, {
          async: true,
          relativeTo: relativeTo instanceof foundry.abstract?.Document ? relativeTo : null,
          secrets: Boolean(game.user?.isGM)
        });
      } catch {
        // conservar bodyHtml sin enriquecer si falla
      }
    }
  }

  return `${tagsHtml}${bodyHtml}`;
}

/**
 * Extrae el payload de drag & drop de forma compatible con Foundry v12-v14 y hojas de PF2e/D&D5e.
 * @param {DragEvent} ev
 * @returns {object|null}
 */
export function parseDropData(ev) {
  try {
    const editor = foundry.applications?.ux?.TextEditor?.implementation || globalThis.TextEditor;
    if (editor?.getDragEventData) {
      const parsed = editor.getDragEventData(ev);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
        return parsed;
      }
    }
  } catch {
    // Fallback abajo
  }
  try {
    const raw = ev.dataTransfer?.getData("text/plain");
    if (raw) return JSON.parse(raw);
  } catch {
    // Ignorar JSON inválido
  }
  return null;
}

/**
 * Resuelve un documento Item arrastrado desde Compendio, Directorio o Hoja de Personaje.
 * @param {object|null} dragData
 * @returns {Promise<Item|null>}
 */
export async function resolveDroppedItem(dragData) {
  if (!dragData || dragData.type !== "Item") return null;

  if (dragData.uuid) {
    const doc = await fromUuid(dragData.uuid).catch(() => null);
    if (doc) return doc;
  }

  const itemId = dragData.itemId || dragData.data?._id;
  if (dragData.tokenId && itemId) {
    const scene = dragData.sceneId ? game.scenes?.get(dragData.sceneId) : canvas?.scene;
    const tokenDoc = scene?.tokens?.get(dragData.tokenId);
    const tokenItem = tokenDoc?.actor?.items?.get(itemId);
    if (tokenItem) return tokenItem;
  }

  if (dragData.actorId && itemId) {
    const actor = game.actors?.get(dragData.actorId);
    const actorItem = actor?.items?.get(itemId);
    if (actorItem) return actorItem;
  }

  if (dragData.data && typeof dragData.data === "object") {
    const parentActor = dragData.actorId ? game.actors?.get(dragData.actorId) : null;
    try {
      return new Item.implementation(dragData.data, { parent: parentActor || undefined });
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Conecta los botones + y - de cualquier `.qty-stepper` dentro del contenedor dado.
 * Soporta Shift+Click (+5/-5) y Alt+Click (+10/-10).
 * @param {HTMLElement} rootEl
 * @param {(input: HTMLInputElement) => void} [onChange]
 */
export function bindQuantitySteppers(rootEl, onChange = null) {
  if (!rootEl) return;
  rootEl.querySelectorAll(".qty-stepper").forEach((stepper) => {
    if (stepper.dataset.stepperBound === "true") return;
    stepper.dataset.stepperBound = "true";

    const input = stepper.querySelector("input[type='number']");
    if (!input) return;

    input.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    input.addEventListener("mousedown", (ev) => ev.stopPropagation());
    input.addEventListener("click", (ev) => ev.stopPropagation());

    stepper.querySelectorAll(".btn-qty-step").forEach((btn) => {
      btn.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      btn.addEventListener("mousedown", (ev) => ev.stopPropagation());
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (input.disabled) return;
        const baseStep = Number(btn.dataset.qtyStep || 0);
        const multiplier = ev.altKey ? 10 : (ev.shiftKey ? 5 : 1);
        const step = baseStep * multiplier;
        const min = input.min !== "" ? Number(input.min) : 1;
        const max = input.max !== "" ? Number(input.max) : Infinity;
        const current = Number(input.value) || min;
        const next = Math.min(max, Math.max(min, current + step));
        if (next !== current) {
          input.value = String(next);
          input.dispatchEvent(new Event("change", { bubbles: true }));
          if (typeof onChange === "function") onChange(input);
        }
      });
    });
  });
}

/**
 * Muestra una ventana emergente para elegir la cantidad de munición a agregar (por defecto x10).
 * @param {string} itemName
 * @param {number} [defaultQty=10]
 * @returns {Promise<number|null>}
 */
export async function promptAmmunitionQuantity(itemName, defaultQty = 10) {
  const title = `${game.i18n.localize("WOW_LOOTER.Dialog.AmmoQuantityTitle")}: ${itemName}`;
  const label = game.i18n.localize("WOW_LOOTER.Dialog.AmmoQuantityLabel");
  const confirmLabel = game.i18n.localize("WOW_LOOTER.Dialog.ConfirmAdd");

  const content = `
    <div class="wow-qty-dialog-body" style="display:flex; flex-direction:column; gap:10px; padding:8px 0;">
      <label style="font-weight:600; color:#e2e8f0; font-size:0.9rem;">${label}</label>
      <div style="display:flex; align-items:center; justify-content:center; gap:8px;">
        <button type="button" class="btn-dialog-step" data-step="-1" style="width:28px; height:28px; cursor:pointer;">-</button>
        <input type="number" id="wow-ammo-qty-input" value="${defaultQty}" min="1" max="9999" style="width:70px; height:28px; text-align:center; font-weight:700;" />
        <button type="button" class="btn-dialog-step" data-step="1" style="width:28px; height:28px; cursor:pointer;">+</button>
      </div>
    </div>
  `;

  const wireSteppers = (root) => {
    const input = root?.querySelector("#wow-ammo-qty-input");
    if (!input) return;
    root.querySelectorAll(".btn-dialog-step").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        const delta = Number(btn.dataset.step || 0);
        const cur = Math.max(1, Number(input.value) || defaultQty);
        input.value = String(Math.max(1, cur + delta));
      });
    });
  };

  if (foundry.applications?.api?.DialogV2) {
    return foundry.applications.api.DialogV2.prompt({
      window: { title },
      content,
      render: (ev, dialog) => wireSteppers(dialog.element),
      ok: {
        label: confirmLabel,
        icon: "fas fa-check",
        callback: (ev, btn, dialog) => {
          const val = Number(dialog.element.querySelector("#wow-ammo-qty-input")?.value || defaultQty);
          return Math.max(1, Math.floor(val));
        }
      },
      rejectClose: false
    });
  }

  return new Promise((resolve) => {
    new Dialog({
      title,
      content,
      render: (html) => wireSteppers(html instanceof HTMLElement ? html : html[0]),
      buttons: {
        ok: {
          icon: '<i class="fas fa-check"></i>',
          label: confirmLabel,
          callback: (html) => {
            const el = html instanceof HTMLElement ? html : html[0];
            const val = Number(el.querySelector("#wow-ammo-qty-input")?.value || defaultQty);
            resolve(Math.max(1, Math.floor(val)));
          }
        },
        cancel: {
          label: game.i18n.localize("WOW_LOOTER.Common.Cancel"),
          callback: () => resolve(null)
        }
      },
      default: "ok",
      close: () => resolve(null)
    }).render(true);
  });
}

/**
 * Muestra una ventana con un slider para confirmar cuántas unidades de un ítem agregar (por defecto x1).
 * @param {string} itemName
 * @param {number} maxQty
 * @param {number} [defaultQty=1]
 * @returns {Promise<number|null>}
 */
export async function promptItemQuantitySlider(itemName, maxQty, defaultQty = 1) {
  const safeMax = Math.max(1, Math.floor(Number(maxQty) || 1));
  const safeDefault = Math.min(safeMax, Math.max(1, Math.floor(Number(defaultQty) || 1)));
  const title = `${game.i18n.localize("WOW_LOOTER.Dialog.ItemQuantityTitle")}: ${itemName}`;
  const label = game.i18n.localize("WOW_LOOTER.Dialog.ItemQuantityLabel");
  const confirmLabel = game.i18n.localize("WOW_LOOTER.Dialog.ConfirmAdd");

  const content = `
    <div class="wow-qty-slider-dialog" style="display:flex; flex-direction:column; gap:10px; padding:8px 0;">
      <label style="font-weight:600; color:#e2e8f0; font-size:0.9rem;">${label} (1 - ${safeMax}):</label>
      <div style="display:flex; align-items:center; gap:10px;">
        <input type="range" id="wow-item-qty-slider" min="1" max="${safeMax}" value="${safeDefault}" style="flex:1; cursor:pointer;" />
        <span id="wow-item-qty-badge" style="min-width:44px; text-align:center; font-weight:700; color:#f59e0b; font-size:0.95rem;">x${safeDefault}</span>
      </div>
    </div>
  `;

  const wireSlider = (root) => {
    const slider = root?.querySelector("#wow-item-qty-slider");
    const badge = root?.querySelector("#wow-item-qty-badge");
    if (!slider || !badge) return;
    slider.addEventListener("input", () => {
      badge.textContent = `x${slider.value}`;
    });
  };

  if (foundry.applications?.api?.DialogV2) {
    return foundry.applications.api.DialogV2.prompt({
      window: { title },
      content,
      render: (ev, dialog) => wireSlider(dialog.element),
      ok: {
        label: confirmLabel,
        icon: "fas fa-check",
        callback: (ev, btn, dialog) => {
          const val = Number(dialog.element.querySelector("#wow-item-qty-slider")?.value || safeDefault);
          return Math.min(safeMax, Math.max(1, Math.floor(val)));
        }
      },
      rejectClose: false
    });
  }

  return new Promise((resolve) => {
    new Dialog({
      title,
      content,
      render: (html) => wireSlider(html instanceof HTMLElement ? html : html[0]),
      buttons: {
        ok: {
          icon: '<i class="fas fa-check"></i>',
          label: confirmLabel,
          callback: (html) => {
            const el = html instanceof HTMLElement ? html : html[0];
            const val = Number(el.querySelector("#wow-item-qty-slider")?.value || safeDefault);
            resolve(Math.min(safeMax, Math.max(1, Math.floor(val))));
          }
        },
        cancel: {
          label: game.i18n.localize("WOW_LOOTER.Common.Cancel"),
          callback: () => resolve(null)
        }
      },
      default: "ok",
      close: () => resolve(null)
    }).render(true);
  });
}
