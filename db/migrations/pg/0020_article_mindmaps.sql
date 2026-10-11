ALTER TABLE "mindmaps" ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mindmap_bindings" ("id" text PRIMARY KEY NOT NULL, "domain" text NOT NULL, "target_id" text NOT NULL, "map_id" text NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "source_block_indexes" ("id" text PRIMARY KEY NOT NULL, "data" text NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mindmap_backups" ("id" text PRIMARY KEY NOT NULL, "map_id" text NOT NULL, "data" text NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL);
