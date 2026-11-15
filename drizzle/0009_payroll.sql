CREATE TYPE "public"."pay_type" AS ENUM('daily', 'monthly');--> statement-breakpoint
CREATE TABLE "attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"marked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_employee_date_unique" UNIQUE("employee_id","business_date")
);
--> statement-breakpoint
CREATE TABLE "employee_advances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"note" text,
	"ledger_entry_id" uuid,
	"settled_in_run_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_advances_positive" CHECK ("employee_advances"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"pay_type" "pay_type" NOT NULL,
	"rate_cents" bigint NOT NULL,
	"start_date" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_id_shop_unique" UNIQUE("id","shop_id"),
	CONSTRAINT "employees_rate_non_negative" CHECK ("employees"."rate_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payroll_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"days_worked" integer NOT NULL,
	"gross_cents" bigint NOT NULL,
	"advances_cents" bigint NOT NULL,
	"net_cents" bigint NOT NULL,
	"ledger_entry_id" uuid
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"month" text NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"gross_cents" bigint NOT NULL,
	"advances_cents" bigint NOT NULL,
	"net_cents" bigint NOT NULL,
	"posted_by" uuid,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_runs_id_shop_unique" UNIQUE("id","shop_id"),
	CONSTRAINT "payroll_runs_shop_month_unique" UNIQUE("shop_id","month"),
	CONSTRAINT "payroll_runs_method" CHECK ("payroll_runs"."payment_method" in ('cash', 'mpesa'))
);
--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_employee_same_shop_fk" FOREIGN KEY ("employee_id","shop_id") REFERENCES "public"."employees"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_employee_same_shop_fk" FOREIGN KEY ("employee_id","shop_id") REFERENCES "public"."employees"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_ledger_same_shop_fk" FOREIGN KEY ("ledger_entry_id","shop_id") REFERENCES "public"."ledger_entries"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_run_same_shop_fk" FOREIGN KEY ("settled_in_run_id","shop_id") REFERENCES "public"."payroll_runs"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_run_same_shop_fk" FOREIGN KEY ("run_id","shop_id") REFERENCES "public"."payroll_runs"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_employee_same_shop_fk" FOREIGN KEY ("employee_id","shop_id") REFERENCES "public"."employees"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_ledger_same_shop_fk" FOREIGN KEY ("ledger_entry_id","shop_id") REFERENCES "public"."ledger_entries"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_shop_date_idx" ON "attendance" USING btree ("shop_id","business_date");--> statement-breakpoint
CREATE INDEX "employee_advances_shop_employee_idx" ON "employee_advances" USING btree ("shop_id","employee_id");--> statement-breakpoint
CREATE INDEX "employees_shop_idx" ON "employees" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "payroll_lines_run_idx" ON "payroll_lines" USING btree ("run_id");