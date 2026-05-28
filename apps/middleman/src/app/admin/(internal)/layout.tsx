import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { UserRole } from '@igniter/db/middleman/enums'

export default async function AdminInternalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session || session.user.role !== UserRole.Owner) {
    redirect('/')
  }

  return <>{children}</>
}