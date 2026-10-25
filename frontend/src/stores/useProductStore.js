import { create } from "zustand";

let categoryRequestCounter = 0;
import toast from "react-hot-toast";
import axios from "../lib/axios";

const getErrorMessage = (error, fallback) => error.response?.data?.message || fallback;

export const useProductStore = create((set) => ({
  products: [],
  priceBounds: null,
  categoryPagination: null,
  categoryFacets: { sizes: [], colors: [], fits: [], brands: [] },
  featuredProducts: [],
  newestProducts: [],
  loading: false,
  setProducts: (products) => set({ products, priceBounds: null }),

  createProduct: async (productData) => {
    set({ loading: true });
    try {
      const res = await axios.post("/products", productData);
      set((state) => ({ products: [...state.products, res.data], loading: false }));
      toast.success("قطعه ایجاد شد");
      return res.data;
    } catch (error) {
      toast.error(getErrorMessage(error, "ایجاد قطعه ناموفق بود"));
      set({ loading: false });
      throw error;
    }
  },

  fetchAllProducts: async (params = {}) => {
    set({ loading: true, error: "" });
    try {
      const response = await axios.get("/products", { params });
      set({ products: Array.isArray(response.data.products) ? response.data.products : [], priceBounds: null, loading: false, error: "" });
      return response.data;
    } catch (error) {
      const message = getErrorMessage(error, "دریافت قطعات ناموفق بود");
      set({ products: [], error: message, loading: false });
      toast.error(message);
      return null;
    }
  },

  updateProduct: async (productId, payload) => {
    set({ loading: true, error: "" });
    try {
      const response = await axios.put("/products/" + productId, payload);
      set((state) => ({
        products: state.products.map((product) => product._id === productId ? response.data : product),
        loading: false,
        error: "",
      }));
      toast.success("قطعه به‌روزرسانی شد");
      return response.data;
    } catch (error) {
      set({ loading: false });
      toast.error(getErrorMessage(error, "به‌روزرسانی قطعه ناموفق بود"));
      throw error;
    }
  },

  setProductActive: async (productId, isActive) => {
    try {
      const response = await axios.patch("/products/" + productId + "/active", { isActive });
      set((state) => ({ products: state.products.map((product) => product._id === productId ? response.data : product) }));
      toast.success(isActive ? "قطعه بازیابی شد" : "قطعه بایگانی شد");
      return true;
    } catch (error) {
      toast.error(getErrorMessage(error, "تغییر وضعیت قطعه ناموفق بود"));
      return false;
    }
  },

  fetchProductsByCategory: async (category, queryString = "") => {
    const requestId = ++categoryRequestCounter;
    set({ loading: true, products: [], error: "" });
    try {
      const suffix = queryString ? "?" + queryString : "";
      const response = await axios.get(`/products/category/${encodeURIComponent(category)}${suffix}`);
      if (requestId !== categoryRequestCounter) return response.data;
      set({
        products: Array.isArray(response.data.products) ? response.data.products : [],
        priceBounds: response.data.priceBounds || null,
        categoryPagination: response.data.pagination || null,
        categoryFacets: response.data.filterOptions || { sizes: [], colors: [], fits: [], brands: [] },
        loading: false,
        error: "",
      });
      return response.data;
    } catch (error) {
      if (requestId !== categoryRequestCounter) return null;
      set({ products: [], priceBounds: null, categoryPagination: null, loading: false, error: getErrorMessage(error, "دریافت قطعات ناموفق بود") });
      toast.error(getErrorMessage(error, "دریافت قطعات ناموفق بود"));
      return null;
    }
  },
  fetchNewestProducts: async () => {
    try {
      const response = await axios.get("/products/newest?limit=8");
      set({ newestProducts: Array.isArray(response.data.products) ? response.data.products : [] });
      return true;
    } catch (error) {
      console.error("Error fetching newest products:", error.message);
      return false;
    }
  },

  deleteProduct: async (productId) => {
    try {
      await axios.delete("/products/" + productId);
      set((state) => ({ products: state.products.filter((product) => product._id !== productId) }));
      toast.success("قطعه برای همیشه حذف شد");
      return true;
    } catch (error) {
      toast.error(getErrorMessage(error, "حذف قطعه ناموفق بود"));
      return false;
    }
  },

  updateProductStock: async (productId, stock) => {
    try {
      const response = await axios.patch(`/products/${productId}/stock`, { stock });
      set((state) => ({
        products: state.products.map((product) => product._id === productId ? { ...product, stock: response.data.stock } : product),
      }));
      toast.success("موجودی به‌روزرسانی شد");
      return true;
    } catch (error) {
      toast.error(getErrorMessage(error, "به‌روزرسانی موجودی ناموفق بود"));
      return false;
    }
  },


  updateProductVariantStock: async (productId, size, color, stock) => {
    try {
      const response = await axios.patch(`/products/${productId}/variant-stock`, { size, color, stock });
      set((state) => ({
        products: state.products.map((product) =>
          product._id === productId ? { ...product, variants: response.data.variants } : product
        ),
      }));
      toast.success("موجودی این گزینه به‌روزرسانی شد");
      return true;
    } catch (error) {
      toast.error(getErrorMessage(error, "به‌روزرسانی موجودی گزینه ناموفق بود"));
      return false;
    }
  },

  toggleFeaturedProduct: async (productId) => {
    set({ loading: true });
    try {
      const response = await axios.patch(`/products/${productId}`);
      set((state) => ({
        products: state.products.map((product) =>
          product._id === productId ? { ...product, isFeatured: response.data.isFeatured } : product
        ),
        loading: false,
      }));
    } catch (error) {
      set({ loading: false });
      toast.error(getErrorMessage(error, "به‌روزرسانی قطعه ناموفق بود"));
    }
  },

  fetchFeaturedProducts: async () => {
    try {
      const response = await axios.get("/products/featured");
      set({ featuredProducts: Array.isArray(response.data) ? response.data : [] });
    } catch (error) {
      console.error("Error fetching featured products:", error.message);
    }
  },
}));
