# Frontend session and form notes

## Session hint

- `localStorage["session-hint"] = "1"` is set after a successful login, signup or `/auth/profile`, and cleared on logout or a definitive 401/403 from the profile probe.
- It holds no token or user data. It only tells the app whether to probe `/auth/profile` at boot and whether a 401 may trigger `/auth/refresh-token`.
- Anonymous visitors (no hint) make no auth requests at boot.
- Sessions that predate this change have no hint: those users appear signed out once and must sign in again (cookies are otherwise unaffected).

## Refresh behaviour

- `checkingAuth` is the boot probe flag only. A token refresh never changes it and never unmounts the app.
- On a 401 the first caller refreshes; concurrent callers share that refresh.
- If the refresh itself fails with 401/403, the app re-checks `/auth/profile` once. If that succeeds (another tab rotated the cookies first) the user stays signed in and the original request is retried; otherwise the user is logged out.
- Network errors and 5xx on refresh do not log the user out.

## Shared helpers

- `src/lib/normalize-digits.js`: the single Persian/Arabic-Indic to ASCII digit normalizer.
- `src/lib/persian-validity.js`: document-level handler that swaps native English validation bubbles for Persian text.
- `src/lib/use-dialog.js`: Escape, initial focus, focus return, Tab trap and scroll lock for dialogs; `modal: false` for popovers.

## Not done here

- Admin `type="number"` inputs (FE-20) still use native number inputs; only the customer-facing price filters and coupon code were converted.
- AdminPage, CustomerManagement, DashboardOverview and CampaignManager were left for the RBAC rework (FE-29 admin nav roles, FE-4 not applicable there).
