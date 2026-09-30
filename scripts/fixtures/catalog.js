'use strict';

/**
 * Hand-set templates and written reasons for `npm run catalog`, keyed by effect id.
 * An effect with no entry gets the auto template. The known actor and the filler are named here.
 */
module.exports = {
  'move:counter': {
    templates: [{
      role: 'user-hidden',
      p1: [
        { species: 'Snorlax', gender: 'M', ability: 'Thick Fat', item: '', nature: 'Serious',
          evs: { hp: 20, atk: 10, def: 20, spa: 0, spd: 16, spe: 0 }, moves: ['Body Slam', 'Splash'] },
        'filler_p1',
        'filler_p1',
      ],
      p2: [
        { species: 'Hariyama', gender: 'M', ability: 'Guts', item: '', nature: 'Serious', moves: ['Counter', 'Splash'] },
        'filler_p2',
        'filler_p2',
      ],
      turns: [
        { p1: 'move bodyslam 1, move splash', p2: 'move counter, move splash' },
        { p1: 'move splash, move splash', p2: 'move splash, move splash' },
      ],
      control: {
        p2Moves: ['Splash', 'Splash'],
        turns: [
          { p1: 'move bodyslam 1, move splash', p2: 'move splash, move splash' },
          { p1: 'move splash, move splash', p2: 'move splash, move splash' },
        ],
      },
      dice: [['hit', 'nocrit', 'roll8', 'noproc']],
      hpLevels: false,
      why: 'Counter needs a physical hit taken first; the known actor gives it one.',
    }],
  },

  'move:mirrorcoat': {
    templates: [{
      role: 'user-hidden',
      p1: [
        { species: 'Snorlax', gender: 'M', ability: 'Thick Fat', item: '', nature: 'Serious',
          evs: { hp: 20, atk: 10, def: 20, spa: 0, spd: 16, spe: 0 }, moves: ['Swift', 'Splash'] },
        'filler_p1',
        'filler_p1',
      ],
      p2: [
        { species: 'Blastoise', gender: 'M', ability: 'Torrent', item: '', nature: 'Serious', moves: ['Mirror Coat', 'Splash'] },
        'filler_p2',
        'filler_p2',
      ],
      turns: [
        { p1: 'move swift 1, move splash', p2: 'move mirrorcoat, move splash' },
        { p1: 'move splash, move splash', p2: 'move splash, move splash' },
      ],
      control: {
        p2Moves: ['Splash', 'Splash'],
        turns: [
          { p1: 'move swift 1, move splash', p2: 'move splash, move splash' },
          { p1: 'move splash, move splash', p2: 'move splash, move splash' },
        ],
      },
      dice: [['hit', 'nocrit', 'roll8', 'noproc']],
      hpLevels: false,
      why: 'Mirror Coat needs a special hit taken first; the known actor gives it one.',
    }],
  },

  'move:metalburst': {
    templates: [{
      role: 'user-hidden',
      p1: [
        { species: 'Snorlax', gender: 'M', ability: 'Thick Fat', item: '', nature: 'Serious',
          evs: { hp: 20, atk: 10, def: 20, spa: 0, spd: 16, spe: 0 }, moves: ['Body Slam', 'Splash'] },
        'filler_p1',
        'filler_p1',
      ],
      p2: [
        { species: 'Duraludon', gender: 'M', ability: 'Light Metal', item: '', nature: 'Serious', moves: ['Metal Burst', 'Splash'] },
        'filler_p2',
        'filler_p2',
      ],
      turns: [
        { p1: 'move bodyslam 1, move splash', p2: 'move metalburst, move splash' },
        { p1: 'move splash, move splash', p2: 'move splash, move splash' },
      ],
      control: {
        p2Moves: ['Splash', 'Splash'],
        turns: [
          { p1: 'move bodyslam 1, move splash', p2: 'move splash, move splash' },
          { p1: 'move splash, move splash', p2: 'move splash, move splash' },
        ],
      },
      dice: [['hit', 'nocrit', 'roll8', 'noproc']],
      hpLevels: false,
      why: 'Metal Burst needs damage taken first; the known actor gives it one.',
    }],
  },

  'move:strengthsap': {
    templates: [{
      role: 'target-hidden',
      p1: [
        { species: 'Sinistcha', gender: 'M', ability: 'Hospitality', item: '', nature: 'Serious',
          evs: { hp: 20, atk: 0, def: 0, spa: 0, spd: 14, spe: 32 }, moves: ['Strength Sap', 'Splash'] },
        { species: 'Gengar', gender: 'M', ability: 'Cursed Body', item: '', nature: 'Serious',
          evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 32 }, moves: ['Night Shade', 'Splash'] },
        'filler_p1',
      ],
      p2: [
        { species: 'Chansey', gender: 'F', ability: 'Natural Cure', item: '', nature: 'Serious', moves: ['Splash'] },
        'filler_p2',
        'filler_p2',
      ],
      turns: [
        { p1: 'move strengthsap 1, move nightshade -1', p2: 'move splash, move splash' },
        { p1: 'move splash, move splash', p2: 'move splash, move splash' },
      ],
      control: {
        p1Moves: ['Splash', 'Night Shade'],
        turns: [
          { p1: 'move splash, move nightshade -1', p2: 'move splash, move splash' },
          { p1: 'move splash, move splash', p2: 'move splash, move splash' },
        ],
      },
      dice: [['hit', 'nocrit', 'roll8', 'noproc']],
      hpLevels: false,
      why: 'Strength Sap heals by the target\'s Attack; p1 heals an exact amount.',
    }],
  },

  'move:painsplit': {
    templates: [{
      role: 'target-hidden',
      p1: [
        { species: 'Alomomola', gender: 'F', ability: 'Healer', item: '', nature: 'Serious',
          evs: { hp: 32, atk: 0, def: 0, spa: 0, spd: 14, spe: 20 }, moves: ['Pain Split', 'Splash'] },
        { species: 'Gengar', gender: 'M', ability: 'Cursed Body', item: '', nature: 'Serious',
          evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 32 }, moves: ['Night Shade', 'Splash'] },
        'filler_p1',
      ],
      p2: [
        { species: 'Kingambit', gender: 'M', ability: 'Defiant', item: '', nature: 'Serious', moves: ['Splash'] },
        'filler_p2',
        'filler_p2',
      ],
      turns: [
        { p1: 'move splash, move nightshade -1', p2: 'move splash, move splash' },
        { p1: 'move painsplit 1, move splash', p2: 'move splash, move splash' },
      ],
      control: {
        p1Moves: ['Splash', 'Night Shade'],
        turns: [
          { p1: 'move splash, move nightshade -1', p2: 'move splash, move splash' },
          { p1: 'move splash, move splash', p2: 'move splash, move splash' },
        ],
      },
      dice: [['hit', 'nocrit', 'roll8', 'noproc']],
      hpLevels: false,
      why: 'Pain Split averages HP between user and target, printing an exact change on p1.',
    }],
  },

  'move:leechseed': {
    templates: [{
      role: 'target-hidden',
      p1: [
        { species: 'Sinistcha', gender: 'M', ability: 'Hospitality', item: '', nature: 'Serious',
          evs: { hp: 20, atk: 0, def: 0, spa: 0, spd: 14, spe: 32 }, moves: ['Leech Seed', 'Splash'] },
        { species: 'Gengar', gender: 'M', ability: 'Cursed Body', item: '', nature: 'Serious',
          evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 32 }, moves: ['Night Shade', 'Splash'] },
        'filler_p1',
      ],
      p2: [
        { species: 'Chansey', gender: 'F', ability: 'Natural Cure', item: '', nature: 'Serious', moves: ['Splash'] },
        'filler_p2',
        'filler_p2',
      ],
      turns: [
        { p1: 'move leechseed 1, move nightshade -1', p2: 'move splash, move splash' },
        { p1: 'move splash, move splash', p2: 'move splash, move splash' },
      ],
      control: {
        p1Moves: ['Splash', 'Night Shade'],
        turns: [
          { p1: 'move splash, move nightshade -1', p2: 'move splash, move splash' },
          { p1: 'move splash, move splash', p2: 'move splash, move splash' },
        ],
      },
      dice: [['hit', 'nocrit', 'roll8', 'noproc']],
      hpLevels: false,
      why: 'Leech Seed drains 1/8 max HP from target and heals the seeder.',
    }],
  },

  'move:wonderroom': {
    templates: [{
      role: 'target-hidden',
      p1: [
        { species: 'Snorlax', gender: 'M', ability: 'Thick Fat', item: '', nature: 'Serious',
          evs: { hp: 20, atk: 10, def: 20, spa: 0, spd: 16, spe: 0 }, moves: ['Wonder Room', 'Dragon Claw'] },
        'filler_p1',
        'filler_p1',
      ],
      p2: [
        { species: 'Blastoise', gender: 'M', ability: 'Torrent', item: '', nature: 'Serious', moves: ['Splash'] },
        'filler_p2',
        'filler_p2',
      ],
      turns: [
        { p1: 'move wonderroom, move splash', p2: 'move splash, move splash' },
        { p1: 'move dragonclaw 1, move splash', p2: 'move splash, move splash' },
      ],
      control: {
        p1Moves: ['Splash', 'Dragon Claw'],
        turns: [
          { p1: 'move splash, move splash', p2: 'move splash, move splash' },
          { p1: 'move dragonclaw 1, move splash', p2: 'move splash, move splash' },
        ],
      },
      dice: [['hit', 'nocrit', 'roll8', 'noproc']],
      hpLevels: false,
      why: 'Wonder Room swaps Def and SpD in damage calculation.',
    }],
  },

  'condition:wonderroom': {
    templates: [{
      role: 'target-hidden',
      p1: [
        { species: 'Snorlax', gender: 'M', ability: 'Thick Fat', item: '', nature: 'Serious',
          evs: { hp: 20, atk: 10, def: 20, spa: 0, spd: 16, spe: 0 }, moves: ['Wonder Room', 'Dragon Claw'] },
        'filler_p1',
        'filler_p1',
      ],
      p2: [
        { species: 'Blastoise', gender: 'M', ability: 'Torrent', item: '', nature: 'Serious', moves: ['Splash'] },
        'filler_p2',
        'filler_p2',
      ],
      turns: [
        { p1: 'move wonderroom, move splash', p2: 'move splash, move splash' },
        { p1: 'move dragonclaw 1, move splash', p2: 'move splash, move splash' },
      ],
      control: {
        p1Moves: ['Splash', 'Dragon Claw'],
        turns: [
          { p1: 'move splash, move splash', p2: 'move splash, move splash' },
          { p1: 'move dragonclaw 1, move splash', p2: 'move splash, move splash' },
        ],
      },
      dice: [['hit', 'nocrit', 'roll8', 'noproc']],
      hpLevels: false,
      why: 'Wonder Room swaps Def and SpD in damage calculation.',
    }],
  },

  'item:shellbell': {
    templates: [{
      role: 'holder-hidden',
      p1: [
        { species: 'Snorlax', gender: 'M', ability: 'Thick Fat', item: '', nature: 'Serious',
          evs: { hp: 20, atk: 10, def: 20, spa: 0, spd: 16, spe: 0 }, moves: ['Super Fang', 'Splash'] },
        'filler_p1',
        'filler_p1',
      ],
      p2: [
        { species: 'Blastoise', gender: 'M', ability: 'Torrent', item: 'Shell Bell', nature: 'Serious', moves: ['Body Slam', 'Splash'] },
        'filler_p2',
        'filler_p2',
      ],
      turns: [
        { p1: 'move superfang 1, move splash', p2: 'move splash, move splash' },
        { p1: 'move splash, move splash', p2: 'move bodyslam 1, move splash' },
      ],
      control: {
        p2Item: '',
        turns: [
          { p1: 'move superfang 1, move splash', p2: 'move splash, move splash' },
          { p1: 'move splash, move splash', p2: 'move bodyslam 1, move splash' },
        ],
      },
      dice: [['hit', 'nocrit', 'roll8', 'noproc']],
      hpLevels: false,
      why: 'Shell Bell heals the holder by 1/8 of damage dealt when damaged.',
    }],
  },

  'item:focussash': {
    templates: [{
      role: 'holder-hidden',
      p1: [
        { species: 'Garchomp', gender: 'M', ability: 'Rough Skin', item: 'Choice Scarf', nature: 'Adamant',
          evs: { hp: 0, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 }, moves: ['Iron Head', 'Splash'] },
        'filler_p1',
        'filler_p1',
      ],
      p2: [
        { species: 'Whimsicott', gender: 'M', ability: 'Infiltrator', item: 'Focus Sash', nature: 'Serious', moves: ['Splash'] },
        'filler_p2',
        'filler_p2',
      ],
      turns: [
        { p1: 'move ironhead 1, move splash', p2: 'move splash, move splash' },
        { p1: 'move splash, move splash', p2: 'move splash, move splash' },
      ],
      control: {
        p2Item: '',
        turns: [
          { p1: 'move ironhead 1, move splash', p2: 'move splash, move splash' },
          { p1: 'move splash, move splash', p2: 'move splash, move splash' },
        ],
      },
      dice: [['hit', 'nocrit', 'roll8', 'noproc']],
      hpLevels: false,
      why: 'Focus Sash holds a lethal hit at 1 HP, firing an activation line (M6).',
    }],
    mechanism: { hp: 'M6' },
  },

  'condition:confusion': {
    templates: [{
      role: 'user-hidden',
      p1: [
        { species: 'Gengar', gender: 'M', ability: 'Cursed Body', item: '', nature: 'Serious',
          evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 32 }, moves: ['Confuse Ray', 'Splash'] },
        'filler_p1',
        'filler_p1',
      ],
      p2: [
        { species: 'Snorlax', gender: 'M', ability: 'Thick Fat', item: '', nature: 'Serious', moves: ['Splash'] },
        'filler_p2',
        'filler_p2',
      ],
      turns: [
        { p1: 'move confuseray 1, move splash', p2: 'move splash, move splash' },
        { p1: 'move splash, move splash', p2: 'move splash, move splash' },
      ],
      control: {
        turns: [
          { p1: 'move splash, move splash', p2: 'move splash, move splash' },
          { p1: 'move splash, move splash', p2: 'move splash, move splash' },
        ],
      },
      dice: [['hit', 'nocrit', 'roll8', 'noproc'], ['confused', 'roll8']],
      hpLevels: false,
      why: 'Confusion self-hit deals 40-power physical damage using the Pokemon\'s own Atk and Def.',
    }],
  },

  'item:choicescarf': {
    witnesses: ['W-order', 'W-two-moves'],
    note: 'Speed modifier that remains silent in battle until move order reveals it.',
  },

  'item:rockyhelmet': {
    witnesses: ['W-phys-taken'],
    note: 'Damages physical attacker for 1/6 max HP, correctly credited to the holder.',
  },

  'ability:voltabsorb': {
    templates: [{
      role: 'holder-hidden',
      p1: [
        { species: 'Electrode', gender: 'N', ability: 'Soundproof', item: '', nature: 'Serious',
          evs: { hp: 0, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 }, moves: ['Thunderbolt', 'Splash'] },
        'filler_p1',
        'filler_p1',
      ],
      p2: [
        { species: 'Jolteon', gender: 'M', ability: 'Volt Absorb', item: '', nature: 'Serious', moves: ['Splash'] },
        'filler_p2',
        'filler_p2',
      ],
      turns: [
        { p1: 'move thunderbolt 1, move splash', p2: 'move splash, move splash' },
        { p1: 'move splash, move splash', p2: 'move splash, move splash' },
      ],
      control: {
        p2Ability: 'Quick Feet',
        turns: [
          { p1: 'move thunderbolt 1, move splash', p2: 'move splash, move splash' },
          { p1: 'move splash, move splash', p2: 'move splash, move splash' },
        ],
      },
      dice: [['hit', 'nocrit', 'roll8', 'noproc']],
      why: 'Volt Absorb heals holder when targeted by Electric move, correctly credited to holder despite [of] tag.',
    }],
    witnesses: ['W-spec-taken'],
    note: 'Heals holder when targeted by Electric move, correctly credited to holder despite [of] tag.',
  },
  'move:acupressure': { noChannelReason: 'data/moves.ts:79: raises random stat stage by 2, no stat channel' },
  'move:dive': { noChannelReason: 'data/moves.ts:503: semi-invulnerable turn has no stat channel' },
  'move:endure': { noChannelReason: 'data/moves.ts:581: endures lethal hit with 1 HP, handled by M6 threshold' },
  'move:growth': { noChannelReason: 'data/moves.ts:881: raises Atk/SpA stages, no stat channel' },
  'move:guardswap': { noChannelReason: 'data/moves.ts:889: swaps Def/SpD stage changes, no stat channel' },
  'move:healingwish': { noChannelReason: 'data/moves.ts:931: faints user to heal replacement, no stat channel' },
  'move:healpulse': { noChannelReason: 'data/moves.ts:939: restores 1/2 target max HP as fixed fraction (M4)' },
  'move:highjumpkick': { noChannelReason: 'data/moves.ts:979: crash damage on miss is 1/2 user max HP (M4)' },
  'move:moonlight': { noChannelReason: 'data/moves.ts:1330: weather recovery heals fixed max HP fraction (M4)' },
  'move:morningsun': { noChannelReason: 'data/moves.ts:1338: weather recovery heals fixed max HP fraction (M4)' },
  'move:powerswap': { noChannelReason: 'data/moves.ts:1537: swaps Atk/SpA stage changes, no stat channel' },
  'move:psychup': { noChannelReason: 'data/moves.ts:1568: copies target stat stages, no stat channel' },
  'move:speedswap': { noChannelReason: 'data/moves.ts:1936: swaps raw Spe stats (M8), unverified' },
  'move:spikyshield': { noChannelReason: 'data/moves.ts:1946: contact damage is 1/8 max HP fixed fraction (M4)' },
  'move:stealthrock': { noChannelReason: 'data/moves.ts:1976: entry hazard deals type-scaled max HP fraction (M4)' },
  'move:synthesis': { noChannelReason: 'data/moves.ts:2088: weather recovery heals fixed max HP fraction (M4)' },
  'move:topsyturvy': { noChannelReason: 'data/moves.ts:2210: inverts target stat stages, no stat channel' },

  'ability:angerpoint': { noChannelReason: 'data/abilities.ts:79: maxes Atk stage when hit by crit, no stat channel' },
  'ability:battlebond': { noChannelReason: 'data/abilities.ts:173: boosts Atk/SpA/Spe stages upon KO, no stat channel' },
  'ability:blaze': { noChannelReason: 'data/abilities.ts:206: boosts Fire moves at <= 1/3 max HP, no stat channel' },
  'ability:cheekpouch': { noChannelReason: 'data/abilities.ts:273: heals 1/3 max HP when Berry eaten (M4)' },
  'ability:cudchew': { noChannelReason: 'data/abilities.ts:400: re-eats Berry at turn end, no stat channel' },
  'ability:disguise': { noChannelReason: 'data/abilities.ts:474: bust damage is 1/8 max HP fixed fraction (M4)' },
  'ability:dryskin': { noChannelReason: 'data/abilities.ts:503: water/rain heal is fixed max HP fraction (M4)' },
  'ability:eartheater': { noChannelReason: 'data/abilities.ts:524: ground immunity heal is 1/4 max HP (M4)' },
  'ability:galewings': { noChannelReason: 'data/abilities.ts:684: priority boost at 100% HP threshold (M6)' },
  'ability:hospitality': { noChannelReason: 'data/abilities.ts:833: heals ally for 1/4 max HP on switch-in (M4)' },
  'ability:icebody': { noChannelReason: 'data/abilities.ts:861: heals 1/16 max HP in snow (M4)' },
  'ability:mirrorarmor': { noChannelReason: 'data/abilities.ts:1174: reflects stat stage drops, no stat channel' },
  'ability:opportunist': { noChannelReason: 'data/abilities.ts:1288: copies foe stat stage boosts, no stat channel' },
  'ability:overgrow': { noChannelReason: 'data/abilities.ts:1309: boosts Grass moves at <= 1/3 max HP, no stat channel' },
  'ability:poisonheal': { noChannelReason: 'data/abilities.ts:1406: heals 1/8 max HP per turn when poisoned (M4)' },
  'ability:raindish': { noChannelReason: 'data/abilities.ts:1506: heals 1/16 max HP in rain (M4)' },
  'ability:receiver': { noChannelReason: 'data/abilities.ts:1532: copies fainted ally ability, no stat channel' },
  'ability:regenerator': { noChannelReason: 'data/abilities.ts:1552: heals 1/3 max HP on switch-out (M4)' },
  'ability:shedskin': { noChannelReason: 'data/abilities.ts:1722: 1/3 chance to cure status at turn end, no stat channel' },
  'ability:solarpower': { noChannelReason: 'data/abilities.ts:1821: loses 1/8 max HP per turn in sun (M4)' },
  'ability:stickyhold': { noChannelReason: 'data/abilities.ts:1894: prevents item removal, no stat channel' },
  'ability:sturdy': { noChannelReason: 'data/abilities.ts:1924: survives OHKO at 100% HP threshold (M6)' },
  'ability:swarm': { noChannelReason: 'data/abilities.ts:1946: boosts Bug moves at <= 1/3 max HP, no stat channel' },
  'ability:torrent': { noChannelReason: 'data/abilities.ts:2134: boosts Water moves at <= 1/3 max HP, no stat channel' },
  'ability:unaware': { noChannelReason: 'data/abilities.ts:2209: ignores foe stat stage changes, no stat channel' },
  'ability:waterabsorb': { noChannelReason: 'data/abilities.ts:2287: water immunity heal is 1/4 max HP (M4)' },

  'item:leppaberry': { noChannelReason: 'data/items.ts:805: restores 10 PP when a move reaches 0 PP, no stat channel' },
  'item:whiteherb': { noChannelReason: 'data/items.ts:1784: restores lowered stat stages, no stat channel' },
};
