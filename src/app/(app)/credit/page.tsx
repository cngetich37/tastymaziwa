import { redirect } from 'next/navigation';

/** Credit now lives on the Customers page (who owes what, and each statement). */
export default function CreditPage() {
  redirect('/customers?show=owing');
}
