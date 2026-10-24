import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
// Self-hosted Persian typeface: no third-party font requests, works when
// Google Fonts is unreachable, and keeps the CSP limited to 'self'.
import "@fontsource/vazirmatn/400.css";
import "@fontsource/vazirmatn/500.css";
import "@fontsource/vazirmatn/600.css";
import "@fontsource/vazirmatn/700.css";
import "@fontsource/vazirmatn/800.css";
import "./index.css";

import { BrowserRouter } from "react-router-dom";
import { installPersianValidation } from "./lib/persian-validity.js";

installPersianValidation();

createRoot(document.getElementById("root")).render(
	<StrictMode>
		<BrowserRouter>
			<App />
		</BrowserRouter>
	</StrictMode>
);
