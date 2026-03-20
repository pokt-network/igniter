import type { Metadata } from 'next'
import { GetAppName } from '@/actions/ApplicationSettings'
import OverrideSidebar from '@igniter/ui/components/OverrideSidebar'
import LandingPage from './components/LandingPage'

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: 'Igniter - Pocket Network Supplier Staking',
    description: `Non-custodial staking for $POKT — stake across multiple providers without giving up custody of your tokens.`,
  }
}

export default function Landing() {
    return (
      <OverrideSidebar>
        <LandingPage />
      </OverrideSidebar>
    );
}
