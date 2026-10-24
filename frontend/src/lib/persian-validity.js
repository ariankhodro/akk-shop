// Replaces the browser's native (UI-language) constraint-validation bubbles with
// Persian text. One document-level listener covers every form field.
const fa = (value) => new Intl.NumberFormat("fa-IR", { useGrouping: false }).format(Number(value));

export const persianValidationMessage = (field) => {
  const { validity } = field;
  if (!validity || validity.valid || validity.customError) return "";
  const type = (field.type || "").toLowerCase();

  if (validity.valueMissing) {
    if (field.tagName === "SELECT") return "لطفاً یکی از گزینه‌ها را انتخاب کنید.";
    if (type === "checkbox") return "برای ادامه، این گزینه را تأیید کنید.";
    if (type === "radio") return "لطفاً یکی از گزینه‌ها را انتخاب کنید.";
    if (type === "file") return "لطفاً یک فایل انتخاب کنید.";
    return "لطفاً این فیلد را پر کنید.";
  }
  if (validity.typeMismatch) {
    if (type === "email") return "لطفاً نشانی ایمیل معتبر وارد کنید.";
    if (type === "url") return "لطفاً نشانی اینترنتی معتبر وارد کنید.";
    return "مقدار واردشده معتبر نیست.";
  }
  if (validity.tooShort) return `این فیلد دست‌کم ${fa(field.minLength)} نویسه لازم دارد.`;
  if (validity.tooLong) return `این فیلد حداکثر ${fa(field.maxLength)} نویسه می‌پذیرد.`;
  if (validity.patternMismatch) return field.title || "مقدار واردشده با قالب خواسته‌شده مطابقت ندارد.";
  if (validity.rangeUnderflow) return `مقدار باید ${fa(field.min)} یا بیشتر باشد.`;
  if (validity.rangeOverflow) return `مقدار باید ${fa(field.max)} یا کمتر باشد.`;
  if (validity.stepMismatch || validity.badInput) return "مقدار واردشده معتبر نیست.";
  return "";
};

export const installPersianValidation = (doc = document) => {
  const onInvalid = (event) => {
    const field = event.target;
    if (!field || typeof field.setCustomValidity !== "function") return;
    const message = persianValidationMessage(field);
    if (message) field.setCustomValidity(message);
  };
  // A custom message sticks until cleared, so reset it as soon as the user edits.
  const onEdit = (event) => {
    const field = event.target;
    if (field && typeof field.setCustomValidity === "function" && field.validity?.customError) {
      field.setCustomValidity("");
    }
  };
  doc.addEventListener("invalid", onInvalid, true);
  doc.addEventListener("input", onEdit, true);
  doc.addEventListener("change", onEdit, true);
  return () => {
    doc.removeEventListener("invalid", onInvalid, true);
    doc.removeEventListener("input", onEdit, true);
    doc.removeEventListener("change", onEdit, true);
  };
};
