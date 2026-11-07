// The battles `npm run score` grades the inference on. Every one is a battle
// whose every answer is known: a recording our server ran, a fuzz battle
// played from its number, or a mimic battle - a real public game played again
// with Stat Points we chose. The list is fixed so every run grades the same games
// and its totals mean the same thing. The mimic battles are a sample of real
// play; any other battle is added here only when it catches something no
// battle here catches, with a word on what.
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
  'fuzz:1005', 'fuzz:1009', 'fuzz:1016',
  'mimic:gen9championsvgc2026regmcbo3-2706771017',
  'mimic:gen9championsvgc2026regmcbo3-2706680632',
  'mimic:gen9championsvgc2026regmcbo3-2706851242',
  'mimic:gen9championsvgc2026regmcbo3-2706949682',
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

// Mimic battles: 100 game-1s of Reg M-C Bo3 sets uploaded on 2026-10-30
// (`npm run crawl -- --pick 100 --day 2026-10-30`), each in
// recordings/showdown/others-open/.
const MIMIC = [
  'mimic:gen9championsvgc2026regmcbo3-2706771017',
  'mimic:gen9championsvgc2026regmcbo3-2706680632',
  'mimic:gen9championsvgc2026regmcbo3-2706851242',
  'mimic:gen9championsvgc2026regmcbo3-2706949682',
  'mimic:gen9championsvgc2026regmcbo3-2706916493',
  'mimic:gen9championsvgc2026regmcbo3-2706688609',
  'mimic:gen9championsvgc2026regmcbo3-2706544797',
  'mimic:gen9championsvgc2026regmcbo3-2706577848',
  'mimic:gen9championsvgc2026regmcbo3-2707007934',
  'mimic:gen9championsvgc2026regmcbo3-2707023527',
  'mimic:gen9championsvgc2026regmcbo3-2706968287',
  'mimic:gen9championsvgc2026regmcbo3-2706983985',
  'mimic:gen9championsvgc2026regmcbo3-2706727043',
  'mimic:gen9championsvgc2026regmcbo3-2706540958',
  'mimic:gen9championsvgc2026regmcbo3-2706523001',
  'mimic:gen9championsvgc2026regmcbo3-2706985744',
  'mimic:gen9championsvgc2026regmcbo3-2706798245',
  'mimic:gen9championsvgc2026regmcbo3-2706936639',
  'mimic:gen9championsvgc2026regmcbo3-2707018986',
  'mimic:gen9championsvgc2026regmcbo3-2706509511',
  'mimic:gen9championsvgc2026regmcbo3-2706578290',
  'mimic:gen9championsvgc2026regmcbo3-2706991186',
  'mimic:gen9championsvgc2026regmcbo3-2706684409',
  'mimic:gen9championsvgc2026regmcbo3-2706796211',
  'mimic:gen9championsvgc2026regmcbo3-2706723174',
  'mimic:gen9championsvgc2026regmcbo3-2706539114',
  'mimic:gen9championsvgc2026regmcbo3-2706503558',
  'mimic:gen9championsvgc2026regmcbo3-2706717448',
  'mimic:gen9championsvgc2026regmcbo3-2706938927',
  'mimic:gen9championsvgc2026regmcbo3-2706608717',
  'mimic:gen9championsvgc2026regmcbo3-2706916905',
  'mimic:gen9championsvgc2026regmcbo3-2707002371',
  'mimic:gen9championsvgc2026regmcbo3-2706533381',
  'mimic:gen9championsvgc2026regmcbo3-2706961122',
  'mimic:gen9championsvgc2026regmcbo3-2706909653',
  'mimic:gen9championsvgc2026regmcbo3-2706927459',
  'mimic:gen9championsvgc2026regmcbo3-2706962613',
  'mimic:gen9championsvgc2026regmcbo3-2706707161',
  'mimic:gen9championsvgc2026regmcbo3-2706930319',
  'mimic:gen9championsvgc2026regmcbo3-2706794900',
  'mimic:gen9championsvgc2026regmcbo3-2706743441',
  'mimic:gen9championsvgc2026regmcbo3-2706670240',
  'mimic:gen9championsvgc2026regmcbo3-2706817003',
  'mimic:gen9championsvgc2026regmcbo3-2707017405',
  'mimic:gen9championsvgc2026regmcbo3-2706958429',
  'mimic:gen9championsvgc2026regmcbo3-2706780495',
  'mimic:gen9championsvgc2026regmcbo3-2707003882',
  'mimic:gen9championsvgc2026regmcbo3-2706662656',
  'mimic:gen9championsvgc2026regmcbo3-2706966975',
  'mimic:gen9championsvgc2026regmcbo3-2706745137',
  'mimic:gen9championsvgc2026regmcbo3-2706953767',
  'mimic:gen9championsvgc2026regmcbo3-2706943807',
  'mimic:gen9championsvgc2026regmcbo3-2706843884',
  'mimic:gen9championsvgc2026regmcbo3-2706989992',
  'mimic:gen9championsvgc2026regmcbo3-2706758304',
  'mimic:gen9championsvgc2026regmcbo3-2706542953',
  'mimic:gen9championsvgc2026regmcbo3-2706957621',
  'mimic:gen9championsvgc2026regmcbo3-2706960648',
  'mimic:gen9championsvgc2026regmcbo3-2706647431',
  'mimic:gen9championsvgc2026regmcbo3-2706995939',
  'mimic:gen9championsvgc2026regmcbo3-2707009294',
  'mimic:gen9championsvgc2026regmcbo3-2706895711',
  'mimic:gen9championsvgc2026regmcbo3-2706689647',
  'mimic:gen9championsvgc2026regmcbo3-2706850041',
  'mimic:gen9championsvgc2026regmcbo3-2706698546',
  'mimic:gen9championsvgc2026regmcbo3-2706637790',
  'mimic:gen9championsvgc2026regmcbo3-2706780588',
  'mimic:gen9championsvgc2026regmcbo3-2706906590',
  'mimic:gen9championsvgc2026regmcbo3-2706827249',
  'mimic:gen9championsvgc2026regmcbo3-2706584453',
  'mimic:gen9championsvgc2026regmcbo3-2706756200',
  'mimic:gen9championsvgc2026regmcbo3-2706811914',
  'mimic:gen9championsvgc2026regmcbo3-2706956206',
  'mimic:gen9championsvgc2026regmcbo3-2706792032',
  'mimic:gen9championsvgc2026regmcbo3-2706680707',
  'mimic:gen9championsvgc2026regmcbo3-2706999080',
  'mimic:gen9championsvgc2026regmcbo3-2706750121',
  'mimic:gen9championsvgc2026regmcbo3-2706716798',
  'mimic:gen9championsvgc2026regmcbo3-2706513250',
  'mimic:gen9championsvgc2026regmcbo3-2706819244',
  'mimic:gen9championsvgc2026regmcbo3-2707004844',
  'mimic:gen9championsvgc2026regmcbo3-2706771605',
  'mimic:gen9championsvgc2026regmcbo3-2706558323',
  'mimic:gen9championsvgc2026regmcbo3-2706509811',
  'mimic:gen9championsvgc2026regmcbo3-2707012784',
  'mimic:gen9championsvgc2026regmcbo3-2706907659',
  'mimic:gen9championsvgc2026regmcbo3-2706955285',
  'mimic:gen9championsvgc2026regmcbo3-2706776573',
  'mimic:gen9championsvgc2026regmcbo3-2706771294',
  'mimic:gen9championsvgc2026regmcbo3-2706795578',
  'mimic:gen9championsvgc2026regmcbo3-2706767665',
  'mimic:gen9championsvgc2026regmcbo3-2706653207',
  'mimic:gen9championsvgc2026regmcbo3-2706998556',
  'mimic:gen9championsvgc2026regmcbo3-2707006493',
  'mimic:gen9championsvgc2026regmcbo3-2706511879',
  'mimic:gen9championsvgc2026regmcbo3-2707018556',
  'mimic:gen9championsvgc2026regmcbo3-2707014534',
  'mimic:gen9championsvgc2026regmcbo3-2706540698',
  'mimic:gen9championsvgc2026regmcbo3-2707020388',
  'mimic:gen9championsvgc2026regmcbo3-2706560352',
];

// Battles that catch a planted bug no battle above caught (`npm run mutate`,
// sample 270 of seed 1 at 7f44a5f, hunted on fuzz 1001-1030): each named
// with the mutants it catches and how.
const PLANTED = [
  'fuzz:1002', // speed.mjs:387 ===→!==, speed.mjs:159 and 163 deleted, speed.mjs:417 ===→!==: keeps more spreads
  'fuzz:1005', // evidence.mjs:1006 ===→!== removes a real spread
  'fuzz:1008', // knowledge.mjs:759 <→<= keeps more spreads; infer.mjs:326 ===→!==, knowledge.mjs:433 + 1→+ 0: keeps more
  'fuzz:1009', // infer.mjs:553, infer.mjs:563 !==→===, infer.mjs:780, knowledge.mjs:782 deleted: gives up; evidence.mjs:676 deleted, knowledge.mjs:433 + 1→+ 0: keeps more
  'fuzz:1012', // speed.mjs:404 deleted, speed.mjs:404 !==→===: crashes; evidence.mjs:3673 deleted: keeps more
  'fuzz:1013', // evidence.mjs:1029 &&→||, evidence.mjs:1086 &&→||: crashes
  'fuzz:1016', // evidence.mjs:751 deleted removes a real spread; evidence.mjs:2396 deleted, evidence.mjs:721 drop !, knowledge.mjs:433 + 1→+ 0: keeps more
  'fuzz:1020', // evidence.mjs:3488 ||→&&, evidence.mjs:3499 deleted, evidence.mjs:252 deleted: gives up
  // Hunted on fuzz 1031-1090 at d2c6742, among the 172 the first hunt left:
  'fuzz:1040', // knowledge.mjs:477 deleted: crashes; speed.mjs:587 deleted, knowledge.mjs:305 deleted remove a real spread; knowledge.mjs:309 deleted: crashes
  'fuzz:1042', // evidence.mjs:3517 drop !: gives up
  // Sample 270 of seed 2 at 9a4c807, its four that only did better hunted on fuzz 1001-1030:
  'fuzz:1001', // evidence.mjs:3652 &&→|| removes a real spread; evidence.mjs:3673 deleted: keeps more
  // and the 171 that changed nothing on the quick slice, hunted on fuzz 1001-1030:
  'fuzz:1007', // knowledge.mjs:679 deleted: crashes
  // and the 162 those left, hunted on fuzz 1031-1090:
  'fuzz:1043', // evidence.mjs:1265 deleted: keeps more spreads
  'fuzz:1054', // infer.mjs:243 true→false: gives up
  'fuzz:1061', // evidence.mjs:161 &&→||, speed.mjs:655 <→<=: remove a real spread
  'fuzz:1070', // evidence.mjs:1780 deleted, evidence.mjs:83 <=→<: remove a real spread
  'fuzz:1086', // knowledge.mjs:632 <→<= keeps more spreads
];

// Games a corpus sweep found the rebuild or the inference failing on
// (`npm run score -- --mimic-dir`), each in recordings/showdown/others-open/
// and named with what it exposed.
const SWEPT = [
  'mimic:gen9championsvgc2026regmcbo3-2701697350', // 2026-10-20: Acupressure on the partner, a target the rebuild never offered
  'mimic:gen9championsvgc2026regmcbo3-2701439305', // 2026-10-20: a hit to exactly 1 HP with the Focus Sash kept, probed apart from the sash's roll
  'mimic:gen9championsvgc2026regmcbo3-2701411559', // 2026-10-20: a flinched Follow Me found under the first search's dice before the budget ran out
  'mimic:gen9championsvgc2026regmcbo3-2698960530', // 2026-10-15: Dire Claw's status pick, and an HP two hits back
  'mimic:gen9championsvgc2026regmcbo3-2699035058', // 2026-10-15: a Giga Drain through the Substitute an Orthworm's Shed Tail made
  'mimic:gen9championsvgc2026regmcbo3-2708011359', // 2026-11-02: Eelevate's boost after a knockout names Mega Eelektross's highest stat
  'mimic:gen9championsvgc2026regmcbo3-2707900624', // 2026-11-02: a Speed that reorders an earlier turn moves the dice handed on from it
];

const BATTLES = [...RECORDINGS, ...FUZZ, ...MIMIC, ...PLANTED, ...SWEPT].map(id => ({ id, quick: QUICK.has(id) }));

module.exports = { BATTLES };
