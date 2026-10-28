import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const user = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  /**
   * E.164 (`+79001234567`). Required wherever a person books or signs up, but
   * nullable here: accounts created by an emailed code have none until asked.
   */
  phone: text("phone"),
  username: text("username"),
  bio: text("bio"),
  language: text("language").default("en"),
  // Better Auth admin plugin
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});
