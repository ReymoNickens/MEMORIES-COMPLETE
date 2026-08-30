# @evolveit/ui — unused, and on the wrong palette

Nothing in `apps/web/src` imports from this package. It is listed as a
dependency and in `transpilePackages`, but every component here has a live
counterpart inlined in a page, and the two have drifted:

| Here | Actually used | Divergence |
|---|---|---|
| `ScannerResult` | inline in `(staff)/scanner/page.tsx` | the page had `✓` as literal text where this renders `✓` |
| `OrderCard` | inline in `(staff)/bar/page.tsx` | `#121416` / `#C8CCD4` against the house `#100E14` / `#F3EDE4` |
| `PhoneInput`, `CurrencyInput` | inline in the menu and close screens | light `bg-gray-50` chrome, from the abandoned light theme |

Every component here hardcodes hex values from a third palette that matches
neither `tailwind.config.ts` nor `globals.css` — `#C8CCD4`, `#D8DCE2`,
`#9A9E9F`, `#111111`. A shared component library that nothing shares is a
place for design drift to accumulate unnoticed, which is exactly what happened.

Either adopt it — move the inline versions out of the pages and into here, on
the tokens in `globals.css` — or delete it. Do not leave it as it is.
