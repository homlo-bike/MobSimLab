/**
 * English messages of the project area (large-area projects): the area window where the planner draws the
 * polygons of the project area, New project's Select area and Project preferences' area block. Merged into each
 * language's dictionary; every language has its own file next to this one.
 */
export const areaEn = {
  "aw.title": "Project area",
  "aw.editing": "Editing the area of {name}",
  "aw.search": "Search a place to move the map, such as Homs",
  "aw.tools": "Drawing tools",
  "aw.draw": "Draw polygon",
  "aw.edit": "Edit points",
  "aw.pan": "Pan",
  "aw.hint.draw":
    "Click to add corners. Click the first corner or press Enter to close the polygon. Backspace removes the last corner.",
  "aw.hint.edit":
    "Click a polygon to select it. Drag a corner to move it, drag a midpoint to add a corner, double-click a corner to remove it.",
  "aw.hint.pan": "Drag to move the map. Click a polygon to select it.",
  "aw.statArea": "Area",
  "aw.statDownload": "Estimated download",
  "aw.mb": "{mb} MB",
  "aw.tiles.one": "{count} map tile",
  "aw.tiles.other": "{count} map tiles",
  "aw.limit": "Limit {mb} MB",
  "aw.overLimit":
    "The area holds more map data than the {mb} MB a project may hold. Make it smaller, or set polygons along routes to main roads and railways only.",
  "aw.polygons": "Polygons",
  "aw.empty":
    "No polygons yet. Draw one round each place the project covers, and a narrow one along each intercity route.",
  "aw.detail.full": "Full",
  "aw.detail.main": "Main roads and railways only",
  "aw.polyLine": "{detail} · {area} km²",
  "aw.name": "Name",
  "aw.detail": "Detail",
  "aw.fullHelp": "Streets, paths, buildings, schools and hospitals, population at 100 m, terrain.",
  "aw.mainHelp":
    "Motorway, trunk and primary roads, railways, terrain, population at 1 km. No buildings: draw towns along the route as Full for the noise map and walk access.",
  "aw.delete": "Delete polygon",
  "aw.newName": "Area {n}",
  "aw.save": "Save area",
  "aw.confirm.title": "Download map data for the new parts?",
  "aw.confirm.body":
    "New or changed: {list}. They need about {mb} MB. Removed parts are no longer used. Nothing is downloaded until you confirm.",
  "aw.confirm.item": "{name} ({detail}, {area} km²)",
  "aw.confirm.back": "Back to the map",
  "aw.confirm.save": "Save and download {mb} MB",
  "aw.select": "Select area",
  "aw.selectHint": "Draw the edges of the project on a map. Map data is downloaded only inside them.",
  "aw.change": "Change area",
  "aw.count.one": "{count} polygon",
  "aw.count.other": "{count} polygons",
  "aw.download": "about {mb} MB of map data",
  "aw.outline": "Outline of the project area",
  "aw.prefsIntro":
    "The polygons drawn round the project. Map data is downloaded only inside them, at each polygon’s detail.",
  "aw.dataFrom": "Map data from {date}",
  "aw.noData": "Map data not downloaded yet",
  "aw.editArea": "Edit area",
  "aw.drawArea": "Draw area",
  "aw.refresh": "Refresh map data",
  "aw.refreshHelp":
    "Refresh downloads the current OpenStreetMap data for the same area; the plan keeps its data date until you do.",
  "aw.none": "No project area yet. Draw one so the tools have map data.",
  "aw.saved": "Area saved.",
  "aw.data.noArea": "Draw the project area first, in Project preferences: the imports cover it.",
  "aw.data.area": "Project area: {names}. The imports cover only these polygons, {area} km².",
  "aw.pop.none": "No project area yet. Draw it in Project preferences.",
  "aw.pop.box": "The project area's polygons: {km2} km². The imports cover only them.",
  "aw.out.title": "Download map data outside the project area?",
  "aw.out.note": "The region {name} reaches outside the project area. Its outside part needs new map data.",
  "aw.out.part": "Outside part",
  "aw.out.km2": "about {km2} km²",
  "aw.out.detail": "Detail for the outside part",
  "aw.out.overLimit":
    "With it, the project area holds more map data than the {mb} MB a project may hold. Pick main roads and railways only, or make the area smaller in Project preferences.",
  "aw.out.adds":
    "Download adds the region to the project area as a new polygon, which you can edit later in the area window.",
  "aw.out.keep": "Keep the region, no download",
  "aw.out.download": "Download {mb} MB",
  "aw.out.downloading": "Downloading…",
  "aw.data.regions": "Geofabrik regions",
  "aw.data.regionsHelp": "One download for each country the polygons reach, each cut to the polygons.",
  "aw.outside.streetLine":
    "The street line {name} reaches outside the project area, where there is no map data.",
  "aw.outside.pluginLine": "The line {name} reaches outside the project area, where there is no map data.",
  "aw.outside.railway": "The railway reaches outside the project area, where there is no map data.",
  "aw.outside.depot": "The depot {name} reaches outside the project area, where there is no map data.",
  "aw.outside.cargoBike":
    "The cargo bike route reaches outside the project area, where there is no map data.",
  "aw.outside.fix": "Extend the area in Project preferences, Project area.",
} as const;

type AreaKey = keyof typeof areaEn;
type AreaPlural = AreaKey extends infer K ? (K extends `${infer B}.other` ? B : never) : never;
type AreaPluralForm = `${AreaPlural}.${"zero" | "one" | "two" | "few" | "many"}`;
/** A language's project area messages: every key of the English ones but plural forms, which it picks itself. */
export type AreaMessages = Record<Exclude<AreaKey, AreaPluralForm>, string> &
  Partial<Record<AreaPluralForm, string>>;
