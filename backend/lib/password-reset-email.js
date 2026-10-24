export const isPasswordResetEmailConfigured = () =>
  Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM && (process.env.APP_URL || process.env.FRONTEND_URL));

export async function sendPasswordResetEmail(email, token) {
  if (!isPasswordResetEmailConfigured()) {
    const error = new Error("Password recovery email is not configured");
    error.code = "EMAIL_NOT_CONFIGURED";
    throw error;
  }
  const resetUrl = new URL("/reset-password", process.env.APP_URL || process.env.FRONTEND_URL);
  resetUrl.searchParams.set("token", token);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [email],
      subject: "Reset your Tique Boutique password",
      html: '<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>Password reset</h2><p>A password reset was requested for your account.</p><p><a href="' + resetUrl.toString() + '">Choose a new password</a></p><p>This link expires in 30 minutes and can only be used once. If you did not request it, you can ignore this email.</p></div>',
    }),
  });
  if (!response.ok) throw new Error("Password reset email provider returned HTTP " + response.status);
}
