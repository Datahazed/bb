# Plugin card taxonomy

Extension surfaces use three different information shapes. They share plugin
identity primitives, but they should not collapse into one universal card.

| Variant                  | Surface and component                                                                    | Job                                                                    | Information priority                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Catalog decision card    | Browse shelves and grids, plus author pages; `PluginCatalogCard` on `ResourceBrowseCard` | Help someone decide whether to inspect or install a plugin             | Name and identity, description, author/origin, useful catalog stats, then the install state/action                |
| Operational resource row | Installed plugins; `InstalledPluginRow` on `ResourceRow`                                 | Scan runtime health and change the installed state                     | Name and identity, current problem or description, update signal, enable/disable control, then details navigation |
| Authored-listing row     | My plugins; `MyPluginsTab` on `ResourceRow`                                              | Track a plugin the user owns through its marketplace-listing lifecycle | Name and identity, description, listing status, then details navigation                                           |

Two intentionally smaller variants reuse those shapes without pretending to be
new resource types:

- Author pages use the catalog decision card because the job is still browsing
  and installing; author ownership only changes the grouping context.
- “More from this author” is a compact catalog teaser. It navigates to another
  listing and therefore omits install, trust, and status controls.

Create-plugin examples are not plugin cards. `ShowcaseExampleCard` is a prompt
seed: activating one writes an example or capability brief into the composer.
It must not show marketplace metadata, installed state, or catalog actions.

## Shared boundaries

- `PluginLogo` and `CatalogEntryIcon` own identity artwork and fallbacks.
- `ResourceBrowseCard` owns the generic decision-card interaction and focus
  target; plugin-specific hierarchy and metadata remain in `PluginCatalogCard`.
- `ResourceRow` owns dense operational/listing geometry. Runtime and publication
  states stay with their respective rows rather than leaking into catalog cards.
- Install, enable/disable, update, and publication status each appear once on
  the control or signal that owns that state.
