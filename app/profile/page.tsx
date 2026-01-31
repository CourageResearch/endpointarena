import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db, fdaPredictions } from '@/lib/db'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDate, getAccuracyColor } from '@/lib/utils'
import Link from 'next/link'
import { eq, and, desc } from 'drizzle-orm'

async function getUserPredictions(email: string) {
  return db.query.fdaPredictions.findMany({
    where: and(
      eq(fdaPredictions.predictorType, 'user'),
      eq(fdaPredictions.predictorId, email)
    ),
    with: {
      fdaEvent: true,
    },
    orderBy: [desc(fdaPredictions.createdAt)],
  })
}

export default async function ProfilePage() {
  const session = await getServerSession(authOptions)

  if (!session?.user?.email) {
    redirect('/login')
  }

  const userPredictions = await getUserPredictions(session.user.email)

  const stats = {
    total: userPredictions.length,
    pending: userPredictions.filter((p) => p.correct === null).length,
    correct: userPredictions.filter((p) => p.correct === true).length,
    incorrect: userPredictions.filter((p) => p.correct === false).length,
  }

  const completedPredictions = stats.total - stats.pending
  const accuracy = completedPredictions > 0
    ? (stats.correct / completedPredictions) * 100
    : 0

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Your Profile</h1>
        <p className="text-gray-600">{session.user.email}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
            <p className="text-sm text-gray-500">Predictions</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
            <p className="text-sm text-gray-500">Pending</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-green-600">{stats.correct}</div>
            <p className="text-sm text-gray-500">Correct</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className={`text-2xl font-bold ${getAccuracyColor(accuracy)}`}>
              {accuracy.toFixed(1)}%
            </div>
            <p className="text-sm text-gray-500">Accuracy</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your FDA Predictions</CardTitle>
        </CardHeader>
        <CardContent>
          {userPredictions.length > 0 ? (
            <div className="space-y-4">
              {userPredictions.map((prediction) => (
                <Link
                  key={prediction.id}
                  href={`/fda-calendar`}
                  className="block p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-medium text-gray-900 line-clamp-1">
                        {prediction.fdaEvent.drugName}
                      </h3>
                      <p className="text-sm text-gray-500 line-clamp-1">
                        {prediction.fdaEvent.companyName} - {prediction.fdaEvent.therapeuticArea || 'N/A'}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        Predicted {formatDate(prediction.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <span className={`px-2 py-1 rounded text-sm font-medium ${
                        prediction.prediction === 'approved'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {prediction.prediction.toUpperCase()}
                      </span>
                      {prediction.correct !== null ? (
                        <Badge variant={prediction.correct ? 'success' : 'destructive'}>
                          {prediction.correct ? 'Correct' : 'Wrong'}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Pending</Badge>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">
              You haven&apos;t made any predictions yet.{' '}
              <Link href="/fda-calendar" className="text-blue-600 hover:underline">
                Browse FDA events
              </Link>{' '}
              to get started.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
