ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_admin_id_dashboard_admins_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_admin_id_dashboard_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."dashboard_admins"("id") ON DELETE restrict ON UPDATE no action;