// Import TypeScript modules
import { LANCER } from "../config";
import { LancerActor, LancerMECH, LancerNPC } from "../actor/lancer-actor";
import { AccDiffData, AccDiffDataSerialized } from "../helpers/acc_diff";
import { renderTemplateStep } from "./_render";
import { rollAttacks, setAttackEffects, setAttackTags, setAttackTargets, showAttackHUD } from "./attack";
import { SystemTemplates } from "../system-template";
import { LancerFlowState } from "./interfaces";
import { LancerItem } from "../item/lancer-item";
import { ActionData } from "../models/bits/action";
import { resolve_dotpath } from "../helpers/commons";
import { ActivationType, AttackType } from "../enums";
import { Flow, FlowState } from "./flow";
import { UUIDRef } from "../source-template";
import {
  applySelfHeat,
  checkItemCharged,
  checkItemDestroyed,
  checkItemLimited,
  updateItemAfterAction,
} from "./item-utils";

const lp = LANCER.log_prefix;

export class TechAttackFlow extends Flow<LancerFlowState.TechAttackRollData> {
  constructor(uuid: UUIDRef | LancerItem | LancerActor, data?: Partial<LancerFlowState.TechAttackRollData>) {
    // Initialize data if not provided
    const initialData: LancerFlowState.TechAttackRollData = {
      type: "tech",
      title: data?.title || "",
      roll_str: data?.roll_str || "",
      flat_bonus: data?.flat_bonus || 0,
      attack_type: data?.attack_type || AttackType.Tech,
      is_smart: true, // Tech attacks always target e-def
      invade: data?.invade || false,
      attack_rolls: data?.attack_rolls || { roll: "", targeted: [] },
      attack_results: data?.attack_results || [],
      hit_results: data?.hit_results || [],
      damage_results: data?.damage_results || [],
      crit_damage_results: data?.crit_damage_results || [],
      reroll_data: data?.reroll_data || "",
      tags: data?.tags || [],
    };

    super("TechAttackFlow", uuid, initialData);

    this.steps.set("initTechAttackData", initTechAttackData);
    this.steps.set("checkItemDestroyed", checkItemDestroyed);
    this.steps.set("checkItemLimited", checkItemLimited);
    this.steps.set("checkItemCharged", checkItemCharged);
    this.steps.set("setAttackTags", setAttackTags);
    this.steps.set("setAttackEffects", setAttackEffects);
    this.steps.set("setAttackTargets", setAttackTargets);
    this.steps.set("showAttackHUD", showAttackHUD);
    this.steps.set("rollAttacks", rollAttacks);
    // TODO: heat, and special tech attacks which do normal damage
    // this.steps.set("rollDamages", rollDamages);
    // TODO: pick invade option for each hit
    // this.steps.set("pickInvades", pickInvades);
    this.steps.set("applySelfHeat", applySelfHeat);
    this.steps.set("updateItemAfterAction", updateItemAfterAction);
    this.steps.set("printTechAttackCard", printTechAttackCard);
  }
}

export async function initTechAttackData(
  state: FlowState<LancerFlowState.TechAttackRollData>,
  options?: { title?: string; flat_bonus?: number; acc_diff?: AccDiffDataSerialized; action_path?: string }
): Promise<boolean> {
  if (!state.data) throw new TypeError(`Tech attack flow state missing!`);
  // TODO: is there a bonus we can check for this type of effect?
  // Add 1 accuracy for all you goblins
  let acc = state.actor.is_mech() && state.actor.system.loadout.frame?.value?.system.lid == "mf_goblin" ? 1 : 0;
  // If we only have an actor, it's a basic attack
  if (!state.item) {
    if (!state.actor.is_mech() && !state.actor.is_npc()) {
      ui.notifications!.error(`Error rolling tech attack macro (not a valid tech attacker).`);
      return false;
    }
    state.data.title = options?.title ?? "TECH ATTACK";
    state.data.attack_type = AttackType.Tech;
    state.data.flat_bonus = 0;
    if (state.actor.is_pilot() || state.actor.is_mech()) {
      state.data.flat_bonus = state.actor.system.tech_attack;
    } else if (state.actor.is_npc()) {
      state.data.flat_bonus = state.actor.system.sys;
    }
    state.data.acc_diff = options?.acc_diff
      ? AccDiffData.fromObject(options.acc_diff)
      : AccDiffData.fromParams(state.actor, [], state.data.title, Array.from(game.user!.targets));
    return true;
  } else {
    // This title works for everything
    state.data.title = options?.title ?? state.item.name!;
    // All of these are tech attacks by definition
    state.data.attack_type = AttackType.Tech;
    if (state.item.is_npc_feature()) {
      if (!state.actor.is_npc()) {
        ui.notifications?.warn("Non-NPC cannot use an NPC system!");
        return false;
      }
      let tier_index: number = state.item.system.tier_override || state.actor.system.tier - 1;
      let asTech = state.item.system as SystemTemplates.NPC.TechData;
      acc = asTech.accuracy[tier_index] ?? 0;
      state.data.flat_bonus = asTech.attack_bonus[tier_index] ?? 0;
      state.data.acc_diff = options?.acc_diff
        ? AccDiffData.fromObject(options.acc_diff)
        : AccDiffData.fromParams(state.item, asTech.tags, state.data.title, Array.from(game.user!.targets), acc);
      return true;
    } else if (state.item.is_mech_system()) {
      // Tech attack system
      if (!state.actor.is_mech()) {
        ui.notifications?.warn("Non-mech cannot use a mech system!");
        return false;
      }
      if (!state.actor.system.pilot?.value) {
        ui.notifications?.warn("Cannot use a system on a non-piloted mech!");
        return false;
      }

      // Get the action if possible
      let action: ActionData | null = null;
      if (options?.action_path) {
        action = resolve_dotpath(state.item, options.action_path);
      }
      state.data.flat_bonus = state.actor.system.tech_attack;
      state.data.tags = state.item.getTags() ?? undefined;
      if (action) {
        // Use the action data
        state.data.title = action.name == ActivationType.Invade ? `INVADE // ${action.name}` : action.name;
        state.data.effect = action.detail;
      } else {
        // Use the system effect as a fallback
        state.data.title = state.item.name!;
        state.data.effect = state.item.system.effect;
      }

      // TODO: check bonuses for flat attack bonus
      state.data.acc_diff = options?.acc_diff
        ? AccDiffData.fromObject(options.acc_diff)
        : AccDiffData.fromParams(
            state.item,
            state.item.system.tags,
            state.data.title,
            Array.from(game.user!.targets),
            acc
          );
      return true;
    }
    ui.notifications!.error(`Error in tech attack flow - ${state.item.name} is an invalid type!`);
    return false;
  }
}

export async function printTechAttackCard(
  state: FlowState<LancerFlowState.TechAttackRollData>,
  options?: { template?: string }
): Promise<boolean> {
  if (!state.data) throw new TypeError(`Tech attack flow state missing!`);
  const template = options?.template || `systems/${game.system.id}/templates/chat/tech-attack-card.hbs`;
  const flags = {
    attackData: {
      origin: state.actor.id,
      targets: state.data.attack_rolls.targeted.map(t => {
        return { id: t.target.id, lockOnConsumed: !!t.usedLockOn };
      }),
    },
  };
  await renderTemplateStep(state.actor, template, state.data, flags);
  return true;
}
