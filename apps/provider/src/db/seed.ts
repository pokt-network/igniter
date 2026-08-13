import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/vercel-postgres";
import { UserRole, usersTable } from "./schema";
import "dotenv/config";
import { configureLogging, getLogger } from "@igniter/logger";

async function main() {
  await configureLogging({ serviceName: 'provider' });
  const logger = getLogger(['provider', 'seed']);

  const db = drizzle();

  const user: typeof usersTable.$inferInsert = {
    identity: "test",
    email: "john@example.com",
    role: UserRole.User,
  };

  await db.insert(usersTable).values(user);
  logger.info("user created", { identity: user.identity });

  const users = await db.select().from(usersTable);
  logger.debug("users listed", { count: users.length });

  await db
    .update(usersTable)
    .set({
      email: "johnY@example.com",
    })
    .where(eq(usersTable.email, "john@example.com"));
  logger.info("user updated", { identity: user.identity });
}

main();
