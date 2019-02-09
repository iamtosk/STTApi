import STTApi from './index';

export function fixupAllCrewIds() {
	// Now replace the ids with proper ones
	STTApi.allcrew.forEach((crew: any) => {
		crew.equipment_slots.forEach((es: any) => {
			let acached = crew.archetypes.find((a: any) => a.id === es.archetype);
			if (!acached) {
				console.warn(`Something went wrong looking for equipment '${es.archetype}' of '${crew.name}'`);
				return;
			}
			let a = STTApi.itemArchetypeCache.archetypes.find((a: any) => a.symbol === acached.symbol);
			if (a) {
				//console.log(`For ${crew.name} at level ${es.level} updating ${es.symbol} from ${es.archetype} to ${a.id}`);
				es.archetype = a.id;
			} else {
				console.warn(`Something went wrong looking for equipment '${es.symbol}'`);
				es.archetype = 0;
			}
		});
	});
}

export async function loadFullTree(onProgress: (description: string) => void, recursing: boolean): Promise<void> {
	let mapEquipment: Set<number> = new Set();
	let missingEquipment: any[] = [];

	// Search for all equipment assignable to the crew at all levels
	// This was a terrible idea; since the data is crowdsourced, it could come from outdated recipe trees and introduce cycles in the graph; data from STTApi.allcrew is not to be trusted

	let allCrewEquip: Set<string> = new Set();
	STTApi.allcrew.forEach((crew: any) => {
		crew.equipment_slots.forEach((es: any) => {
			let a = crew.archetypes.find((a: any) => a.id === es.archetype);

			if (a) {
				allCrewEquip.add(a.symbol);
				es.symbol = a.symbol;
			}
		});
	});

	STTApi.itemArchetypeCache.archetypes.forEach((equipment: any) => {
		mapEquipment.add(equipment.id);
		allCrewEquip.delete(equipment.symbol);
	});

	// Have we already cached equipment details for the current digest (since the last recipe update)?
	let entry = await STTApi.equipmentCache
		.where('digest')
		.equals(STTApi.serverConfig.config.craft_config.recipe_tree.digest)
		.first();

	if (entry) {
		// Merge the cached equipment, since the recipe tree didn't change since our last load
		entry.archetypeCache.forEach((cacheEntry: any) => {
			if (!mapEquipment.has(cacheEntry.id)) {
				STTApi.itemArchetypeCache.archetypes.push(cacheEntry);
				mapEquipment.add(cacheEntry.id);
			}

			allCrewEquip.delete(cacheEntry.symbol);
		});
	}

	// Load the description for all crew equipment
	let allcrewData = Array.from(allCrewEquip.values());
	while (allcrewData.length > 0) {
		onProgress(`Loading all crew equipment... (${allcrewData.length} remaining)`);
		let archetypesAll = await loadItemsDescription(allcrewData.splice(0, 20));
		console.log(`Loaded ${archetypesAll.length}, remaining ${allcrewData.length}`);
		if (archetypesAll.length > 0) {
			STTApi.itemArchetypeCache.archetypes = STTApi.itemArchetypeCache.archetypes.concat(archetypesAll);
		}
	}

	if (!recursing) {
		fixupAllCrewIds();
	}

	// Search for all equipment in the recipe tree
	STTApi.itemArchetypeCache.archetypes.forEach((equipment: any) => {
		if (equipment.recipe && equipment.recipe.demands && equipment.recipe.demands.length > 0) {
			equipment.recipe.demands.forEach((item: any) => {
				if (!mapEquipment.has(item.archetype_id)) {
					missingEquipment.push(item.archetype_id);
				}
			});
		}
	});

	// Search for all equipment currently assigned to crew
	STTApi.roster.forEach((crew: any) => {
		crew.equipment_slots.forEach((es: any) => {
			if (!mapEquipment.has(es.archetype)) {
				missingEquipment.push(es.archetype);
			}
		});
	});

	onProgress(`Loading equipment... (${missingEquipment.length} remaining)`);
	if (missingEquipment.length === 0) {
		// We're done loading, let's cache the current list, to save on future loading time
		/*await*/ STTApi.equipmentCache.put({
			digest: STTApi.serverConfig.config.craft_config.recipe_tree.digest,
			archetypeCache: STTApi.itemArchetypeCache.archetypes
		});

		return;
	}

	// Load the description for the missing equipment
	let archetypes = await loadItemsDescription(missingEquipment.slice(0, 20));

	if (archetypes.length > 0) {
		STTApi.itemArchetypeCache.archetypes = STTApi.itemArchetypeCache.archetypes.concat(archetypes);
		console.log(`Loaded ${archetypes.length} archetypes; recursing`);
		return loadFullTree(onProgress, true);
	}

	// We're done loading, let's cache the current list, to save on future loading time
	/*await*/ STTApi.equipmentCache.put({
		digest: STTApi.serverConfig.config.craft_config.recipe_tree.digest,
		archetypeCache: STTApi.itemArchetypeCache.archetypes
	});
}

async function loadItemsDescription(ids: number[] | string[]): Promise<any[]> {
	let archetypes: any[] = [];
	try {
		// Load the description for the missing equipment
		let data = await STTApi.executeGetRequest('item/description', { ids });

		if (data.item_archetype_cache && data.item_archetype_cache.archetypes) {
			archetypes = data.item_archetype_cache.archetypes;
		}
	} catch (error) {
		// Some equipment is causing the server to choke, time to binary search the culprit
		if (ids.length === 1) {
			console.error(`The description for item ${ids[0]} fails to load.`);
		} else {
			let leftSide = ids.splice(0, Math.ceil(ids.length / 2));

			let leftArchetypes = await loadItemsDescription(leftSide);
			let rightArchetypes = await loadItemsDescription(ids);

			archetypes = leftArchetypes.concat(rightArchetypes);
		}
	}

	return archetypes;
}

export interface ICadetItemSource {
	quest: any;
	mission: any;
	masteryLevel: number;
}

export interface IFactionStoreItemSource {
	cost_currency: string;
	cost_amount: number;
	faction: any;
}

export interface IEquipNeedFilter {
	onlyNeeded: boolean;
	onlyFaction: boolean;
	cadetable: boolean;
	allLevels: boolean;
	userText: string | undefined;
}

export interface IEquipNeedCount {
	crew: any;
	count: number;
}

export interface IEquipNeed {
	equipment: any;
	needed: number;
	have: number;
	cadetSources: ICadetItemSource[];
	factionSources: IFactionStoreItemSource[];
	counts: Map<number, IEquipNeedCount>;
	isDisputeMissionObtainable: boolean;
	isShipBattleObtainable: boolean;
	isFactionObtainable: boolean;
	isCadetable: boolean;
}

interface IUnparsedEquipment {
	archetype: number;
	need: number;
	crew: any;
}

export class NeededEquipmentClass {
	private _cadetableItems: Map<number, ICadetItemSource[]>;
	private _factionableItems: Map<number, IFactionStoreItemSource[]>;

	constructor() {
		this._cadetableItems = new Map<number, ICadetItemSource[]>();
		this._factionableItems = new Map<number, IFactionStoreItemSource[]>();
	}

	filterNeededEquipment(filters: IEquipNeedFilter, limitCrew: number[]): IEquipNeed[] {
		this._getCadetableItems();
		this._getFactionableItems();
		const filteredCrew = this._getFilteredCrew(filters, limitCrew);
		const neededEquipment = this._getNeededEquipment(filteredCrew, filters);
		return neededEquipment;
	}

	private _getFilteredCrew(filters: IEquipNeedFilter, limitCrew: number[]): any[] {
		if (limitCrew.length === 0) {
			// filter out `crew.buyback` by default
			return STTApi.roster.filter((c: any) => !c.buyback);
		} else {
			let selectedCrew: any[] = [];
			limitCrew.forEach((id: any) => {
				let crew = STTApi.roster.find((c: any) => c.id === id);
				if (!crew) {
					crew = STTApi.allcrew.find((c: any) => c.id === id);
				}

				if (crew) {
					selectedCrew.push(crew);
				}
			});

			return selectedCrew;
		}
	}

	private _getFactionableItems() {
		if (this._factionableItems.size === 0) {
			for (let faction of STTApi.playerData.character.factions) {
				for (let storeItem of faction.storeItems) {
					if (
						storeItem.offer.game_item.type === 2 &&
						(storeItem.offer.game_item.item_type === 2 || storeItem.offer.game_item.item_type === 3)
					) {
						let item_id = storeItem.offer.game_item.id;

						let info: IFactionStoreItemSource = {
							cost_currency: storeItem.offer.cost.currency,
							cost_amount: storeItem.offer.cost.amount,
							faction: faction
						};

						if (this._factionableItems!.has(item_id)) {
							this._factionableItems!.get(item_id)!.push(info);
						} else {
							this._factionableItems!.set(item_id, [info]);
						}
					}
				}
			}
		}
	}

	private _getCadetableItems() {
		if (this._cadetableItems.size === 0) {
			//Advanced Cadet Challenges offer the same rewards as Standard ones, so filter them to avoid duplicates
			let cadetMissions = STTApi.missions
				.filter((mission: any) => mission.quests.some((quest: any) => quest.cadet))
				.filter((mission: any) => mission.episode_title.indexOf('Adv') === -1);

			for (let cadetMission of cadetMissions) {
				for (let quest of cadetMission.quests) {
					for (let masteryLevel of quest.mastery_levels) {
						masteryLevel.rewards
							.filter((r: any) => r.type === 0)
							.forEach((reward: any) => {
								reward.potential_rewards.forEach((item: any) => {
									let info: ICadetItemSource = {
										quest: quest,
										mission: cadetMission,
										masteryLevel: masteryLevel.id
									};

									if (this._cadetableItems!.has(item.id)) {
										this._cadetableItems!.get(item.id)!.push(info);
									} else {
										this._cadetableItems!.set(item.id, [info]);
									}
								});
							});
					}
				}
			}
		}
	}

	private _mergeMapUnowned(target: Map<number, IEquipNeed>, source: Map<number, IEquipNeed>) {
		for (let archetype of source.keys()) {
			if (target.has(archetype)) {
				target.get(archetype)!.needed += source.get(archetype)!.needed;

				for (let count of source.get(archetype)!.counts.keys()) {
					if (target.get(archetype)!.counts.has(count)) {
						target.get(archetype)!.counts.get(count)!.count += source.get(archetype)!.counts.get(count)!.count;
					} else {
						target.get(archetype)!.counts.set(count, source.get(archetype)!.counts.get(count)!);
					}
				}
			} else {
				target.set(archetype, source.get(archetype)!);
			}
		}

		return target;
	}

	private _calculateNeeds(unparsedEquipment: IUnparsedEquipment[], archetypes: any[]) {
		let mapUnowned: Map<number, IEquipNeed> = new Map();
		let mapIncompleteUsed: Map<number, IEquipNeed> = new Map();
		// TODO: infinite loop detection, for bad data

		let loopCount = 0;
		while (unparsedEquipment.length > 0) {
			if (loopCount++ > 10000) {
				break;
			}

			let eq = unparsedEquipment.pop()!;
			let equipment = archetypes.find(e => e.id === eq.archetype);

			if (!equipment) {
				console.warn(`This equipment has no recipe and no sources: '${eq.archetype}'`);
			} else if (equipment.recipe && equipment.recipe.demands && equipment.recipe.demands.length > 0) {
				let have = STTApi.playerData.character.items.find((item: any) => item.archetype_id === eq.archetype);
				// don't have any partially built, queue up to break into pieces
				if (!have || have.quantity <= 0) {
					// Add all children in the recipe to parse on the next loop iteration
					equipment.recipe.demands.forEach((recipeItem: any) => {
						unparsedEquipment.push({
							archetype: recipeItem.archetype_id,
							need: recipeItem.count * eq.need,
							crew: eq.crew
						});
					});
				} else {
					// see how many are already accounted for
					let found = mapIncompleteUsed.get(eq.archetype);
					if (found) {
						found.needed += eq.need;
					} else {
						found = {
							equipment,
							needed: eq.need - have.quantity,
							have: have.quantity,
							cadetSources: this._cadetableItems.get(equipment.id) || [],
							factionSources: this._factionableItems.get(equipment.id) || [],
							counts: new Map(),
							isDisputeMissionObtainable: false,
							isShipBattleObtainable: false,
							isFactionObtainable: false,
							isCadetable: false
						};

						mapIncompleteUsed.set(eq.archetype, found);
					}

					// if total requirements exceed inventory
					if (found.needed > 0) {
						// how many can be filled for this equipment demand
						let partialNeeded = eq.need;
						// If this new requirement pushed past inventory amount, only need a partial amount equal to the overlap
						if (found.needed < eq.need) {
							partialNeeded = eq.need - found.needed;
						}
						equipment.recipe.demands.forEach((recipeItem: any) => {
							unparsedEquipment.push({
								archetype: recipeItem.archetype_id,
								need: recipeItem.count * partialNeeded,
								crew: eq.crew
							});
						});
					} else {
						//NOTE: this clause can be removed to avoid zero counts for crew members
						// Track the crew that needs them, but retain zero count (since the item is partially built)
						// in case the intermediate item gets consumed elsewhere
						equipment.recipe.demands.forEach((recipeItem: any) => {
							unparsedEquipment.push({
								archetype: recipeItem.archetype_id,
								need: 0,
								crew: eq.crew
							});
						});
					}
				}
			} else if ((equipment.item_sources && equipment.item_sources.length > 0) || this._cadetableItems.has(equipment.id)) {
				let found = mapUnowned.get(eq.archetype);
				if (found) {
					found.needed += eq.need;
					let counts = found.counts.get(eq.crew.id);
					if (counts) {
						counts.count += eq.need;
					} else {
						found.counts.set(eq.crew.id, { crew: eq.crew, count: eq.need });
					}
				} else {
					let have = STTApi.playerData.character.items.find((item: any) => item.archetype_id === eq.archetype);
					let isDisputeMissionObtainable = equipment.item_sources.filter((e: any) => e.type === 0).length > 0;
					let isShipBattleObtainable = equipment.item_sources.filter((e: any) => e.type === 2).length > 0;
					let isFactionObtainable = equipment.item_sources.filter((e: any) => e.type === 1).length > 0;
					let isCadetable = this._cadetableItems.has(equipment.id);
					let counts: Map<number, IEquipNeedCount> = new Map();
					counts.set(eq.crew.id, { crew: eq.crew, count: eq.need });

					equipment.item_sources.sort((a: any, b: any) => b.energy_quotient - a.energy_quotient);

					mapUnowned.set(eq.archetype, {
						equipment,
						cadetSources: this._cadetableItems.get(equipment.id) || [],
						factionSources: this._factionableItems.get(equipment.id) || [],
						needed: eq.need,
						have: have ? have.quantity : 0,
						counts: counts,
						isDisputeMissionObtainable: isDisputeMissionObtainable,
						isShipBattleObtainable: isShipBattleObtainable,
						isFactionObtainable: isFactionObtainable,
						isCadetable: isCadetable
					});
				}
			}
		}

		return mapUnowned;
	}

	private _getNeededEquipment(filteredCrew: any[], filters: IEquipNeedFilter) {
		let unparsedEquipment: IUnparsedEquipment[] = [];
		let mapUnowned: Map<number, IEquipNeed> = new Map();
		for (let crew of filteredCrew) {
			let lastEquipmentLevel = 1;
			crew.equipment_slots.forEach((equipment: any) => {
				if (!equipment.have) {
					unparsedEquipment.push({ archetype: equipment.archetype, need: 1, crew: crew });
				}

				lastEquipmentLevel = equipment.level;
			});

			if (filters.allLevels && !crew.isExternal) {
				let feCrew = STTApi.allcrew.find(c => c.symbol === crew.symbol);
				if (feCrew) {
					let unparsedEquipmentFE: IUnparsedEquipment[] = [];
					feCrew.equipment_slots.forEach((equipment: any) => {
						if (equipment.level > lastEquipmentLevel) {
							unparsedEquipmentFE.push({ archetype: equipment.archetype, need: 1, crew: crew });
						}
					});

					mapUnowned = this._mergeMapUnowned(mapUnowned, this._calculateNeeds(unparsedEquipmentFE, STTApi.itemArchetypeCache.archetypes));
				}
			}
		}

		mapUnowned = this._mergeMapUnowned(mapUnowned, this._calculateNeeds(unparsedEquipment, STTApi.itemArchetypeCache.archetypes));

		// Sort the map by "needed" descending
		let arr = Array.from(mapUnowned.values());
		arr.sort((a, b) => b.needed - a.needed);

		if (filters.onlyNeeded) {
			arr = arr.filter((entry: IEquipNeed) => entry.have < entry.needed);
		}

		if (filters.onlyFaction) {
			arr = arr.filter(
				(entry: IEquipNeed) => !entry.isDisputeMissionObtainable && !entry.isShipBattleObtainable && entry.isFactionObtainable
			);
		}

		if (filters.cadetable) {
			arr = arr.filter((entry: IEquipNeed) => entry.isCadetable);
		}

		if (filters.userText && filters.userText.trim().length > 0) {
			let filterString = filters.userText.toLowerCase();

			arr = arr.filter((entry: IEquipNeed) => {
				// if value is (parsed into) a number, filter by entry.equipment.rarity, entry.needed, entry.have, entry.counts{}.count
				let filterInt = parseInt(filterString);
				if (!isNaN(filterInt)) {
					if (entry.equipment.rarity === filterInt) {
						return true;
					}
					if (entry.needed === filterInt) {
						return true;
					}
					if (entry.have === filterInt) {
						return true;
					}
					if (Array.from(entry.counts.values()).some((c: IEquipNeedCount) => c.count === filterInt)) {
						return true;
					}
					return false;
				}

				// if string, filter by entry.equipment.name, entry.counts{}.crew.name, entry.equipment.item_sources[].name, cadetableItems{}.name
				if (entry.equipment.name.toLowerCase().includes(filterString)) {
					return true;
				}
				if (Array.from(entry.counts.values()).some((c: IEquipNeedCount) => c.crew.name.toLowerCase().includes(filterString))) {
					return true;
				}
				if (entry.equipment.item_sources.some((s: any) => s.name.toLowerCase().includes(filterString))) {
					return true;
				}
				if (this._cadetableItems.has(entry.equipment.id)) {
					if (
						this._cadetableItems
							.get(entry.equipment.id)!
							.some(
								(c: any) =>
									c.quest.name.toLowerCase().includes(filterString) || c.mission.episode_title.toLowerCase().includes(filterString)
							)
					) {
						return true;
					}
				}

				return false;
			});
		}

		return arr;
	}
}
