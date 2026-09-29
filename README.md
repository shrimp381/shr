# Crucible Worlds: Wounds & Armour

A Foundry VTT module that automates the **Perils of Adventuring** and **Armour Changes** rules from *The Crucible Worlds — Homebrew Rules* for D&D 5e.

- **Foundry:** v13
- **System:** dnd5e 5.x
- **Sheets:** default dnd5e character sheet, and Tidy 5e Sheets (as a **Perils** tab)
- **Damage:** dnd5e damage application; midi-qol supported (see below)

## Features

### Ablated Armour
- A **critical hit**, or **massive damage** from an attack (more than half the target's max HP), takes 1 AC off the target's armour. This works for characters and enemies.
- **Shields are ablated first.** A shield at 0 AC is broken and must be replaced.
- **Exemptions:** natural armour (and Draconic Resilience), Unarmoured Defence (monk, barbarian, bard), and **psychic damage** never ablate armour.
- **+3 armour** can't be ablated.
- NPCs with a flat stat-block AC and no armour items get a stacking −1 AC effect instead. You can turn this off.
- The damaged value is written to the item's own AC, so every sheet and HUD shows it. The undamaged value is kept in a flag.

### Shields
- An equipped shield with AC left **stops the effects of massive damage**: no wound roll and no massive-damage ablation. A setting can make the shield lose 1 AC instead.
- **Shield Block** (reaction): when a character with a shield is hit by an attack, their player gets a **Block / Take it** prompt before HP changes. Blocking halves the damage and costs the shield 1 AC. If the player isn't online, the GM is asked.
- If the prompt is off (or you use midi-qol), the tracker's **Shield Block last hit** button or the macro below blocks after the fact. It refunds half the last hit and ablates the shield.

### Wounds and Injuries
- A player character who drops to **0 HP**, or takes **more than half their max HP** in one hit, rolls **2d6 minus their current wounds** on the Wounds table.
- **Duplicates:** if the result is a wound they already have, it moves down to the next lowest one they don't have. Results marked **\*** are repeatable and skip this check.
- **2 or less:** a Constitution save (DC = half the damage taken) is posted as a chat button. If the save fails, the character rolls 1d6 on the **Permanent Wound** table, which follows the same duplicate rule.
- Each wound becomes an Active Effect:

| Wound | Automation |
|---|---|
| Internal Bleeding* | HP max halved |
| Concussion | Dazed condition |
| Laceration | Bleeding condition |
| Deep Wound* | +1 failed death save each time you drop to 0 HP |
| Battered* | +1 exhaustion when gained |
| Sprained Wrist* | shown on the tracker (narrative) |
| Damaged Eardrum | Deafened |
| System Shock | disadvantage on initiative |
| Sprained Ankle* | walking speed halved; a second one sets it to 0 |
| Close Call* | back to 1 HP and prone instead of 0 HP |
| Fatal Wound | dead |
| Lost Arm* | shown on the tracker (narrative) |
| Lost Leg* | as Sprained Ankle |
| Lost Eye* | disadvantage on Perception and Investigation; a second one gives Blinded |
| Scarred Lungs | shown on the tracker (narrative) |
| Hideous Scar | disadvantage on Performance and Persuasion |

- **Exhaustion at 0 HP:** a character gains 1 level each time they drop to 0 HP.

### Dealing with Wounds
The **Treat** button on each temporary wound offers four options:
- **Healer's kit:** Medicine DC 8 + character level. Success removes the wound.
- **Grit and bear it:** Medicine DC 8 + level. The wound is always suppressed until a short rest. The character gains 1 exhaustion on a success, or 2 on a failure.
- **Potion:** subdues one injury until a short rest. Drinking a potion also offers this automatically.
- **Long rest recovery:** Medicine DC 10.

On a **long rest**, the module rolls a DC 10 Medicine check for each temporary wound automatically. You can turn this off. Suppressed wounds come back at the next rest. **Permanent wounds** can only be removed from the tracker, which stands in for *regenerate*.

### Repair and magic armour
- **Repair** button on damaged armour. The options are a craftsman (2/5/10 gp for light/medium/heavy, with an option to deduct the gold), a party member with the right tools (free), or *Mending* (only if the piece has lost less than 3 AC). Shields can only be **replaced**.
- **Magic armour recovers AC:** 1 every 2 days for a basic enchantment, 1 per day for +1, and 2 per day for +2. By default a long rest counts as 1.5 days, because the setting's long rest is 36 hours. You can instead tie recovery to world time or do it manually.

### Wound Tracker
On the default sheet, a panel sits in the sidebar under HP. It shows:
- the wound penalty (−N)
- each wound, with Temporary or Permanent and Subdued tags; click a wound to expand its text
- Treat, Subdue and Remove buttons, plus Add wound and Roll wound buttons
- each armour piece's AC as pips, with repair buttons and the Shield Block button

On Tidy 5e, the same panel appears as a **Perils** tab.

## Settings
All settings are world settings under **Configure Settings → Crucible Worlds**. They let you turn off or tune each rule: ablation, stat-block ablation, the shield's massive-damage mode, the Shield Block prompt (attacks, any damage, or off), Shield Block for NPCs and its timeout, magic armour recovery source and days per long rest, wounds, wounds for NPCs, whether permanent wounds count toward the penalty, exhaustion at 0 HP, long-rest Medicine checks, the potion prompt, and private chat cards.

## Macros

**Shield Block (after the fact)**
```js
CrucibleWorlds.shieldBlock(); // selected token, or your assigned character
```

**Advance magic armour recovery (GM)**
```js
CrucibleWorlds.advanceDays(1);
```

**Roll a wound by hand**
```js
const actor = canvas.tokens.controlled[0]?.actor;
CrucibleWorlds.rollWound(actor, { reason: "manual", damage: 18 });
```

## Customising the tables
The rules data is in `CONFIG.CRUCIBLE`. You can change it from a world script or a macro that runs on `ready`, for example:
```js
CONFIG.CRUCIBLE.WOUNDS.concussion.repeatable = true;   // allow Concussion more than once
CONFIG.CRUCIBLE.MAGIC_RECOVERY = [0.5, 1, 2];          // AC/day by magic bonus
```
Wound definitions (table, result, repeatable, conditions, effect changes) are in `scripts/constants.js`.

## midi-qol
With midi-qol active, crits and damage types are read from the midi workflow. Everything else works the same way. The automatic Shield Block prompt is turned off because midi applies damage on its own; use the tracker button or the macro instead.

## API
`game.modules.get("crucible-worlds").api` (also `globalThis.CrucibleWorlds`):
`getWounds, woundCount, addWound, removeWound, setSuppressed, rollWound, rollPermanent, resolvePermanent, treatWound, syncWoundEffects, ablate, repairItem, recoverMagic, advanceDays, activeShield, shieldBlock, processHit`

## Data
- Actor flags `crucible-worlds.wounds` (the wound list), `woundCount`, `pendingPermanent`, `lastHit`
- Item flags `crucible-worlds.baseAC`, `broken`, `recovery`
- Wound Active Effects carry `flags.crucible-worlds.woundId`
