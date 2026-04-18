import assert from 'node:assert/strict'
import test from 'node:test'
import { abbreviateType } from '../lib/constants'
import { glossaryLookupAnchor, glossaryTermAnchor } from '../lib/glossary'

test('glossary lookup maps combined phase trial aliases to the combined phase glossary card', () => {
  const combinedPhaseAnchor = glossaryTermAnchor('Combined Phase Trial')

  assert.equal(glossaryLookupAnchor('Phase 2/Phase 3'), combinedPhaseAnchor)
  assert.equal(glossaryLookupAnchor('phase-2-phase-3'), combinedPhaseAnchor)
  assert.equal(glossaryLookupAnchor('Phase 1b/Phase 2a'), combinedPhaseAnchor)
})

test('abbreviateType uses the combined phase glossary anchor for mixed-phase trial labels', () => {
  const meta = abbreviateType('Phase 2/Phase 3')

  assert.equal(meta.display, 'Phase 2/Phase 3')
  assert.equal(meta.anchor, glossaryTermAnchor('Combined Phase Trial'))
})

test('abbreviateType preserves direct glossary anchors for standard FDA application types', () => {
  const meta = abbreviateType('Biologics License Application')

  assert.equal(meta.display, 'BLA')
  assert.equal(meta.anchor, glossaryTermAnchor('BLA'))
})
