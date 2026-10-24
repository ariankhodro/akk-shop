import { create } from "zustand";
import axios from "../lib/axios.js";
import { toast } from "react-hot-toast";
import { createRefreshCoordinator, shouldAttemptTokenRefresh } from "../lib/refresh-coordinator.js";

const getErrorMessage = (error, fallback = "خطایی رخ داد") =>
	error.response?.data?.message || error.message || fallback;

export const useUserStore = create((set) => ({
	user: null,
	loading: false,
	checkingAuth: true,

	signup: async ({ name, email, password, confirmPassword }) => {
		set({ loading: true });

		if (password !== confirmPassword) {
			set({ loading: false });
			return toast.error("رمزهای عبور یکسان نیستند");
		}

		try {
			const res = await axios.post("/auth/signup", { name, email, password });
			set({ user: res.data, loading: false });
		} catch (error) {
			set({ loading: false });
			toast.error(getErrorMessage(error));
		}
	},

	login: async (email, password) => {
		set({ loading: true });

		try {
			const res = await axios.post("/auth/login", { email, password });
			set({ user: res.data, loading: false });
		} catch (error) {
			set({ loading: false });
			toast.error(getErrorMessage(error));
		}
	},

	logout: async () => {
		try {
			await axios.post("/auth/logout");
		} catch (error) {
			console.error("درخواست خروج ناموفق بود:", error);
		} finally {
			set({ user: null });
		}
	},

	checkAuth: async () => {
		set({ checkingAuth: true });

		try {
			const response = await axios.get("/auth/profile");

			if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
				throw new Error("پاسخ احراز هویت نامعتبر است");
			}

			set({ user: response.data, checkingAuth: false });
		} catch (error) {
			console.error("بررسی احراز هویت ناموفق بود:", error);
			set({ checkingAuth: false, user: null });
		}
	},

	updateProfile: async (name) => {
		const response = await axios.patch("/auth/profile", { name });
		const updatedUser = response.data?.user;
		if (updatedUser) set((state) => ({ user: state.user ? { ...state.user, ...updatedUser } : updatedUser }));
		return updatedUser;
	},

	refreshToken: async () => {
		set({ checkingAuth: true });

		try {
			const response = await axios.post("/auth/refresh-token");
			set({ checkingAuth: false });
			return response.data;
		} catch (error) {
			set({ user: null, checkingAuth: false });
			throw error;
		}
	},
}));

const refreshSessionOnce = createRefreshCoordinator(
	() => useUserStore.getState().refreshToken()
);

axios.interceptors.response.use(
	(response) => response,
	async (error) => {
		const originalRequest = error.config;
		if (!shouldAttemptTokenRefresh(error)) return Promise.reject(error);

		originalRequest._retry = true;

		try {
			await refreshSessionOnce();
			return axios(originalRequest);
		} catch (refreshError) {
			void useUserStore.getState().logout();
			return Promise.reject(refreshError);
		}
	}
);
