'use client'

import { useState, useMemo, useEffect } from 'react'
import { WhiteNavbar } from '@/components/WhiteNavbar'

interface GlossaryTerm {
  term: string
  fullName: string
  definition: string
  category: string
}

const CATEGORY_ORDER = [
  'Application Types',
  'FDA Actions',
  'Review Processes',
  'Expedited Pathways',
  'Clinical Trials',
]

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
    term: 'rBLA',
    fullName: 'Resubmitted Biologics License Application',
    definition: 'A BLA that has been resubmitted after a Complete Response Letter (CRL). The sponsor addresses the deficiencies cited by the FDA and resubmits the application for further review.',
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

const SQ_COLORS = ['#f2544e', '#40bd4b', '#d4a017', '#299bff', '#31b8b5']

function SquareDivider({ className = '' }: { className?: string }) {
  return (
    <div className={`w-full ${className}`}>
      <svg className="w-full" height="8" preserveAspectRatio="none">
        <rect x="20%" y="1" width="6" height="6" rx="1" fill={SQ_COLORS[0]} opacity="0.8" />
        <rect x="35%" y="1" width="6" height="6" rx="1" fill={SQ_COLORS[1]} opacity="0.8" />
        <rect x="50%" y="1" width="6" height="6" rx="1" fill={SQ_COLORS[2]} opacity="0.85" />
        <rect x="65%" y="1" width="6" height="6" rx="1" fill={SQ_COLORS[3]} opacity="0.8" />
        <rect x="80%" y="1" width="6" height="6" rx="1" fill={SQ_COLORS[4]} opacity="0.8" />
      </svg>
    </div>
  )
}

function HeaderDots() {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-[6px] h-[6px] rounded-[1px]" style={{ backgroundColor: '#D4604A', opacity: 0.8 }} />
      <div className="w-[6px] h-[6px] rounded-[1px]" style={{ backgroundColor: '#C9A227', opacity: 0.85 }} />
      <div className="w-[6px] h-[6px] rounded-[1px]" style={{ backgroundColor: '#2D7CF6', opacity: 0.8 }} />
    </div>
  )
}

export default function GlossaryPage() {
  const [highlightedTerm, setHighlightedTerm] = useState<string | null>(null)

  useEffect(() => {
    const hash = window.location.hash
    if (hash && hash.startsWith('#term-')) {
      const term = decodeURIComponent(hash.replace('#term-', ''))
      setHighlightedTerm(term)
      setTimeout(() => {
        const el = document.getElementById(`term-${term}`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 100)
      setTimeout(() => setHighlightedTerm(null), 3000)
    }
  }, [])

  const groupedTerms = useMemo(() => {
    const groups: Record<string, GlossaryTerm[]> = {}
    for (const term of GLOSSARY_TERMS) {
      if (!groups[term.category]) {
        groups[term.category] = []
      }
      groups[term.category].push(term)
    }
    return groups
  }, [])

  return (
    <div className="min-h-screen bg-[#F5F2ED] text-[#1a1a1a]">
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        {/* Header */}
        <div className="mb-8 sm:mb-12">
          <div className="flex items-center gap-3">
            <h1 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Glossary</h1>
            <HeaderDots />
          </div>
        </div>

        <SquareDivider className="mb-8" />

        {/* Terms by Category */}
        {CATEGORY_ORDER.map((category, i) => {
          const terms = groupedTerms[category]
          if (!terms) return null
          return (
            <section key={category} className="mb-10">
              {i > 0 && <SquareDivider className="mb-8" />}
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">{category}</h2>
                <HeaderDots />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {terms.map((term) => {
                  const isHighlighted = highlightedTerm === term.term
                  return (
                    <div
                      key={term.term}
                      id={`term-${term.term}`}
                      className={`p-[1px] rounded-sm scroll-mt-32 transition-shadow duration-500 ${isHighlighted ? 'shadow-[0_0_0_3px_rgba(212,96,74,0.3),0_0_0_3px_rgba(45,124,246,0.3)]' : ''}`}
                      style={{ background: 'linear-gradient(135deg, #D4604A, #C9A227, #2D7CF6)' }}
                    >
                      <div className={`rounded-sm p-4 h-full transition-colors duration-500 ${isHighlighted ? 'bg-[#f3ebe0]' : 'bg-white/95'}`}>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <span className="text-lg font-bold text-[#1a1a1a]">{term.term}</span>
                        </div>
                        <div className="text-sm font-medium text-[#8a8075] mb-2">{term.fullName}</div>
                        <p className="text-sm text-[#b5aa9e] leading-relaxed">{term.definition}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}

        {/* Footer gradient line */}
        <div className="mt-10 h-[2px]" style={{ background: 'linear-gradient(90deg, #D4604A, #C9A227, #2D7CF6)' }} />
      </main>
    </div>
  )
}
