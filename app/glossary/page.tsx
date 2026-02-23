'use client'

import { useState, useMemo, useEffect } from 'react'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { FooterGradientRule, HeaderDots, PageFrame, SquareDivider } from '@/components/site/chrome'

interface GlossaryTerm {
  term: string
  fullName: string
  definition: string
  category: string
}

const GRADIENT_BORDER = 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)'

const CATEGORY_ORDER = [
  'Clinical Development',
  'Endpoints',
  'Application Types',
  'FDA Actions',
  'Post-Approval Safety & Commitments',
  'Review Processes',
  'Expedited Programs & Designations',
]

const GLOSSARY_TERMS: GlossaryTerm[] = [
  // Application Types
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
    term: 'rNDA',
    fullName: 'Resubmitted New Drug Application',
    definition: 'An NDA resubmitted after a Complete Response Letter (CRL). The sponsor addresses FDA deficiencies and resubmits for another review cycle.',
    category: 'Application Types',
  },
  {
    term: 'BLA',
    fullName: 'Biologics License Application',
    definition: 'FDA submission required for approval of biological products including vaccines, blood products, gene therapy, and other complex molecules derived from living organisms.',
    category: 'Application Types',
  },
  {
    term: 'sBLA',
    fullName: 'Supplemental Biologics License Application',
    definition: 'An amendment to an existing BLA for changes such as new indications, labeling updates, manufacturing changes, or new patient populations for a biologic product.',
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
    definition: 'Application for generic drug approval. It generally relies on pharmaceutical equivalence and bioequivalence to a reference drug rather than new efficacy trials, though some products require additional studies.',
    category: 'Application Types',
  },
  {
    term: '505(b)(2)',
    fullName: '505(b)(2) NDA',
    definition: 'A type of NDA that can rely in part on existing studies or FDA findings for a previously approved drug, plus new bridging or supportive data as needed. Common for reformulations or new routes of administration.',
    category: 'Application Types',
  },
  {
    term: 'NME',
    fullName: 'New Molecular Entity',
    definition: 'A drug containing an active ingredient never previously approved by FDA. Distinct from new formulations, combinations, or new uses of existing drugs.',
    category: 'Application Types',
  },

  // FDA Actions & Responses
  {
    term: 'RTF',
    fullName: 'Refuse to File',
    definition: 'FDA determination (usually within 60 days of submission) that an application is too incomplete for substantive review. If it is not filed, the review cycle does not proceed.',
    category: 'FDA Actions',
  },
  {
    term: 'Approval',
    fullName: 'Approval (Approval Letter)',
    definition: 'FDA action granting marketing authorization for the submitted application or supplement. Approval may include final labeling, a REMS, and postmarketing requirements or commitments.',
    category: 'FDA Actions',
  },
  {
    term: 'CRL',
    fullName: 'Complete Response Letter',
    definition: 'FDA communication indicating that the review cycle is complete but the application is not ready for approval. Lists deficiencies that must be addressed.',
    category: 'FDA Actions',
  },

  // Post-Approval Safety & Commitments
  {
    term: 'REMS',
    fullName: 'Risk Evaluation and Mitigation Strategy',
    definition: 'Safety strategy required for certain drugs with serious risks. May include medication guides, patient registries, or prescriber certifications.',
    category: 'Post-Approval Safety & Commitments',
  },
  {
    term: 'PMR',
    fullName: 'Postmarketing Requirement',
    definition: 'A study or clinical trial FDA legally requires after approval (or under certain pathways) to further assess safety, efficacy, or optimal use.',
    category: 'Post-Approval Safety & Commitments',
  },
  {
    term: 'PMC',
    fullName: 'Postmarketing Commitment',
    definition: 'A post-approval study the sponsor agrees to conduct that is not legally required in the same way as a PMR. FDA may still track progress and reporting.',
    category: 'Post-Approval Safety & Commitments',
  },

  // Review Processes & Timelines
  {
    term: 'PDUFA',
    fullName: 'Prescription Drug User Fee Act',
    definition: 'Law authorizing FDA user fees for human drug review and setting performance goals for review timelines. It is the basis for many commonly cited NDA/BLA review goal dates.',
    category: 'Review Processes',
  },
  {
    term: 'Priority Review',
    fullName: 'Priority Review',
    definition: 'FDA review designation with a shorter goal timeline (often about 6 months from filing for qualifying applications). It does not lower the evidentiary standard for approval.',
    category: 'Review Processes',
  },
  {
    term: 'Standard Review',
    fullName: 'Standard Review',
    definition: 'Default FDA review designation. For many original NDA/BLA applications, the goal timeline is about 10 months from filing, while supplemental applications may have different goals.',
    category: 'Review Processes',
  },
  {
    term: 'PDUFA Date',
    fullName: 'PDUFA Date (Target Action Date)',
    definition: 'Common shorthand for the FDA target action date on many NDA/BLA reviews under PDUFA. It is a target date for FDA action, not a guaranteed approval date.',
    category: 'Review Processes',
  },
  {
    term: 'Rolling Submission',
    fullName: 'Rolling Submission',
    definition: 'Allows companies with Fast Track designation to submit completed portions of their application for review before the entire submission is complete.',
    category: 'Review Processes',
  },
  {
    term: 'AdCom',
    fullName: 'Advisory Committee',
    definition: 'Independent expert panel that reviews some applications and gives non-binding recommendations to FDA. Meetings are usually public and may include votes.',
    category: 'Review Processes',
  },
  {
    term: 'CMC',
    fullName: 'Chemistry, Manufacturing, and Controls',
    definition: 'Regulatory and technical information describing how a drug is made, tested, and controlled for quality. CMC issues are a common reason for review delays or CRLs.',
    category: 'Review Processes',
  },
  {
    term: 'Class 1 Resubmission',
    fullName: 'Class 1 Resubmission',
    definition: 'A CRL resubmission category for lower-complexity responses (for example certain labeling or minor changes). FDA review goal is typically 2 months from receipt.',
    category: 'Review Processes',
  },
  {
    term: 'Class 2 Resubmission',
    fullName: 'Class 2 Resubmission',
    definition: 'A CRL resubmission category for more substantial responses, such as significant new analyses, manufacturing updates, or new clinical information. FDA review goal is typically 6 months from receipt.',
    category: 'Review Processes',
  },

  // Expedited Programs & Designations
  {
    term: 'Fast Track',
    fullName: 'Fast Track Designation',
    definition: 'FDA designation for drugs treating serious conditions with unmet need. Enables more frequent FDA communication and rolling submission.',
    category: 'Expedited Programs & Designations',
  },
  {
    term: 'Breakthrough Therapy',
    fullName: 'Breakthrough Therapy',
    definition: 'FDA designation for serious conditions when preliminary clinical evidence suggests substantial improvement over available therapy. Includes Fast Track features plus intensive FDA guidance.',
    category: 'Expedited Programs & Designations',
  },
  {
    term: 'Accelerated Approval',
    fullName: 'Accelerated Approval',
    definition: 'Allows approval based on surrogate endpoints (like tumor shrinkage) rather than clinical outcomes (like survival). Requires post-marketing confirmatory trials.',
    category: 'Expedited Programs & Designations',
  },

  // Clinical Development
  {
    term: 'Phase I',
    fullName: 'Phase I Clinical Trial',
    definition: 'Early human studies that primarily assess safety, tolerability, dosing, and pharmacokinetics. They often enroll healthy volunteers, but some programs (for example oncology) enroll patients.',
    category: 'Clinical Development',
  },
  {
    term: 'Phase II',
    fullName: 'Phase II Clinical Trial',
    definition: 'Mid-stage studies in patients that further assess safety and provide preliminary evidence of efficacy, dose selection, and regimen design for later-stage trials.',
    category: 'Clinical Development',
  },
  {
    term: 'Phase III',
    fullName: 'Phase III Clinical Trial',
    definition: 'Usually larger, late-stage studies intended to provide pivotal evidence of efficacy and safety. Many NDA/BLA submissions rely on Phase III data, but the required evidence package varies by disease and pathway.',
    category: 'Clinical Development',
  },
  {
    term: 'Pivotal Trial',
    fullName: 'Pivotal Trial',
    definition: 'A key trial intended to provide the main evidence supporting approval (sometimes called a registrational study). Pivotal trials are often Phase III, but may occur in other designs or phases depending on disease and pathway.',
    category: 'Clinical Development',
  },
  {
    term: 'Combined Phase Trial',
    fullName: 'Phase 1/2 or 2/3',
    definition: 'A trial design that combines phases in one protocol, such as Phase 1/2 or Phase 2/3. It may start with safety or dose-finding, then move into efficacy testing using prespecified rules. This can save time but requires careful statistical planning.',
    category: 'Clinical Development',
  },
  {
    term: 'Primary Endpoint',
    fullName: 'Primary Endpoint',
    definition: 'The main prespecified outcome measure used to evaluate a drug\'s effectiveness in a clinical trial. Statistical significance on the primary endpoint is often central to FDA approval decisions.',
    category: 'Endpoints',
  },
  {
    term: 'Secondary Endpoint',
    fullName: 'Secondary Endpoint',
    definition: 'A prespecified outcome measure used to evaluate additional effects of a treatment beyond the primary endpoint. It can support interpretation and labeling, but formal claims often depend on multiplicity control and study design.',
    category: 'Endpoints',
  },
  {
    term: 'Surrogate Endpoint',
    fullName: 'Surrogate Endpoint',
    definition: 'A measurable marker (like tumor response or a lab value) used as a substitute for a direct clinical outcome. It can support faster development when the surrogate is adequately validated or accepted for the context.',
    category: 'Endpoints',
  },
  {
    term: 'Confirmatory Trial',
    fullName: 'Confirmatory Trial',
    definition: 'A post-approval or late-stage trial designed to verify and describe clinical benefit, especially after Accelerated Approval. Failure to confirm benefit can lead to label changes or withdrawal.',
    category: 'Clinical Development',
  },
]

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
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        {/* Terms by Category */}
        {CATEGORY_ORDER.map((category, i) => {
          const terms = groupedTerms[category]
          if (!terms) return null
          return (
            <section key={category} className="mb-10 sm:mb-16">
              {i > 0 && <SquareDivider className="mb-8 sm:mb-10" />}
              <div className="mb-6 sm:mb-8">
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">{category}</h2>
                  <HeaderDots />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {terms.map((term) => {
                  const isHighlighted = highlightedTerm === term.term
                  return (
                    <div
                      key={term.term}
                      id={`term-${term.term}`}
                      className={`scroll-mt-32 rounded-sm p-[1px] transition-shadow duration-150 ${
                        isHighlighted
                          ? 'shadow-[0_0_0_2px_rgba(211,157,46,0.12)]'
                          : 'hover:shadow-[0_1px_0_rgba(26,26,26,0.04)]'
                      }`}
                      style={{ background: GRADIENT_BORDER }}
                    >
                      <div
                        className={`h-full rounded-sm p-4 sm:p-6 transition-colors duration-150 ${
                          isHighlighted ? 'bg-[#fbf6ee]' : 'bg-white/95 hover:bg-[#f7f1e8]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <span className="truncate-wrap text-lg font-medium text-[#3b3833]">{term.term}</span>
                        </div>
                        <div className="truncate-wrap mb-2 text-sm font-medium text-[#8a8075]">{term.fullName}</div>
                        <p className="truncate-wrap text-sm leading-relaxed text-[#b5aa9e]">{term.definition}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}

        {/* Footer gradient line */}
        <FooterGradientRule className="mt-10" />
      </main>
    </PageFrame>
  )
}
