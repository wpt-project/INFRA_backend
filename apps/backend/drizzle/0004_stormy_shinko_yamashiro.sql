CREATE TYPE "public"."audit_action" AS ENUM('warn', 'restrict', 'ban', 'dismiss');--> statement-breakpoint
CREATE TYPE "public"."dashboard_admin_role" AS ENUM('owner', 'admin');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"action" "audit_action" NOT NULL,
	"target_phone_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "dashboard_admin_role" DEFAULT 'admin' NOT NULL,
	"is_test_account" boolean DEFAULT false NOT NULL,
	"owner_reset_token_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_admins_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_admin_id_dashboard_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."dashboard_admins"("id") ON DELETE  restrict  ON UPDATE no action;