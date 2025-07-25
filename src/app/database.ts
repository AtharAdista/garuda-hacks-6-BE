import { PrismaClient } from "@prisma/client";

// Create a single global instance with connection pooling
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Function to create a new Prisma client with proper error handling
function createPrismaClient() {
  return new PrismaClient({
    log: ["error"],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
    // Disable query engine caching to prevent prepared statement conflicts
    errorFormat: "pretty",
  });
}

export const prismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production")
  globalForPrisma.prisma = prismaClient;

// Add connection recovery mechanism
export async function ensureDatabaseConnection() {
  try {
    await prismaClient.$connect();
    // Test the connection
    await prismaClient.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    console.error("Database connection error:", error);

    // Try to reconnect
    try {
      await prismaClient.$disconnect();
      await prismaClient.$connect();
      return true;
    } catch (reconnectError) {
      console.error("Failed to reconnect to database:", reconnectError);
      return false;
    }
  }
}

// Graceful shutdown handling
process.on("beforeExit", async () => {
  await prismaClient.$disconnect();
});

process.on("SIGINT", async () => {
  await prismaClient.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await prismaClient.$disconnect();
  process.exit(0);
});
