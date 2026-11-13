import { MODULE_ID } from "../constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const REPORT_EMAIL = "workshopofwonders.maps@gmail.com";

/**
 * Ventana para reportar errores del módulo por correo electrónico.
 */
export class ReportBugApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "wow-looter-report-bug",
    tag: "form",
    classes: ["wow-looter-app", "wow-looter-report-bug-app"],
    window: {
      title: "WOW_LOOTER.ReportBug.Title",
      icon: "fas fa-bug",
      resizable: false
    },
    position: {
      width: 480,
      height: "auto"
    },
    actions: {
      "send-report": ReportBugApp._onSendReport,
      "copy-report": ReportBugApp._onCopyReport
    }
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/report-bug.hbs`
    }
  };

  _getEnvInfo() {
    const mod = game.modules.get(MODULE_ID);
    return {
      moduleVersion: mod?.version || "1.0.0",
      foundryVersion: game.version || game.release?.version || "unknown",
      systemId: game.system?.id || "unknown",
      systemVersion: game.system?.version || "unknown"
    };
  }

  async _prepareContext() {
    return this._getEnvInfo();
  }

  _buildReportPayload() {
    const html = this.element;
    const subjectRaw = html?.querySelector("input[name='subject']")?.value?.trim() || "";
    const descRaw = html?.querySelector("textarea[name='description']")?.value?.trim() || "";
    if (!subjectRaw || !descRaw) {
      ui.notifications.warn(game.i18n.localize("WOW_LOOTER.ReportBug.MissingFields"));
      return null;
    }

    const env = this._getEnvInfo();
    const subject = `[Wow's Take a Loot Bug] ${subjectRaw}`;
    const body = [
      `Reporter: ${game.user?.name || "Unknown"} (${game.user?.isGM ? "GM" : "Player"})`,
      `Module: ${MODULE_ID} v${env.moduleVersion}`,
      `Foundry VTT: v${env.foundryVersion}`,
      `System: ${env.systemId} v${env.systemVersion}`,
      ``,
      `Description:`,
      descRaw
    ].join("\n");

    return { subject, body };
  }

  static async _onCopyReport() {
    const payload = this._buildReportPayload();
    if (!payload) return;

    const fullText = `To: ${REPORT_EMAIL}\nSubject: ${payload.subject}\n\n${payload.body}`;
    try {
      await navigator.clipboard.writeText(fullText);
      ui.notifications.info(game.i18n.localize("WOW_LOOTER.ReportBug.CopiedNotice"));
    } catch (err) {
      console.error("[wow-looter] No se pudo copiar el reporte:", err);
    }
  }

  static async _onSendReport() {
    const payload = this._buildReportPayload();
    if (!payload) return;

    const mailtoUrl = `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(payload.subject)}&body=${encodeURIComponent(payload.body)}`;
    const link = document.createElement("a");
    link.href = mailtoUrl;
    link.target = "_blank";
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();

    ui.notifications.info(game.i18n.localize("WOW_LOOTER.ReportBug.SentNotice"));
    this.close();
  }
}

