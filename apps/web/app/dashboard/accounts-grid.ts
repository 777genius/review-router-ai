// Header and rows are separate grids, so every track must be content-free
// (fr-based). The previous `auto` fourth track sized to the row actions and
// left the header columns misaligned with the row cells.
export const accountsGridColumns =
  "lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,.8fr)_minmax(0,1.1fr)]";
