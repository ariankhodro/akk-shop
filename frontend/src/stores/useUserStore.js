import { create } from "zustand";
import axios from "../lib/axios.js";
import { toast } from "react-hot-toast";
import { createRefreshCoordinator, shouldAttemptTokenRefresh } from "../lib/refresh-coordinator.js";
import { clearSessionHint, hasSessionHint, setSessionHint } from "../lib/session-hint.js";

const getErrorMessage = (error, fallback = "خطایی رخ داد") =>
	error.response?.data?.message || error.message || fallback;

export const useUserStore = create((set) => ({
	user: null,
	loading: false,
	// True only while the initial session probe is in flight at boot. Token
	// refreshes mid-session must never touch it (it gates the whole app tree).
	// Anonymous visitors (no session hint) have nothing to probe.
	checkingAuth: hasSessionHint(),

	signup: async ({ name, email, password, confirmPassword }) => {
		set({ loading: true });

		if (password !== confirmPassword) {
			set({ loading: false });
			return toast.error("رمزهای عبور یکسان نیستند");
		}

		try {
			const res = await axios.post("/auth/signup", { name, email, password });
			setSessionHint();
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
			setSessionHint();
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
			clearSessionHint();
			set({ user: null });
		}
	},

	checkAuth: async () => {
		if (!hasSessionHint()) {
			set({ checkingAuth: false, user: null });
			return;
		}

		try {
			const response = await axios.get("/auth/profile");

			if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
				throw new Error("پاسخ احراز هویت نامعتبر است");
			}

			setSessionHint();
			set({ user: response.data, checkingAuth: false });
		} catch (error) {
			console.error("بررسی احراز هویت ناموفق بود:", error);
			// Only a definitive auth failure clears the hint; a network blip must not.
			if (error?.response?.status === 401 || error?.response?.status === 403) clearSessionHint();
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
		// Deliberately does not touch `checkingAuth` or `user`: the interceptor
		// decides what to do on failure (another tab may have won the race).
		const response = await axios.post("/auth/refresh-token");
		return response.data;
	},

	// Re-validates the session after a failed refresh. Returns true when the
	// cookies are in fact valid (e.g. another tab rotated them first).
	recheckSession: async () => {
		try {
			const response = await axios.get("/auth/profile", { _retry: true });
			if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) return false;
			set({ user: response.data });
			return true;
		} catch {
			return false;
		}
	},
}));

const refreshSessionOnce = createRefreshCoordinator(async () => {
	const store = useUserStore.getState();
	try {
		return await store.refreshToken();
	} catch (error) {
		const status = error?.response?.status;
		// Network/5xx failures say nothing about the session: keep the user in.
		if (status !== 401 && status !== 403) throw error;
		// Lost a refresh race against another tab? The winner's cookies are valid.
		if (await store.recheckSession()) return undefined;
		void store.logout();
		throw error;
	}
});

axios.interceptors.response.use(
	(response) => response,
	async (error) => {
		const originalRequest = error.config;
		if (!shouldAttemptTokenRefresh(error)) return Promise.reject(error);
		// No session hint: an anonymous visitor, nothing to refresh.
		if (!hasSessionHint()) return Promise.reject(error);

		originalRequest._retry = true;

		await refreshSessionOnce();
		return axios(originalRequest);
	}
);
