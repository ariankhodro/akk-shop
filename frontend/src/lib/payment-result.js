// A browser redirect may be an error even after the provider accepted payment.
// Only a server-assigned terminal-unpaid reason may be presented as a confirmed failure.
export const isConfirmedPaymentFailure = (reason) => reason === "payment-not-confirmed";
