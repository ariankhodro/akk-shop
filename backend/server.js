import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const [{ default: app }, { connectDB }, { redis }, { assertValidEnvironment }, { logger, errorFields }] = await Promise.all([
	import("./app.js"),
	import("./lib/db.js"),
	import("./lib/redis.js"),
	import("./lib/config.js"),
	import("./lib/logger.js"),
]);

try {
	assertValidEnvironment();
} catch (error) {
	logger.error("startup_aborted", errorFields(error));
	process.exit(1);
}

const PORT = process.env.PORT || 5000;
const SHUTDOWN_TIMEOUT_MS = 15_000;

let server;
let shuttingDown = false;

// Stop accepting connections, let in-flight requests finish, then close
// MongoDB and Redis. A hard timeout guarantees the process cannot hang.
const shutdown = async (signal) => {
	if (shuttingDown) return;
	shuttingDown = true;
	logger.info("shutdown_started", { signal });
	const forceExit = setTimeout(() => {
		logger.error("shutdown_timeout", { signal });
		process.exit(1);
	}, SHUTDOWN_TIMEOUT_MS);
	forceExit.unref();
	try {
		if (server) await new Promise((resolve) => server.close(resolve));
		await mongoose.disconnect();
		if (typeof redis.quit === "function") await redis.quit().catch(() => {});
		logger.info("shutdown_complete", { signal });
		process.exit(0);
	} catch (error) {
		logger.error("shutdown_failed", errorFields(error));
		process.exit(1);
	}
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => logger.error("unhandled_rejection", errorFields(reason)));
process.on("uncaughtException", (error) => {
	logger.error("uncaught_exception", errorFields(error));
	shutdown("uncaughtException");
});

connectDB()
	.then(() => {
		server = app.listen(PORT, () => logger.info("server_listening", { port: Number(PORT) }));
		// Keep-alive must outlive typical proxy idle timeouts to avoid sporadic 502s.
		server.keepAliveTimeout = 65_000;
	})
	.catch((error) => {
		logger.error("startup_failed", errorFields(error));
		process.exit(1);
	});
