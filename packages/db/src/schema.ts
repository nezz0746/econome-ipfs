import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Better Auth tables (shape mandated by Better Auth's Drizzle adapter).
// Table + column names must match Better Auth's expectations exactly.
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

// ---------------------------------------------------------------------------
// Application tables
// ---------------------------------------------------------------------------

/** Machine ingest credentials. Only the hash is stored; raw key shown once. */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    label: text("label").notNull(),
    hashedKey: text("hashed_key").notNull().unique(),
    /** AES-256-GCM ciphertext of the raw key, for reveal/copy in the UI. */
    encryptedKey: text("encrypted_key"),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    revokedAt: timestamp("revoked_at"),
  },
  (table) => [index("api_keys_hashed_key_idx").on(table.hashedKey)],
);

/** One row per successful ingest, used for auditing and accounting. */
export const uploads = pgTable("uploads", {
  id: uuid("id").defaultRandom().primaryKey(),
  cid: text("cid").notNull(),
  name: text("name"),
  size: bigint("size", { mode: "number" }).notNull().default(0),
  apiKeyId: uuid("api_key_id").references(() => apiKeys.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** A vetted participant running a follower (Kubo + ipfs-cluster-follow). */
export const participants = pgTable("participants", {
  id: uuid("id").defaultRandom().primaryKey(),
  peerId: text("peer_id").notNull().unique(),
  label: text("label"),
  onboardingTokenId: uuid("onboarding_token_id"),
  firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
});

/** Single-use token minted in the dashboard to onboard a new participant. */
export const onboardingTokens = pgTable("onboarding_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  token: text("token").notNull().unique(),
  label: text("label"),
  createdBy: text("created_by").references(() => user.id, {
    onDelete: "set null",
  }),
  usedByPeerId: text("used_by_peer_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
});

/** Periodic per-peer contribution snapshot. Data foundation for rewards. */
export const contributionSnapshots = pgTable(
  "contribution_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    peerId: text("peer_id").notNull(),
    bytesHeld: bigint("bytes_held", { mode: "number" }).notNull().default(0),
    cidCount: integer("cid_count").notNull().default(0),
    online: boolean("online").notNull().default(false),
    capturedAt: timestamp("captured_at").defaultNow().notNull(),
  },
  (table) => [index("contribution_snapshots_peer_id_idx").on(table.peerId)],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const participantRelations = relations(participants, ({ one }) => ({
  onboardingToken: one(onboardingTokens, {
    fields: [participants.onboardingTokenId],
    references: [onboardingTokens.id],
  }),
}));

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type Upload = typeof uploads.$inferSelect;
export type NewUpload = typeof uploads.$inferInsert;
export type Participant = typeof participants.$inferSelect;
export type OnboardingToken = typeof onboardingTokens.$inferSelect;
export type ContributionSnapshot = typeof contributionSnapshots.$inferSelect;
export type NewContributionSnapshot = typeof contributionSnapshots.$inferInsert;
