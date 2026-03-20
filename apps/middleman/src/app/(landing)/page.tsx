import type { Metadata } from 'next'
import Hero from "./components/Hero";
import About from "./components/About";
import EmptySpace from "./components/EmptySpace";
import { GetAppName } from '@/actions/ApplicationSettings'
import Header from '@/app/(landing)/components/Header'
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
      <div className={'w-[100dvw] bg-bg-root absolute top-[-72px] left-0 min-w-[100dvw] z-[50]'}>
        <OverrideSidebar>
          <div className="flex flex-row justify-center min-h-screen bg-bg-root">
            <div className="h-[100dvh] w-[958px] border-x border-border-primary overflow-y-scroll scrollbar-hidden">
              <Header />
              <Hero />
              <About />
              <EmptySpace />
              <Footer />
            </div>
          </div>
        </OverrideSidebar>
      </div>
    );
}
