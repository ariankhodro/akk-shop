import { create } from "zustand";
import toast from "react-hot-toast";
import axios from "../lib/axios";

const messageFrom = (error, fallback) => error.response?.data?.message || fallback;

export const useCategoryStore = create((set, get) => ({
  categories: [],
  adminCategories: [],
  loading: false,
  error: "",

  fetchCategories: async () => {
    try {
      const response = await axios.get("/categories");
      const categories = Array.isArray(response.data.categories) ? response.data.categories : [];
      set({ categories, error: "" });
      return categories;
    } catch (error) {
      set({ error: messageFrom(error, "دریافت دسته‌بندی‌ها ناموفق بود.") });
      return get().categories;
    }
  },

  fetchAdminCategories: async () => {
    set({ loading: true, error: "" });
    try {
      const response = await axios.get("/categories/admin");
      const categories = Array.isArray(response.data.categories) ? response.data.categories : [];
      set({ adminCategories: categories, loading: false });
      return categories;
    } catch (error) {
      const message = messageFrom(error, "دریافت دسته‌بندی‌ها ناموفق بود.");
      set({ loading: false, error: message });
      toast.error(message);
      return [];
    }
  },

  createCategory: async (payload) => {
    set({ loading: true, error: "" });
    try {
      await axios.post("/categories", payload);
      toast.success("دسته‌بندی ایجاد شد.");
      set({ loading: false });
      await Promise.all([get().fetchAdminCategories(), get().fetchCategories()]);
      return true;
    } catch (error) {
      const message = messageFrom(error, "ایجاد دسته‌بندی ناموفق بود.");
      set({ loading: false, error: message });
      toast.error(message);
      return false;
    }
  },

  updateCategory: async (id, payload) => {
    set({ loading: true, error: "" });
    try {
      await axios.patch("/categories/" + id, payload);
      toast.success("دسته‌بندی به‌روزرسانی شد.");
      set({ loading: false });
      await Promise.all([get().fetchAdminCategories(), get().fetchCategories()]);
      return true;
    } catch (error) {
      const message = messageFrom(error, "به‌روزرسانی دسته‌بندی ناموفق بود.");
      set({ loading: false, error: message });
      toast.error(message);
      return false;
    }
  },

  deleteCategory: async (id) => {
    set({ loading: true, error: "" });
    try {
      await axios.delete("/categories/" + id);
      toast.success("دسته‌بندی حذف شد.");
      set({ loading: false });
      await Promise.all([get().fetchAdminCategories(), get().fetchCategories()]);
      return true;
    } catch (error) {
      const message = messageFrom(error, "حذف دسته‌بندی ناموفق بود.");
      set({ loading: false, error: message });
      toast.error(message);
      return false;
    }
  },
}));
