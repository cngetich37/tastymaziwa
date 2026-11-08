import { ForgotPasswordForm } from '../auth-forms';
import { AuthHeading } from '../auth-heading';

export const metadata = { title: 'Reset password · TastyMaziwa' };

export default function ForgotPasswordPage() {
  return (
    <>
      <AuthHeading title="Forgot your password?" subtitle="Enter your email and we'll send you a reset link." />
      <ForgotPasswordForm />
    </>
  );
}
