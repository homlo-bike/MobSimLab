# Regions

In the **GIS** tab, switch from **Streets** to **Regions** to describe areas you know better than the open data: a neighbourhood's population density, land value, tax revenue or jobs. Values you enter take priority over WorldPop, OpenStreetMap and the World Bank in the [benefit tables](benefit-tables.md). The regions are not used anywhere else.

## Add a region

- **Draw a region**: tap the map to place the corners (at least 3), then **Finish**. **Cancel** stops drawing.
- **Import from OpenStreetMap**: tap a place on the map to list the neighbourhoods, districts and other named areas around it, then pick one. Its boundary is copied into the project.

## Enter what you know

Each region has a name and these values, all optional:

| Value | Unit | Replaces |
|-------|------|----------|
| Primary land use | Residential, commercial, industrial, mixed or public | How OpenStreetMap buildings without a use are counted |
| Land and building value | per m² of floor area | The value from GDP per person, for land value uplift |
| Property tax revenue | a year | The property tax rate, for tax from uplift |
| Population density | people per km² | WorldPop and building floor area |
| Jobs in the region | jobs | Jobs from building floor area |
| GDP per person | a year | The World Bank country value |
| Residents with a job | % of all residents | The World Bank employment rate |

Money is in the project's local currency. Leave a value empty to keep the sourced one. Where regions overlap, the one added last wins. **Delete region** removes it.

Regions are saved with the project, for everyone who opens it. Viewers can see them but not change them.
