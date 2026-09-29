/**
 * Chat cards and chat-card buttons.
 */
import { MODULE_ID } from "./constants.js";
import { setting, t } from "./settings.js";
import { resolvePermanent } from "./wounds.js";

const esc = s => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
export { esc };

/**
 * Post a Crucible Worlds chat card.
 * @param {Actor} actor
 * @param {object} data
 * @param {string} data.title
 * @param {string} [data.icon]      Font Awesome classes
 * @param {string[]} [data.lines]   pre-escaped HTML lines
 * @param {string} [data.body]      pre-escaped HTML appended after the lines
 * @param {Roll[]} [data.rolls]
 */
export async function postCard(actor, { title, icon = "fa-solid fa-heart-crack", lines = [], body = "", rolls = [] }) {
  let rollHtml = "";
  for (const roll of rolls) rollHtml += await roll.render();
  const content = `
    <div class="cw-card">
      <header class="cw-card-title"><i class="${icon}"></i> ${title}</header>
      ${lines.length ? `<ul class="cw-card-lines">${lines.map(l => `<li>${l}</li>`).join("")}</ul>` : ""}
      ${rollHtml ? `<div class="cw-card-rolls">${rollHtml}</div>` : ""}
      ${body}
    </div>`;
  const data = {
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    rolls,
    flags: { [MODULE_ID]: { card: true } }
  };
  if (rolls.length) data.sound = CONFIG.sounds.dice;
  if (setting("whisperGM")) {
    const owners = game.users.filter(u => actor.testUserPermission(u, "OWNER")).map(u => u.id);
    data.whisper = [...new Set([...owners, ...ChatMessage.getWhisperRecipients("GM").map(u => u.id)])];
  }
  return ChatMessage.create(data);
}

/** Wire buttons in our chat cards (v13 hook gives an HTMLElement). */
export function bindChatCard(message, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  for (const button of root.querySelectorAll("[data-cw-chat]")) {
    button.addEventListener("click", async event => {
      event.preventDefault();
      const actor = await fromUuid(button.dataset.actorUuid);
      if (!actor?.isOwner) return ui.notifications.warn(t("Notify.NotOwner"));
      button.disabled = true;
      try {
        if (button.dataset.cwChat === "permSave") await resolvePermanent(actor, button.dataset.pendingId);
      } catch (err) {
        console.error(`${MODULE_ID} |`, err);
        ui.notifications.error(err.message);
      } finally {
        button.disabled = false;
      }
    });
  }
}
