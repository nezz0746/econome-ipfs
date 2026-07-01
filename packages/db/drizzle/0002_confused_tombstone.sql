CREATE TABLE "geoip_cache" (
	"ip" text PRIMARY KEY NOT NULL,
	"country_code" text,
	"country" text,
	"city" text,
	"lat" double precision,
	"lon" double precision,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pin_sizes" (
	"cid" text PRIMARY KEY NOT NULL,
	"size" bigint NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
