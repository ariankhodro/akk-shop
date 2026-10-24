import mongoose from "mongoose";

let connectionPromise = null;

// Clear the settled promise when the driver reports a dropped connection so
// subsequent requests can initiate a real reconnect instead of awaiting an
// already-resolved promise from the old connection.
mongoose.connection.on("disconnected", () => {
  connectionPromise = null;
});

export const connectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not configured");
  }

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize: (() => {
        const configured = Number(process.env.MONGO_MAX_POOL_SIZE);
        return Number.isInteger(configured) && configured >= 1 && configured <= 20 ? configured : 5;
      })(),
      minPoolSize: 0,
      maxConnecting: 2,
      waitQueueTimeoutMS: 5000,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
      maxIdleTimeMS: 30000,
    }).catch((error) => {
      connectionPromise = null;
      throw error;
    });
  }

  const connection = await connectionPromise;
  console.log(`MongoDB connected: ${connection.connection.host}`);
  return connection.connection;
};
