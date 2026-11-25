/**
 * The single `--import` of the visual run's Next server. `next dev` folds
 * repeated `--import` flags into one broken path when it forks the server, so
 * both network fixtures load from here, the GitHub boundary first: the public
 * catalog fixture answers its two URLs and delegates everything else to it.
 */
import "./github-fixture.ts";
import "../accounts-reference-e2e/src/catalog-fetch-fixture.ts";
