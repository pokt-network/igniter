import { redirect } from 'next/navigation';

// The unstake flow is a modal now (opened from the supplier detail with the supplier
// pre-selected, or from the bulk "Unstake" button on the suppliers list). This route
// is kept only so any stale /app/unstake link lands somewhere sensible.
export default function UnstakePage() {
  redirect('/app/suppliers');
}
