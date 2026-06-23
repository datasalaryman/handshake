ALTER TABLE "handshake_swap_offers" ADD COLUMN "is_revoked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "handshake_swap_offers" ADD COLUMN "maker_revocation_preparation_signature" text;--> statement-breakpoint
ALTER TABLE "handshake_swap_offers" ADD COLUMN "maker_revocation_signature" text;