# Golden Hour Product and UX Specification

## Scope

This update is for Golden Hour only.

It must not modify or interfere with:

1. Moon phase logic
2. Tide generation logic, except where Golden Hour is attached to an existing tide location
3. Existing sun or moon calendar products unless required for Golden Hour integration

Golden Hour is a separate product option and a separate Stripe code path.

## Core Golden Hour Behavior

Golden Hour is location dependent.

Use SunCalc for Golden Hour generation.

For each day and location, use:

`SunCalc.getTimes(date, lat, lng)`

Golden Hour must generate 2 timed events per day.

### Morning Golden Hour

Start: `sunrise`  
End: `goldenHourEnd`

### Evening Golden Hour

Start: `goldenHour`  
End: `sunset`

Do not approximate Golden Hour manually from sunrise and sunset.  
Use SunCalc’s Golden Hour fields directly.

## Product Model

Golden Hour must support 3 use cases.

### 1. Standalone Golden Hour purchase

A user can purchase Golden Hour without buying tides or moon phases.

Standalone Golden Hour can be generated for:

1. Current location
2. A searched and selected map location

### 2. Golden Hour as an add on to a tide location

When a user is purchasing a tide location, they can optionally add Golden Hour for that same location.

In this case, Golden Hour uses the tide location’s:

1. Latitude
2. Longitude
3. Location name

### 3. Golden Hour for Pro users

A Pro user must be able to create a Golden Hour calendar for any location they choose.

This includes:

1. Current location
2. Any searched and selected map location
3. Any tide or map location

A Pro user must not be restricted to Golden Hour only as an add on to a tide purchase.

## User Access Rules

### Non Pro users

Non Pro users can access Golden Hour in 2 ways.

#### A. Standalone purchase

They can buy Golden Hour for:

1. Current location
2. A searched and selected map location

#### B. Tide add on

They can add Golden Hour while purchasing a tide location.

In tide purchase flows, Golden Hour means:

Use the same tide location automatically.

Do not ask for a second location inside a tide add on flow.

### Pro users

Pro users must be able to add Golden Hour to any location they choose.

This means:

1. Pro users can create a Golden Hour calendar directly without needing a tide purchase
2. Pro users can use current location
3. Pro users can use any searched and selected map location
4. Pro users can use any selected tide or map location
5. Pro users should still see Golden Hour in tide purchase flows as an add on option for convenience

Golden Hour should feel like an unlocked location based feature for Pro users.

## UI Integration Requirements

Use the existing HTML naming exactly as it already exists:

1. `leaflet-popup`
2. `planModal`
3. `upsellModal`

Do not rename these structures.

## leaflet-popup Requirements

When a user is viewing a tide location in the `leaflet-popup`, add a Golden Hour checkbox near the download flow.

Meaning of this checkbox:

**Add Golden Hour for this same tide location**

Rules:

1. If checked, Golden Hour uses the selected tide location automatically
2. Do not ask for a second location in this flow
3. This is an add on behavior tied to the selected tide location

If the user is Pro, they may still use this checkbox for convenience, but Pro must also have a broader Golden Hour creation option elsewhere.

## planModal Requirements

Add Golden Hour as an option in `planModal`.

`planModal` must support:

### Tide context

If the user is currently in a tide location purchase flow, Golden Hour means add it for this same tide location.

### Standalone context

If the user is entering Golden Hour as a standalone product, allow location choice via:

1. Current location
2. Searched and selected map location

### Pro context

If the user has Pro, allow direct Golden Hour creation for:

1. Current location
2. Searched and selected map location
3. Selected map location or tide location

## upsellModal Requirements

Add Golden Hour as an upsell option in `upsellModal`.

Behavior depends on context.

### Tide location upsell

If the user is in a tide purchase context, Golden Hour means add it for this same tide location.

### Standalone upsell

If the user is not tied to a tide flow, Golden Hour may be offered as a standalone product using:

1. Current location
2. Searched and selected map location

### Pro upsell

If the user is Pro, Golden Hour should be presented as an unlocked feature for any location they choose.

## Search Result Map Marker for Golden Hour

When a user searches for a location using the existing map search bar and selects a result, the app must:

1. Move the map to that searched location
2. Place a marker at that searched location
3. Make that marker selectable
4. Treat that marker as a Golden Hour only location

This marker is not a tide station unless it actually matches a tide station.

### Search marker behavior

The searched location marker must:

1. Support Golden Hour creation
2. Support standalone Golden Hour purchase
3. Support Pro Golden Hour creation
4. Not show tide purchase options if the location is not a tide station

### Marker management

Only one active searched location Golden Hour marker should exist at a time.

When a new search result is selected:

1. Remove the previous searched location marker
2. Replace it with the new one

### Popup behavior

The searched location marker popup should clearly indicate that this is a selected location for Golden Hour.

Example action:

**Create Golden Hour Calendar**

Do not treat this marker like a tide station marker unless it is actually a tide station.

## Current Location Flow

The app already has a map search bar and a GPS based current location flow.

Reuse this existing functionality for Golden Hour.

### Current location behavior

If a user chooses current location for Golden Hour:

1. Use the existing GPS based location flow
2. Capture the user’s latitude and longitude
3. Use that location for Golden Hour calendar generation
4. Provide a clear location label where possible

## Manual Golden Hour Selection Decision

Do not build a separate manual Golden Hour selector form.

Manual Golden Hour selection should use the existing map search and GPS location system.

This means standalone Golden Hour location selection must be:

1. Use my current location
2. Search on the map and select a location

This is the selected UX decision for version one.

Do not ask users to manually enter raw latitude and longitude.

Do not require a separate pin dropping tool if the current search and selection flow already works.

## UX Rules

1. In tide related flows, Golden Hour means the same tide location
2. Do not ask for another location inside tide add on flows
3. Standalone Golden Hour is the flow where current location or searched map location should be chosen
4. Pro users must be able to create Golden Hour for any location
5. Do not expose raw latitude and longitude in the UI unless needed internally
6. Keep the purchase flow simple and low friction
7. Golden Hour should not be bundled automatically into tides or moon phases
8. Golden Hour should remain a separate product option and separate Stripe path

## Calendar Event Requirements

Golden Hour calendar generation must create 2 timed events per day.

### Event summaries

Use the location name in the summary.

Examples:

`Morning Golden Hour • Port Renfrew`  
`Evening Golden Hour • Port Renfrew`  
`Morning Golden Hour • Home`  
`Evening Golden Hour • Home`

If the user selected a searched place name, use that label.

### Event descriptions

#### Morning event description

Location: `{locationName}`  
Window: Sunrise to golden hour end

#### Evening event description

Location: `{locationName}`  
Window: Golden hour start to sunset

Keep descriptions simple and useful.

## Location Source Rules

Golden Hour must support these location sources.

### 1. Tide location

Use existing tide station or map location coordinates.

### 2. Current location

Reuse the existing find my current location latitude and longitude flow.

### 3. Searched map location

Use the coordinates from the location selected through the existing map search bar.

If there is already a reusable search or map selection pattern, reuse it.  
If not, implement the smallest safe version.

## Technical Requirements

1. Use SunCalc for Golden Hour generation
2. Reuse existing latitude and longitude sources where possible
3. Reuse existing current location logic where possible
4. Reuse existing map search selection logic where possible
5. Keep the refactor minimal
6. Do not break Stripe flows
7. Do not merge Golden Hour into moon phases
8. Do not merge Golden Hour into tides automatically
9. Golden Hour must remain purchasable on its own
10. Golden Hour must remain available as a tide add on
11. Pro users must be able to create Golden Hour for any location they choose

## Stripe and Product Logic

Golden Hour is a separate option and a separate Stripe code path.

Support these combinations.

### Non Pro

1. Golden Hour only using current location
2. Golden Hour only using searched map location
3. Tide location only
4. Tide location plus Golden Hour
5. Tide location plus moon phases
6. Tide location plus moon phases plus Golden Hour

### Pro

1. Pro user can add Golden Hour for any location
2. Pro user can still add Golden Hour to a tide location directly
3. Pro user should not be forced into a tide purchase flow to use Golden Hour

Do not merge Golden Hour into Pro invisibly.  
The UI should still communicate clearly what is being created.

## Implementation Guardrails

Do not:

1. Change moon phase logic
2. Change unrelated tide logic
3. Rename `leaflet-popup`, `planModal`, or `upsellModal`
4. Ask for a second location during tide add on flows
5. Expose technical location data unnecessarily
6. Build a separate manual location entry flow if current location and map search already cover the use case

Do:

1. Keep Golden Hour logic isolated
2. Wire it cleanly into existing purchase and upsell flows
3. Support standalone, tide add on, and Pro unlocked flows
4. Keep the UX simple
5. Reuse the current map search bar and current location logic
6. Create a Golden Hour only marker when a searched location is selected

## Required Output From Implementation

After coding, report back with:

1. Which files changed
2. How `leaflet-popup` was updated
3. How `planModal` was updated
4. How `upsellModal` was updated
5. How standalone Golden Hour location selection works
6. How Pro Golden Hour location selection works
7. How the searched location Golden Hour marker works
8. How current location Golden Hour works
9. How Golden Hour uses SunCalc
10. How the Stripe product path was wired
11. What exact purchase combinations are now supported