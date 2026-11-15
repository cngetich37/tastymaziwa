ALTER TABLE "employees" ADD COLUMN "statutory" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "kra_pin" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "nssf_number" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "sha_number" text;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "nssf_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "shif_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "housing_levy_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "taxable_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "paye_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "employer_nssf_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "employer_housing_levy_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "statutory_due_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "remitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "remittance_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_remittance_same_shop_fk" FOREIGN KEY ("remittance_entry_id","shop_id") REFERENCES "public"."ledger_entries"("id","shop_id") ON DELETE no action ON UPDATE no action;