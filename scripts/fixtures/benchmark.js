// The battles `npm run score` grades the inference on. Every one is a battle
// whose every answer is known: a recording our server ran, or a fuzz battle
// played from its number. The list is fixed so every run grades the same games
// and its totals mean the same thing; a battle is added here only when it
// catches something no battle here catches, with a word on what.
//
// `quick` is the slice an agent runs while it works; `full` is every battle,
// run before a merge.

const QUICK = new Set([
  'recordings/local/probes/gen9championsvgc2026regmc-1.log.json',
  'recordings/local/probes/gen9championsvgc2026regmc-23.log.json',
  'recordings/local/probes/gen9championsvgc2026regmc-302.log.json',
  'recordings/local/scripted/gen9championsvgc2026regmb-25.log.json',
  'recordings/local/scripted/gen9championsvgc2026regmb-79.log.json',
  'recordings/local/branched/gen9championsvgc2026regmb-199.log.json',
  'fuzz:101', 'fuzz:102', 'fuzz:103', 'fuzz:104', 'fuzz:105',
  'fuzz:106', 'fuzz:107', 'fuzz:108', 'fuzz:109', 'fuzz:110',
]);

const RECORDINGS = [
  'recordings/local/branched/gen9championsvgc2026regmb-144.log.json',
  'recordings/local/branched/gen9championsvgc2026regmb-145.log.json',
  'recordings/local/branched/gen9championsvgc2026regmb-199.log.json',
  'recordings/local/branched/gen9championsvgc2026regmb-200.log.json',
  'recordings/local/branched/gen9championsvgc2026regmb-46.log.json',
  'recordings/local/branched/gen9championsvgc2026regmb-69.log.json',
  'recordings/local/probes/gen9championsvgc2026regmc-1.log.json',
  'recordings/local/probes/gen9championsvgc2026regmc-12.log.json',
  'recordings/local/probes/gen9championsvgc2026regmc-23.log.json',
  'recordings/local/probes/gen9championsvgc2026regmc-281.log.json',
  'recordings/local/probes/gen9championsvgc2026regmc-295.log.json',
  'recordings/local/probes/gen9championsvgc2026regmc-296.log.json',
  'recordings/local/probes/gen9championsvgc2026regmc-302.log.json',
  'recordings/local/probes/gen9championsvgc2026regmc-303.log.json',
  'recordings/local/scripted/gen9championsvgc2026regmb-100.log.json',
  'recordings/local/scripted/gen9championsvgc2026regmb-111.log.json',
  'recordings/local/scripted/gen9championsvgc2026regmb-122.log.json',
  'recordings/local/scripted/gen9championsvgc2026regmb-23.log.json',
  'recordings/local/scripted/gen9championsvgc2026regmb-24.log.json',
  'recordings/local/scripted/gen9championsvgc2026regmb-25.log.json',
  'recordings/local/scripted/gen9championsvgc2026regmb-26.log.json',
  'recordings/local/scripted/gen9championsvgc2026regmb-34.log.json',
  'recordings/local/scripted/gen9championsvgc2026regmb-48.log.json',
  'recordings/local/scripted/gen9championsvgc2026regmb-70.log.json',
  'recordings/local/scripted/gen9championsvgc2026regmb-71.log.json',
  'recordings/local/scripted/gen9championsvgc2026regmb-75.log.json',
  'recordings/local/scripted/gen9championsvgc2026regmb-76.log.json',
  'recordings/local/scripted/gen9championsvgc2026regmb-78.log.json',
  'recordings/local/scripted/gen9championsvgc2026regmb-79.log.json',
];

// Fuzz battles 101-300: the seeds the fuzz baseline has always used.
const FUZZ = Array.from({ length: 200 }, (_, k) => `fuzz:${101 + k}`);

const BATTLES = [...RECORDINGS, ...FUZZ].map(id => ({ id, quick: QUICK.has(id) }));

module.exports = { BATTLES };
