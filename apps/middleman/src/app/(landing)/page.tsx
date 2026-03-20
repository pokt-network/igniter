import type { Metadata } from 'next'
import Hero from "./components/Hero";
import About from "./components/About";
import EmptySpace from "./components/EmptySpace";
import { GetAppName } from '@/actions/ApplicationSettings'
import Footer from '@/app/(landing)/components/Footer'
import OverrideSidebar from '@igniter/ui/components/OverrideSidebar'

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: `Home - ${appName}`,
    description: `Light up your earnings with ${appName}`,
  }
}

export default function Landing() {
    return (
      <OverrideSidebar>
        <div className="flex flex-row justify-center w-full bg-bg-root">
          <div className="w-full max-w-[958px] border-x border-border-primary overflow-y-auto">
            <Hero />
            <About />
            <EmptySpace />
            <Footer />
          </div>
        </div>
      </OverrideSidebar>
    );
}
