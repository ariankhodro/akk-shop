import { useEffect, useMemo, useRef, useState } from "react";
import PageMeta from "../components/PageMeta";
import ProductCard from "../components/ProductCard";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, Car, Check, Copy, Heart, LoaderCircle, Minus, Plus, ShieldCheck, ShoppingCart,
  X, Wrench, ZoomIn, RefreshCw,
} from "lucide-react";
import toast from "react-hot-toast";
import axios from "../lib/axios";
import { useCartStore } from "../stores/useCartStore";
import { useWishlistStore } from "../stores/useWishlistStore";
import {
  effectiveUnitPrice, formatFitment, formatPrice, isOutOfStock, isStockTracked, maxLineQuantity, partQualityLabel, wholesaleOffer,
} from "../lib/commerce";
import { normalizeDigits } from "../lib/normalize-digits";
import { useCategoryStore } from "../stores/useCategoryStore";
import { isWholesaleUser, useUserStore } from "../stores/useUserStore";
import PartPrice from "../components/PartPrice";

const fa = new Intl.NumberFormat("fa-IR");
const faYear = new Intl.NumberFormat("fa-IR", { useGrouping: false });
const findCategoryName = (categories, slug) => {
  for (const category of Array.isArray(categories) ? categories : []) {
    if (category?.slug === slug) return category.name?.fa || slug;
    const nested = findCategoryName(category?.children, slug);
    if (nested) return nested;
  }
  return "";
};

const CopyCode = ({ value, label }) => {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(label + " کپی شد");
    } catch {
      toast.error("کپی انجام نشد؛ کد را دستی انتخاب کنید");
    }
  };
  return (
    <button type="button" onClick={copy} aria-label={"کپی " + label + " " + value} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-canvas)] px-2 py-1 font-mono text-xs text-[var(--ui-text-strong)] transition hover:border-[var(--ui-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]">
      <span dir="ltr">{value}</span><Copy size={13} aria-hidden="true" className="text-[var(--ui-muted)]" />
    </button>
  );
};

const ProductDetailsPage = () => {
  const { productId } = useParams();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const [selectedSize, setSelectedSize] = useState("");
  const [selectedColor, setSelectedColor] = useState("");
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [failedImageUrls, setFailedImageUrls] = useState(() => new Set());
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const imageViewerCloseRef = useRef(null);
  const [relatedProducts, setRelatedProducts] = useState([]);
  const [recentlyViewed, setRecentlyViewed] = useState([]);
  const { addToCart } = useCartStore();
  const { categories, fetchCategories } = useCategoryStore();
  const { user } = useUserStore();
  useEffect(() => { if (!categories?.length) fetchCategories?.(); }, [categories?.length, fetchCategories]);
  const { isSaved, toggleSaved } = useWishlistStore();
  const isWishlisted = Boolean(product && isSaved(product._id));

  useEffect(() => {
    let active = true;
    const fetchProduct = async () => {
      setLoading(true); setError(""); setProduct(null);
      setFailedImageUrls(new Set());
      setImageViewerOpen(false);
      setRelatedProducts([]);
      try {
        const response = await axios.get("/products/" + productId);
        if (active) {
          const nextProduct = response.data;
          setProduct(nextProduct);
          const variants = Array.isArray(nextProduct.variants) ? nextProduct.variants : [];
          const firstAvailable = variants.find((variant) => variant.stock > 0) || variants[0];
          const sizes = Array.isArray(nextProduct.sizes) && nextProduct.sizes.length
            ? nextProduct.sizes : [...new Set(variants.map((variant) => variant.size).filter(Boolean))];
          const colors = Array.isArray(nextProduct.colors) && nextProduct.colors.length
            ? nextProduct.colors : [...new Set(variants.map((variant) => variant.color).filter(Boolean))]
                .map((name) => ({ name, hex: "#d2d6dc" }));
          setSelectedSize(firstAvailable?.size || sizes[0] || "");
          setSelectedColor(firstAvailable?.color || colors[0]?.name || "");
          setActiveImageIndex(0);
          const offer = wholesaleOffer(nextProduct);
          setQuantity(offer && offer.minQuantity > 1 ? offer.minQuantity : 1);
        }
      } catch (requestError) {
        if (active) {
          const status = requestError.response?.status;
          if (status === 404 || requestError.response?.data?.message === "Product not found") {
            setError("این قطعه وجود ندارد یا دیگر در دسترس نیست.");
          } else if (status === 400 || requestError.response?.data?.message === "Invalid product ID") {
            setError("شناسه قطعه معتبر نیست.");
          } else {
            setError("بارگذاری این قطعه انجام نشد. اتصال را بررسی کنید و دوباره تلاش کنید.");
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchProduct();
    return () => { active = false; };
  }, [productId, retryCount]);

  const galleryImages = useMemo(() => {
    if (!product) return [];
    const candidates = [...(Array.isArray(product.images) ? product.images : []), product.image];
    return [...new Set(candidates.filter((image) => typeof image === "string" && image.trim()))];
  }, [product]);

  const activeGalleryImage = galleryImages[Math.min(activeImageIndex, Math.max(0, galleryImages.length - 1))] || "";
  const markGalleryImageFailed = image => {
    if (!image) return;
    setFailedImageUrls(current => {
      const next = new Set(current);
      next.add(image);
      return next;
    });
  };

  useEffect(() => {
    if (!product?._id || !product?.category) return undefined;
    const controller = new AbortController();
    setRelatedProducts([]);
    axios.get(`/products/category/${encodeURIComponent(product.category)}?page=1&limit=8`, { signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        const candidates = Array.isArray(data.products) ? data.products : [];
        const available = candidates.filter(candidate => {
          if (!candidate?._id || String(candidate._id) === String(product._id)) return false;
          const variants = Array.isArray(candidate.variants) ? candidate.variants : [];
          return variants.length
            ? variants.some(variant => Number(variant.stock) > 0)
            : !isOutOfStock(candidate);
        });
        setRelatedProducts(available.slice(0, 4));
      })
      .catch(error => {
        if (!controller.signal.aborted && error.code !== "ERR_CANCELED") setRelatedProducts([]);
      });
    return () => controller.abort();
  }, [product?._id, product?.category]);

  useEffect(() => {
    if (!product?._id) return;
    try {
      const stored = JSON.parse(window.localStorage.getItem("miba-recently-viewed") || "[]");
      const previous = Array.isArray(stored)
        ? stored.filter(item => item?._id && String(item._id) !== String(product._id))
        : [];
      setRecentlyViewed(previous.slice(0, 4));
      const currentItem = {
        _id: product._id,
        name: product.name,
        description: product.description || "",
        image: product.image || galleryImages[0] || "",
        price: product.price,
        category: product.category,
        stock: product.stock,
        variants: Array.isArray(product.variants) ? product.variants : [],
        sizes: Array.isArray(product.sizes) ? product.sizes : [],
        colors: Array.isArray(product.colors) ? product.colors : [],
        sku: product.sku || "",
        brand: product.brand || "",
        quality: product.quality || "",
        fitments: Array.isArray(product.fitments) ? product.fitments.slice(0, 6) : [],
      };
      window.localStorage.setItem("miba-recently-viewed", JSON.stringify([currentItem, ...previous].slice(0, 6)));
    } catch {
      setRecentlyViewed([]);
    }
  }, [product?._id, product?.name, product?.description, product?.image, product?.price, product?.category, product?.stock, product?.variants, product?.sizes, product?.colors, product?.sku, product?.brand, product?.quality, product?.fitments, galleryImages]);

  useEffect(() => {
    if (!imageViewerOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement;
    const dialog = document.querySelector("[data-product-image-dialog]");
    document.body.style.overflow = "hidden";
    imageViewerCloseRef.current?.focus();
    const handleViewerKey = event => {
      if (event.key === "Escape") setImageViewerOpen(false);
      if (event.key === "ArrowLeft" && galleryImages.length > 1) {
        event.preventDefault();
        setActiveImageIndex(index => (index + 1) % galleryImages.length);
      }
      if (event.key === "ArrowRight" && galleryImages.length > 1) {
        event.preventDefault();
        setActiveImageIndex(index => (index - 1 + galleryImages.length) % galleryImages.length);
      }
      if (event.key === "Tab") {
        const focusable = Array.from(dialog?.querySelectorAll(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        ) || []).filter(element => element.getAttribute("aria-hidden") !== "true");
        if (!focusable.length) {
          event.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleViewerKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleViewerKey);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [imageViewerOpen, galleryImages.length]);

  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const hasVariants = variants.length > 0;
  const sizes = product?.sizes?.length
    ? product.sizes
    : [...new Set(variants.map((variant) => variant.size).filter(Boolean))];
  const colors = product?.colors?.length
    ? product.colors
    : [...new Set(variants.map((variant) => variant.color).filter(Boolean))].map((name) => ({ name, hex: "#d2d6dc" }));
  const selectedVariant = hasVariants
    ? variants.find((variant) => (variant.size || "") === selectedSize && (variant.color || "") === selectedColor)
    : null;
  const selectedStock = selectedVariant ? selectedVariant.stock : product?.stock;
  const normalizedSelectedStock = Number(selectedStock);
  const hasStockValue = selectedStock !== null && selectedStock !== undefined && selectedStock !== "" && Number.isFinite(normalizedSelectedStock);
  const outOfStock = hasVariants
    ? !selectedVariant || !hasStockValue || normalizedSelectedStock <= 0
    : isOutOfStock(product);

  const hasAnyStockForSize = (size) => variants.some((variant) => variant.size === size && variant.stock > 0);
  const hasAnyStockForColor = (color) => variants.some((variant) => variant.color === color && variant.stock > 0);
  const hasStockForSize = (size) => variants.some((variant) => variant.size === size && variant.color === selectedColor && variant.stock > 0);
  const hasStockForColor = (color) => variants.some((variant) => variant.color === color && variant.size === selectedSize && variant.stock > 0);

  const handleSizeSelect = (size) => {
    if (!hasVariants) { setSelectedSize(size); return; }
    const exact = variants.find((variant) => variant.size === size && variant.color === selectedColor && variant.stock > 0);
    const available = exact || variants.find((variant) => variant.size === size && variant.stock > 0);
    if (!available) return;
    setSelectedSize(available.size || size);
    setSelectedColor(available.color || "");
  };
  const handleColorSelect = (color) => {
    if (!hasVariants) { setSelectedColor(color); return; }
    const exact = variants.find((variant) => variant.color === color && variant.size === selectedSize && variant.stock > 0);
    const available = exact || variants.find((variant) => variant.color === color && variant.stock > 0);
    if (!available) return;
    setSelectedColor(available.color || color);
    setSelectedSize(available.size || "");
  };

  // UI cap only; the cart and checkout enforce the real limits on the server.
  const accountLimit = isWholesaleUser(user) ? 1000 : maxLineQuantity(product || {});
  const lineLimit = Math.max(1, Math.min(accountLimit, hasStockValue ? Math.max(1, normalizedSelectedStock) : accountLimit));
  const offer = wholesaleOffer(product);
  const unitPrice = product ? effectiveUnitPrice(product, quantity) : 0;
  const setClampedQuantity = (value) => {
    const next = Number.parseInt(normalizeDigits(value), 10);
    setQuantity(Number.isInteger(next) ? Math.min(lineLimit, Math.max(1, next)) : 1);
  };
  const handleAddToCart = () => {
    if (outOfStock) return toast.error(hasVariants ? "این گزینه از قطعه موجود نیست" : "این قطعه در حال حاضر موجود نیست");
    addToCart(product, { size: selectedSize, color: selectedColor, quantity });
  };

  const handleToggleWishlist = () => {
    if (!product) return;
    toggleSaved({ ...product, image: product.image || galleryImages[0] || "" });
  };

  const showPreviousImage = () => {
    if (galleryImages.length < 2) return;
    setActiveImageIndex((index) => (index - 1 + galleryImages.length) % galleryImages.length);
  };

  const showNextImage = () => {
    if (galleryImages.length < 2) return;
    setActiveImageIndex((index) => (index + 1) % galleryImages.length);
  };

  if (loading) return <main dir="rtl" className="flex min-h-[60vh] items-center justify-center bg-[var(--ui-canvas)] px-4 text-[var(--ui-text)]"><div className="flex items-center gap-3 text-sm text-[var(--ui-muted)]" role="status"><LoaderCircle className="animate-spin" size={20} aria-hidden="true" />در حال بارگذاری جزئیات قطعه…</div></main>;
  if (error || !product) return <main dir="rtl" className="min-h-[60vh] bg-[var(--ui-canvas)] px-4 py-16 text-[var(--ui-text)] sm:px-6"><PageMeta title="قطعه در دسترس نیست" description="ممکن است شناسه قطعه نادرست باشد یا قطعه دیگر در دسترس نباشد." robots="noindex, nofollow" canonical={false} /><div className="mx-auto max-w-3xl rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-6 py-12 text-center"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ui-accent)]">قطعه در دسترس نیست</p><h1 className="mt-3 text-3xl font-bold">قطعه موردنظر پیدا نشد.</h1><p role="status" className="mt-3 text-sm leading-6 text-[var(--ui-muted)]">{error || "ممکن است این قطعه حذف شده باشد."}</p><div className="mt-7 flex flex-col justify-center gap-2 sm:flex-row"><button type="button" onClick={() => setRetryCount(count => count + 1)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[var(--ui-border)] px-5 py-3 text-sm font-semibold text-[var(--ui-text)] transition hover:bg-[var(--ui-surface-raised)]"><RefreshCw size={16} aria-hidden="true" />دوباره تلاش کنید</button><Link to="/" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[var(--ui-strong-surface)] px-5 py-3 text-sm font-semibold text-[var(--ui-inverse-text)] transition hover:bg-[var(--ui-strong-hover)]"><ArrowLeft size={16} aria-hidden="true" />بازگشت به فروشگاه</Link></div></div></main>;
  const categoryName = findCategoryName(categories, product.category) || product.category || "";
  const qualityName = partQualityLabel(product.quality);
  const fitments = Array.isArray(product.fitments) ? product.fitments : [];
  const oemNumbers = Array.isArray(product.oemNumbers) ? product.oemNumbers.filter(Boolean) : [];
  const specRows = [
    ["برند / سازنده", product.brand],
    ["کیفیت", qualityName],
    ["کشور سازنده", product.countryOfOrigin],
    ["گارانتی", Number(product.warrantyMonths) > 0 ? fa.format(product.warrantyMonths) + " ماه" : ""],
    ["دسته‌بندی", categoryName],
  ].filter(([, value]) => value);

  return (
    <main dir="rtl" className="min-h-screen bg-[var(--ui-canvas)] px-3 py-6 pb-28 text-[var(--ui-text)] sm:px-6 sm:py-10 sm:pb-28 lg:px-8 lg:pb-10">
      <PageMeta title={product?.name || "قطعه"} description={product?.description || "جزئیات، قیمت، کد فنی و خودروهای سازگار با این قطعه در میبا."} image={product?.image} path={window.location.pathname} type="product" product={product || undefined} breadcrumbs={[{ name: "صفحه اصلی", path: "/" }, ...(product?.category ? [{ name: categoryName, path: "/category/" + encodeURIComponent(product.category) }] : []), { name: product?.name || "قطعه", path: window.location.pathname }]} />
      <div className="mx-auto max-w-[1600px]">
        <Link to={product.category ? "/category/" + encodeURIComponent(product.category) : "/"} className="inline-flex min-h-10 items-center gap-2 rounded-full px-3 py-2 text-sm text-[var(--ui-muted)] transition hover:bg-[var(--ui-hover)] hover:text-[var(--ui-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)]"><ArrowRight size={16} aria-hidden="true" />بازگشت به {categoryName || "فروشگاه"}</Link>

        <div className="mt-4 grid items-start gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)] lg:gap-8">
          <section aria-label="تصاویر قطعه" className="min-w-0">
            <div className="relative overflow-hidden rounded-[1.5rem] border border-[var(--ui-border)] bg-[var(--ui-surface-raised)]">
              {activeGalleryImage && !failedImageUrls.has(activeGalleryImage) ? (
                <button type="button" onClick={() => setImageViewerOpen(true)} aria-label="نمایش تصویر قطعه در اندازه بزرگ" className="group block w-full cursor-zoom-in focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--ui-focus)]">
                  <img src={activeGalleryImage} alt={product.name} fetchPriority="high" onError={() => markGalleryImageFailed(activeGalleryImage)} className="aspect-square max-h-[720px] w-full bg-[var(--ui-surface)] object-contain p-4" />
                  <span className="absolute bottom-3 right-3 inline-flex items-center gap-2 rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface)]/95 px-3 py-2 text-xs font-semibold text-[var(--ui-text)] shadow-sm transition group-hover:bg-[var(--ui-surface)]"><ZoomIn size={15} aria-hidden="true" />بزرگ‌نمایی تصویر</span>
                </button>
              ) : (
                <div role="img" aria-label={"تصویر " + product.name + " در دسترس نیست"} className="flex aspect-square w-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-[var(--ui-muted)]">
                  <Wrench size={40} aria-hidden="true" className="text-[var(--ui-accent)]" />
                  <span>تصویر قطعه به‌زودی اضافه می‌شود</span>
                </div>
              )}
              {galleryImages.length > 1 && (
                <>
                  <button type="button" onClick={showPreviousImage} aria-label="نمایش تصویر قبلی" className="absolute end-3 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/70 bg-[var(--ui-surface)]/95 text-[var(--ui-text)] shadow-sm backdrop-blur-sm transition hover:bg-[var(--ui-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)]">
                    <ArrowRight size={18} aria-hidden="true" />
                  </button>
                  <button type="button" onClick={showNextImage} aria-label="نمایش تصویر بعدی" className="absolute start-3 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/70 bg-[var(--ui-surface)]/95 text-[var(--ui-text)] shadow-sm backdrop-blur-sm transition hover:bg-[var(--ui-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)]">
                    <ArrowLeft size={18} aria-hidden="true" />
                  </button>
                </>
              )}
              {galleryImages.length > 1 && (
                <span className="absolute bottom-3 left-3 rounded-full border border-white/70 bg-[var(--ui-surface)]/90 px-3 py-1.5 text-xs font-medium text-[var(--ui-text-strong)] backdrop-blur-sm">
                  {new Intl.NumberFormat("fa-IR").format(activeImageIndex + 1)} از {new Intl.NumberFormat("fa-IR").format(galleryImages.length)} تصویر
                </span>
              )}
            </div>
            {galleryImages.length > 1 && (
              <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-5" aria-label="انتخاب تصویر قطعه">
                {galleryImages.map((image, index) => (
                  <button key={image} type="button" onClick={() => setActiveImageIndex(index)} aria-label={"نمایش تصویر " + (index + 1)} aria-pressed={activeImageIndex === index} className={"overflow-hidden rounded-xl border-2 bg-[var(--ui-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)] " + (activeImageIndex === index ? "border-[var(--ui-accent)]" : "border-transparent hover:border-[var(--ui-border-strong)]")}>
                    {failedImageUrls.has(image) ? <span className="flex aspect-square w-full items-center justify-center px-2 text-[10px] text-[var(--ui-muted)]">تصویر موجود نیست</span> : <img src={image} alt="" loading="lazy" onError={() => markGalleryImageFailed(image)} className="aspect-square w-full bg-[var(--ui-surface)] object-contain p-1" />}
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="min-w-0 rounded-[1.5rem] border border-[var(--ui-border)] bg-[var(--ui-surface)] px-5 py-6 sm:px-8 sm:py-9 lg:sticky lg:top-24 lg:px-10">
            <p className="text-xs font-semibold tracking-wide text-[var(--ui-accent)]">{categoryName || "قطعات یدکی میبا"}</p>
            <h1 className="mt-3 text-2xl font-bold leading-tight tracking-tight sm:text-3xl">{product.name}</h1>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[var(--ui-muted)]">
              {product.sku && <><span>کد کالا:</span><CopyCode value={product.sku} label="کد کالا" /></>}
              {qualityName && <span className="rounded-full bg-[var(--ui-accent-soft)] px-2.5 py-1 font-bold text-[var(--ui-accent)]">{qualityName}</span>}
            </div>
            <PartPrice product={product} size="lg" className="mt-5" />
            {offer && (
              <p className="mt-2 text-xs leading-6 text-[var(--ui-muted)]">
                {offer.minQuantity > 1
                  ? `قیمت همکار برای سفارش ${fa.format(offer.minQuantity)} عدد و بیشتر اعمال می‌شود.`
                  : "قیمت همکار برای حساب عمده شما اعمال می‌شود."}
              </p>
            )}
            <div className="my-6 h-px bg-[var(--ui-border)]" />

            {sizes.length > 0 && (
              <section aria-labelledby="size-options-heading" className="mb-6">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 id="size-options-heading" className="text-sm font-semibold">نوع / موقعیت قطعه</h2>
                </div>
                {hasVariants && <p className="mb-2 text-xs leading-5 text-[var(--ui-muted)]">گزینه‌های خط‌چین با انتخاب خودکار رنگ سازگار در دسترس‌اند؛ گزینه‌های ناموجود قابل انتخاب نیستند.</p>}
                <div className="flex flex-wrap gap-2">
                  {sizes.map((size) => {
                    const hasAnyStock = hasVariants && hasAnyStockForSize(size);
                    const compatible = !hasVariants || hasStockForSize(size);
                    const unavailable = hasVariants && !hasAnyStock;
                    return (
                      <button key={size} type="button" disabled={unavailable} onClick={() => handleSizeSelect(size)} aria-pressed={selectedSize === size} aria-label={hasAnyStock && !compatible ? "نوع " + size + "؛ رنگ سازگار خودکار انتخاب می‌شود" : "نوع " + size} className={"relative min-h-11 min-w-12 rounded-xl border px-4 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)] disabled:cursor-not-allowed disabled:border-[var(--ui-border)] disabled:bg-[var(--ui-disabled-bg)] disabled:text-[var(--ui-disabled-text)] disabled:line-through " + (selectedSize === size ? "border-[var(--ui-strong-surface)] bg-[var(--ui-strong-surface)] text-[var(--ui-inverse-text)]" : compatible ? "border-[var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text-strong)] hover:border-[var(--ui-accent)]" : "border-dashed border-[var(--ui-accent)] bg-[var(--ui-accent-soft)] text-[var(--ui-text-strong)] hover:border-[var(--ui-accent)]")}>
                        {size}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {colors.length > 0 && (
              <section aria-labelledby="color-options-heading" className="mb-6">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 id="color-options-heading" className="text-sm font-semibold">رنگ</h2>
                  <span className="text-xs text-[var(--ui-muted)]">{selectedColor || "انتخاب نشده"}</span>
                </div>
                <div className="flex flex-wrap gap-3">
                  {colors.map((color) => {
                    const hasAnyStock = hasVariants && hasAnyStockForColor(color.name);
                    const compatible = !hasVariants || hasStockForColor(color.name);
                    const unavailable = hasVariants && !hasAnyStock;
                    return (
                      <button key={color.name} type="button" disabled={unavailable} onClick={() => handleColorSelect(color.name)} aria-label={hasAnyStock && !compatible ? "انتخاب رنگ " + color.name + "؛ نوع سازگار خودکار انتخاب می‌شود" : "انتخاب رنگ " + color.name} aria-pressed={selectedColor === color.name} className={"group flex min-h-12 items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)] disabled:cursor-not-allowed disabled:opacity-35 " + (selectedColor === color.name ? "border-[var(--ui-accent)] bg-[var(--ui-accent-soft)] text-[var(--ui-text)]" : compatible ? "border-[var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-muted)] hover:border-[var(--ui-border-strong)]" : "border-dashed border-[var(--ui-accent)] bg-[var(--ui-accent-soft)] text-[var(--ui-text-strong)] hover:border-[var(--ui-accent)]")}>
                        <span className={"relative inline-flex h-6 w-6 items-center justify-center rounded-full border border-black/10 " + (unavailable ? "after:absolute after:h-px after:w-7 after:rotate-45 after:bg-[var(--ui-danger)]" : "")} style={{ backgroundColor: color.hex || "#d2d6dc" }}>
                          {selectedColor === color.name && <Check size={14} className={["#ffffff", "#fff", "#f9fafb"].includes(String(color.hex).toLowerCase()) ? "text-[var(--ui-text)]" : "text-[var(--ui-inverse-text)] drop-shadow"} aria-hidden="true" />}
                        </span>
                        <span>{color.name}</span>
                      </button>
                    );
                  })}
                </div>
                {hasVariants && <p className="mt-2 text-xs leading-5 text-[var(--ui-muted)]">رنگ‌های خط‌چین با انتخاب خودکار نوع سازگار در دسترس‌اند.</p>}
              </section>
            )}

            <div role="status" aria-live="polite" aria-atomic="true" className="mb-6 rounded-xl border border-[var(--ui-border)] px-4 py-3">
              {(sizes.length > 0 || colors.length > 0) && (
                <p className="mb-2 text-xs leading-5 text-[var(--ui-muted)]">
                  انتخاب شما: {sizes.length > 0 ? "نوع " + (selectedSize || "انتخاب‌نشده") : "بدون گزینه"} · {colors.length > 0 ? "رنگ " + (selectedColor || "انتخاب‌نشده") : "بدون رنگ"}
                </p>
              )}
              <p className={"flex items-center gap-2 text-sm font-semibold " + (outOfStock ? "text-[var(--ui-danger)]" : "text-[var(--ui-accent)]")}>
                <span className={"h-2 w-2 rounded-full " + (outOfStock ? "bg-[var(--ui-danger)]" : "bg-[var(--ui-accent)]")} aria-hidden="true" />
                {outOfStock ? (hasVariants ? "این گزینه ناموجود است" : "در حال حاضر ناموجود") : "موجود در انبار میبا"}
              </p>
              {hasStockValue && <p className="mt-1.5 text-xs text-[var(--ui-muted)]">موجودی انبار: {fa.format(normalizedSelectedStock)} عدد</p>}
              {!hasVariants && !isStockTracked(product) && <p className="mt-1.5 text-xs text-[var(--ui-muted)]">موجودی این قطعه هنگام ثبت سفارش بررسی می‌شود.</p>}
            </div>

            {specRows.length > 0 && (
              <section aria-labelledby="spec-heading" className="mb-6">
                <h2 id="spec-heading" className="text-sm font-semibold">مشخصات فنی</h2>
                <dl className="mt-3 divide-y divide-[var(--ui-border)] rounded-xl border border-[var(--ui-border)] text-sm">
                  {specRows.map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-4 px-4 py-2.5"><dt className="text-[var(--ui-muted)]">{label}</dt><dd className="font-medium text-[var(--ui-text)]">{value}</dd></div>
                  ))}
                  {oemNumbers.length > 0 && (
                    <div className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-start sm:justify-between"><dt className="text-[var(--ui-muted)]">شماره فنی (OEM)</dt><dd className="flex flex-wrap gap-1.5">{oemNumbers.map((code) => <CopyCode key={code} value={code} label="شماره فنی" />)}</dd></div>
                  )}
                </dl>
              </section>
            )}

            <h2 className="text-sm font-semibold">توضیحات</h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-7 text-[var(--ui-muted)]">{product.description || "پیش از خرید، کد فنی و مدل خودرو را با قطعه فعلی مقایسه کنید."}</p>

            {!outOfStock && (
              <div className="mt-7">
                <label htmlFor="product-quantity" className="text-sm font-semibold">تعداد</label>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <div className="inline-flex items-center rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface)]">
                    <button type="button" aria-label="کاهش تعداد" disabled={quantity <= 1} onClick={() => setClampedQuantity(quantity - 1)} className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[var(--ui-text)] transition hover:bg-[var(--ui-hover)] disabled:opacity-40"><Minus size={16} aria-hidden="true" /></button>
                    <input id="product-quantity" type="text" inputMode="numeric" dir="ltr" value={quantity} onChange={(event) => setClampedQuantity(event.target.value)} className="h-11 w-16 border-0 bg-transparent text-center text-sm font-semibold tabular-nums text-[var(--ui-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ui-focus)]/30" />
                    <button type="button" aria-label="افزایش تعداد" disabled={quantity >= lineLimit} onClick={() => setClampedQuantity(quantity + 1)} className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[var(--ui-text)] transition hover:bg-[var(--ui-hover)] disabled:opacity-40"><Plus size={16} aria-hidden="true" /></button>
                  </div>
                  <p className="text-sm text-[var(--ui-muted)]" aria-live="polite">جمع: <span className="font-bold tabular-nums text-[var(--ui-text)]">{formatPrice(unitPrice * quantity)}</span></p>
                </div>
                {offer && offer.minQuantity > 1 && quantity < offer.minQuantity && (
                  <p className="mt-2 text-xs text-[var(--ui-warning)]">با سفارش {fa.format(offer.minQuantity)} عدد یا بیشتر، قیمت همکار ({formatPrice(offer.unitPrice)}) اعمال می‌شود.</p>
                )}
              </div>
            )}

            <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
              <button type="button" onClick={handleAddToCart} disabled={outOfStock} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-[var(--ui-accent)] px-4 py-3 text-sm font-bold text-white transition hover:bg-[var(--ui-accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)] disabled:cursor-not-allowed disabled:bg-[var(--ui-disabled-bg)] disabled:text-[var(--ui-muted)] sm:flex-[1.2]"><ShoppingCart size={17} aria-hidden="true" />{outOfStock ? "ناموجود" : "افزودن به سبد خرید"}</button>
              <button type="button" onClick={handleToggleWishlist} aria-pressed={isWishlisted} aria-label={isWishlisted ? "حذف قطعه از علاقه‌مندی‌ها" : "افزودن قطعه به علاقه‌مندی‌ها"} className={"inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full border px-4 py-3 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)] sm:flex-1 " + (isWishlisted ? "border-[var(--ui-accent)] bg-[var(--ui-hover)] text-[var(--ui-accent)]" : "border-[var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text)] hover:border-[var(--ui-accent)] hover:bg-[var(--ui-hover)]")}>
                <Heart size={17} fill={isWishlisted ? "currentColor" : "none"} aria-hidden="true" />
                {isWishlisted ? "ذخیره‌شده در علاقه‌مندی‌ها" : "افزودن به علاقه‌مندی‌ها"}
              </button>
            </div>
            <Link to="/shop" className="mt-4 inline-flex min-h-9 items-center gap-2 self-start rounded-full px-2 py-2 text-xs font-semibold text-[var(--ui-muted)] transition hover:text-[var(--ui-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)]">ادامه جستجوی قطعات <ArrowLeft size={14} aria-hidden="true" /></Link>
            <div className="mt-5 grid gap-2 border-t border-[var(--ui-border)] pt-4 text-xs sm:grid-cols-3">
              <Link to="/shipping-policy" className="rounded-xl bg-[var(--ui-canvas)] px-3 py-3 text-center text-[var(--ui-muted)] transition hover:bg-[var(--ui-hover)] hover:text-[var(--ui-text)]">اطلاعات ارسال</Link>
              <Link to="/returns-policy" className="rounded-xl bg-[var(--ui-canvas)] px-3 py-3 text-center text-[var(--ui-muted)] transition hover:bg-[var(--ui-hover)] hover:text-[var(--ui-text)]">شرایط بازگشت</Link>
              <Link to="/support" className="rounded-xl bg-[var(--ui-canvas)] px-3 py-3 text-center text-[var(--ui-muted)] transition hover:bg-[var(--ui-hover)] hover:text-[var(--ui-text)]">پشتیبانی و راهنمایی</Link>
            </div>
            <p className="mt-4 flex items-center gap-2 text-xs leading-5 text-[var(--ui-muted)]"><ShieldCheck size={15} className="shrink-0 text-[var(--ui-accent)]" aria-hidden="true" />ضمانت اصالت کالا؛ پیش از خرید، کد فنی را با قطعه فعلی خودرو تطبیق دهید.</p>
          </section>
        </div>

        <section aria-labelledby="fitment-heading" className="mt-8 rounded-[1.5rem] border border-[var(--ui-border)] bg-[var(--ui-surface)] p-5 sm:p-8">
          <h2 id="fitment-heading" className="flex items-center gap-2 text-lg font-bold"><Car size={20} className="text-[var(--ui-accent)]" aria-hidden="true" />خودروهای سازگار</h2>
          {fitments.length ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[480px] text-right text-sm">
                <thead className="bg-[var(--ui-canvas)] text-xs text-[var(--ui-muted)]"><tr><th scope="col" className="px-3 py-3 font-semibold">برند خودرو</th><th scope="col" className="px-3 py-3 font-semibold">مدل</th><th scope="col" className="px-3 py-3 font-semibold">سال تولید</th><th scope="col" className="px-3 py-3 font-semibold">موتور</th></tr></thead>
                <tbody className="divide-y divide-[var(--ui-border)]">
                  {fitments.map((fitment) => (
                    <tr key={formatFitment(fitment)}>
                      <td className="px-3 py-3 font-medium">{fitment.make}</td>
                      <td className="px-3 py-3">{fitment.model ? <Link className="text-[var(--ui-accent)] hover:underline" to={"/shop?make=" + encodeURIComponent(fitment.make) + "&model=" + encodeURIComponent(fitment.model)}>{fitment.model}</Link> : "همه مدل‌ها"}</td>
                      <td className="px-3 py-3 tabular-nums">{fitment.yearFrom || fitment.yearTo ? [fitment.yearFrom, fitment.yearTo].filter(Boolean).map((year) => faYear.format(year)).join(" تا ") : "—"}</td>
                      <td className="px-3 py-3">{fitment.engine || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-sm leading-7 text-[var(--ui-muted)]">خودروی سازگار برای این قطعه ثبت نشده است. برای اطمینان، کد فنی قطعه فعلی را با پشتیبانی میبا بررسی کنید.</p>
          )}
        </section>

        {(relatedProducts.length > 0 || recentlyViewed.length > 0) && (
          <section className="mt-10 border-t border-[var(--ui-border)] pt-8 sm:mt-14 sm:pt-10" aria-label="پیشنهادهای بیشتر">
            {relatedProducts.length > 0 && (
              <div className="mb-10">
                <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                  <div><p className="text-xs font-semibold text-[var(--ui-accent)]">انتخاب‌های مشابه</p><h2 className="mt-1 text-xl font-bold sm:text-2xl">قطعات مشابه</h2></div>
                  {product.category && <Link to={"/category/" + encodeURIComponent(product.category)} className="inline-flex min-h-9 items-center gap-1 rounded-full px-3 py-2 text-xs font-semibold text-[var(--ui-muted)] transition hover:bg-[var(--ui-hover)] hover:text-[var(--ui-text)]">مشاهده دسته‌بندی <ArrowLeft size={14} aria-hidden="true" /></Link>}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
                  {relatedProducts.map(item => <ProductCard key={item._id} product={item} />)}
                </div>
              </div>
            )}
            {recentlyViewed.filter(item => String(item._id) !== String(product._id) && !relatedProducts.some(related => String(related._id) === String(item._id)) && (Array.isArray(item.variants) && item.variants.length ? item.variants.some(variant => Number(variant.stock) > 0) : !isOutOfStock(item))).length > 0 && (
              <div>
                <h2 className="mb-5 text-xl font-bold sm:text-2xl">بازدیدهای اخیر شما</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
                  {recentlyViewed.filter(item => String(item._id) !== String(product._id) && !relatedProducts.some(related => String(related._id) === String(item._id)) && (Array.isArray(item.variants) && item.variants.length ? item.variants.some(variant => Number(variant.stock) > 0) : !isOutOfStock(item))).map(item => <ProductCard key={item._id} product={item} />)}
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--ui-border)] bg-[var(--ui-surface)]/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-12px_35px_-24px_rgba(0,0,0,0.3)] backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-[var(--ui-muted)]">{product.name}</p>
            <p className="mt-0.5 text-sm font-bold tabular-nums">{formatPrice(unitPrice * (outOfStock ? 1 : quantity))}{!outOfStock && quantity > 1 && <span className="mr-1 text-xs font-normal text-[var(--ui-muted)]">({fa.format(quantity)} عدد)</span>}</p>
          </div>
          <button type="button" onClick={handleAddToCart} disabled={outOfStock} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-[var(--ui-accent)] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[var(--ui-accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)] disabled:cursor-not-allowed disabled:bg-[var(--ui-disabled-bg)] disabled:text-[var(--ui-muted)]">
            <ShoppingCart size={16} aria-hidden="true" />{outOfStock ? "ناموجود" : "افزودن به سبد خرید"}
          </button>
        </div>
      </div>

      {imageViewerOpen && activeGalleryImage && !failedImageUrls.has(activeGalleryImage) && (
        <div data-product-image-dialog role="dialog" aria-modal="true" aria-label={"نمایش بزرگ تصویر " + product.name} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-3 sm:p-6" onMouseDown={event => { if (event.target === event.currentTarget) setImageViewerOpen(false); }}>
          <button ref={imageViewerCloseRef} type="button" onClick={() => setImageViewerOpen(false)} aria-label="بستن تصویر بزرگ" className="absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white sm:right-5 sm:top-5"><X size={21} aria-hidden="true" /></button>
          {galleryImages.length > 1 && <button type="button" onClick={showPreviousImage} aria-label="تصویر قبلی" className="absolute right-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25 sm:right-6"><ArrowRight size={20} aria-hidden="true" /></button>}
          <img src={activeGalleryImage} alt={product.name} onError={() => markGalleryImageFailed(activeGalleryImage)} className="max-h-[88dvh] max-w-[94vw] touch-pinch-zoom object-contain" />
          {galleryImages.length > 1 && <button type="button" onClick={showNextImage} aria-label="تصویر بعدی" className="absolute left-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25 sm:left-6"><ArrowLeft size={20} aria-hidden="true" /></button>}
        </div>
      )}
    </main>
  );
};

export default ProductDetailsPage;
