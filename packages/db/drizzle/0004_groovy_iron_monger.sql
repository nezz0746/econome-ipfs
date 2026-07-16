ALTER TABLE "onboarding_tokens" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "subscribed_tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;