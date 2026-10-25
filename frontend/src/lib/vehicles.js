import axios from "./axios";

// Vehicle makes/models that have parts in the catalogue, fetched once per page load.
let cache = null;
export const loadVehicleCatalog = () => {
  cache ??= axios.get("/products/vehicles")
    .then(({ data }) => (Array.isArray(data?.makes) ? data.makes : []))
    .catch((error) => {
      cache = null;
      throw error;
    });
  return cache;
};

const currentYear = new Date().getFullYear();
// Model years offered in the fitment selectors (Chinese cars sold in Iran: 2005+).
export const VEHICLE_YEARS = Array.from({ length: currentYear - 2004 }, (_, index) => currentYear - index);
