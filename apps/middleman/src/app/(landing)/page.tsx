import type { Metadata } from 'next'
import LandingPage from './components/LandingPage'

export const metadata: Metadata = {
  title: 'Igniter - Pocket Network Supplier Staking',
  description: 'Non-custodial staking for $POKT — stake across multiple providers without giving up custody of your tokens.',
}

export default function Landing() {
    return <LandingPage />;
}
