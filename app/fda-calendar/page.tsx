import { permanentRedirect } from 'next/navigation'

export default async function FDACalendarPage() {
  permanentRedirect('/trials')
}
