/**
 * Encoreable's admission contract, shared by Node and the extension.
 *
 * These are product capabilities, not replacement simulator rules. Showdown
 * still validates teams and supplies every stat and mechanic. In particular,
 * admitting a known-team recording never admits its hidden-team inference.
 */

export const SIMULATOR_PIN = 'a5df8274e85b0889bf2a9b3422a08b39732374fc';

const CAPABILITIES = Object.freeze([
  'recording', 'exactReplay', 'branching', 'rngControl',
  'knownTeamReconstruction', 'openSpreadInference', 'closedInference',
]);

function profile(formatid, mod, gameType, statModel, inference = false) {
  return Object.freeze({
    formatid, gen: 9, mod, gameType, statModel,
    capabilities: Object.freeze(Object.fromEntries(CAPABILITIES.map(name => [name,
      !['knownTeamReconstruction', 'openSpreadInference', 'closedInference'].includes(name) || inference,
    ]))),
    // A true gate describes an admitted input path, not completeness of search.
    inferenceStatus: inference ? 'partial' : 'unsupported',
    closedInferenceStatus: inference ? 'assumed-sets; candidate inference incomplete' : 'unsupported',
  });
}

export const FORMAT_PROFILES = Object.freeze([
  profile('gen9championsvgc2026regmc', 'champions', 'doubles', 'champions-sp', true),
  profile('gen9championsvgc2026regmb', 'championsregmb', 'doubles', 'champions-sp', true),
  profile('gen9championsvgc2026regmcbo3', 'champions', 'doubles', 'champions-sp', true),
  profile('gen9championsvgc2026regmbbo3', 'championsregmb', 'doubles', 'champions-sp', true),
  // Custom Game's unbounded levels/budgets are deliberately outside inference.
  profile('gen9championsdoublescustomgame', 'champions', 'doubles', 'champions-sp'),
  profile('gen9ou', 'gen9', 'singles', 'standard-ev-iv'),
]);

const byId = new Map(FORMAT_PROFILES.map(p => [p.formatid, p]));

/** Exact simulator IDs only; no generation, tier or custom-rule fallback. */
export function formatProfile(formatid) {
  if (typeof formatid !== 'string' || !byId.has(formatid)) {
    throw new Error(`Unsupported format "${String(formatid ?? '')}". Encoreable requires an explicitly supported format ID; no generation or stat-model fallback is applied.`);
  }
  return byId.get(formatid);
}

export function assertFormatCapability(formatid, capability, actual = {}) {
  const p = formatProfile(formatid);
  if (!CAPABILITIES.includes(capability)) throw new Error(`Unknown format capability "${capability}"`);
  for (const key of ['gen', 'mod', 'gameType', 'statModel']) {
    if (actual[key] !== undefined && actual[key] !== p[key]) {
      throw new Error(`Format ${p.formatid}: ${key} ${String(actual[key])} disagrees with supported ${p[key]}`);
    }
  }
  if (!p.capabilities[capability]) {
    throw new Error(`Unsupported capability ${capability} for ${p.formatid} (${p.statModel}). Known-team replay and branching do not establish replay reconstruction or hidden-team inference.`);
  }
  return p;
}

/** Parse the start payload, independent of JSON whitespace or property order. */
export function profileFromInputLog(raw, capability = 'exactReplay') {
  const lines = Array.isArray(raw) ? raw : String(raw ?? '').split('\n');
  const starts = lines.filter(line => typeof line === 'string' && /^>start\s/.test(line));
  if (starts.length !== 1) throw new Error('input log must contain exactly one >start payload');
  let options;
  try { options = JSON.parse(starts[0].replace(/^>start\s+/, '')); }
  catch { throw new Error('input log has invalid >start JSON'); }
  if (!options || typeof options !== 'object' || Array.isArray(options) || typeof options.formatid !== 'string') {
    throw new Error('>start requires an explicit formatid');
  }
  if (['format', 'gameType', 'gen', 'mod', 'ruleTable', 'customRules'].some(key => Object.hasOwn(options, key))) {
    throw new Error('>start overrides of the supported format profile are unsupported');
  }
  return assertFormatCapability(options.formatid, capability);
}

/** Check replay facts before looking up species, sets, or any inference domain. */
export function profileFromObservation(formatid, lines, capability = 'knownTeamReconstruction') {
  const p = assertFormatCapability(formatid, capability);
  for (const line of lines || []) {
    const [blank, kind, value] = String(line).split('|');
    if (blank || !['gen', 'gametype', 'tier'].includes(kind)) continue;
    if (kind === 'gen' && Number(value) !== p.gen) throw new Error(`Replay generation ${value} disagrees with ${formatid}`);
    if (kind === 'gametype' && value !== p.gameType) throw new Error(`Replay game type ${value} disagrees with ${formatid}`);
    if (kind === 'tier') {
      // A Bo3 room publishes the base game's tier with the Bo3 suffix.
      const tierId = value.replace(/\s*\(Bo\d+\)\s*$/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (tierId !== p.formatid.replace(/bo3$/, '')) throw new Error(`Replay tier ${value} disagrees with ${formatid}`);
    }
  }
  return p;
}
