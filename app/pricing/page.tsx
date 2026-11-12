import { redirect } from 'next/navigation'

/** Legal pages and older links point at /pricing; plans live on the landing page. */
export default function PricingPage() {
  redirect('/#pricing')
}
