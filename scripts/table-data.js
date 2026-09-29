/**
 * Default roll tables, taken verbatim from the campaign's exported RollTables
 * ("Wounds & Injuries", "Wounds & Injuries (NPC)", "Permanent Wound").
 *
 * On first load the module creates these as real RollTable documents in the world so the GM can
 * edit them (see tables.js). The one deliberate difference from the export: on the NPC table
 * Sprained Wrist, Sprained Ankle and Impaired Vision are marked with a * (repeatable), because
 * their own text says what happens the second time. Remove the * in the table to change that.
 *
 * `key` links a result to a wound definition in constants.js (the automation: conditions,
 * Active Effects, one-off effects). "permanent" marks the "roll on the Permanent Wound table" band.
 */
export const DEFAULT_TABLES = {
  "main": {
    "name": "Wounds & Injuries",
    "formula": "2d6",
    "description": "",
    "results": [
      {
        "range": [
          1,
          2
        ],
        "key": "permanent",
        "description": "Permanent Wound. You have sustained a serious wound that is most likely permanent. Roll on the Permanent Wound Table and apply the result."
      },
      {
        "range": [
          3,
          3
        ],
        "key": "internalBleeding",
        "description": "Internal Bleeding*. You have suffered an internal hemorrhage and bruising. Your hit point maximum is halved."
      },
      {
        "range": [
          4,
          4
        ],
        "key": "concussion",
        "description": "Concussion. You have received a minor concussion and struggle to focus on complicated tasks. You gain the dazed condition."
      },
      {
        "range": [
          5,
          5
        ],
        "key": "laceration",
        "description": "Laceration. You have taken a deep injury which you are bleeding from. You gain the bleeding condition."
      },
      {
        "range": [
          6,
          6
        ],
        "key": "deepWound",
        "description": "Deep Wound*. You have taken a blow that under different circumstances would kill most humanoids. When you are reduced to 0 hit points, you start with an additional failed death saving throw."
      },
      {
        "range": [
          7,
          7
        ],
        "key": "battered",
        "description": "Battered*. Your muscles ache and you have had the wind knocked out of you. You gain a level of @condition[exhaustion]."
      },
      {
        "range": [
          8,
          8
        ],
        "key": "sprainedWrist",
        "description": "Sprained Wrist*. You have badly sprained your wrist, unable to use it effectively. You are unable to hold objects in one of your hands and you cannot take actions that require that arm."
      },
      {
        "range": [
          9,
          9
        ],
        "key": "damagedEardrum",
        "description": "Damaged Eardrum. You have suffered a blow to the head and your hearing has been impaired. You gain the @condition[deafened] condition."
      },
      {
        "range": [
          10,
          10
        ],
        "key": "systemShock",
        "description": "System Shock. You have suffered a severe nervous system shock. You have disadvantage in Dexterity checks to determine initiative."
      },
      {
        "range": [
          11,
          11
        ],
        "key": "sprainedAnkle",
        "description": "Sprained Ankle*. You have badly sprained your ankle, unable to use it effectively. Your speed on foot is halved and you cannot take the dash action. If you receive this result a second time your speed on foot becomes 0."
      },
      {
        "range": [
          12,
          12
        ],
        "key": "closeCall",
        "description": "Close Call*. You narrowly miss an otherwise dangerous blow. Instead of being reduced to 0 hit points, you fall to 1 hit point instead, and become @condition[prone]."
      }
    ]
  },
  "npc": {
    "name": "Wounds & Injuries (NPC)",
    "formula": "2d6",
    "description": "",
    "results": [
      {
        "range": [
          1,
          2
        ],
        "key": "permanent",
        "description": "Permanent Wound. You have sustained a serious wound that is most likely permanent. Roll on the Permanent Wound Table and apply the result. (Reroll if not a significant NPC)"
      },
      {
        "range": [
          3,
          3
        ],
        "key": "collapsedLung",
        "description": "Collapsed Lung. The internal organs of the creature receive significant damage, or their otherwise integral systems begin shutting down. If the creature moves more than 10 feet on its turn, it must make a DC 10 Constitution saving throw or their movement is reduced to 0. Additionally, they can only speak in short, clipped sentences. If the creature tries to cast a spell with a verbal component, they must make a [DC 10 + spell level ] Constitution saving throw or the spell fails."
      },
      {
        "range": [
          4,
          4
        ],
        "key": "concussion",
        "description": "Concussion. You have received a minor concussion and struggle to focus on complicated tasks. You gain the dazed condition."
      },
      {
        "range": [
          5,
          5
        ],
        "key": "laceration",
        "description": "Laceration. You have taken a deep injury which you are bleeding from. You gain the bleeding condition."
      },
      {
        "range": [
          6,
          6
        ],
        "key": "tornMuscle",
        "description": "Torn Muscle. The creature's muscles rip or their form otherwise takes significant damage that impedes their ability to attack. If they have the 'Multiattack' feature, the number of attacks they can make is reduced to by half. If they do not have such a feature, they instead cannot take bonus actions."
      },
      {
        "range": [
          7,
          7
        ],
        "key": "wornOut",
        "description": "Worn Out. The creature's haggard breathing or deteriorating form betrays them. Their melee attacks that use strength or dexterity have their damage halved."
      },
      {
        "range": [
          8,
          8
        ],
        "key": "sprainedWrist",
        "description": "Sprained Wrist*. You have badly sprained your wrist, unable to use it effectively. You are unable to hold objects in one of your hands and you cannot take actions that require that arm."
      },
      {
        "range": [
          9,
          9
        ],
        "key": "impairedVision",
        "description": "Impaired Vision*. The creature has suffered a blow to the head impairing its vision, all ranged attacks are at Disadvantage. If they suffer the same injury again they are considered Blind."
      },
      {
        "range": [
          10,
          10
        ],
        "key": "desperatePanic",
        "description": "Desperate Panic. The severity of the wound causes a brief shock to the creature, causing their actions to become desperate. They receive the frightened condition. They may make a[ DC10 + Attackers Prof] Wisdom saving throw at the end of their turns to end this condition."
      },
      {
        "range": [
          11,
          11
        ],
        "key": "sprainedAnkle",
        "description": "Sprained Ankle*. You have badly sprained your ankle, unable to use it effectively. Your speed on foot is halved and you cannot take the dash action. If you receive this result a second time your speed on foot becomes 0."
      },
      {
        "range": [
          12,
          12
        ],
        "key": "brutalBlow",
        "description": "Brutal Blow. The Creature suffers a heavy blow that knocks them prone, they suffer an extra die of damage (without modifiers)."
      }
    ]
  },
  "permanent": {
    "name": "Permanent Wound",
    "formula": "1d6",
    "description": "Table columns: 1d6 | Permanent Wound",
    "results": [
      {
        "range": [
          1,
          1
        ],
        "key": "fatalWound",
        "description": "Fatal Wound. Through an unrecoverable injury you have been fatally wounded. You are now dead."
      },
      {
        "range": [
          2,
          2
        ],
        "key": "lostArm",
        "description": "Lost Arm*. You have suffered a serious injury to your arm or have lost it entirely. You are unable to hold objects in one of your arms and you cannot take actions that require two arms."
      },
      {
        "range": [
          3,
          3
        ],
        "key": "lostLeg",
        "description": "Lost Leg*. You have suffered a serious injury to your leg or have lost it entirely. Your speed on foot is halved and you cannot take the dash action. If you receive this result again your speed on foot becomes 0."
      },
      {
        "range": [
          4,
          4
        ],
        "key": "lostEye",
        "description": "Lost Eye*. You have lost the use of a good eye. You have disadvantage on Wisdom (Perception) and Intelligence (Investigation) checks that rely on sight. If you receive this result again, you gain the @condition[blinded] condition."
      },
      {
        "range": [
          5,
          5
        ],
        "key": "scarredLungs",
        "description": "Scarred Lungs. Undertaking vigorous activities causes you to break out in a coughing fit. If you take an action, you cannot take a bonus action until your next turn. If you take a bonus action you cannot take an action until your next turn."
      },
      {
        "range": [
          6,
          6
        ],
        "key": "hideousScar",
        "description": "Hideous Scar. You have been horribly and visibly scared. You have disadvantage on Charisma (Performance) and Charisma (Persuasion) checks. Additionally, indifferent NPC's may prefer not to converse with you."
      }
    ]
  }
};
