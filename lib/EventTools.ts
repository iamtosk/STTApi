import STTApi from "./index";

export class BonusCrew {
    eventName: string = '';
    crewIds: number[] = [];
};

export function bonusCrewForCurrentEvent(): BonusCrew | undefined {
    let result = new BonusCrew();

    //credit for @emanueldejanu
	//get only events that are opened or that starts in less than 2 days 
    let events: any[] = (STTApi.playerData.character.events || []).filter((evt:any) => evt.opened || evt.seconds_to_start < 172800);
	events.sort((a: any, b: any) => a.seconds_to_start - b.seconds_to_start);
	if (events.length > 0) {
		let activeEvent = events[0];
		
        result.eventName = activeEvent.name;

        let eventCrew: { [index: string]: any } = {};
        if (activeEvent.content) {
            if (activeEvent.content.crew_bonuses) {
                for (let symbol in activeEvent.content.crew_bonuses) {
                    eventCrew[symbol] = activeEvent.content.crew_bonuses[symbol];
                }
            }

            // For skirmish events
            if (activeEvent.content.bonus_crew) {
                for (let symbol in activeEvent.content.bonus_crew) {
                    eventCrew[symbol] = activeEvent.content.bonus_crew[symbol];
                }
            }

            // For expedition events
            if (activeEvent.content.special_crew) {
                activeEvent.content.special_crew.forEach((symbol: string) => {
                    eventCrew[symbol] = symbol;
                });
            }

            // TODO: there's also bonus_traits; should we bother selecting crew with those? It looks like you can use voyage crew in skirmish events, so it probably doesn't matter
            if (activeEvent.content.shuttles) {
                activeEvent.content.shuttles.forEach((shuttle: any) => {
                    for (let symbol in shuttle.crew_bonuses) {
                        eventCrew[symbol] = shuttle.crew_bonuses[symbol];
                    }
                });
            }
        }

        for (let symbol in eventCrew) {
            let foundCrew = STTApi.roster.find((crew: any) => crew.symbol === symbol);
            if (foundCrew) {
                result.crewIds.push(foundCrew.crew_id || foundCrew.id);
            }
        }

        return result;
    }

    return undefined;
}