import axios from "axios";
import { toPersianUserMessage } from "./user-error-message.js";

const axiosInstance = axios.create({
  baseURL: import.meta.env?.VITE_API_URL || "/api",
  withCredentials: true,
});

// Normalize errors centrally so English backend/transport messages are never
// accidentally shown directly in customer-facing UI.
axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (error?.response) {
      const original = error.response.data?.message;
      if (error.response.data && typeof error.response.data === "object") {
        error.response.data.message = toPersianUserMessage(original, status);
      }
      error.userMessage = toPersianUserMessage(original, status);
    } else {
      error.userMessage = toPersianUserMessage(error?.message);
      error.message = error.userMessage;
    }
    return Promise.reject(error);
  },
);

export default axiosInstance;
