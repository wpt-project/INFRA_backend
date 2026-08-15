CREATE TABLE "message_relay" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_device_id" uuid NOT NULL,
	"recipient_device_id" uuid NOT NULL,
	"recipient_user_id" uuid,
	"recipient_group_id" uuid,
	"ciphertext" "bytea" NOT NULL,
	"message_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '30 days' NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "message_relay_recipient_exactly_one" CHECK ((
        ("message_relay"."recipient_user_id" IS NOT NULL AND "message_relay"."recipient_group_id" IS NULL)
        OR
        ("message_relay"."recipient_user_id" IS NULL AND "message_relay"."recipient_group_id" IS NOT NULL)
      )),
	CONSTRAINT "message_relay_size_bytes_non_negative" CHECK ("message_relay"."size_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "message_relay" ADD CONSTRAINT "message_relay_sender_device_id_devices_id_fk" FOREIGN KEY ("sender_device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_relay" ADD CONSTRAINT "message_relay_recipient_device_id_devices_id_fk" FOREIGN KEY ("recipient_device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_relay" ADD CONSTRAINT "message_relay_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_relay" ADD CONSTRAINT "message_relay_recipient_group_id_groups_id_fk" FOREIGN KEY ("recipient_group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;