# Accessibility

MobSimLab should be usable by everyone who plans public transport, including people who use a keyboard instead of a mouse, a screen reader, screen magnification or other assistive technology.

## Our commitment

We aim to meet [WCAG 2.2](https://www.w3.org/TR/WCAG22/) level AA for every part of the web app except the map, and to make all of those controls operable by keyboard (requirement NFR-A11Y-01 in [docs/architecture/02-requirements.md](docs/architecture/02-requirements.md)). The map and the editors drawn on it are excluded from this target for now; see the known limitations below.

We treat accessibility barriers as bugs, and we will not lower this target without a new ADR.

## What the app offers today

- **Languages:** the interface is available in 32 languages, with right-to-left layout for Arabic, Persian and Urdu. It follows your device's language unless you choose another one.
- **Settings:** under **Settings → App settings** you can turn on **Larger touch targets** and **Reduce motion**. Animations are also reduced when your operating system asks for less motion. These settings are saved to your account.
- **Labels:** many controls carry labels for screen readers.

## Supported environments

- Current versions of Chrome, Edge, Firefox and Safari on desktop computers.
- Phones and tablets with the same browsers, for viewing projects.

We have not yet tested MobSimLab with screen readers or other assistive technology, so we do not name any as supported. We will add them here once they are tested.

## Known limitations

- **The map and drawing editors** (for example the railway, street line and depot editors) need a mouse or touch, and give screen readers little information. They are outside the WCAG target above.
- **Not yet audited:** the automated accessibility checks and keyboard navigation tests in the [implementation plan](docs/architecture/12-implementation-plan.md) are not built yet, and the app has not been audited against WCAG 2.2. Parts of it may not yet meet the target.
- **No dark or high-contrast theme** is available yet.

## Reporting a barrier

If something is hard or impossible to use with your setup, please tell us:

- **In public:** open an issue with the [Accessibility barrier template](https://github.com/homlo-bike/MobSimLab/issues/new?template=accessibility_barrier.yml). Say what you were trying to do, where in the app it happened, and your browser, operating system and any assistive technology you use.
- **In private:** contact the maintainer, [@homlo-bike](https://github.com/homlo-bike), as described in the [Code of Conduct](CODE_OF_CONDUCT.md#enforcement). Security vulnerabilities go through [SECURITY.md](SECURITY.md) instead.
