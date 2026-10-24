# Password recovery setup

The storefront includes a one-time password-recovery flow. To enable delivery, configure these backend environment variables in the deployment environment:

- `RESEND_API_KEY`: API key for the Resend email provider.
- `EMAIL_FROM`: sender address on a domain verified with Resend (use the exact sender format allowed by your Resend account).
- `APP_URL` or `FRONTEND_URL`: absolute public base URL of the storefront, for example `https://shop.example.com`. The app generates `/reset-password?token=…` links under this origin.

Do not commit API keys or real credentials to the repository. Restart/redeploy the backend after setting the variables.

Security behavior:
- Recovery tokens are generated with a cryptographically secure random generator.
- Only the SHA-256 token hash is stored on the user document.
- Each token expires after 30 minutes and is cleared after a successful reset.
- Reset requests have the existing authentication rate limit applied.
- A successful reset uses the existing password-hashing hook and revokes the stored refresh token.
- Recovery URLs are marked `noindex, nofollow` by the storefront.

If the email provider is not configured, `POST /api/auth/forgot-password` returns HTTP 503 so the deployment can be corrected. Provider send failures are logged by the backend; inspect the application logs and Resend delivery events when troubleshooting.

Email verification is intentionally not enabled by this change: the existing application does not require verified email addresses for account creation or login, and enabling it safely would require a separate account-policy decision and a migration/rollout plan.
