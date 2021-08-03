import { Mech } from 'machine-mind';
import { AnyLancerActor, AnyMMActor, LancerActorType } from '../actor/lancer-actor';
import { HANDLER_activate_general_controls } from '../helpers/commons';
import { HANDLER_activate_native_ref_dragging, HANDLER_activate_ref_dragging, HANDLER_openRefOnClick } from '../helpers/refs';

interface FilledCategory {
  label: string;
  items: any[];
}

/**
 * A helper Dialog subclass for editing an actors inventories
 * @extends {Dialog}
 */
export class InventoryDialog<O extends LancerActorType> extends Dialog {
  constructor(
    readonly actor: AnyLancerActor,
    dialogData: DialogData = {},
    options: ApplicationOptions = {}
  ) {
    super(dialogData, options);
    this.actor = actor;
  }

  /* -------------------------------------------- */

  /** @override */
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      template: "systems/lancer/templates/window/inventory.hbs",
      width: 600,
      height: "auto",
      classes: ["lancer"],
    });
  }

  /** @override
   * Expose our data. Note that everything should be ready by now
   */
  async getData(): Promise<any> {
    // Fill out our categories
    let mm = await this.actor.data.data.derived.mm_promise;
    return {
      ...super.getData(),
      categories: this.populate_categories(mm) // this.populate_categories()
    };
  }


  /** @inheritdoc */
  render(force: any, options={}) {
    // Register the active Application with the referenced Documents, to get updates
    // @ts-ignore
    this.actor.apps[this.appId] = this;
    return super.render(force, options);
  }

  async close(options={}) {
    // @ts-ignore 0.8
    delete this.actor.apps[this.appId];
    // @ts-ignore 0.8
    return super.close(options);
  }

  // Get the appropriate cats for the given mm actor
  populate_categories(mm: AnyMMActor): FilledCategory[] {
    // Decide categories based on type
    let cats: FilledCategory[] = [];
    if(mm instanceof Mech) {
      cats = [
        {
          label: "Frames",
          items: mm.OwnedFrames
        },
        {
          label: "Weapons",
          items: mm.OwnedMechWeapons
        },
        {
          label: "Systems",
          items: mm.OwnedSystems
        },
        {
          label: "Mods",
          items: mm.OwnedWeaponMods
        },
        {
          label: "Statuses",
          items: mm.StatusesAndConditions
          // path: "mm.StatusesAndConditions"
        },
      ];
    } else {
      console.warn("Cannot yet show inventory for " + mm.Type);
    }
    return cats;
  }

  /**
   * @override
   * Activate event listeners using the prepared sheet HTML
   * @param html {HTMLElement}   The prepared HTML object ready to be rendered into the DOM
   */
  activateListeners(html: JQuery<HTMLElement>) {
    super.activateListeners(html);

    // Everything below here is only needed if the sheet is editable
    let getfunc = () => this.getData();
    let commitfunc = (_: any) => {};

    // Enable general controls, so items can be deleted and such
    HANDLER_activate_general_controls(html, getfunc, commitfunc);  
    
    // Enable ref dragging
    HANDLER_activate_ref_dragging(html);
    HANDLER_activate_native_ref_dragging(html);
    
    // Make refs clickable to open the item
    $(html).find(".ref.valid").on("click", HANDLER_openRefOnClick);
  }

  static async show_inventory<T>(
    actor: AnyLancerActor
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const dlg = new this(actor, {
        title: `${actor.name}'s inventory`,
        buttons: {},
        close: () => resolve(),
      });    // Register the active Application with the referenced Documents
      dlg.render(true);
    });
  }
}