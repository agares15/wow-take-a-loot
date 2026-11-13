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
 * Enriquece el HTML de la descripción de un ítem usando el TextEditor de Foundry
 * para respetar formato nativo del sistema (negrita, cursiva, iconos, links y código inline).
 * @param {string} rawHtml
 * @param {object|null} [relativeTo=null]
 * @returns {Promise<string>}
 */
export async function enrichItemDescription(rawHtml, relativeTo = null) {
  if (!rawHtml || typeof rawHtml !== "string") return "";
  const editor = foundry.applications?.ux?.TextEditor?.implementation || globalThis.TextEditor;
  if (!editor?.enrichHTML) return rawHtml;
  try {
    return await editor.enrichHTML(rawHtml, {
      async: true,
      relativeTo,
      secrets: Boolean(game.user?.isGM)
    });
  } catch {
    return rawHtml;
  }
}

