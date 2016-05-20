import * as Config from '../openag-config.json';
import PouchDB from 'pouchdb';
import {html, forward, Effects, thunk} from 'reflex';
import {merge, tagged, tag, batch} from './common/prelude';
import * as ClassName from './common/classname';
import {cursor} from './common/cursor';
import * as Request from './common/request';
import * as Indexed from './common/indexed';
import * as Unknown from './common/unknown';
import * as Poll from './common/poll';
import {compose} from './lang/functional';
import * as EnvironmentalDataPoint from './environmental-data-point';
import * as CurrentRecipe from './environmental-data-point/recipe';
// @TODO do proper localization
import * as LANG from './environmental-data-point/lang';

const ORIGIN_LATEST = Config.db_origin_environmental_data_point_latest;
const RECIPE_START = 'recipe_start';
const RECIPE_END = 'recipe_end';
const AIR_TEMPERATURE = 'air_temperature';
const WATER_TEMPERATURE = 'water_temperature';

// Matching functions

const matcher = (key, value) => (object) =>
  object[key] === value;

const isRecipeStart = matcher('variable', RECIPE_START);
const isRecipeEnd = matcher('variable', RECIPE_END);
const isAirTemperature = matcher('variable', AIR_TEMPERATURE);
const isWaterTemperature = matcher('variable', WATER_TEMPERATURE);

// Actions and action tagging functions

const PollAction = action =>
  action.type === 'Ping' ?
  GetLatest :
  tagged('Poll', action);

const PongPoll = PollAction(Poll.Pong);
const MissPoll = PollAction(Poll.Miss);

const GetLatest = Request.Get(ORIGIN_LATEST);

const AirTemperatureAction = tag('AirTemperature');
const WaterTemperatureAction = tag('WaterTemperature');

const AddManyAirTemperatures = compose(
  AirTemperatureAction,
  EnvironmentalDataPoint.AddMany
);

const AddManyWaterTemperatures = compose(
  WaterTemperatureAction,
  EnvironmentalDataPoint.AddMany
);

const CurrentRecipeAction = tag('CurrentRecipe');
const CurrentRecipeStart = compose(CurrentRecipeAction, CurrentRecipe.Start);
const CurrentRecipeEnd = compose(CurrentRecipeAction, CurrentRecipe.End);

const Restore = value => ({
  type: 'Restore',
  value
});

// Init and update

export const init = () => {
  const [poll, pollFx] = Poll.init();
  const [currentRecipe, currentRecipeFx] = CurrentRecipe.init();

  const [airTemperature, airTemperatureFx] = EnvironmentalDataPoint.init(
    AIR_TEMPERATURE,
    LANG[AIR_TEMPERATURE]
  );

  const [waterTemperature, waterTemperatureFx] = EnvironmentalDataPoint.init(
    WATER_TEMPERATURE,
    LANG[WATER_TEMPERATURE]
  );

  return [
    {
      currentRecipe,
      poll,
      airTemperature,
      waterTemperature
    },
    Effects.batch([
      currentRecipeFx.map(CurrentRecipeAction),
      pollFx.map(PollAction),
      airTemperatureFx.map(AirTemperatureAction),
      waterTemperatureFx.map(WaterTemperatureAction),
      Effects.receive(GetLatest)
    ])
  ];
};

const updatePoll = cursor({
  get: model => model.poll,
  set: (model, poll) => merge(model, {poll}),
  update: Poll.update,
  tag: PollAction
});

const updateAirTemperature = cursor({
  get: model => model.airTemperature,
  set: (model, airTemperature) => merge(model, {airTemperature}),
  update: EnvironmentalDataPoint.update,
  tag: AirTemperatureAction
});

const updateWaterTemperature = cursor({
  get: model => model.waterTemperature,
  set: (model, waterTemperature) => merge(model, {waterTemperature}),
  update: EnvironmentalDataPoint.update,
  tag: WaterTemperatureAction
});

const updateCurrentRecipe = cursor({
  get: model => model.currentRecipe,
  set: (model, currentRecipe) => merge(model, {currentRecipe}),
  update: CurrentRecipe.update,
  tag: CurrentRecipeAction
});

const readDataPointFromRow = row => row.value;
const readDataPoints = (record, predicate) =>
  record.rows
    .map(readDataPointFromRow)
    .filter(predicate);

// Read most recent data point from record set.
// Filter by predicate. Get most recent.
// Returns most recent data point matching predicate or null.
const readMostRecentDataPoint = (record, predicate) =>
  record.rows
    .map(readDataPointFromRow)
    .filter(predicate)
    .shift();

const restore = (model, record) =>
  batch(update, model, [
    AddManyAirTemperatures(readDataPoints(
      record,
      isAirTemperature
    )),
    AddManyWaterTemperatures(readDataPoints(
      record,
      isWaterTemperature
    )),
    CurrentRecipeStart(readMostRecentDataPoint(
      record,
      isRecipeStart
    ))
  ]);

const gotOk = (model, record) =>
  batch(update, model, [
    Restore(record),
    PongPoll
  ]);

const gotError = (model, error) =>
  update(model, MissPoll);

// Is the problem that I'm not mapping the returned effect?
export const update = (model, action) =>
  action.type === 'CurrentRecipe' ?
  updateCurrentRecipe(model, action.source) :
  action.type === 'AirTemperature' ?
  updateAirTemperature(model, action.source) :
  action.type === 'WaterTemperature' ?
  updateWaterTemperature(model, action.source) :
  action.type === 'Poll' ?
  updatePoll(model, action.source) :
  action.type === 'Get' ?
  Request.get(model, action.url) :
  action.type === 'Got' ?
  (
    action.result.isOk ?
    gotOk(model, action.result.value) :
    gotError(model, action.result.error)
  ) :
  action.type === 'Restore' ?
  restore(model, action.value) :
  Unknown.update(model, action);

export const view = (model, address) =>
  html.div({
    className: 'dash-main'
  }, [
    thunk(
      'water-temperature',
      EnvironmentalDataPoint.view,
      model.waterTemperature,
      forward(address, WaterTemperatureAction)
    ),
    thunk(
      'air-temperature',
      EnvironmentalDataPoint.view,
      model.airTemperature,
      forward(address, AirTemperatureAction)
    )
  ]);
