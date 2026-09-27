/** Voices registry (docs/VOICES.md, contract v1): the closed vocabulary the collector validates feedback, surveys and
 *  ratings against, keyed by project. A project absent here cannot be admitted to COLLECT_VOICE_PROJECTS.
 *
 *  Per project:
 *    routes   the feedback `route` vocabulary (the screen the player was on; not the product-event route list)
 *    surveys  survey id -> { subject: 'none' | 'puzzle', comment: <bool>, meta: { key: { required, values } },
 *                            questions: [{ id, type: 'one' | 'many', required, max (many only), options }] }
 *
 *  Changing an option list changes what a stored answer can mean: add a new survey id (alibi-taste-2) instead of
 *  editing a published one. The read model counts only the options listed here. */
const deepFreeze = value => {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) deepFreeze(item); Object.freeze(value); }
  return value;
};

/** Alibi's thirteen puzzle families and six difficulty tiers, as the client sends them in rating `meta`. */
export const ALIBI_FAMILIES = Object.freeze(['bridges', 'scene', 'dossier', 'witness', 'sudoku', 'nonogram', 'binary', 'futoshiki',
  'lightup', 'tents', 'aquarium', 'network', 'trail']);
export const ALIBI_TIERS = Object.freeze(['gentle', 'steady', 'tricky', 'expert', 'master', 'grandmaster']);

export const VOICE_REGISTRY = deepFreeze({
  alibi: {
    routes: ['home', 'puzzle', 'castle', 'quiet-wing', 'games', 'settings', 'other'],
    surveys: {
      'alibi-taste-1': {
        subject: 'none', comment: true, meta: {},
        questions: [
          { id: 'often', type: 'one', required: true, options: ['daily', 'few-a-week', 'weekly', 'now-and-then', 'first-time'] },
          { id: 'more', type: 'many', required: false, max: 5,
            options: [...ALIBI_FAMILIES, 'archive-heist', 'borough', 'duel', 'block-cabinet', 'gardens', 'casebooks', 'castle'] },
          { id: 'difficulty', type: 'one', required: true, options: ['too-easy', 'mostly-right', 'too-hard', 'mixed'] },
          { id: 'tiers', type: 'many', required: false, max: 3, options: [...ALIBI_TIERS] },
          { id: 'next', type: 'one', required: false, options: ['more-puzzles', 'harder-puzzles', 'new-families', 'more-story', 'club-games', 'polish'] },
          { id: 'feel', type: 'one', required: false, options: ['love-it', 'fine', 'cluttered', 'confusing'] },
          { id: 'recommend', type: 'one', required: false, options: ['definitely', 'probably', 'not-sure', 'probably-not'] },
        ],
      },
      'puzzle-rating': {
        subject: 'puzzle', comment: false,
        meta: { family: { required: true, values: [...ALIBI_FAMILIES] }, tier: { required: true, values: [...ALIBI_TIERS] } },
        questions: [
          { id: 'difficulty', type: 'one', required: true, options: ['too-easy', 'just-right', 'too-hard'] },
          // The "More like this" heart: present means chosen, absent means not chosen.
          { id: 'more', type: 'one', required: false, options: ['yes'] },
        ],
      },
    },
  },
});

/** The rating survey the read model rolls up per subject, family and tier (docs/VOICES.md section 3). */
export const RATING_SURVEY = 'puzzle-rating';

/** The project's voice registry entry, or null for a project that has none. */
export const voiceRegistry = id => typeof id === 'string' && Object.hasOwn(VOICE_REGISTRY, id) ? VOICE_REGISTRY[id] : null;
