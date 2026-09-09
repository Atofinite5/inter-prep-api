import mongoose from 'mongoose';

let isConnected = false;
let isInMemoryFallback = false;

// In-memory mock store for environments without a live MongoDB daemon
export const inMemoryStore = {
  users: new Map<string, any>(),
  kits: new Map<string, any>(),
};

export async function connectDatabase(uri?: string): Promise<boolean> {
  if (isConnected) return true;

  const mongoUri = uri || process.env.MONGODB_URI || 'mongodb://localhost:27017/interview_prep_db';

  try {
    // Set 2 second timeout for connection attempt
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 2000,
    });
    isConnected = true;
    isInMemoryFallback = false;
    console.log(`[Database] Successfully connected to MongoDB at ${mongoUri}`);
    return true;
  } catch (err: any) {
    console.warn(`[Database Warning] Could not connect to external MongoDB (${err.message}). Using high-performance in-memory fallback store.`);
    isConnected = true;
    isInMemoryFallback = true;
    return false;
  }
}

export function getDatabaseStatus(): { isConnected: boolean; isInMemoryFallback: boolean } {
  return { isConnected, isInMemoryFallback };
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  isConnected = false;
  isInMemoryFallback = false;
}
