# Shrimp's Homebrew Rules (SHR)

A Foundry VTT module that automates homebrew rules for D&D 5e. This release covers the **Perils of Adventuring** and **Armour Changes** chapters of *The Crucible Worlds — Homebrew Rules*, including the NPC wounds table.

- **Foundry:** v13
- **System:** dnd5e 5.x
- **Sheets:** default dnd5e character sheet, and Tidy 5e Sheets (as a **Perils** tab, or pinned to the first tab)
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
- **2 or less:** a Permanent Wound: roll 1d6 on the **Permanent Wound** table (same duplicate rule). If you want the Constitution save (DC = half the damage taken) from the rules doc first, turn on **Constitution save before a Permanent Wound** in settings.
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

### NPC wounds and injuries
Turn on **NPC wounds and injuries** in the module settings and NPCs roll on their own 2d6 table (the same duplicate rule applies) when they take massive damage and survive. An NPC at 0 HP is simply dead or defeated, so it doesn't roll. NPC wounds show as effects on the token and in chat.

| 2d6 | NPC wound | Automation |
|---|---|---|
| 2 or less | Permanent Wound | see below |
| 3 | Collapsed Lung | narrative (saves are the GM's call) |
| 4 | Concussion | Dazed |
| 5 | Laceration | Bleeding |
| 6 | Torn Muscle | narrative |
| 7 | Worn Out | narrative |
| 8 | Sprained Wrist* | narrative |
| 9 | Impaired Vision* | narrative; a second one gives Blinded |
| 10 | Desperate Panic | Frightened |
| 11 | Sprained Ankle* | speed halved; a second one sets it to 0 |
| 12 | Brutal Blow | Prone (the extra damage die is the GM's to roll) |

The exported table doesn't mark repeatable wounds. Sprained Wrist, Sprained Ankle and Impaired Vision have a `*` added in the default NPC table, because their text says what happens the second time. Remove the `*` in the table to change that.

**NPC Permanent Wounds:** the table says to reroll unless the NPC is significant. The **NPC permanent wounds** setting decides: ask the GM each time (default), always apply, or always reroll. A permanent wound on an NPC has no Constitution save; it rolls straight on the Permanent Wound table.

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

### Overcharging spells
Cast a spell without a slot by spending Hit Dice. A checkbox appears in the usage dialog of leveled spells cast by player characters: tick it, choose the level to cast at, and (under the level cap rules, 4th level and up) the slot to expend.

- **Base rules (level 6 or lower):** spend Hit Dice equal to the spell's level, then make a spell check: `1d20 + spellcasting modifier + proficiency` against DC 10 + the spell's level. On a success the spell is cast; on a failure the spell fails and the caster takes Force damage equal to the Hit Dice spent. The damage comes straight off hit points (temporary hit points and resistances don't apply).
- **At level cap:** 1st-3rd level spells cost Hit Dice equal to their level, with no check or damage. 4th level and up expend a lower spell slot plus a Hit Die for each level it is below the spell (Fireball at 4th: a 3rd level slot + 1 Hit Die, or a 2nd level slot + 2). Under these rules a Warlock's pact slot counts as a 3rd level slot.
- Spent dice come off Veteran Dice first, then the largest Hit Die.
- Which rules apply is decided by the GM's **At level cap** setting (or by the character being past the level cap).

### Level Cap and Veteran Levels
With **At level cap** switched on, every level a character gains beyond the level cap (default 6) is a Veteran Level. The character still gains class features and advancements, but:
- proficiency bonus stays where it was at the cap,
- max HP doesn't grow (the Hit Points advancement of veteran levels is ignored),
- spell slots and pact slots stop progressing, and cantrips stop scaling,
- the Hit Dice of veteran levels are **Veteran Dice**, shown separately in the Wound Tracker (Hit Dice x/y, Veteran Dice a/b).
Veteran levels are recorded when a class levels up past the cap, or when the GM switches the rule on for characters already past it. Spell choices at level-up work as normal (the level's spells can be chosen even though no slots come with them). Overcharging is limited to the highest spell level the character's levels would normally let them cast. Not automated: Fighter Extra Attack (2)/(3) and the level 8/10 ASIs/feats; handle them by not granting those advancements. Veteran Dice can be spent on short rest healing and Overcharging; dnd5e's short rest dialog still lists them with the normal Hit Dice.

Both features have a master switch in the SHR settings (**Overcharging spells** and **Veteran Levels**). Switching one off removes it completely.

### Exhaustion
Each level of exhaustion gives -1 to d20 Tests (dnd5e 5.x's own rule is -2 per level). Change it with the **Exhaustion penalty per level** setting; it edits the system's exhaustion setting on load, and the system does the rest.

### Wound Tracker
On the default sheet, a panel sits in the sidebar under HP. It shows:
- the wound penalty (−N)
- each wound, with Temporary or Permanent and Subdued tags; click a wound to expand its text
- Treat, Subdue and Remove buttons, plus Add wound and Roll wound buttons
- each armour piece's AC as pips, with repair buttons and the Shield Block button

On Tidy 5e, the same panel is a **Perils** tab. The **bookmark** in its header (the same icon Tidy uses to favourite an item) **pins the panel to the first tab** instead, at the bottom of that tab. The list above it (your favourites, weapons and abilities) gets shorter but keeps scrolling, and the panel scrolls on its own if it grows. While pinned, the Perils tab is hidden. Click the bookmark on the pinned panel to bring the tab back. This is a per-user preference, so each player chooses their own layout. It needs Tidy 5e's Quadrone sheet; the classic Tidy sheet always keeps the Perils tab.

## Editing the wound tables
The three tables (**Wounds & Injuries**, **Wounds & Injuries (NPC)**, **Permanent Wound**) are ordinary roll tables in your world, created the first time a GM loads it (in a "Shrimp's Homebrew Rules" folder). If your world already has tables with those exact names, the module uses those instead. Edit them like any roll table:
- **Severity:** change a result's range, or swap wounds between results.
- **Table size:** delete results to shorten a table; a roll that lands on a gap moves down to the next result.
- **Text:** write the wound as *Name*. Text* in the description (a `*` after the name makes it repeatable on that table), or use the name field. A result called **Permanent Wound** on a 2d6 table sends the roll to the Permanent Wound table.
- **New wounds:** add a result. It is tracked and shown on the sheet like any other wound.
- **Automation:** open a result and use **Wound automation (SHR)**: pick conditions (Deafened, Blinded ...), extra conditions when the wound repeats, skill or initiative disadvantage, halved HP maximum or speed, exhaustion, prone, close call or fatal. Known wounds start with their usual effects. Whatever is set applies automatically when that result is rolled.
- **Reset:** Settings → SHR → **Open or reset wound tables** opens a table or puts all three back to the defaults.

A wound keeps the name, text and automation it was gained with, so editing a table doesn't change wounds already on a sheet.

## Settings
All settings are world settings under **Configure Settings → Shrimp's Homebrew Rules**. They let you turn off or tune each rule: ablation, stat-block ablation, the shield's massive-damage mode, the Shield Block prompt (attacks, any damage, or off), Shield Block for NPCs and its timeout, magic armour recovery source and days per long rest, wounds, NPC wounds and injuries, NPC permanent wounds, the optional Constitution save before a Permanent Wound, whether permanent wounds count toward the penalty, exhaustion penalty per level (1 by default), exhaustion at 0 HP, long-rest Medicine checks, the potion prompt, and private chat cards.

## Macros

**Shield Block (after the fact)**
```js
SHR.shieldBlock(); // selected token, or your assigned character
```

**Advance magic armour recovery (GM)**
```js
SHR.advanceDays(1);
```

**Roll a wound by hand**
```js
const actor = canvas.tokens.controlled[0]?.actor;
SHR.rollWound(actor, { reason: "manual", damage: 18 });
```

## Customising the tables
The rules data is in `CONFIG.SHR`. You can change it from a world script or a macro that runs on `ready`, for example:
```js
CONFIG.SHR.MAGIC_RECOVERY = [0.5, 1, 2];          // AC/day by magic bonus
```
Wound definitions (repeatable, conditions, effect changes) are in `scripts/constants.js`; which wound sits on which result is in the roll tables. Roll-table edits are read automatically; after a script change call `SHR.tables.load()`.

## midi-qol
With midi-qol active, crits and damage types are read from the midi workflow. Everything else works the same way. The automatic Shield Block prompt is turned off because midi applies damage on its own; use the tracker button or the macro instead.

## API
`game.modules.get("shr").api` (also `globalThis.SHR`):
`tables.load, tables.reset, tables.get, getWounds, woundCount, addWound, removeWound, setSuppressed, rollWound, rollPermanent, resolvePermanent, treatWound, syncWoundEffects, ablate, repairItem, recoverMagic, advanceDays, activeShield, shieldBlock, processHit`

## Data
- Actor flags `shr.wounds` (the wound list), `woundCount`, `pendingPermanent`, `lastHit`
- Item flags `shr.baseAC`, `broken`, `recovery`
- Wound Active Effects carry `flags.shr.woundId`
