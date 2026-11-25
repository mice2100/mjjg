// House or apartment / hotel for the delivery fee, decided from the address with the shared
// rule in web/src/lib/address.js and the Moose Jaw lists in data/.
import { hasUnit, placeForAddress } from '../../web/src/lib/address.js';
import { HttpError } from './http.js';
import hotelData from '../../data/moose_jaw_hotels.json' with { type: 'json' };
import buildingData from '../../data/moose_jaw_apartment_buildings.json' with { type: 'json' };
import { DELIVERY_PLACES } from './util.js';

export const PLACES = { hotels: hotelData.hotels, buildings: buildingData.buildings };

export const deliveryPlaceFor = (address) => placeForAddress(address, PLACES);

// Staff may override the automatic answer; customers on the website may not.
// Apartments, condos and hotels: the address must name the unit / suite / apt or room (or Lobby).
export const UNIT_REQUIRED = 'Apartment, hotel or trailer court delivery: please add the unit, suite, apt, room or lot number to the address.';
export function assertUnit(deliveryType, place, address) {
  if (deliveryType === 'delivery' && place === 'apartment' && !hasUnit(address)) {
    throw new HttpError(400, UNIT_REQUIRED, { unit_required: true });
  }
}

export const staffPlace = (chosen, address) => (DELIVERY_PLACES.includes(chosen) ? chosen : deliveryPlaceFor(address));
