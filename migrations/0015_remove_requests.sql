-- Owner, 2026-11-25: take the Requests options (No extra MSG, No onion, Extra Onion, Less oil,
-- Less salt, Sauce on the side) off every dish. Past orders keep the requests they were saved with.
DELETE FROM option_groups WHERE id = 'requests';
