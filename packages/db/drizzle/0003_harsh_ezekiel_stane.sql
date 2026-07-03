DROP INDEX "contribution_snapshots_peer_id_idx";--> statement-breakpoint
CREATE INDEX "contribution_snapshots_peer_id_captured_at_idx" ON "contribution_snapshots" USING btree ("peer_id","captured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "uploads_created_at_idx" ON "uploads" USING btree ("created_at" DESC NULLS LAST);