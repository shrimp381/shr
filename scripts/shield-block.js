/**
 * Shield Block (Martial Reaction): "While wielding a shield, when you are hit you can
 * half the incoming damage at the expense of ablating it by 1."
 *
 * Two ways to use it:
 * 1. Prompt — when damage is applied through dnd5e's damage application, the shield's owner
 *    gets a Block / Take it dialog before HP changes (asked over a v13 user query if the
 *    owner is on another client). Disabled while midi-qol is active.
 * 2. After the fact — the tracker button / macro `CrucibleWorlds.shieldBlock(actor)` refunds
 *    half of the last hit and ablates the shield.
 */
import { MODULE_ID } from "./constants.js";
import { setting, t, tf } from "./settings.js";
import { activeShield, ablate, ablationLine } from "./armour.js";
import { postCard, esc } from "./chat.js";

export const QUERY = `${MODULE_ID}.shieldBlock`;

/** Should the prompt be offered for this hit? */
export function shouldOfferBlock(actor, ctx) {
  const mode = setting("shieldBlock");
  if (mode === "off" || game.modules.get("midi-qol")?.active) return false;
  if (!activeShield(actor)) return false;
  if (mode === "attack" && ctx?.isAttack !== true) return false;
  if (!actor.hasPlayerOwner && !setting("shieldBlockNpc")) return false;
  return true;
}

/** Who decides: the actor's player if online, otherwise a GM. */
function decider(actor) {
  const players = game.users.filter(u => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
  return players.find(u => u.character?.id === actor.id) ?? players[0] ?? game.users.activeGM ?? game.user;
}

/**
 * The Block / Take it dialog. Resolves false on close or timeout.
 * @param {{actorName:string, shieldName:string, amount:number, crit:boolean}} data
 * @param {number} timeout seconds
 */
export function blockDialog(data, timeout = 30) {
  const half = Math.floor(data.amount / 2);
  const content = `<div class="cw-dialog">
    <p>${tf("ShieldBlock.Prompt", { name: esc(data.actorName), amount: data.amount, shield: esc(data.shieldName) })}</p>
    ${data.crit ? `<p class="cw-crit">${t("ShieldBlock.Crit")}</p>` : ""}
    <p class="hint">${tf("ShieldBlock.Hint", { half })}</p>
  </div>`;
  return new Promise(resolve => {
    let done = false;
    const finish = value => { if (!done) { done = true; resolve(value); } };
    const dialog = new foundry.applications.api.DialogV2({
      window: { title: t("ShieldBlock.Title"), icon: "fa-solid fa-shield-halved" },
      content,
      buttons: [
        { action: "block", label: tf("ShieldBlock.Block", { half }), icon: "fa-solid fa-shield-halved", default: true, callback: () => true },
        { action: "take", label: tf("ShieldBlock.Take", { amount: data.amount }), icon: "fa-solid fa-heart-crack", callback: () => false }
      ],
      submit: result => finish(result === true)
    });
    dialog.addEventListener?.("close", () => finish(false));
    dialog.render({ force: true });
    setTimeout(() => { if (!done) { finish(false); dialog.close(); } }, timeout * 1000);
  });
}

/** Ask the right user whether to block. */
export async function askBlock(actor, amount, ctx) {
  const shield = activeShield(actor);
  const timeout = setting("shieldBlockTimeout");
  const data = { actorName: actor.name, shieldName: shield?.name ?? "", amount, crit: !!ctx?.crit, timeout };
  const user = decider(actor);
  if (!user || user.isSelf || typeof user.query !== "function") return blockDialog(data, timeout);
  try {
    return !!(await user.query(QUERY, data, { timeout: (timeout + 5) * 1000 }));
  } catch (err) {
    console.warn(`${MODULE_ID} | Shield Block query to ${user.name} failed`, err);
    return false;
  }
}

/**
 * Block the last recorded hit after the fact: refund half the damage and ablate the shield.
 * Effects the hit already triggered (a wound roll, exhaustion) are not undone.
 */
export async function manualShieldBlock(actor) {
  if (!actor) return ui.notifications.warn(t("Notify.SelectToken"));
  const shield = activeShield(actor);
  if (!shield) return ui.notifications.warn(t("Notify.NoShield"));
  const hit = actor.getFlag(MODULE_ID, "lastHit");
  if (!hit || hit.blocked) return ui.notifications.warn(t("Notify.NoHit"));

  const refund = hit.amount - Math.floor(hit.amount / 2);
  const hp = actor.system.attributes.hp;
  const max = hp.effectiveMax ?? hp.max;
  await actor.update({
    "system.attributes.hp.value": Math.min(max, hp.value + refund),
    [`flags.${MODULE_ID}.lastHit.blocked`]: true
  }, { cwInternal: true });
  const result = await ablate(actor, { shieldOnly: true });
  const lines = [tf("ShieldBlock.Refund", { amount: hit.amount, refund }), ablationLine(result, "block")];
  if (hit.triggered) lines.push(`<em>${t("ShieldBlock.AlreadyTriggered")}</em>`);
  await postCard(actor, { title: tf("ShieldBlock.CardTitle", { name: esc(actor.name) }), icon: "fa-solid fa-shield-halved", lines });
}
