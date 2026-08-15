CREATE TYPE "public"."report_status" AS ENUM('pending', 'reviewed', 'actioned', 'dismissed');--> statement-breakpoint
CREATE TABLE "blocks" (
	"blocker_phone_hash" text NOT NULL,
	"blocked_phone_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_blocker_phone_hash_blocked_phone_hash_pk" PRIMARY KEY("blocker_phone_hash","blocked_phone_hash"),
	CONSTRAINT "blocks_cannot_block_self" CHECK ("blocks"."blocker_phone_hash" <> "blocks"."blocked_phone_hash")
);
--> statement-breakpoint
CREATE TABLE "report_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"message_content" text NOT NULL,
	"message_created_at" timestamp with time zone NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_phone_hash" text NOT NULL,
	"reported_phone_hash" text NOT NULL,
	"status" "report_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"actioned_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "test_report_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_report_id" uuid NOT NULL,
	"message_content" text NOT NULL,
	"message_created_at" timestamp with time zone NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_phone_hash" text NOT NULL,
	"reported_phone_hash" text NOT NULL,
	"status" "report_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"actioned_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "report_evidence" ADD CONSTRAINT "report_evidence_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_report_evidence" ADD CONSTRAINT "test_report_evidence_test_report_id_test_reports_id_fk" FOREIGN KEY ("test_report_id") REFERENCES "public"."test_reports"("id") ON DELETE cascade ON UPDATE no action;