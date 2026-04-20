import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  formatPollDate,
  getPollWeekStartDate,
  normalizePollNctNumber,
} from '../lib/poll'
import {
  buildMarketSuggestionMessage,
  normalizeMarketSuggestionNctNumber,
  parseMarketSuggestionMessage,
} from '../lib/market-suggestions'

async function readRepoFile(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('poll NCT normalization accepts only ClinicalTrials.gov identifiers', () => {
  assert.equal(normalizePollNctNumber(' nct12345678 '), 'NCT12345678')
  assert.equal(normalizePollNctNumber('NCT1234567'), null)
  assert.equal(normalizePollNctNumber('ABC12345678'), null)
  assert.equal(normalizePollNctNumber('NCT123456789'), null)
})

test('market suggestion NCT normalization accepts only ClinicalTrials.gov identifiers', () => {
  assert.equal(normalizeMarketSuggestionNctNumber(' nct12345678 '), 'NCT12345678')
  assert.equal(normalizeMarketSuggestionNctNumber('123123'), null)
  assert.equal(normalizeMarketSuggestionNctNumber('NCT1234567'), null)
  assert.equal(normalizeMarketSuggestionNctNumber('NCT123456789'), null)

  assert.throws(
    () => buildMarketSuggestionMessage('123123', 'context'),
    /Market suggestion NCT number is invalid/,
  )

  const parsed = parseMarketSuggestionMessage(buildMarketSuggestionMessage('nct12345678', 'context'))
  assert.equal(parsed?.nctNumber, 'NCT12345678')
})

test('poll week starts on Sunday in UTC', () => {
  assert.equal(formatPollDate(getPollWeekStartDate(new Date('2026-04-19T12:00:00.000Z'))), '2026-04-19')
  assert.equal(formatPollDate(getPollWeekStartDate(new Date('2026-04-22T12:00:00.000Z'))), '2026-04-19')
})

test('poll surface is wired to suggestions, anonymous vote API, and footer navigation', async () => {
  const pollPageSource = await readRepoFile('app/poll/page.tsx')
  const pollLibSource = await readRepoFile('lib/poll.ts')
  const voteRouteSource = await readRepoFile('app/api/poll/vote/route.ts')
  const footerSource = await readRepoFile('components/site/chrome.tsx')
  const sitemapSource = await readRepoFile('app/sitemap.ts')

  assert.match(pollPageSource, /getPollPageData/)
  assert.match(pollPageSource, /PollVotingList/)
  assert.match(pollPageSource, /href="\/suggest"/)
  assert.match(pollLibSource, /MARKET_SUGGESTION_MESSAGE_PREFIX/)
  assert.match(pollLibSource, /fetchClinicalTrialsStudyByNctNumber/)
  assert.match(voteRouteSource, /POLL_VOTER_COOKIE_NAME/)
  assert.match(voteRouteSource, /isSuggestedPollNctNumber/)
  assert.match(voteRouteSource, /recordPollVote/)
  assert.match(footerSource, /href: '\/poll'/)
  assert.match(sitemapSource, /'\/poll'/)
})
