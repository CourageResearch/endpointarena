import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('season 4 trade amount input supports keyboard arrow stepping', async () => {
  const source = await readFile(new URL('../components/season4/Season4MarketPage.tsx', import.meta.url), 'utf8')

  assert.match(source, /stepTradeAmountInput/)
  assert.match(source, /ArrowUp/)
  assert.match(source, /ArrowDown/)
  assert.match(source, /role="spinbutton"/)
})

test('season 4 human trades use Privy native gas sponsorship', async () => {
  const source = await readFile(new URL('../components/season4/Season4MarketPage.tsx', import.meta.url), 'utf8')

  assert.match(source, /sponsoredTransactionOptions/)
  assert.match(source, /sponsor:\s*true/)
  assert.match(source, /Privy gas sponsorship is not enabled for Base Sepolia yet/)
})

test('season 4 trade question copy is regular-weight body text', async () => {
  const source = await readFile(new URL('../components/season4/Season4MarketPage.tsx', import.meta.url), 'utf8')

  assert.match(
    source,
    /<p className="text-\[0\.92rem\] font-normal leading-\[1\.45\] text-\[#4f4942\]">\{marketQuestion\}<\/p>/,
  )
})
