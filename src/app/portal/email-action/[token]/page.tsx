import { EmailActionClient } from './EmailActionClient'

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function EmailActionPage({ params }: PageProps) {
  const { token } = await params

  return <EmailActionClient token={token} />
}
