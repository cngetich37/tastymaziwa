/**
 * The original STK callback path. New prompts use /api/payments/stk/... (Daraja
 * is reported to drop callback URLs containing "mpesa"); this stays so prompts
 * sent before the move still settle.
 */
export { POST } from '@/app/api/payments/stk/[id]/[token]/route';
