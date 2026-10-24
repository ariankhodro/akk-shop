# Admin expansion requirements

This branch adds a first version of customer access management, low-stock dashboard alerts, sales CSV export, and support/return/refund case tracking. Keep the current admin shell and URL `?tab=` navigation; extend existing components rather than rebuilding the dashboard.

## Customer management and permissions
- Search by name/email, paginate, inspect role and account status.
- Deactivate/reactivate accounts; prevent administrators from removing their own access or disabling the last active administrator.
- Permission capabilities: catalogue, orders, customers, support, reports, settings, inventory, audit, operations, marketing, and role management.
- Legacy administrators without a permission array retain current access until explicitly configured. Review and migrate those accounts before production rollout.

## Support, returns, and refunds
- Support requests may be general or linked to an order; returns require a delivered paid order; refund requests require a paid IRT/Zarinpal order.
- Keep case history and administrator resolution notes.
- Refund status is operational bookkeeping only. These endpoints do not issue refunds through Zarinpal. Mark a refund processed only after an operator has performed the actual refund and recorded its reference.
- Before launch, define the return window, eligible product conditions, partial-refund policy, shipping-fee treatment, and approval authority.

## Sales reporting
- CSV export includes paid Zarinpal/IRT orders, customer identity, totals, shipping, discounts, coupon, shipment state, and payment reference.
- Exports are capped at 10,000 rows and formula-escaped for spreadsheet safety.
- Define net-revenue treatment for refunds/returns before describing reports as profit or net sales; existing charts remain gross paid-order reporting.

## Inventory
- Low-stock alerts currently use an adjustable threshold and scan up to 500 active products.
- Define per-variant thresholds, untracked-stock handling, alert recipients, deduplication, notification channels, and stock history before adding automatic alerts.

## Store settings
- Existing settings cover shipping rates and free-shipping thresholds only.
- Before a broader settings section is added, define public/editable settings for store identity, contact details, social links, announcements, policies, tax/shipping behavior, and maintenance mode. Specify validation, audit history, and changes requiring re-authentication.

## Responsive/UX verification
- Keep the existing ivory/charcoal/sage design tokens and Persian RTL layout.
- Verify browser rendering at 320, 360, 390, 768, 1024, 1280, and 1440 px. Include long Persian labels, long customer emails/IDs, empty/error/loading states, keyboard navigation, and narrow charts/tables.
- This source-only update cannot certify rendered screenshots. Run the preview or local browser before considering visual verification complete.
