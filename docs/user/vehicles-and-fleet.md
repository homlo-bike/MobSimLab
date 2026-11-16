# Own vehicles and fleet

Under **Project preferences**, a project can add vehicles the catalogue does not have and keep a list of its individual vehicles. Owners and Editors can change both; Viewers see them. Both are saved with the project's drawings.

## Own vehicles

**Upload vehicles** takes one or more `.json` files. A file can hold one vehicle or a list of vehicles, in either format:

- the **research format**, the one `vehicles/_import/` uses and the catalogue research prompt asks for (`dimensions.lengthM`, `capacity.seated`, `energy.supply`, …);
- the **catalogue format** of `vehicles/schema/vehicle.schema.json`, where every value is a record `{value, unit, …}`.

Each vehicle needs the core values the catalogue needs (ADR-0026): **length, width, seats, standing places, top speed and energy source**. Standing places can also come from the total capacity minus the seats. A vehicle without one of them, or with a value out of range (for example 12000 for a 12 m bus), is **not added**, and the message after the upload names the values that are missing or wrong. The other vehicles in the same upload are added.

**Create vehicle** opens a form with the same values; fields marked * are needed, and saving checks the vehicle as an upload is checked. **Edit** changes an own vehicle the same way. Uploading a vehicle with the id of one the project already has replaces it.

Own vehicles are marked **Own** in the **Vehicles** list, where they can be ticked like catalogue vehicles. Street vehicles (bus, BRT, trolleybus, intercity bus) appear in the street line tool's vehicle list and the depots (their width, articulations and turning circle are used for slots and the swept-path check); rail vehicles appear in the railway tool's train list. Their capacity is counted like the catalogue's: seats plus the standing area at the mode's planning density, where the standing area is the standing places at the density the source quotes, or at 4 pers/m² when it quotes none.

**Delete** removes an own vehicle and its fleet vehicles. Lines that ran it go back to the mode's typical vehicle.

## Fleet

The fleet lists the project's vehicles one by one. Each has a type (a catalogue or own vehicle), a **fleet number**, a **home depot**, the **year** it entered service and a **status**: active, reserve, in maintenance or retired.

**Add vehicles** adds up to 500 vehicles of one type at a time, numbered up from the first fleet number: `101` gives 101, 102, 103; `T-009` gives T-009, T-010. Only the depots that take the vehicle's mode are offered as home depots (road depots take street vehicles). The list shows how many vehicles of each type there are by status; numbers, depots, years and statuses can be changed in place, and fleet numbers used twice are pointed out.

The fleet is a record of the project's vehicles. The depot tool and the cost tables still size depots and count vehicles from the lines' service, not from this list.
