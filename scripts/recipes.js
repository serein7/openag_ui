import {html, forward, Effects, Task, thunk} from 'reflex';
import * as Config from '../openag-config.json';
import PouchDB from 'pouchdb-browser';
import * as Template from './common/stache';
import * as Database from './common/database';
import * as Indexed from './common/indexed';
import * as Unknown from './common/unknown';
import * as Result from './common/result';
import * as Banner from './common/banner';
import {merge, tag, tagged, batch} from './common/prelude';
import * as Modal from './common/modal';
import {cursor} from './common/cursor';
import {classed, toggle} from './common/attr';
import {localize} from './common/lang';
import {compose, constant} from './lang/functional';
import * as RecipesForm from './recipes/form';
import * as Recipe from './recipe';

const DB = new PouchDB(Config.recipes.local);
// Export for debugging
window.RecipesDB = DB;

const getPouchID = Indexed.getter('_id');

// Actions and tagging functions

const TagIndexed = source => ({
  type: 'Indexed',
  source
});

const Activate = compose(TagIndexed, Indexed.Activate);

const TagModal = tag('Modal');

const TagBanner = source => ({
  type: 'Banner',
  source
});

const AlertRefreshable = compose(TagBanner, Banner.AlertRefreshable);
const AlertDismissable = compose(TagBanner, Banner.AlertDismissable);
const FailRecipeStart = AlertDismissable("Blarg! Couldn't start recipe");

const RecipesFormAction = action =>
  action.type === 'Back' ?
  ActivatePanel(null) :
  action.type === 'Submitted' ?
  Put(action.recipe) :
  tagged('RecipesForm', action);

const RecipeAction = (id, action) =>
  action.type === 'Activate' ?
  StartByID(id) :
  ({
    type: 'Recipe',
    id,
    source: action
  });

const ByID = id => action =>
  RecipeAction(id, action);


// This action handles information restored from the parent.
export const Configure = origin => ({
  type: 'Configure',
  origin
});

// Restore recipes in-memory from PouchDB
const RestoreRecipes = {type: 'RestoreRecipes'};

// Response from recipe restore
const RestoredRecipes = result => ({
  type: 'RestoredRecipes',
  result
});

const Put = Database.Put;
const Putted = Database.Putted;

// Request database sync
const Sync = {type: 'Sync'};
// Confirm sync.
const Synced = Database.Synced;

export const Open = TagModal(Modal.Open);
export const Close = TagModal(Modal.Close);

export const StartByID = id => ({
  type: 'StartByID',
  id
});

export const RequestStart = value => ({
  type: 'RequestStart',
  value
});

const ActivatePanel = id => ({
  type: 'ActivatePanel',
  id
});

// An action representing "no further action".
const NoOp = Indexed.NoOp;

// Model, update and init

export const init = () => {
  const [recipesForm, recipesFormFx] = RecipesForm.init();
  const [banner, bannerFx] = Banner.init();

  return [
    {
      active: null,
      activePanel: null,
      isOpen: false,
      // Origin url
      origin: null,
      // Build an array of ordered recipe IDs
      order: [],
      // Index all recipes by ID
      entries: {},
      recipesForm,
      banner
    },
    Effects.batch([
      recipesFormFx.map(RecipesFormAction),
      bannerFx.map(TagBanner)
    ])
  ];
};

const updateIndexed = cursor({
  update: Indexed.update,
  tag: TagIndexed
});

const updateModal = cursor({
  update: Modal.update,
  tag: TagModal
});

const updateBanner = cursor({
  get: model => model.banner,
  set: (model, banner) => merge(model, {banner}),
  update: Banner.update,
  tag: TagBanner
})

const updateRecipesForm = cursor({
  get: model => model.recipesForm,
  set: (model, recipesForm) => merge(model, {recipesForm}),
  update: RecipesForm.update,
  tag: RecipesFormAction
});

const updateByID = (model, id, action) =>
  Indexed.updateWithID(Recipe.update, ByID(id), model, id, action);

const sync = model => {
  if (model.origin) {
    const origin = templateRecipesDatabase(model.origin);
    return [model, Database.sync(DB, origin).map(Synced)];
  }
  else {
    // @TODO this case should never happen, but perhaps we want to notify the
    // user something went wrong?
    console.warn('Recipe database sync attempted before origin was added to model');
    return [model, Effects.none];
  }
}

const syncedOk = model =>
  update(model, RestoreRecipes);

const syncedError = model => {
  const message = localize("Couldn't sync with the cloud. Using local database.");
  return update(model, AlertDismissable(message));
}

const restoredRecipes = Result.updater(
  (model, recipes) => [
    merge(model, {
      // Build an array of ordered recipe IDs
      order: recipes.map(getPouchID),
      // Index all recipes by ID
      entries: Indexed.indexWith(recipes, getPouchID)
    }),
    Effects.none
  ],
  (model, error) => {
    const message = localize("Hmm, couldn't read from your browser's database.");
    return update(model, AlertRefreshable(message));
  }
);

// Activate recipe by id
const startByID = (model, id) => {
  const [next, fx] = update(model, Activate(id));

  return [
    next,
    Effects.batch([
      fx,
      Effects.receive(RequestStart(merge({}, model.entries[id])))
    ])
  ];
}

const activatePanel = (model, id) =>
  [merge(model, {activePanel: id}), Effects.none];

const put = (model, recipe) => {
  // Insert recipe into in-memory model.
  // @TODO perhaps we should do this after succesful put.
  const next = Indexed.add(model, recipe._id, recipe);
  // Then attempt to store it in DB.
  return [next, Database.put(DB, recipe).map(Putted)];
}

const putted = (model, result) =>
  result.isOk ?
  [model, Effects.none] :
  [model, Effects.none];

const configure = (model, origin) => {
  const next = merge(model, {origin});

  return batch(update, next, [
    RestoreRecipes,
    Sync
  ]);
}

export const update = (model, action) =>
  action.type === 'Indexed' ?
  updateIndexed(model, action.source) :
  action.type === 'Banner' ?
  updateBanner(model, action.source) :
  action.type === 'RecipesForm' ?
  updateRecipesForm(model, action.source) :
  action.type === 'Modal' ?
  updateModal(model, action.source) :
  action.type === 'NoOp' ?
  [model, Effects.none] :
  action.type === 'Put' ?
  put(model, action.value) :
  action.type === 'Putted' ?
  putted(model, action.result) :
  action.type === 'RestoreRecipes' ?
  [model, Database.restore(DB).map(RestoredRecipes)] :
  action.type === 'RestoredRecipes' ?
  restoredRecipes(model, action.result) :
  action.type === 'StartByID' ?
  startByID(model, action.id) :
  action.type === 'ActivatePanel' ?
  activatePanel(model, action.id) :
  action.type === 'Sync' ?
  sync(model) :
  action.type === 'Synced' ?
  (
    action.result.isOk ?
    syncedOk(model) :
    syncedError(model)
  ) :
  action.type === 'Recipe' ?
  updateByID(model, action.id, action.source) :
  action.type === 'Configure' ?
  configure(model, action.origin) :
  Unknown.update(model, action);

// View

export const view = (model, address) =>
  html.div({
    id: 'recipes-modal',
    className: 'modal',
    hidden: toggle(!model.isOpen, 'hidden')
  }, [
    html.div({
      className: 'modal-overlay',
      onClick: () => address(Close)
    }),
    html.dialog({
      className: classed({
        'modal-main': true
      }),
      open: toggle(model.isOpen, 'open')
    }, [
      html.div({
        className: classed({
          'panels--main': true,
          'panels--lv1': model.activePanel !== null
        })
      }, [
        html.div({
          className: 'panel--main panel--lv0'
        }, [
          html.header({
            className: 'panel--header'
          }, [
            html.h1({
              className: 'panel--title'
            }, [
              localize('Recipes')
            ]),
            html.div({
              className: 'panel--nav-right'
            }, [
              html.a({
                className: 'recipes-create-icon',
                onClick: () => address(ActivatePanel('form'))
              })
            ])
          ]),
          thunk(
            'recipes-banner',
            Banner.view,
            model.banner,
            forward(address, TagBanner),
            'panel--banner recipes--banner'
          ),
          html.div({
            className: 'panel--content'
          }, [
            html.div({
              className: classed({
                'recipes-main': true,
                'recipes-main-close': !model.isOpen
              })
            }, model.order.map(id => thunk(
              id,
              Recipe.view,
              model.entries[id],
              forward(address, ByID(id))
            )))
          ])
        ]),
        thunk(
          'recipes-form',
          RecipesForm.view,
          model.recipesForm,
          forward(address, RecipesFormAction),
          model.activePanel === 'form'
        )
      ])
    ])
  ]);

// Helpers

const templateRecipesDatabase = origin =>
  Template.render(Config.recipes.origin, {
    origin_url: origin
  });