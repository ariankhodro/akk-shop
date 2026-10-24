import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "react-hot-toast";

import Navbar from "./components/Navbar";
import StoreFooter from "./components/StoreFooter";
import LoadingSpinner from "./components/LoadingSpinner";
import PageMeta from "./components/PageMeta";
import { PRIVATE_ROUTE_META } from "./lib/seo-utils.js";
import { useUserStore } from "./stores/useUserStore";
import { useCartStore } from "./stores/useCartStore";

const HomePage = lazy(() => import("./pages/HomePage"));
const ShopPage = lazy(() => import("./pages/ShopPage"));
const SignUpPage = lazy(() => import("./pages/SignUpPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const CategoryPage = lazy(() => import("./pages/CategoryPage"));
const ProductDetailsPage = lazy(() => import("./pages/ProductDetailsPage"));
const CartPage = lazy(() => import("./pages/CartPage"));
const WishlistPage = lazy(() => import("./pages/WishlistPage"));
const StoreInfoPage = lazy(() => import("./pages/StoreInfoPage"));
const NewsletterUnsubscribePage = lazy(() => import("./pages/NewsletterUnsubscribePage"));
const PurchaseSuccessPage = lazy(() => import("./pages/PurchaseSuccessPage"));
const PurchaseCancelPage = lazy(() => import("./pages/PurchaseCancelPage"));
const MyOrdersPage = lazy(() => import("./pages/MyOrdersPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const CampaignPage = lazy(() => import("./pages/CampaignPage"));
const CampaignsPage = lazy(() => import("./pages/CampaignsPage"));
const CollectionPage = lazy(() => import("./pages/CollectionPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));

const privateRoutePage = (path, element) => {
  const meta = PRIVATE_ROUTE_META[path];
  return <>{meta && <PageMeta title={meta.title} description={meta.description} path={path} robots="noindex, nofollow" canonical={false} />}{element}</>;
};

const RouteLoadingFallback = () => (
  <div
    role="status"
    aria-live="polite"
    className="flex min-h-[45vh] items-center justify-center px-4 py-16 text-sm text-[var(--ui-muted)]"
  >
    <span className="ml-3 h-5 w-5 animate-spin rounded-full border-2 border-[var(--ui-border)] border-t-[var(--ui-accent)] motion-reduce:animate-none" aria-hidden="true" />
    در حال بارگذاری صفحه…
  </div>
);

function App() {
  const location = useLocation();
  const isAccountPage = ["/login", "/signup", "/forgot-password", "/reset-password"].includes(location.pathname);
  const { user, checkAuth, checkingAuth } = useUserStore();
  const { setAuthenticated, initializeGuestCart, mergeGuestCart } = useCartStore();

  useEffect(() => { checkAuth(); }, [checkAuth]);
  useEffect(() => {
    setAuthenticated(Boolean(user));
    if (!user) {
      initializeGuestCart();
      return;
    }
    mergeGuestCart();
  }, [user, setAuthenticated, initializeGuestCart, mergeGuestCart]);

  if (checkingAuth) return <LoadingSpinner />;

  return (
    <div className="min-h-screen overflow-x-hidden bg-[var(--ui-canvas)] text-[var(--ui-text)]">
      <div className={`relative z-50 ${isAccountPage ? "pt-0" : "pt-32 md:pt-44 min-[1680px]:pt-32"}`}>
        {!isAccountPage && <Navbar />}
        <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/shop" element={<ShopPage />} />
            <Route path="/new-arrivals" element={<CollectionPage type="newest" />} />
            <Route path="/bestsellers" element={<CollectionPage type="bestsellers" />} />
            <Route path="/featured-products" element={<CollectionPage type="featured" />} />
            <Route path="/looks/:slug" element={<CollectionPage type="look" />} />
            <Route path="/campaigns" element={<CampaignsPage />} />
            <Route path="/campaign/:campaignId" element={<CampaignPage />} />
            <Route path="/signup" element={!user ? privateRoutePage("/signup", <SignUpPage />) : <Navigate to={location.state?.from?.pathname || "/"} />} />
            <Route path="/login" element={!user ? privateRoutePage("/login", <LoginPage />) : <Navigate to={location.state?.from?.pathname || "/"} />} />
            <Route path="/forgot-password" element={privateRoutePage("/forgot-password", <ForgotPasswordPage />)} />
            <Route path="/reset-password" element={privateRoutePage("/reset-password", <ResetPasswordPage />)} />
            <Route path="/secret-dashboard" element={privateRoutePage("/secret-dashboard", user?.role === "admin" ? <AdminPage /> : <Navigate to="/login" />)} />
            <Route path="/category/:slug" element={<CategoryPage />} />
            <Route path="/product/:productId" element={<ProductDetailsPage />} />
            <Route path="/cart" element={privateRoutePage("/cart", <CartPage />)} />
            <Route path="/profile" element={user ? privateRoutePage("/profile", <ProfilePage />) : <Navigate to="/login" state={{ from: { pathname: "/profile" } }} />} />
            <Route path="/orders" element={user ? privateRoutePage("/orders", <MyOrdersPage />) : <Navigate to="/login" state={{ from: { pathname: "/orders" } }} />} />
            <Route path="/wishlist" element={privateRoutePage("/wishlist", <WishlistPage />)} />
            <Route path="/shipping-policy" element={<StoreInfoPage />} />
            <Route path="/returns-policy" element={<StoreInfoPage />} />
            <Route path="/support" element={<StoreInfoPage />} />
            <Route path="/faq" element={<StoreInfoPage />} />
            <Route path="/privacy-policy" element={<StoreInfoPage />} />
            <Route path="/terms-of-use" element={<StoreInfoPage />} />
            <Route path="/newsletter-unsubscribe" element={privateRoutePage("/newsletter-unsubscribe", <NewsletterUnsubscribePage />)} />
            <Route path="/purchase-success" element={user ? privateRoutePage("/purchase-success", <PurchaseSuccessPage />) : <Navigate to="/login" />} />
            <Route path="/purchase-cancel" element={user ? privateRoutePage("/purchase-cancel", <PurchaseCancelPage />) : <Navigate to="/login" />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </div>
      {!isAccountPage && <StoreFooter />}
      <Toaster />
    </div>
  );
}

export default App;
