/* The 7 game modes — single source of truth shared by the menu, the race
 * controller, the HUD badges/results and the local-stats panel. */

export const MODES = {
  classic: { icon: '🏁', name: 'Classic', desc: 'race real TypeRacer racers' },
  single: { icon: '🕹️', name: 'Single', desc: 'solo time trial on a real quote' },
  practice: { icon: '🧘', name: 'Practice', desc: 'Monkeytype quotes, no pressure' },
  death: { icon: '💀', name: 'Death', desc: 'one mistake ends the run' },
  bot: { icon: '🤖', name: 'Bot', desc: 'race bots you configure' },
  drill: { icon: '🎯', name: 'Drill', desc: 'words · numbers · code' },
  custom: { icon: '📝', name: 'Custom', desc: 'race your own text' },
};

/* modes with no opponents on track (1 vehicle, no bot pace) */
export const SOLO_MODES = ['single', 'practice', 'drill', 'custom'];

/* modes replaying a real (or bot-battle) race id that a challenge link can share */
export const SHAREABLE_RACE_MODES = ['classic', 'single', 'death', 'bot'];

/* modes that fetch real TypeRacer data (username row is relevant there) */
export const REAL_DATA_MODES = ['classic', 'single', 'death'];

export const MODE_ICONS = Object.fromEntries(
  Object.entries(MODES).map(([id, m]) => [id, m.icon])
);
