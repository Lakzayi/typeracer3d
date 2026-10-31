/* Theme registry — one racing world per theme. A theme only needs a
 * create(world, { racers, seed, timeOfDay }) factory returning
 * { group, vehicles, update(dt, racersState), finishZ, setTimeOfDay }. */

import * as car from './car.js';
import * as boat from './boat.js';
import * as horse from './horse.js';
import * as rocket from './rocket.js';

export const THEMES = {
  car: {
    id: 'car',
    name: 'Street Race',
    icon: '🏎️',
    status: 'live',
    blurb: 'Asphalt sprint against real TypeRacer racers',
    create: car.create,
  },
  boat: {
    id: 'boat',
    name: 'River Rapids',
    icon: '🚤',
    status: 'live',
    blurb: 'Canyon river sprint — buoys, docks and spray',
    create: boat.create,
  },
  horse: {
    id: 'horse',
    name: 'Wild West Ride',
    icon: '🐎',
    status: 'live',
    blurb: 'Dusty trail gallop with campfires at night',
    create: horse.create,
  },
  rocket: {
    id: 'rocket',
    name: 'Orbit Dash',
    icon: '🚀',
    status: 'live',
    blurb: 'Low-orbit drag strip past the rings',
    create: rocket.create,
  },
};
