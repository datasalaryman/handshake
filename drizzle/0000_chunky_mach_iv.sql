CREATE TABLE "handshake_swap_offers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cluster_id" text NOT NULL,
	"maker_address" text NOT NULL,
	"maker_send_token_address" text NOT NULL,
	"maker_send_amount" text NOT NULL,
	"taker_address" text NOT NULL,
	"taker_send_token_address" text NOT NULL,
	"taker_send_amount" text NOT NULL,
	"vector_signature" text NOT NULL,
	"status" text NOT NULL,
	"submitted_signature" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
