import {
  columnFilteringFeature,
  columnVisibilityFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
} from "@tanstack/react-table";

// Sorting and pagination run on the API; selection and visibility use the
// official table features. No client row model reorders a server page.
export const catalogTableFeatures = tableFeatures({
  columnVisibilityFeature,
  globalFilteringFeature,
  columnFilteringFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
});
export type CatalogTableFeatures = typeof catalogTableFeatures;
