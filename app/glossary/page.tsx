'use client'

import { useState, useMemo } from 'react'
import { Navbar } from '@/components/Navbar'

interface GlossaryTerm {
  term: string
  fullName: string
  definition: string
  category: string
}

const GLOSSARY_TERMS: GlossaryTerm[] = [
  // Application Types
  {
    term: 'BLA',
    fullName: 'Biologics License Application',
    definition: 'FDA submission required for approval of biological products including vaccines, blood products, gene therapy, and other complex molecules derived from living organisms.',
    category: 'Application Types',
  },
  {
    term: 'NDA',
    fullName: 'New Drug Application',
    definition: 'The formal submission to FDA requesting approval to market a new pharmaceutical drug. Contains all preclinical and clinical data demonstrating safety and efficacy.',
    category: 'Application Types',
  },
  {
    term: 'sNDA',
    fullName: 'Supplemental New Drug Application',
    definition: 'An amendment to an existing NDA for changes like new indications, dosage forms, manufacturing changes, or new patient populations.',
    category: 'Application Types',
  },
  {
    term: 'sBLA',
    fullName: 'Supplemental Biologics License Application',
    definition: 'An amendment to an existing BLA, similar to an sNDA but for biological products.',
    category: 'Application Types',
  },
  {
    term: 'ANDA',
    fullName: 'Abbreviated New Drug Application',
    definition: 'Application for generic drug approval. Does not require clinical trials but must demonstrate bioequivalence to the reference drug.',
    category: 'Application Types',
  },
  {
    term: 'IND',
    fullName: 'Investigational New Drug',
    definition: 'Application submitted to FDA before a company can begin clinical trials in humans. Allows the drug to be shipped across state lines for testing.',
    category: 'Application Types',
  },

  // FDA Actions & Responses
  {
    term: 'CRL',
    fullName: 'Complete Response Letter',
    definition: 'FDA communication indicating that the review cycle is complete but the application is not ready for approval. Lists deficiencies that must be addressed.',
    category: 'FDA Actions',
  },
  {
    term: 'RTF',
    fullName: 'Refuse to File',
    definition: 'FDA determination within 60 days of submission that an application is too incomplete to permit a substantive review. The clock stops until issues are resolved.',
    category: 'FDA Actions',
  },
  {
    term: 'Approvable Letter',
    fullName: 'Approvable Letter',
    definition: 'Historical FDA response (no longer used) indicating approval would be granted once specified conditions are met. Replaced by CRL in 2008.',
    category: 'FDA Actions',
  },
  {
    term: 'REMS',
    fullName: 'Risk Evaluation and Mitigation Strategy',
    definition: 'Safety strategy required for certain drugs with serious risks. May include medication guides, patient registries, or prescriber certifications.',
    category: 'FDA Actions',
  },

  // Review Processes & Timelines
  {
    term: 'PDUFA',
    fullName: 'Prescription Drug User Fee Act',
    definition: 'Law allowing FDA to collect fees from drug companies to fund the review process. Establishes target review timelines - the "PDUFA date" is the FDA\'s deadline to complete review.',
    category: 'Review Processes',
  },
  {
    term: 'AdCom',
    fullName: 'Advisory Committee',
    definition: 'Independent expert panel that reviews NDAs/BLAs and provides non-binding recommendations to FDA. Meetings are public and include a vote on approval.',
    category: 'Review Processes',
  },
  {
    term: 'Priority Review',
    fullName: 'Priority Review',
    definition: 'Expedited FDA review (6 months vs standard 10 months) for drugs offering significant improvements in treatment, diagnosis, or prevention of serious conditions.',
    category: 'Review Processes',
  },
  {
    term: 'Standard Review',
    fullName: 'Standard Review',
    definition: 'Default FDA review timeline of 10 months for new molecular entities or 6 months for applications not qualifying for priority review.',
    category: 'Review Processes',
  },
  {
    term: 'Rolling Submission',
    fullName: 'Rolling Submission',
    definition: 'Allows companies with Fast Track designation to submit completed portions of their application for review before the entire submission is complete.',
    category: 'Review Processes',
  },

  // Expedited Pathways
  {
    term: 'Fast Track',
    fullName: 'Fast Track Designation',
    definition: 'FDA designation for drugs treating serious conditions with unmet need. Enables more frequent FDA communication and rolling submission.',
    category: 'Expedited Pathways',
  },
  {
    term: 'Breakthrough Therapy',
    fullName: 'Breakthrough Therapy Designation',
    definition: 'For drugs showing substantial improvement over existing treatments. Includes Fast Track features plus intensive FDA guidance on development.',
    category: 'Expedited Pathways',
  },
  {
    term: 'Accelerated Approval',
    fullName: 'Accelerated Approval',
    definition: 'Allows approval based on surrogate endpoints (like tumor shrinkage) rather than clinical outcomes (like survival). Requires post-marketing confirmatory trials.',
    category: 'Expedited Pathways',
  },
  {
    term: 'EUA',
    fullName: 'Emergency Use Authorization',
    definition: 'Temporary FDA authorization during public health emergencies for products not yet fully approved. Used extensively during COVID-19.',
    category: 'Expedited Pathways',
  },
  {
    term: 'Orphan Drug',
    fullName: 'Orphan Drug Designation',
    definition: 'Status for drugs treating rare diseases (<200,000 US patients). Provides tax credits, fee waivers, and 7 years market exclusivity upon approval.',
    category: 'Expedited Pathways',
  },

  // Clinical Trials
  {
    term: 'Phase I',
    fullName: 'Phase I Clinical Trial',
    definition: 'First-in-human studies, typically 20-100 healthy volunteers. Primary goal is assessing safety, dosing, and identifying side effects.',
    category: 'Clinical Trials',
  },
  {
    term: 'Phase II',
    fullName: 'Phase II Clinical Trial',
    definition: 'Studies in 100-300 patients with the target disease. Evaluates efficacy and further assesses safety. Often determines optimal dosing.',
    category: 'Clinical Trials',
  },
  {
    term: 'Phase III',
    fullName: 'Phase III Clinical Trial',
    definition: 'Large-scale studies (1,000-3,000+ patients) providing definitive evidence of efficacy and safety. Required for NDA/BLA submission.',
    category: 'Clinical Trials',
  },
  {
    term: 'Phase IV',
    fullName: 'Phase IV Clinical Trial',
    definition: 'Post-marketing studies conducted after approval. May be required by FDA or voluntary. Monitors long-term safety and real-world effectiveness.',
    category: 'Clinical Trials',
  },
  {
    term: 'NME',
    fullName: 'New Molecular Entity',
    definition: 'A drug containing an active ingredient that has never been approved by FDA. Distinct from new formulations or combinations of existing drugs.',
    category: 'Clinical Trials',
  },
  {
    term: 'Primary Endpoint',
    fullName: 'Primary Endpoint',
    definition: 'The main outcome measure used to evaluate a drug\'s effectiveness in a clinical trial. Statistical significance here typically required for approval.',
    category: 'Clinical Trials',
  },
  {
    term: 'Surrogate Endpoint',
    fullName: 'Surrogate Endpoint',
    definition: 'A measurable marker (like blood pressure or tumor size) used as a substitute for clinical outcomes (like heart attack or death). Enables faster trials.',
    category: 'Clinical Trials',
  },
  {
    term: 'ITT',
    fullName: 'Intention to Treat',
    definition: 'Analysis method including all randomized patients regardless of whether they completed treatment. Preserves randomization and reflects real-world effectiveness.',
    category: 'Clinical Trials',
  },
]

const CATEGORIES = [
  'All',
  'Application Types',
  'FDA Actions',
  'Review Processes',
  'Expedited Pathways',
  'Clinical Trials',
]

export default function GlossaryPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('All')

  const filteredTerms = useMemo(() => {
    return GLOSSARY_TERMS.filter((term) => {
      const matchesSearch =
        searchQuery === '' ||
        term.term.toLowerCase().includes(searchQuery.toLowerCase()) ||
        term.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        term.definition.toLowerCase().includes(searchQuery.toLowerCase())

      const matchesCategory =
        selectedCategory === 'All' || term.category === selectedCategory

      return matchesSearch && matchesCategory
    })
  }, [searchQuery, selectedCategory])

  // Group terms by category for display
  const groupedTerms = useMemo(() => {
    if (selectedCategory !== 'All') {
      return { [selectedCategory]: filteredTerms }
    }

    const groups: Record<string, GlossaryTerm[]> = {}
    for (const term of filteredTerms) {
      if (!groups[term.category]) {
        groups[term.category] = []
      }
      groups[term.category].push(term)
    }
    return groups
  }, [filteredTerms, selectedCategory])

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <Navbar />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">FDA Glossary</h1>
          <p className="text-zinc-500 text-sm mt-1">
            Common FDA and clinical trial terminology explained. Hover over acronyms throughout the site to see quick definitions.
          </p>
        </div>

        {/* Search and Filter */}
        <div className="sticky top-14 z-40 bg-[#0a0a0a] py-4 mb-6 -mx-4 px-4 sm:-mx-6 sm:px-6 border-b border-zinc-800">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <input
                type="text"
                placeholder="Search terms..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 pl-10 text-sm text-white placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
              />
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 sm:pb-0">
              {CATEGORIES.map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`px-3 py-2 text-sm rounded-lg whitespace-nowrap transition-colors ${
                    selectedCategory === category
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                      : 'bg-zinc-800/50 text-zinc-400 border border-zinc-700 hover:text-white hover:border-zinc-600'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Results count */}
        <div className="text-sm text-zinc-500 mb-6">
          {filteredTerms.length} {filteredTerms.length === 1 ? 'term' : 'terms'} found
        </div>

        {/* Terms by Category */}
        {Object.entries(groupedTerms).map(([category, terms]) => (
          <section key={category} className="mb-10">
            <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span>
              {category}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {terms.map((term) => (
                <div
                  key={term.term}
                  className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 hover:border-zinc-700 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-lg font-bold text-blue-400">{term.term}</span>
                  </div>
                  <div className="text-sm font-medium text-white mb-2">{term.fullName}</div>
                  <p className="text-sm text-zinc-400 leading-relaxed">{term.definition}</p>
                </div>
              ))}
            </div>
          </section>
        ))}

        {filteredTerms.length === 0 && (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl py-12 text-center">
            <div className="text-zinc-500 mb-2">No terms found matching your search.</div>
            <button
              onClick={() => {
                setSearchQuery('')
                setSelectedCategory('All')
              }}
              className="text-blue-400 hover:text-blue-300 text-sm"
            >
              Clear filters
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
