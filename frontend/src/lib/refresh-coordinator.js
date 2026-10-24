export const shouldAttemptTokenRefresh = (error) => {
  const request = error?.config;
  if (!request || error?.response?.status !== 401 || request._retry) return false;

  const url = String(request.url || "").split("?")[0];
  const authEndpoint = /(?:^|\/)auth\/(?:refresh-token|logout|login|signup|forgot-password|reset-password)$/.test(url);
  return !authEndpoint;
};

export const createRefreshCoordinator = (refresh) => {
  let activePromise = null;
  return () => {
    if (!activePromise) activePromise = Promise.resolve().then(refresh);
    const currentPromise = activePromise;
    return currentPromise.finally(() => {
      if (activePromise === currentPromise) activePromise = null;
    });
  };
};
