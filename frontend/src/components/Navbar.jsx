import { useEffect, useMemo, useRef, useState } from "react";
import axios from "../lib/axios";
import { formatPrice } from "../lib/commerce";
import { normalizeDigits } from "../lib/normalize-digits";
import {
  ShoppingCart,
  Truck,
  Heart,
  Home,
  ShoppingBag,
  Grid2X2,
  ChevronLeft,
  LogIn,
  LogOut,
  Lock,
  Menu,
  UserRound,
  Search,
  SlidersHorizontal,
  X,
  ChevronDown,
  FolderTree,
  Moon,
  Sun,
  Building2,
  ClipboardList,
} from "lucide-react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useUserStore } from "../stores/useUserStore";
import { useCartStore } from "../stores/useCartStore";
import { useWishlistStore } from "../stores/useWishlistStore";
import { useCategoryStore } from "../stores/useCategoryStore";

const defaultCategories = [
  ["", "همه دسته‌بندی‌ها"],
  ["engine", "قطعات موتوری"],
  ["brakes", "سیستم ترمز"],
  ["suspension", "جلوبندی و تعلیق"],
  ["filters", "فیلترها"],
  ["electrical", "برق و الکترونیک"],
  ["body", "بدنه و تزئینات"],
  ["transmission", "گیربکس و کلاچ"],
  ["cooling", "سیستم خنک‌کاری"],
];

const sortOptions = [
  ["newest", "جدیدترین"],
  ["oldest", "قدیمی‌ترین"],
  ["priceAsc", "ارزان‌ترین"],
  ["priceDesc", "گران‌ترین"],
  ["nameAsc", "نام قطعه (الف تا ی)"],
];

const defaultFilters = {
  q: "",
  category: "",
  minPrice: "",
  maxPrice: "",
  sort: "newest",
};

const categoryLabel = (value, dynamicCategories = []) =>
  dynamicCategories.find((category) => category.slug === value)?.name?.fa ||
  defaultCategories.find(([category]) => category === value)?.[1] || value || "قطعات";

const categoryPath = (category, categories) => {
  const byId = new Map(categories.map((item) => [String(item._id), item]));
  const parts = [];
  let current = category;
  let remaining = 20;
  while (current && remaining-- > 0) {
    parts.unshift(current.name?.fa || current.name?.en || current.slug);
    current = byId.get(String(current.parentId || ""));
  }
  return parts.join(" / ");
};

const fieldClass =
  "mt-1 min-h-11 w-full rounded-xl border border-[var(--ui-border-strong)] bg-[var(--ui-surface)] px-3 py-2 text-sm text-[var(--ui-text)] outline-none transition focus:border-[var(--ui-accent)] focus:ring-2 focus:ring-[var(--ui-focus)]/20";

const readSavedTheme = () => {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem("miba-theme") === "dark"
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
};

const Navbar = () => {
  const { user, logout } = useUserStore();
  const isAdmin = user?.role === "admin";
  const isWholesale = user?.accountType === "wholesale";
  const wholesaleCompany = user?.wholesaleProfile?.companyName || "";
  const { cart } = useCartStore();
  const { items: savedProducts } = useWishlistStore();
  const { categories: dynamicCategories, fetchCategories } = useCategoryStore();
  const categories = useMemo(() => {
    if (!dynamicCategories.length) return defaultCategories;
    return [
      ["", "همه دسته‌بندی‌ها"],
      ...dynamicCategories.filter((category) => category.showInNavigation !== false)
        .map((category) => [category.slug, categoryPath(category, dynamicCategories)]),
    ];
  }, [dynamicCategories]);

  const navigationTree = useMemo(() => {
    if (!dynamicCategories.length) {
      return {
        roots: categories.filter(([slug]) => Boolean(slug)).map(([slug, name]) => ({
          _id: "legacy-" + slug,
          slug,
          name: { fa: name },
          parentId: null,
        })),
        childrenByParent: new Map(),
      };
    }

    const navigable = dynamicCategories.filter(
      (category) => category.isActive !== false && category.showInNavigation !== false,
    );
    const navigableIds = new Set(navigable.map((category) => String(category._id)));
    const roots = [];
    const childrenByParent = new Map();
    const sortCategories = (items) => items.sort((a, b) =>
      Number(a.sortOrder || 0) - Number(b.sortOrder || 0) ||
      String(a.name?.fa || a.name?.en || "").localeCompare(String(b.name?.fa || b.name?.en || ""), "fa")
    );

    navigable.forEach((category) => {
      const parentId = String(category.parentId || "");
      if (parentId && !navigableIds.has(parentId)) return;
      if (!parentId) {
        roots.push(category);
        return;
      }
      const children = childrenByParent.get(parentId) || [];
      children.push(category);
      childrenByParent.set(parentId, children);
    });

    childrenByParent.forEach(sortCategories);
    return { roots: sortCategories(roots), childrenByParent };
  }, [dynamicCategories, categories]);

  useEffect(() => { fetchCategories(); }, [fetchCategories]);
  const location = useLocation();
  const navigate = useNavigate();
  const [theme, setTheme] = useState(readSavedTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) themeColorMeta.setAttribute("content", theme === "dark" ? "#090a0c" : "#f5f6f8");
    try {
      window.localStorage.setItem("miba-theme", theme);
    } catch {
      // Theme still applies for this session when browser storage is unavailable.
    }
  }, [theme]);

  useEffect(() => {
    const slug = location.pathname.startsWith("/category/")
      ? decodeURIComponent(location.pathname.slice("/category/".length))
      : "";
    const currentCategory = dynamicCategories.find((item) => item.slug === slug);
    if (!currentCategory) return;

    setExpandedCategories((current) => {
      const next = { ...current };
      const byId = new Map(dynamicCategories.map((item) => [String(item._id), item]));
      let parentId = String(currentCategory.parentId || "");
      let depth = 0;
      while (parentId && depth++ < 20) {
        next[parentId] = true;
        parentId = String(byId.get(parentId)?.parentId || "");
      }
      return next;
    });
  }, [dynamicCategories, location.pathname]);
  const desktopSearchRef = useRef(null);
  const mobileSearchInputRef = useRef(null);
  const accountMenuRef = useRef(null);
  const [shippingAnnouncement, setShippingAnnouncement] = useState({
    loading: true,
    error: false,
    flatRate: 0,
    freeShippingThreshold: 0,
    currency: "IRT",
  });
  const [globalPriceBounds, setGlobalPriceBounds] = useState({ minPrice: 0, maxPrice: 1, count: 0 });
  const [filters, setFilters] = useState(defaultFilters);
  const [desktopFiltersOpen, setDesktopFiltersOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuScrollPositionRef = useRef(0);
  const [expandedCategories, setExpandedCategories] = useState({});
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [activeSearchSurface, setActiveSearchSurface] = useState(null);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [searchSuggestions, setSearchSuggestions] = useState({ products: [], loading: false, error: false });
  const suggestionQuery = filters.q.trim();
  const appliedFilterParams = new URLSearchParams(
    location.pathname === "/shop" ? location.search : "",
  );
  const appliedSort = appliedFilterParams.get("sort") || "newest";
  const activeFilterCount = [
    appliedFilterParams.get("q"),
    appliedFilterParams.get("category"),
    appliedFilterParams.get("minPrice"),
    appliedFilterParams.get("maxPrice"),
    appliedSort !== "newest" ? appliedSort : "",
  ].filter(Boolean).length;
  const categorySuggestions = suggestionQuery.length >= 2
    ? categories
        .filter(([value, label]) => value && (
          label.toLowerCase().includes(suggestionQuery.toLowerCase()) ||
          value.toLowerCase().includes(suggestionQuery.toLowerCase())
        ))
        .slice(0, 3)
    : [];

  useEffect(() => {
    let active = true;
    axios.get("/shipping?subtotal=0")
      .then(({ data }) => {
        if (!active) return;
        setShippingAnnouncement({
          loading: false,
          error: false,
          flatRate: Number(data.flatRate || 0),
          freeShippingThreshold: Number(data.freeShippingThreshold || 0),
          currency: String(data.currency || "IRT").toUpperCase(),
        });
      })
      .catch(() => {
        if (active) setShippingAnnouncement((current) => ({ ...current, loading: false, error: true }));
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    axios.get("/products/price-bounds")
      .then(({ data }) => {
        if (!active) return;
        const bounds = data.priceBounds || {};
        const minPrice = Number(bounds.minPrice);
        const maxPrice = Number(bounds.maxPrice);
        const count = Number(bounds.count);
        setGlobalPriceBounds({
          minPrice: Number.isFinite(minPrice) ? Math.max(0, Math.floor(minPrice)) : 0,
          maxPrice: Number.isFinite(maxPrice) ? Math.max(1, Math.ceil(maxPrice)) : 1,
          count: Number.isFinite(count) ? Math.max(0, count) : 0,
        });
      })
      .catch(() => {
        if (active) setGlobalPriceBounds({ minPrice: 0, maxPrice: 1, count: 0 });
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setFilters({
      q: params.get("q") || "",
      category: params.get("category") || "",
      minPrice: params.get("minPrice") || "",
      maxPrice: params.get("maxPrice") || "",
      sort: params.get("sort") || "newest",
    });
  }, [location.pathname, location.search]);

  useEffect(() => {
    const query = suggestionQuery;
    if (activeSearchSurface === null || query.length < 2) {
      setSearchSuggestions({ products: [], loading: false, error: false });
      setActiveSuggestionIndex(-1);
      return undefined;
    }

    const controller = new AbortController();
    setSearchSuggestions({ products: [], loading: true, error: false });
    setActiveSuggestionIndex(-1);

    const timeoutId = window.setTimeout(() => {
      const params = new URLSearchParams({ q: query, limit: "5", page: "1", sort: "newest" });
      axios
        .get(`/products/search?${params.toString()}`, { signal: controller.signal })
        .then(({ data }) => {
          if (controller.signal.aborted) return;
          setSearchSuggestions({
            products: Array.isArray(data.products) ? data.products.slice(0, 5) : [],
            loading: false,
            error: false,
          });
        })
        .catch((error) => {
          if (controller.signal.aborted || error.code === "ERR_CANCELED") return;
          setSearchSuggestions({ products: [], loading: false, error: true });
        });
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [activeSearchSurface, suggestionQuery]);

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      if (!desktopSearchRef.current?.contains(event.target)) {
        setDesktopFiltersOpen(false);
        if (activeSearchSurface === "desktop") setActiveSearchSurface(null);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [activeSearchSurface]);

  useEffect(() => {
    if (!accountMenuOpen) return undefined;

    const closeOnOutsideClick = (event) => {
      if (!accountMenuRef.current?.contains(event.target)) setAccountMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setAccountMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountMenuOpen]);

  useEffect(() => {
    if (location.pathname || location.search) {
      setMobileMenuOpen(false);
      setAccountMenuOpen(false);
    }
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement;
    const panel = document.querySelector("#store-menu-panel aside[role='dialog']");
    const scrollContainer = panel?.querySelector("[data-mobile-menu-scroll]");
    document.body.style.overflow = "hidden";
    if (scrollContainer) scrollContainer.scrollTop = mobileMenuScrollPositionRef.current;

    const getFocusable = () => Array.from(panel?.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ) || []).filter(element => element.getAttribute("aria-hidden") !== "true");
    const closeOnEscapeAndTrapFocus = event => {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    panel?.querySelector('button[aria-label="بستن منوی فروشگاه"]')?.focus();
    document.addEventListener("keydown", closeOnEscapeAndTrapFocus);
    return () => {
      if (scrollContainer) mobileMenuScrollPositionRef.current = scrollContainer.scrollTop;
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscapeAndTrapFocus);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!mobileSearchOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    mobileSearchInputRef.current?.focus();

    const closeOnEscape = (event) => {
      if (event.key === "Escape") setMobileSearchOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileSearchOpen]);

  const handleLogout = async () => {
    setAccountMenuOpen(false);
    setMobileMenuOpen(false);
    await logout();
    navigate("/");
  };

  const linkClass = ({ isActive }) =>
    `inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-full px-3 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)] ${isActive ? "bg-[var(--ui-surface-raised)] text-[var(--ui-text)]" : "text-[var(--ui-muted)] hover:bg-[var(--ui-surface-raised)] hover:text-[var(--ui-text)]"}`;

  const navigateToShop = (params) => {
    const query = params.toString();
    navigate({ pathname: "/shop", search: query ? `?${query}` : "" });
    setDesktopFiltersOpen(false);
    setMobileSearchOpen(false);
    setActiveSearchSurface(null);
  };

  const selectProductSuggestion = (product) => {
    setActiveSearchSurface(null);
    setDesktopFiltersOpen(false);
    setMobileSearchOpen(false);
    navigate(`/product/${product._id}`);
  };

  const selectCategorySuggestion = (category) => {
    setFilters({ ...defaultFilters, category: "" });
    setActiveSearchSurface(null);
    setDesktopFiltersOpen(false);
    setMobileSearchOpen(false);
    navigate("/category/" + encodeURIComponent(category));
  };

  const handleSuggestionKeyDown = (event) => {
    const suggestionCount = categorySuggestions.length + searchSuggestions.products.length;
    if (event.key === "Escape") {
      setActiveSearchSurface(null);
      setActiveSuggestionIndex(-1);
      return;
    }
    if (!suggestionCount) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestionIndex((current) => (current + 1) % suggestionCount);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestionIndex((current) => current <= 0 ? suggestionCount - 1 : current - 1);
    } else if (event.key === "Enter" && activeSuggestionIndex >= 0) {
      event.preventDefault();
      if (activeSuggestionIndex < categorySuggestions.length) {
        selectCategorySuggestion(categorySuggestions[activeSuggestionIndex][0]);
      } else {
        selectProductSuggestion(searchSuggestions.products[activeSuggestionIndex - categorySuggestions.length]);
      }
    }
  };

  const suggestionOptionCount = categorySuggestions.length + searchSuggestions.products.length;
  // ARIA combobox state for the search input of a given surface ("desktop" | "mobile").
  const comboboxProps = (surface) => {
    const open = activeSearchSurface === surface && suggestionQuery.length >= 2;
    return {
      role: "combobox",
      "aria-autocomplete": "list",
      "aria-haspopup": "listbox",
      "aria-expanded": open,
      "aria-controls": open ? `${surface}-search-suggestions` : undefined,
      "aria-activedescendant": open && activeSuggestionIndex >= 0 && activeSuggestionIndex < suggestionOptionCount
        ? `${surface}-search-option-${activeSuggestionIndex}`
        : undefined,
    };
  };

  const renderSearchSuggestions = (surface) => {
    if (activeSearchSurface !== surface || suggestionQuery.length < 2) return null;
    const hasSuggestions = suggestionOptionCount > 0;

    return (
      <>
      <p role="status" className="sr-only">
        {searchSuggestions.loading
          ? "در حال جست‌وجوی قطعات"
          : hasSuggestions
            ? `${new Intl.NumberFormat("fa-IR").format(suggestionOptionCount)} پیشنهاد موجود است`
            : "پیشنهادی پیدا نشد"}
      </p>
      <div
        id={`${surface}-search-suggestions`}
        role="listbox"
        aria-label="پیشنهادهای جست‌وجو"
        className={`${surface === "desktop" ? "absolute left-0 right-0 top-[calc(100%+0.65rem)] z-[60]" : "relative mt-2"} max-h-80 overflow-y-auto rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-2 shadow-[0_20px_55px_-24px_rgba(28,31,36,0.35)]`}
      >
        {categorySuggestions.length > 0 && (
          <div className="pb-2">
            <p className="px-3 pb-1 pt-2 text-[11px] font-semibold text-[var(--ui-muted)]">دسته‌بندی‌های پیشنهادی</p>
            {categorySuggestions.map(([value, label], index) => (
              <button
                key={value}
                id={`${surface}-search-option-${index}`}
                type="button"
                tabIndex={-1}
                role="option"
                aria-selected={activeSuggestionIndex === index}
                onMouseEnter={() => setActiveSuggestionIndex(index)}
                onClick={() => selectCategorySuggestion(value)}
                className={`flex min-h-10 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-right text-sm transition ${activeSuggestionIndex === index ? "bg-[var(--ui-hover)] text-[var(--ui-text)]" : "text-[var(--ui-muted)] hover:bg-[var(--ui-surface-raised)] hover:text-[var(--ui-text)]"}`}
              >
                <span>{label}</span>
                <span className="text-xs text-[var(--ui-muted)]">مشاهده دسته‌بندی</span>
              </button>
            ))}
          </div>
        )}

        {searchSuggestions.products.length > 0 && (
          <div className={categorySuggestions.length ? "border-t border-[#eceef2] pt-2" : ""}>
            <p className="px-3 pb-1 pt-1 text-[11px] font-semibold text-[var(--ui-muted)]">قطعات</p>
            {searchSuggestions.products.map((product, index) => {
              const optionIndex = categorySuggestions.length + index;
              return (
                <button
                  key={product._id}
                  id={`${surface}-search-option-${optionIndex}`}
                  type="button"
                  tabIndex={-1}
                  role="option"
                  aria-selected={activeSuggestionIndex === optionIndex}
                  onMouseEnter={() => setActiveSuggestionIndex(optionIndex)}
                  onClick={() => selectProductSuggestion(product)}
                  className={`flex min-h-[4.25rem] w-full items-center gap-3 rounded-xl px-2.5 py-2 text-right transition ${activeSuggestionIndex === optionIndex ? "bg-[var(--ui-hover)]" : "hover:bg-[var(--ui-canvas)]"}`}
                >
                  {product.image ? (
                    <img src={product.image} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-lg bg-[var(--ui-surface-raised)] object-cover" />
                  ) : (
                    <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[var(--ui-surface-raised)] text-[var(--ui-muted)]"><Search size={17} /></span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--ui-text)]">{product.name}</span>
                    <span className="mt-1 block truncate text-xs text-[var(--ui-muted)]">{categoryLabel(product.category, dynamicCategories)}</span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-[var(--ui-text-strong)]">{formatPrice(product.price)}</span>
                </button>
              );
            })}
          </div>
        )}

        {searchSuggestions.loading && (
          <p role="status" className="px-3 py-3 text-sm text-[var(--ui-muted)]">در حال جست‌وجوی قطعات…</p>
        )}
        {searchSuggestions.error && !searchSuggestions.loading && (
          <p role="status" className="px-3 py-3 text-sm text-[var(--ui-muted)]">پیشنهادها موقتاً در دسترس نیستند؛ جست‌وجو را ادامه دهید.</p>
        )}
        {!searchSuggestions.loading && !searchSuggestions.error && !hasSuggestions && (
          <p className="px-3 py-3 text-sm text-[var(--ui-muted)]">پیشنهادی پیدا نشد؛ عبارت دیگری را امتحان کنید.</p>
        )}
      </div>
      </>
    );
  };

  const toggleTheme = () => {
    setTheme((current) => current === "dark" ? "light" : "dark");
  };

  const renderThemeToggle = (insideMenu = false) => (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "تغییر به پوسته روشن" : "تغییر به پوسته تاریک"}
      aria-pressed={theme === "dark"}
      title={theme === "dark" ? "پوسته روشن" : "پوسته تاریک"}
      className={insideMenu
        ? "flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-3 text-sm font-semibold text-[var(--ui-text-strong)] transition hover:bg-[var(--ui-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]"
        : "hidden h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--ui-border-strong)] bg-[var(--ui-surface)] text-[var(--ui-text-strong)] shadow-sm transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)] lg:inline-flex"}
    >
      <span className="inline-flex min-w-0 items-center gap-3">
        {theme === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
        {insideMenu && <span>{theme === "dark" ? "فعال‌کردن پوسته روشن" : "فعال‌کردن پوسته تاریک"}</span>}
      </span>
      {insideMenu && <span className="text-xs font-normal text-[var(--ui-muted)]">{theme === "dark" ? "روشن" : "تیره"}</span>}
    </button>
  );

  const renderNavigationCategory = (category, depth = 0) => {
    const id = String(category._id);
    const children = navigationTree.childrenByParent.get(id) || [];
    const expanded = Boolean(expandedCategories[id]);
    const label = category.name?.fa || category.name?.en || category.slug;
    const isRoot = depth === 0;
    const isActive = location.pathname === "/category/" + encodeURIComponent(category.slug);

    return (
      <div
        key={id}
        className={isRoot
          ? "overflow-hidden rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] shadow-sm"
          : "relative min-w-0"}
      >
        <div className={"relative flex min-w-0 items-center gap-2 transition " +
          (isRoot ? "px-2 py-1" : "rounded-xl px-2 py-0.5 hover:bg-[var(--ui-hover)]") +
          (isActive ? " bg-[var(--ui-hover)]" : "")}
        >
          {!isRoot && <span aria-hidden="true" className="absolute right-0 top-1/2 h-px w-3 bg-[#c3c8cf]" />}
          <Link
            to={"/category/" + encodeURIComponent(category.slug)}
            onClick={() => setMobileMenuOpen(false)}
            aria-current={isActive ? "page" : undefined}
            className={"flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)] " +
              (isActive ? "font-bold text-[var(--ui-accent)]" : isRoot ? "font-semibold text-[var(--ui-text-strong)]" : "font-medium text-[var(--ui-muted)]")}
          >
            <span className={"inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg " +
              (isRoot ? "bg-[var(--ui-surface-raised)] text-[var(--ui-accent)]" : "text-[var(--ui-muted)]")}>
              {isRoot ? <FolderTree size={16} aria-hidden="true" /> : <span className="h-1.5 w-1.5 rounded-full bg-[#a0a5ad]" />}
            </span>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {isRoot && children.length > 0 && (
              <span className="shrink-0 rounded-full bg-[var(--ui-surface-raised)] px-2 py-0.5 text-[10px] font-medium text-[var(--ui-muted)]">
                {new Intl.NumberFormat("fa-IR").format(children.length)} زیر‌دسته
              </span>
            )}
          </Link>
          {children.length > 0 && (
            <button
              type="button"
              aria-label={(expanded ? "بستن" : "نمایش") + " زیر‌دسته‌های " + label}
              aria-expanded={expanded}
              aria-controls={"category-children-" + id}
              onClick={() => setExpandedCategories((current) => ({ ...current, [id]: !current[id] }))}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[var(--ui-accent)] transition hover:bg-[var(--ui-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]"
            >
              <ChevronDown size={17} className={"transition-transform duration-200 " + (expanded ? "rotate-180" : "")} aria-hidden="true" />
            </button>
          )}
        </div>
        {expanded && children.length > 0 && (
          <div
            id={"category-children-" + id}
            className={isRoot
              ? "mx-3 mb-3 mt-1 space-y-1 rounded-xl bg-[var(--ui-canvas)] p-2"
              : "relative mr-4 space-y-1 border-r border-dashed border-[var(--ui-border-strong)] py-1 pr-3"}
          >
            {children.map((child) => renderNavigationCategory(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const handleDesktopSearch = (event) => {
    event.preventDefault();
    const params = new URLSearchParams(
      location.pathname === "/shop" ? location.search : "",
    );
    const query = filters.q.trim();
    if (query) params.set("q", query);
    else params.delete("q");
    params.delete("page");
    navigateToShop(params);
  };

  const applyFilters = (event) => {
    event.preventDefault();
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      const normalized = String(value).trim();
      if (normalized) params.set(key, normalized);
    });
    params.set("page", "1");
    navigateToShop(params);
  };

  const clearFilters = () => {
    const query = filters.q.trim();
    setFilters({ ...defaultFilters, q: query });
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    navigateToShop(params);
  };

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const renderFilterFields = () => {
    const rangeMin = Math.max(0, globalPriceBounds.minPrice);
    const rangeMax = Math.max(rangeMin + 1, globalPriceBounds.maxPrice);
    const rangeSpan = rangeMax - rangeMin;
    const sliderStep = Math.max(1, Math.ceil(rangeSpan / 1200));
    const parsedMin = filters.minPrice.trim() === "" ? rangeMin : Number(filters.minPrice);
    const parsedMax = filters.maxPrice.trim() === "" ? rangeMax : Number(filters.maxPrice);
    const clamp = (value, fallback) =>
      Number.isFinite(value) ? Math.min(rangeMax, Math.max(rangeMin, value)) : fallback;
    const minCandidate = clamp(parsedMin, rangeMin);
    const maxCandidate = clamp(parsedMax, rangeMax);
    const sliderMinValue = Math.min(minCandidate, maxCandidate);
    const sliderMaxValue = Math.max(minCandidate, maxCandidate);
    const sliderMinPercent = ((sliderMinValue - rangeMin) / rangeSpan) * 100;
    const sliderMaxPercent = ((sliderMaxValue - rangeMin) / rangeSpan) * 100;

    const updateSlider = (field, rawValue) => {
      const value = clamp(Math.round(Number(rawValue)), field === "minPrice" ? sliderMinValue : sliderMaxValue);
      setFilters((current) => {
        const currentMin = current.minPrice.trim() === "" ? rangeMin : clamp(Number(current.minPrice), rangeMin);
        const currentMax = current.maxPrice.trim() === "" ? rangeMax : clamp(Number(current.maxPrice), rangeMax);
        if (field === "minPrice") {
          const nextMin = Math.min(value, currentMax);
          return { ...current, minPrice: nextMin <= rangeMin ? "" : String(nextMin) };
        }
        const nextMax = Math.max(value, currentMin);
        return { ...current, maxPrice: nextMax >= rangeMax ? "" : String(nextMax) };
      });
    };

    return (
      <div className="space-y-3">
        <div>
          <p className="text-xs font-medium text-[var(--ui-muted)]">محدوده قیمت ({formatPrice(rangeMin)} تا {formatPrice(rangeMax)})</p>
          <div className="mt-1 grid grid-cols-2 gap-3">
            <label className="text-xs text-[var(--ui-muted)]">
              از
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                dir="ltr"
                placeholder="بدون محدودیت"
                className={fieldClass}
                value={filters.minPrice}
                onChange={(event) => updateFilter("minPrice", normalizeDigits(event.target.value).replace(/\D/g, ""))}
              />
            </label>
            <label className="text-xs text-[var(--ui-muted)]">
              تا
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                dir="ltr"
                placeholder="بدون محدودیت"
                className={fieldClass}
                value={filters.maxPrice}
                onChange={(event) => updateFilter("maxPrice", normalizeDigits(event.target.value).replace(/\D/g, ""))}
              />
            </label>
          </div>
          <div className="mt-2 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-canvas)] px-3 py-3">
            <div className="mb-2 flex items-center justify-between gap-3 text-xs text-[var(--ui-muted)]">
              <span>از <strong className="tabular-nums text-[var(--ui-text)]">{formatPrice(sliderMinValue)}</strong></span>
              <span>تا <strong className="tabular-nums text-[var(--ui-text)]">{formatPrice(sliderMaxValue)}</strong></span>
            </div>
            <div className={"relative h-7 " + (globalPriceBounds.count > 0 ? "" : "opacity-50")} dir="ltr">
              <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--ui-chart-grid)]" />
              <div
                className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--ui-accent)]"
                style={{ left: sliderMinPercent + "%", right: 100 - sliderMaxPercent + "%" }}
              />
              <input
                type="range"
                min={rangeMin}
                max={rangeMax}
                step={sliderStep}
                value={sliderMinValue}
                disabled={globalPriceBounds.count === 0}
                aria-label="حداقل قیمت"
                aria-valuetext={formatPrice(sliderMinValue)}
                onChange={(event) => updateSlider("minPrice", event.target.value)}
                className="price-range-slider"
                style={{ zIndex: sliderMinValue >= sliderMaxValue - sliderStep ? 5 : 4 }}
              />
              <input
                type="range"
                min={rangeMin}
                max={rangeMax}
                step={sliderStep}
                value={sliderMaxValue}
                disabled={globalPriceBounds.count === 0}
                aria-label="حداکثر قیمت"
                aria-valuetext={formatPrice(sliderMaxValue)}
                onChange={(event) => updateSlider("maxPrice", event.target.value)}
                className="price-range-slider"
                style={{ zIndex: sliderMinValue >= sliderMaxValue - sliderStep ? 4 : 5 }}
              />
            </div>
          </div>
        </div>

        <label className="block text-xs font-medium text-[var(--ui-muted)]">
          مرتب‌سازی
          <select
            className={fieldClass}
            value={filters.sort}
            onChange={(event) => updateFilter("sort", event.target.value)}
          >
            {sortOptions.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      </div>
    );
  };

  const renderFilterActions = () => (
    <div className="mt-5 flex gap-2 border-t border-[#eceef2] pt-4">
      <button
        type="submit"
        className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--ui-strong-surface)] px-4 py-2 text-sm font-semibold text-[var(--ui-inverse-text)] transition hover:bg-[var(--ui-strong-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)]"
      >
        نمایش قطعات
        <Search size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={clearFilters}
        className="min-h-11 rounded-xl border border-[var(--ui-border-strong)] px-4 py-2 text-sm font-semibold text-[var(--ui-text-strong)] transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-canvas)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)]"
      >
        پاک‌کردن فیلترها
      </button>
    </div>
  );

  return (
    <>
      <header
        dir="rtl"
        className="fixed inset-x-0 top-0 z-40 w-full border-b border-[var(--ui-border)] bg-[#f5f6f8]/95 text-[var(--ui-text)] shadow-[0_8px_24px_-22px_rgba(28,31,36,0.45)] backdrop-blur-xl"
      >
        <div className="bg-[var(--ui-strong-surface)] text-[var(--ui-inverse-text)]">
          <div className="mx-auto flex min-h-9 max-w-[1920px] items-center justify-center gap-2 px-3 py-2 text-center sm:justify-between sm:px-6 lg:px-8 min-[1680px]:px-12">
            <p className="flex min-w-0 items-center justify-center gap-2 text-[11px] font-medium leading-5 sm:justify-start sm:text-xs">
              <Truck size={15} className="shrink-0 text-[var(--ui-accent)]" aria-hidden="true" />
              <span>
                {shippingAnnouncement.loading || shippingAnnouncement.error
                  ? "هزینه نهایی و شرایط ارسال در سبد خرید مشخص می‌شود"
                  : shippingAnnouncement.flatRate <= 0
                    ? "ارسال سفارش‌ها در حال حاضر رایگان است"
                    : shippingAnnouncement.freeShippingThreshold > 0
                      ? `ارسال رایگان برای سفارش‌های حداقل ${formatPrice(shippingAnnouncement.freeShippingThreshold, shippingAnnouncement.currency)}`
                      : `هزینه ارسال ${formatPrice(shippingAnnouncement.flatRate, shippingAnnouncement.currency)} · مبلغ نهایی در سبد خرید`}
              </span>
            </p>
            <Link
              to="/shop"
              className="hidden shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold text-[var(--ui-accent)] transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:inline-flex"
            >
              مشاهده قطعات
              <ChevronLeft size={14} aria-hidden="true" />
            </Link>
          </div>
        </div>
        <div className="mx-auto max-w-[1920px] px-3 sm:px-6 lg:px-8 min-[1680px]:px-12">
          <div className="relative flex min-h-14 flex-wrap items-center justify-between gap-2 py-3 sm:gap-4 min-[1680px]:grid min-[1680px]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] min-[1680px]:justify-normal">
            <div
              ref={accountMenuRef}
              className="relative z-50 flex shrink-0 items-center gap-1 min-[1680px]:col-start-3 min-[1680px]:row-start-1 min-[1680px]:justify-self-end min-[1680px]:gap-2"
            >
              <button
                type="button"
                aria-label={mobileMenuOpen ? "بستن منوی فروشگاه" : "باز کردن منوی فروشگاه"}
                aria-expanded={mobileMenuOpen}
                aria-controls="store-menu-panel"
                onClick={() => setMobileMenuOpen((open) => !open)}
                className="order-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--ui-border-strong)] bg-[var(--ui-surface)] text-[var(--ui-text-strong)] shadow-sm transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)] lg:hidden"
              >
                {mobileMenuOpen ? <X size={19} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
              </button>

              {renderThemeToggle(false)}

              <button
                type="button"
                aria-label={accountMenuOpen ? "بستن منوی حساب کاربری" : "باز کردن منوی حساب کاربری"}
                aria-expanded={accountMenuOpen}
                aria-controls="account-menu"
                onClick={() => setAccountMenuOpen((open) => !open)}
                className="order-2 hidden h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--ui-border-strong)] bg-[var(--ui-surface)] text-[var(--ui-text-strong)] shadow-sm transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)] lg:inline-flex"
              >
                {accountMenuOpen ? <X size={19} aria-hidden="true" /> : <UserRound size={19} aria-hidden="true" />}
              </button>

              <Link
                to="/cart"
                aria-label={cart.length > 0 ? `سبد خرید، ${new Intl.NumberFormat("fa-IR").format(cart.length)} کالا` : "سبد خرید"}
                className="order-2 relative inline-flex h-10 items-center justify-center gap-2 rounded-full px-2.5 text-sm font-medium text-[var(--ui-muted)] transition hover:bg-[var(--ui-surface-raised)] hover:text-[var(--ui-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)] sm:px-3 lg:order-1"
              >
                <ShoppingCart size={18} aria-hidden="true" />
                <span className="hidden lg:inline">سبد خرید</span>
                {cart.length > 0 && (
                  <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--ui-accent)] px-1.5 py-0.5 text-xs font-semibold text-[var(--ui-button-text)]">
                    {new Intl.NumberFormat("fa-IR").format(cart.length)}
                  </span>
                )}
              </Link>

              {accountMenuOpen && (
                <div
                  id="account-menu"
                  dir="rtl"
                  className="absolute right-0 top-[calc(100%+0.75rem)] z-[70] hidden w-64 overflow-hidden rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-2 shadow-[0_24px_70px_-24px_rgba(28,31,36,0.35)] lg:block lg:left-0 lg:right-auto"
                >
                  <div className="border-b border-[#eceef2] px-3 py-3">
                    <p className="text-sm font-bold text-[var(--ui-text)]">حساب کاربری</p>
                    {user && (
                      <p className="mt-1 break-words text-xs text-[var(--ui-muted)]">{user.name || user.email || "کاربر فروشگاه"}</p>
                    )}
                    {isWholesale && (
                      <span className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--ui-accent-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--ui-accent)]">
                        <Building2 size={13} aria-hidden="true" />
                        <span className="truncate">حساب همکار (عمده){wholesaleCompany ? " · " + wholesaleCompany : ""}</span>
                      </span>
                    )}
                  </div>

                  <div className="space-y-1 py-2">
                    {!user ? (
                      <>
                        <Link
                          to="/login"
                          onClick={() => setAccountMenuOpen(false)}
                          className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-[var(--ui-text-strong)] transition hover:bg-[var(--ui-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]"
                        >
                          <LogIn size={17} aria-hidden="true" />
                          ورود به حساب
                        </Link>
                        <Link
                          to="/signup"
                          onClick={() => setAccountMenuOpen(false)}
                          className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-[var(--ui-text-strong)] transition hover:bg-[var(--ui-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]"
                        >
                          <UserRound size={17} aria-hidden="true" />
                          ایجاد حساب کاربری
                        </Link>
                        <Link
                          to="/login?wholesale=1"
                          onClick={() => setAccountMenuOpen(false)}
                          className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-[var(--ui-accent)] transition hover:bg-[var(--ui-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]"
                        >
                          <Building2 size={17} aria-hidden="true" />
                          ورود همکاران
                        </Link>
                      </>
                    ) : (
                      <>
                        <Link
                          to="/profile"
                          onClick={() => setAccountMenuOpen(false)}
                          className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-[var(--ui-text-strong)] transition hover:bg-[var(--ui-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]"
                        >
                          <UserRound size={17} aria-hidden="true" />
                          پروفایل و نشانی‌ها
                        </Link>
                        <Link
                          to="/orders"
                          onClick={() => setAccountMenuOpen(false)}
                          className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-[var(--ui-text-strong)] transition hover:bg-[var(--ui-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]"
                        >
                          <Truck size={17} aria-hidden="true" />
                          سفارش‌های من و رهگیری
                        </Link>
                        {isWholesale && (
                          <Link
                            to="/wholesale/quick-order"
                            onClick={() => setAccountMenuOpen(false)}
                            className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-[var(--ui-accent)] transition hover:bg-[var(--ui-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]"
                          >
                            <ClipboardList size={17} aria-hidden="true" />
                            سفارش سریع عمده
                          </Link>
                        )}
                        {isAdmin && (
                          <Link
                            to="/secret-dashboard"
                            onClick={() => setAccountMenuOpen(false)}
                            className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-[var(--ui-text-strong)] transition hover:bg-[var(--ui-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]"
                          >
                            <Lock size={17} aria-hidden="true" />
                            داشبورد مدیریت
                          </Link>
                        )}
                        <button
                          type="button"
                          onClick={handleLogout}
                          className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-right text-sm font-medium text-[var(--ui-danger)] transition hover:bg-[var(--ui-danger-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]"
                        >
                          <LogOut size={17} aria-hidden="true" />
                          خروج از حساب
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            <Link
              to="/"
              aria-label="صفحه اصلی میبا"
              className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 shrink-0 items-center justify-center gap-2 whitespace-nowrap text-2xl font-extrabold tracking-tight text-[var(--ui-text)] transition hover:text-[var(--ui-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ui-focus)] min-[1680px]:static min-[1680px]:col-start-2 min-[1680px]:row-start-1 min-[1680px]:translate-x-0 min-[1680px]:justify-self-center"
            >
              <img src="/favicon.svg" alt="" width="36" height="36" className="h-9 w-9 rounded-xl" />
              <span dir="ltr" className="tracking-[0.12em]">MIBA</span>
              <span className="hidden text-base font-bold text-[var(--ui-accent)] sm:inline">میبا</span>
            </Link>

            <div className="flex min-w-0 flex-1 items-center justify-end gap-1 sm:gap-3 md:order-last md:basis-full md:justify-start min-[1680px]:order-none min-[1680px]:basis-auto min-[1680px]:col-start-1 min-[1680px]:row-start-1 min-[1680px]:w-full min-[1680px]:flex-initial min-[1680px]:justify-self-stretch">
              <nav
                aria-label="پیمایش اصلی"
                className="hidden shrink-0 items-center gap-1 lg:flex"
              >
                <button
                  type="button"
                  aria-label={mobileMenuOpen ? "بستن منوی دسته‌بندی‌ها" : "باز کردن منوی دسته‌بندی‌ها"}
                  aria-expanded={mobileMenuOpen}
                  aria-controls="store-menu-panel"
                  onClick={() => setMobileMenuOpen((open) => !open)}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--ui-border-strong)] bg-[var(--ui-surface)] text-[var(--ui-text-strong)] shadow-sm transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)]"
                >
                  {mobileMenuOpen ? <X size={19} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
                </button>
                <NavLink to="/" end className={linkClass}>صفحه اصلی</NavLink>
                <NavLink to="/shop" className={linkClass}>قطعات</NavLink>
                <NavLink to="/wishlist" className={linkClass}><Heart size={15} aria-hidden="true" />علاقه‌مندی‌ها{savedProducts.length > 0 && <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--ui-accent)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--ui-button-text)]">{new Intl.NumberFormat("fa-IR").format(savedProducts.length)}</span>}</NavLink>
              </nav>

              <div
                ref={desktopSearchRef}
                className="relative hidden min-w-0 max-w-none flex-1 items-center md:flex min-[1680px]:max-w-[31rem]"
              >
                <form
                  onSubmit={handleDesktopSearch}
                  role="search"
                  aria-label="جست‌وجوی قطعات"
                  className="flex min-h-12 min-w-0 flex-1 items-center gap-1 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-1 shadow-sm transition focus-within:border-[var(--ui-focus)] focus-within:ring-4 focus-within:ring-[#ea580c]/10"
                >
                  <Search size={18} className="mr-2 shrink-0 text-[var(--ui-muted)]" aria-hidden="true" />
                  <input
                    type="search"
                    value={filters.q}
                    onFocus={() => { setDesktopFiltersOpen(false); setActiveSearchSurface("desktop"); }}
                    onKeyDown={handleSuggestionKeyDown}
                    onChange={(event) => updateFilter("q", event.target.value)}
                    aria-label="نام قطعه، کد فنی یا خودرو"
                    {...comboboxProps("desktop")}
                    autoComplete="off"
                    placeholder="نام قطعه، کد فنی یا خودرو…"
                    className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-[var(--ui-text)] outline-none placeholder:text-[var(--ui-muted)]"
                  />
                  <button
                    type="submit"
                    aria-label="جست‌وجو"
                    className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--ui-strong-surface)] px-3 text-sm font-semibold text-[var(--ui-inverse-text)] transition hover:bg-[var(--ui-strong-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)]"
                  >
                    <Search size={16} aria-hidden="true" />
                    <span className="hidden 2xl:inline">جست‌وجو</span>
                  </button>
                  <button
                    type="button"
                    aria-label={activeFilterCount > 0
                      ? `نمایش فیلترها، ${new Intl.NumberFormat("fa-IR").format(activeFilterCount)} فیلتر فعال`
                      : "نمایش فیلترها"}
                    aria-expanded={desktopFiltersOpen}
                    aria-controls="desktop-product-filters"
                    onClick={() => {
                      setActiveSearchSurface(null);
                      setDesktopFiltersOpen((open) => !open);
                    }}
                    className={`inline-flex h-10 shrink-0 items-center justify-center gap-1 rounded-xl border px-3 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)] ${desktopFiltersOpen ? "border-[var(--ui-accent)] bg-[var(--ui-hover)] text-[var(--ui-text-strong)]" : "border-[var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-muted)] hover:bg-[var(--ui-surface-raised)]"}`}
                  >
                    <SlidersHorizontal size={16} aria-hidden="true" />
                    <span>فیلترها</span>
                    {activeFilterCount > 0 && (
                      <span
                        aria-label={`${new Intl.NumberFormat("fa-IR").format(activeFilterCount)} فیلتر فعال`}
                        className="inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--ui-accent)] px-1.5 py-0.5 text-[11px] font-bold leading-none text-[var(--ui-button-text)]"
                      >
                        {new Intl.NumberFormat("fa-IR").format(activeFilterCount)}
                      </span>
                    )}
                    <ChevronDown size={14} className={`transition-transform ${desktopFiltersOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                  </button>
                </form>

                {renderSearchSuggestions("desktop")}

                {desktopFiltersOpen && (
                  <form
                    id="desktop-product-filters"
                    onSubmit={applyFilters}
                    className="absolute left-0 right-auto top-[calc(100%+0.75rem)] z-50 max-h-[min(70vh,34rem)] w-[27rem] overflow-y-auto rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-5 shadow-[0_24px_70px_-24px_rgba(28,31,36,0.35)]"
                  >
                    <div className="mb-4">
                      <p className="text-sm font-bold text-[var(--ui-text)]">فیلتر قطعات</p>
                      <p className="mt-1 text-xs text-[var(--ui-muted)]">نتیجه‌ها را دقیق‌تر و سریع‌تر پیدا کنید.</p>
                    </div>
                    {renderFilterFields()}
                    {renderFilterActions()}
                  </form>
                )}
              </div>

              <button
                type="button"
                onClick={() => setMobileSearchOpen(true)}
                aria-label={activeFilterCount > 0
                  ? `باز کردن جست‌وجو و فیلتر قطعات، ${new Intl.NumberFormat("fa-IR").format(activeFilterCount)} فیلتر فعال`
                  : "باز کردن جست‌وجو و فیلتر قطعات"}
                className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text-strong)] shadow-sm transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)] md:hidden"
              >
                <Search size={18} aria-hidden="true" />
                {activeFilterCount > 0 && (
                  <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full border-2 border-[var(--ui-canvas)] bg-[var(--ui-accent)] px-1 py-0.5 text-[10px] font-bold leading-none text-[var(--ui-button-text)]">
                    {new Intl.NumberFormat("fa-IR").format(activeFilterCount)}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      {mobileMenuOpen && (
        <div id="store-menu-panel" dir="rtl" className="fixed inset-0 z-[90]">
          <button
            type="button"
            aria-label="بستن منوی فروشگاه"
            onClick={() => setMobileMenuOpen(false)}
            className="absolute inset-0 h-full w-full bg-[#1c1f24]/45 backdrop-blur-sm"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="store-nav-heading"
            className="absolute inset-y-0 right-0 flex h-[100dvh] w-[min(92vw,28rem)] flex-col border-l border-[var(--ui-border)] bg-[var(--ui-canvas)] shadow-[0_24px_80px_-20px_rgba(28,31,36,0.42)] animate-[searchPanelIn_180ms_ease-out]"
          >
            <div className="flex items-center justify-between gap-4 border-b border-[var(--ui-border)] px-5 py-4">
              <div>
                <Link
                  to="/"
                  onClick={() => setMobileMenuOpen(false)}
                  className="inline-flex items-center gap-2 text-2xl font-extrabold tracking-tight text-[var(--ui-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ui-focus)]"
                >
                  <img src="/favicon.svg" alt="" width="32" height="32" className="h-8 w-8 rounded-lg" />
                  <span dir="ltr" className="tracking-[0.12em]">MIBA</span>
                </Link>
                <p id="store-nav-heading" className="mt-1 text-xs text-[var(--ui-muted)]">منوی فروشگاه</p>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="بستن منوی فروشگاه"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-muted)] transition hover:bg-[var(--ui-surface-raised)] hover:text-[var(--ui-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-4" data-mobile-menu-scroll>
              <section aria-label="تنظیمات نمایش" className="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-2">
                {renderThemeToggle(true)}
              </section>

              {user ? (
                <section className="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-hover)] p-4">
                  <div className="flex items-start gap-3">
                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--ui-surface)] text-[var(--ui-accent)]">
                      <UserRound size={20} aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-[var(--ui-accent)]">حساب کاربری شما</p>
                      <p className="mt-1 break-words text-sm font-bold text-[var(--ui-text)]">{user.name || user.email || "کاربر میبا"}</p>
                      {isAdmin && <span className="mt-2 inline-flex rounded-full bg-[var(--ui-strong-surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ui-inverse-text)]">مدیر فروشگاه</span>}
                      {isWholesale && (
                        <span className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--ui-accent-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--ui-accent)]">
                          <Building2 size={13} aria-hidden="true" />
                          <span className="truncate">حساب همکار (عمده){wholesaleCompany ? " · " + wholesaleCompany : ""}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </section>
              ) : (
                <section className="rounded-2xl bg-[var(--ui-strong-surface)] p-4 text-[var(--ui-inverse-text)]">
                  <p className="text-xs font-semibold tracking-wide text-[var(--ui-accent)]">به میبا خوش آمدید</p>
                  <h2 className="mt-2 text-xl font-bold">قطعه مناسب خودروی خود را پیدا کنید.</h2>
                  <p className="mt-2 text-xs leading-5 text-white/70">وارد حساب شوید یا برای پیگیری سفارش‌ها ثبت‌نام کنید.</p>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Link
                      to="/login"
                      onClick={() => setMobileMenuOpen(false)}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--ui-surface)] px-3 py-2 text-sm font-semibold text-[var(--ui-text)] transition hover:bg-[var(--ui-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                    >
                      <LogIn size={16} aria-hidden="true" />
                      ورود
                    </Link>
                    <Link
                      to="/signup"
                      onClick={() => setMobileMenuOpen(false)}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/25 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                    >
                      <UserRound size={16} aria-hidden="true" />
                      ثبت‌نام
                    </Link>
                  </div>
                  <Link
                    to="/login?wholesale=1"
                    onClick={() => setMobileMenuOpen(false)}
                    className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[var(--ui-accent)]/60 px-3 py-2 text-sm font-semibold text-[var(--ui-accent)] transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  >
                    <Building2 size={16} aria-hidden="true" />
                    ورود همکاران (عمده)
                  </Link>
                </section>
              )}

              <section aria-labelledby="mobile-quick-links-heading">
                <div className="mb-3 flex items-center justify-between px-1">
                  <h3 id="mobile-quick-links-heading" className="text-sm font-bold text-[var(--ui-text)]">دسترسی سریع</h3>
                  <span className="text-[11px] text-[var(--ui-muted)]">همه‌چیز یک‌جا</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Link
                    to="/"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex min-h-[4.25rem] items-center gap-3 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-3 text-sm font-semibold text-[var(--ui-text-strong)] transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--ui-surface-raised)] text-[var(--ui-accent)]"><Home size={18} aria-hidden="true" /></span>
                    صفحه اصلی
                  </Link>
                  <Link
                    to="/shop"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex min-h-[4.25rem] items-center gap-3 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-3 text-sm font-semibold text-[var(--ui-text-strong)] transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--ui-surface-raised)] text-[var(--ui-accent)]"><ShoppingBag size={18} aria-hidden="true" /></span>
                    همه قطعات
                  </Link>
                  <Link
                    to="/wishlist"
                    onClick={() => setMobileMenuOpen(false)}
                    className="col-span-2 flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-3 text-sm font-semibold text-[var(--ui-text-strong)] transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]"
                  >
                    <span className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--ui-surface-raised)] text-[var(--ui-accent)]"><Heart size={18} aria-hidden="true" /></span>علاقه‌مندی‌ها</span>
                    {savedProducts.length > 0 && <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-[var(--ui-accent)] px-2 py-1 text-xs font-bold text-[var(--ui-button-text)]">{new Intl.NumberFormat("fa-IR").format(savedProducts.length)}</span>}
                  </Link>
                  <Link
                    to="/cart"
                    onClick={() => setMobileMenuOpen(false)}
                    className="col-span-2 flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-3 text-sm font-semibold text-[var(--ui-text-strong)] transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]"
                  >
                    <span className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--ui-surface-raised)] text-[var(--ui-accent)]"><ShoppingCart size={18} aria-hidden="true" /></span>سبد خرید</span>
                    {cart.length > 0 && <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-[var(--ui-accent)] px-2 py-1 text-xs font-bold text-[var(--ui-button-text)]">{new Intl.NumberFormat("fa-IR").format(cart.length)}</span>}
                  </Link>
                </div>
              </section>

              <section aria-labelledby="store-categories-heading">
                <div className="mb-3 flex items-center justify-between gap-3 px-1">
                  <div className="flex items-center gap-2">
                    <Grid2X2 size={17} className="text-[var(--ui-accent)]" aria-hidden="true" />
                    <h3 id="store-categories-heading" className="text-sm font-bold text-[var(--ui-text)]">دسته‌بندی‌ها</h3>
                  </div>
                  <Link
                    to="/shop"
                    onClick={() => setMobileMenuOpen(false)}
                    className="inline-flex min-h-8 items-center gap-1 rounded-full px-2 text-xs font-semibold text-[var(--ui-accent)] transition hover:bg-[var(--ui-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]"
                  >
                    مشاهده همه
                    <ChevronLeft size={14} aria-hidden="true" />
                  </Link>
                </div>
                <div className="space-y-1 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-2">
                  {navigationTree.roots.length > 0 ? navigationTree.roots.map((category) => renderNavigationCategory(category)) : (
                    <p className="px-3 py-4 text-sm text-[var(--ui-muted)]">دسته‌بندی قابل نمایشی وجود ندارد.</p>
                  )}
                </div>
              </section>

              {(isAdmin || user) && (
                <section aria-label="حساب و مدیریت" className="space-y-2 border-t border-[var(--ui-border)] pt-4">
                  {user && (
                    <Link
                      to="/profile"
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--ui-border-strong)] bg-[var(--ui-surface)] px-3 py-3 text-sm font-semibold text-[var(--ui-text-strong)] transition hover:bg-[var(--ui-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]"
                    >
                      <UserRound size={17} aria-hidden="true" />
                      پروفایل و نشانی‌ها
                      <ChevronLeft size={15} className="mr-auto text-[var(--ui-accent)]" aria-hidden="true" />
                    </Link>
                  )}
                  {user && (
                    <Link
                      to="/orders"
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex min-h-12 items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-[var(--ui-text-strong)] transition hover:bg-[var(--ui-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]"
                    >
                      <Truck size={17} aria-hidden="true" />
                      سفارش‌های من و رهگیری
                      <ChevronLeft size={15} className="mr-auto text-[var(--ui-accent)]" aria-hidden="true" />
                    </Link>
                  )}
                  {isWholesale && (
                    <Link
                      to="/wholesale/quick-order"
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex min-h-12 items-center gap-3 rounded-xl bg-[var(--ui-accent-soft)] px-3 py-3 text-sm font-semibold text-[var(--ui-accent)] transition hover:bg-[var(--ui-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]"
                    >
                      <ClipboardList size={17} aria-hidden="true" />
                      سفارش سریع عمده
                      <ChevronLeft size={15} className="mr-auto text-[var(--ui-accent)]" aria-hidden="true" />
                    </Link>
                  )}
                  {isAdmin && (
                    <Link
                      to="/secret-dashboard?tab=categories"
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--ui-border-strong)] bg-[var(--ui-surface)] px-3 py-3 text-sm font-semibold text-[var(--ui-text-strong)] transition hover:bg-[var(--ui-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]"
                    >
                      <FolderTree size={17} aria-hidden="true" />
                      مدیریت دسته‌بندی‌ها
                      <ChevronLeft size={15} className="mr-auto text-[var(--ui-accent)]" aria-hidden="true" />
                    </Link>
                  )}
                  {isAdmin && (
                    <Link
                      to="/secret-dashboard"
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex min-h-12 items-center gap-3 rounded-xl bg-[var(--ui-hover)] px-3 py-3 text-sm font-semibold text-[var(--ui-text-strong)] transition hover:bg-[var(--ui-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]"
                    >
                      <Lock size={17} aria-hidden="true" />
                      داشبورد مدیریت
                      <ChevronLeft size={15} className="mr-auto text-[var(--ui-accent)]" aria-hidden="true" />
                    </Link>
                  )}
                  {user && (
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-3 text-right text-sm font-semibold text-[var(--ui-danger)] transition hover:bg-[var(--ui-danger-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]"
                    >
                      <LogOut size={17} aria-hidden="true" />
                      خروج از حساب کاربری
                    </button>
                  )}
                </section>
              )}
            </div>
            <div className="border-t border-[var(--ui-border)] bg-[#ffffff]/70 px-5 py-3 text-center text-[11px] text-[var(--ui-muted)]">
              قطعات یدکی خودروهای چینی؛ خرده و عمده
            </div>
          </aside>
        </div>
      )}

      {mobileSearchOpen && (
        <div
          dir="rtl"
          className="fixed inset-0 z-[100] flex items-center justify-center px-3 py-4 sm:px-6 sm:py-8 lg:hidden"
        >
          <button
            type="button"
            aria-label="بستن جست‌وجو"
            onClick={() => { setMobileSearchOpen(false); setActiveSearchSurface(null); }}
            className="absolute inset-0 h-full w-full bg-[#1c1f24]/35 backdrop-blur-md"
          />

          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-search-heading"
            className="relative z-10 max-h-[min(88dvh,48rem)] w-full max-w-lg animate-[searchPanelIn_180ms_ease-out] overflow-y-auto rounded-[1.75rem] border border-white/70 bg-[#ffffff]/95 p-4 shadow-[0_32px_100px_-28px_rgba(28,31,36,0.5)] backdrop-blur-2xl sm:p-6"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="mb-1 text-xs font-semibold tracking-[0.16em] text-[var(--ui-accent)]">جست‌وجوی هوشمند</p>
                <h2 id="mobile-search-heading" className="font-serif text-2xl font-medium text-[var(--ui-text)]">دنبال چه چیزی هستید؟</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--ui-muted)]">قطعات را جست‌وجو و نتیجه‌ها را فیلتر کنید.</p>
              </div>
              <button
                type="button"
                onClick={() => { setMobileSearchOpen(false); setActiveSearchSurface(null); }}
                aria-label="بستن پنجره جست‌وجو"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-muted)] transition hover:bg-[var(--ui-surface-raised)] hover:text-[var(--ui-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={applyFilters}>
              <label htmlFor="mobile-product-search" className="sr-only">نام قطعه، کد فنی یا خودرو</label>
              <div className="mb-5 flex min-h-12 items-center gap-2 rounded-2xl border border-[var(--ui-border-strong)] bg-[var(--ui-surface)] p-1.5 transition focus-within:border-[var(--ui-accent)] focus-within:ring-4 focus-within:ring-[#ea580c]/10">
                <Search size={19} className="mr-2 shrink-0 text-[var(--ui-accent)]" aria-hidden="true" />
                <input
                  ref={mobileSearchInputRef}
                  id="mobile-product-search"
                  type="search"
                  value={filters.q}
                  onFocus={() => setActiveSearchSurface("mobile")}
                  onKeyDown={handleSuggestionKeyDown}
                  onChange={(event) => updateFilter("q", event.target.value)}
                  {...comboboxProps("mobile")}
                  autoComplete="off"
                  placeholder="نام قطعه، کد فنی یا خودرو…"
                  className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-[var(--ui-text)] outline-none placeholder:text-[var(--ui-muted)]"
                />
              </div>

              {renderSearchSuggestions("mobile")}

              <div className="mb-4 flex items-center gap-2 border-b border-[var(--ui-border)] pb-3">
                <SlidersHorizontal size={17} className="text-[var(--ui-accent)]" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-[var(--ui-text)]">فیلترها</h3>
                <span className="text-xs text-[var(--ui-muted)]">قیمت و مرتب‌سازی</span>
              </div>

              {renderFilterFields()}
              {renderFilterActions()}
            </form>
          </section>
        </div>
      )}
    </>
  );
};

export default Navbar;
