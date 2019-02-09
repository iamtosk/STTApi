import STTApi from './index';
import { mergeDeep } from './ObjectMerge';

export async function loadVoyage(voyageId: number, newOnly: boolean = true): Promise<any> {
	let data = await STTApi.executePostRequest('voyage/refresh', { voyage_status_id: voyageId, new_only: newOnly });
	if (data) {
		let voyageNarrative: any[] = [];

		data.forEach((action: any) => {
			if (action.character) {
				// TODO: if DB adds support for more than one voyage at a time this hack won't work

				// Clear out the dilemma resolutions before load to avoid duplicates
				if (STTApi.playerData.character.voyage[0] && STTApi.playerData.character.voyage[0].dilemma) {
					STTApi.playerData.character.voyage[0].dilemma.resolutions = [];
				}
				STTApi.playerData.character.voyage[0] = mergeDeep(STTApi.playerData.character.voyage[0], action.character.voyage[0]);
			} else if (action.voyage_narrative) {
				voyageNarrative = action.voyage_narrative;
			}
		});

		return voyageNarrative;
	} else {
		throw new Error('Invalid data for voyage!');
	}
}

export function bestVoyageShip(): any[] {
	let voyage = STTApi.playerData.character.voyage_descriptions[0];

	let consideredShips: any[] = [];
	STTApi.ships.forEach((ship: any) => {
		if (ship.id > 0) {
			let entry = {
				ship: ship,
				score: ship.antimatter
			};

			if (ship.traits.find((trait: any) => trait == voyage.ship_trait)) {
				entry.score += 150; // TODO: where is this constant coming from (Config)?
			}

			consideredShips.push(entry);
		}
	});

	consideredShips = consideredShips.sort((a, b) => b.score - a.score);

	return consideredShips;
}
