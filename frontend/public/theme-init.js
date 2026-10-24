// Applies the saved theme before first paint. Kept as a static file (not an
// inline script) so the Content-Security-Policy can use script-src 'self'.
try {
  const savedTheme = localStorage.getItem("miba-theme");
  if (savedTheme === "dark") {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.colorScheme = "dark";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#0b0d10");
  }
} catch {
  // Fall back to the light theme when storage is unavailable.
}
