#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const {BattleStream, Dex, TeamValidator, Teams} = require('pokemon-showdown');

const FORMAT_ID = 'gen9championsvgc2026regmb';
const SEED = 'sodium,00000000000000000000000000000001';

const IVS = Object.freeze({hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31});
const STAT_POINTS = Object.freeze({hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32});

const p1Team = [
	{
		species: 'Gardevoir', item: 'Gardevoirite', ability: 'Synchronize',
		moves: ['Moonblast', 'Psychic', 'Thunderbolt', 'Protect'], nature: 'Modest',
		level: 50, evs: STAT_POINTS, ivs: IVS, teraType: 'Fairy',
	},
	{
		species: 'Klefki', item: 'Light Clay', ability: 'Prankster',
		moves: ['Sandstorm', 'Thunder Wave', 'Reflect', 'Protect'], nature: 'Calm',
		level: 50, evs: STAT_POINTS, ivs: IVS, teraType: 'Steel',
	},
	{
		species: 'Tyranitar', item: 'Lum Berry', ability: 'Sand Stream',
		moves: ['Rock Slide', 'Crunch', 'Low Kick', 'Protect'], nature: 'Adamant',
		level: 50, evs: STAT_POINTS, ivs: IVS, teraType: 'Rock',
	},
	{
		species: 'Excadrill', item: 'Focus Sash', ability: 'Sand Rush',
		moves: ['High Horsepower', 'Iron Head', 'Rock Slide', 'Protect'], nature: 'Jolly',
		level: 50, evs: STAT_POINTS, ivs: IVS, teraType: 'Ground',
	},
	{
		species: 'Sinistcha', item: 'Leftovers', ability: 'Hospitality',
		moves: ['Matcha Gotcha', 'Strength Sap', 'Rage Powder', 'Trick Room'], nature: 'Calm',
		level: 50, evs: STAT_POINTS, ivs: IVS, teraType: 'Water',
	},
	{
		species: 'Kommo-o', item: 'White Herb', ability: 'Overcoat',
		moves: ['Clanging Scales', 'Aura Sphere', 'Flamethrower', 'Protect'], nature: 'Modest',
		level: 50, evs: STAT_POINTS, ivs: IVS, teraType: 'Steel',
	},
];

const p2Team = [
	{
		species: 'Charizard', item: 'Charizardite Y', ability: 'Blaze',
		moves: ['Heat Wave', 'Air Slash', 'Solar Beam', 'Protect'], nature: 'Timid',
		level: 50, evs: STAT_POINTS, ivs: IVS, teraType: 'Fire',
	},
	{
		species: 'Garchomp', item: 'Life Orb', ability: 'Rough Skin',
		moves: ['Earthquake', 'Dragon Claw', 'Rock Slide', 'Protect'], nature: 'Jolly',
		level: 50, evs: STAT_POINTS, ivs: IVS, teraType: 'Ground',
	},
	{
		species: 'Archaludon', item: 'White Herb', ability: 'Stamina',
		moves: ['Draco Meteor', 'Flash Cannon', 'Thunderbolt', 'Dragon Pulse'], nature: 'Modest',
		level: 50, evs: STAT_POINTS, ivs: IVS, teraType: 'Steel',
	},
	{
		species: 'Pelipper', item: 'Sitrus Berry', ability: 'Drizzle',
		moves: ['Hurricane', 'Weather Ball', 'Tailwind', 'Protect'], nature: 'Modest',
		level: 50, evs: STAT_POINTS, ivs: IVS, teraType: 'Water',
	},
	{
		species: 'Basculegion-F', item: 'Mystic Water', ability: 'Swift Swim',
		moves: ['Hydro Pump', 'Shadow Ball', 'Ice Beam', 'Surf'], nature: 'Modest',
		level: 50, evs: STAT_POINTS, ivs: IVS, teraType: 'Water',
	},
	{
		species: 'Grimmsnarl', item: 'Light Clay', ability: 'Prankster',
		moves: ['Spirit Break', 'Light Screen', 'Fake Out', 'Reflect'], nature: 'Careful',
		level: 50, evs: STAT_POINTS, ivs: IVS, teraType: 'Dark',
	},
];

function validateTeam(team, side) {
	const problems = new TeamValidator(FORMAT_ID).validateTeam(team);
	if (problems) {
		throw new Error(`${side} fixture is not legal for ${FORMAT_ID}:\n${problems.join('\n')}`);
	}
}

async function runInput(input) {
	const stream = new BattleStream({noCatch: true});
	const chunks = [];
	const readOutput = (async () => {
		for await (const chunk of stream) chunks.push(chunk);
	})();

	await stream.write(input);
	await readOutput;

	assert.ok(stream.battle, 'BattleStream did not create a battle');
	return {
		inputLog: [...stream.battle.inputLog],
		protocol: chunks.join('\n'),
	};
}

function firstDifference(expected, actual) {
	const expectedLines = expected.split('\n');
	const actualLines = actual.split('\n');
	const maxLines = Math.max(expectedLines.length, actualLines.length);

	for (let index = 0; index < maxLines; index++) {
		if (expectedLines[index] !== actualLines[index]) {
			return {
				line: index + 1,
				expected: expectedLines[index] ?? '<end of output>',
				actual: actualLines[index] ?? '<end of output>',
			};
		}
	}
	return null;
}

async function main() {
	const format = Dex.formats.get(FORMAT_ID);
	assert.ok(format.exists, `Missing required format: ${FORMAT_ID}`);
	validateTeam(p1Team, 'p1');
	validateTeam(p2Team, 'p2');

	const initialInput = [
		`>start ${JSON.stringify({formatid: FORMAT_ID, seed: SEED})}`,
		`>player p1 ${JSON.stringify({name: 'Encoreable P1', team: Teams.pack(p1Team)})}`,
		`>player p2 ${JSON.stringify({name: 'Encoreable P2', team: Teams.pack(p2Team)})}`,
		'>p1 team 1, 2, 3, 4',
		'>p2 team 1, 2, 3, 4',
		'>p1 move 1 1, move 1',
		'>p2 move 1, move 1',
		'>forcewin p1',
	].join('\n');

	const original = await runInput(initialInput);
	assert.ok(original.inputLog.some(line => line.startsWith('>start ') && line.includes('"seed"')),
		'Captured input log does not contain a seed');
	assert.ok(original.inputLog.some(line => line.startsWith('>p1 ')),
		'Captured input log does not contain a p1 command');
	assert.ok(original.inputLog.some(line => line.startsWith('>p2 ')),
		'Captured input log does not contain a p2 command');

	const replayed = await runInput(original.inputLog.join('\n'));
	const difference = firstDifference(original.protocol, replayed.protocol);
	if (difference) {
		throw new Error(
			`Protocol outputs diverged at line ${difference.line}.\n` +
			`Expected: ${difference.expected}\n` +
			`Actual:   ${difference.actual}`
		);
	}

	console.log(`Format: ${format.name}`);
	console.log(`Captured input log: ${original.inputLog.length} lines`);
	console.log(`Captured seed and player choices: yes`);
	console.log(`Protocol reproduction: PASS (${original.protocol.length} bytes)`);
}

main().catch(error => {
	console.error(`Protocol reproduction: FAIL\n${error.stack || error.message}`);
	process.exitCode = 1;
});
