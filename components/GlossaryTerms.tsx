'use client'

import { useEffect, useMemo, useState } from 'react'
import { glossaryLookupAnchor, glossaryTermAnchor } from '@/lib/glossary'
import { HeaderDots, SquareDivider } from '@/components/site/chrome'

interface GlossaryTerm {
  term: string
  fullName?: string
  definition: string
  category: string
}

interface GuidedGlossaryTerm {
  term: string
  subtitle: string
  definition: string
}

interface ResolutionComparisonRow {
  label: string
  yesPhrases: string[]
  yesDetail: string
  noPhrases: string[]
  noDetail: string
}

const GRADIENT_BORDER = 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)'

const CATEGORY_ORDER = [
  'Clinical Development',
  'Endpoints',
  'Application Types',
  'FDA Actions',
  'Review Processes',
  'Expedited Programs & Designations',
]

const MARKET_RESOLUTION_TERMS: GuidedGlossaryTerm[] = [
  {
    term: 'YES Resolution',
    subtitle: 'What must happen for YES to win',
    definition: 'A market resolves YES when the accepted evidence shows that the exact trial readout was positive, encouraging, clinically meaningful, supportive of success, met efficacy goals, or equivalent.',
  },
  {
    term: 'NO Resolution',
    subtitle: 'What must happen for NO to win',
    definition: 'A market resolves NO when the accepted evidence shows that the exact trial readout was negative, disappointing, failed, did not meet goals, showed no meaningful activity, or equivalent.',
  },
  {
    term: 'Topline Result',
    subtitle: 'The first high-level public summary',
    definition: 'A topline result is the initial summary of the most important trial outcomes before a full dataset is released. It is often enough to move the market even when important details are still missing.',
  },
  {
    term: 'Statistical Significance',
    subtitle: 'A signal unlikely to be random chance alone',
    definition: 'Statistical significance means the observed result crossed a prespecified threshold suggesting the effect is unlikely to be explained by chance alone. It helps a readout, but by itself does not guarantee the result is clinically important.',
  },
  {
    term: 'Clinically Meaningful',
    subtitle: 'A result that matters in practice',
    definition: 'Clinically meaningful means the effect looks important enough to matter for patients or decision-makers, not just numerically positive. This kind of language usually frames a public readout as supportive of success.',
  },
]

const RESOLUTION_COMPARISON_ROWS: ResolutionComparisonRow[] = [
  {
    label: 'Signal Words',
    yesPhrases: ['positive', 'encouraging', 'supportive of success'],
    yesDetail:
      'These are the kinds of words that make a public readout sound directionally favorable for the exact trial.',
    noPhrases: ['negative', 'disappointing', 'failed'],
    noDetail:
      'These are the kinds of words that make the readout sound directionally unfavorable for the exact trial.',
  },
  {
    label: 'Goal Language',
    yesPhrases: ['met efficacy goals', 'clinically meaningful'],
    yesDetail:
      'This kind of wording usually suggests the company or source is framing the result as a real success, not just a technical datapoint.',
    noPhrases: ['did not meet goals', 'no meaningful activity'],
    noDetail:
      'This kind of wording usually signals that the outcome fell short in a way that matters for the market question.',
  },
]

const PHASE_2_TRIAL_DESIGN_TERMS: GuidedGlossaryTerm[] = [
  {
    term: 'Phase 1',
    subtitle: 'Early human testing',
    definition: 'Phase 1 studies focus mainly on safety, tolerability, and dosing. They usually tell you whether a drug can move forward, not whether it clearly works.',
  },
  {
    term: 'Phase 2',
    subtitle: 'Mid-stage signal seeking in patients',
    definition: 'Phase 2 studies test a treatment in the target disease population and look for evidence that it is working, while continuing to learn about safety and dose selection.',
  },
  {
    term: 'Phase 3',
    subtitle: 'Late-stage confirmation',
    definition: 'Phase 3 trials are usually larger confirmatory studies meant to provide stronger evidence for regulators, physicians, and payers than an earlier Phase 2 program can provide.',
  },
  {
    term: 'Combined Phase Trial',
    subtitle: 'One protocol spanning multiple stages',
    definition: 'A combined phase trial, such as Phase 1/2 or Phase 2/3, blends multiple development stages into one study. This can speed development, but it also makes the design more complex to interpret.',
  },
  {
    term: 'Randomized',
    subtitle: 'Treatment assignment by chance',
    definition: 'Randomization assigns participants to different study arms by chance rather than choice. It helps reduce bias and makes it easier to compare outcomes fairly.',
  },
  {
    term: 'Open-Label',
    subtitle: 'Everyone knows the assigned treatment',
    definition: 'In an open-label study, investigators and participants know which treatment is being given. That can be practical, but it can also make subjective endpoints harder to interpret.',
  },
  {
    term: 'Double-Blind',
    subtitle: 'Key parties do not know the assigned treatment',
    definition: 'A double-blind trial keeps treatment assignment hidden from participants and investigators or assessors. This can reduce expectation bias and make softer or more subjective endpoints easier to trust.',
  },
  {
    term: 'Placebo-Controlled',
    subtitle: 'Compared against an inactive control',
    definition: 'A placebo-controlled study compares the treatment arm with a group receiving an inactive control. This can make the treatment effect easier to isolate, especially when outcomes are noisy.',
  },
  {
    term: 'Active-Controlled',
    subtitle: 'Compared against an existing treatment',
    definition: 'An active-controlled study compares the investigational therapy against another active treatment rather than placebo. This is common when withholding treatment would be impractical or unethical.',
  },
  {
    term: 'Enrollment',
    subtitle: 'How many participants the study recruits',
    definition: 'Enrollment is the number of participants a trial plans to include or has already included. It affects how much data the study can generate and how stable the result may be.',
  },
  {
    term: 'Study Start Date',
    subtitle: 'When the first participant enters the study',
    definition: 'The actual date on which the first participant was enrolled in a clinical study. The estimated study start date is the date that the researchers think will be the study start date.',
  },
  {
    term: 'Primary Completion Date',
    subtitle: 'When primary outcome data collection is finished',
    definition: 'The date when the last participant was examined or received an intervention to collect final data for the study’s primary outcome measures. If a study has more than one primary outcome, this means the date data collection finished for all of them. The estimated primary completion date is the date researchers expect this milestone to happen.',
  },
  {
    term: 'Study Completion Date',
    subtitle: 'When the full study is finished',
    definition: 'The date when the last participant was examined or received an intervention or treatment to collect final data for the primary outcomes, secondary outcomes, and adverse events. It is effectively the last participant’s last visit. The estimated study completion date is the date researchers expect this milestone to happen.',
  },
]

const PHASE_2_STUDY_TYPE_TERMS: GuidedGlossaryTerm[] = [
  {
    term: 'Single-Arm Trial',
    subtitle: 'Everyone gets the investigational treatment',
    definition: 'A single-arm trial does not use a concurrent control group. It can be useful in rare diseases or early signal-seeking settings, but it gives less comparative certainty than a randomized study.',
  },
  {
    term: 'Randomized Controlled Trial (RCT)',
    subtitle: 'Experimental therapy versus a control arm',
    definition: 'An RCT assigns participants by chance to different treatment groups, often the investigational therapy versus placebo or standard of care. This is the clearest way to compare treatments while reducing selection bias.',
  },
  {
    term: 'ORR-Based Single-Arm Trial',
    subtitle: 'A single-arm Phase 2 built around response rate',
    definition: 'Some oncology Phase 2 studies are single-arm trials centered on objective response rate, or ORR. They ask whether tumor shrinkage looks strong enough to justify moving forward, but they usually provide less certainty than an RCT because there is no concurrent control arm.',
  },
  {
    term: 'Simon Two-Stage Design',
    subtitle: 'A phase 2 design that can stop early',
    definition: 'Simon two-stage designs are commonly used in cancer phase 2 trials to stop early if a treatment looks insufficiently active after the first stage. The goal is to limit exposure to a weak drug while still allowing a promising one to continue.',
  },
  {
    term: 'Historical Control Benchmark',
    subtitle: 'Comparing against prior data instead of a live control arm',
    definition: 'In many single-arm phase 2 studies, the new treatment is judged against a prespecified benchmark drawn from prior experience rather than a concurrently randomized control arm. This is faster, but it makes interpretation more fragile if the populations are not truly comparable.',
  },
  {
    term: 'Adaptive Trial Design',
    subtitle: 'A design with prespecified changes along the way',
    definition: 'An adaptive trial allows planned modifications based on accumulating trial data, such as dropping arms, changing randomization, or refining enrollment. The goal is to be more efficient without sacrificing interpretability.',
  },
  {
    term: 'Biomarker-Enriched Trial',
    subtitle: 'Enrollment is narrowed toward patients more likely to respond',
    definition: 'An enriched trial intentionally concentrates enrollment in a subgroup with a higher chance of showing an effect, such as patients with a specific biomarker. This can make a signal easier to detect, but it can also narrow how broadly the result applies.',
  },
  {
    term: 'Dose Escalation Study',
    subtitle: 'Testing different doses to find the phase 2 dose',
    definition: 'A dose escalation study gives enrolled patients different dose levels to determine the recommended phase 2 dose (RP2D). It is usually more associated with earlier development, but it can feed directly into a phase 2 program.',
  },
  {
    term: 'Expansion Cohort',
    subtitle: 'Adding more patients after the early dose-finding stage',
    definition: 'An expansion cohort enrolls additional patients, often at the selected Phase 2 dose, to better estimate activity and safety in a defined population. These cohorts are common in oncology programs that move from dose finding into an early efficacy signal within the same broader study.',
  },
  {
    term: 'Randomized Dosage Evaluation',
    subtitle: 'Comparing two or more doses head-to-head',
    definition: 'Randomized dosage evaluation compares the benefit-risk of multiple dosage levels rather than assuming one dose is best. This matters when a program needs to optimize activity and tolerability before late-stage trials.',
  },
  {
    term: 'Basket Trial',
    subtitle: 'One therapy across multiple diseases or biomarker groups',
    definition: 'A basket trial studies a single investigational drug or combination across multiple cancer populations, often defined by biomarkers or disease subtypes. In oncology, these are often single-arm, activity-estimating studies that use ORR as the primary endpoint.',
  },
  {
    term: 'Umbrella Trial',
    subtitle: 'Multiple therapies within one disease setting',
    definition: 'An umbrella trial evaluates multiple investigational drugs within a single disease population. Different substudies may match different therapies to different biomarker-defined groups or treatment strategies.',
  },
  {
    term: 'Platform Trial',
    subtitle: 'An ongoing trial where arms can enter or leave',
    definition: 'A platform trial evaluates multiple medical products in an ongoing structure, with therapies entering or exiting over time. These trials often use shared infrastructure and can use a common control arm, but comparisons usually need to focus on concurrently randomized patients.',
  },
]

const GUIDED_GLOSSARY_TERMS = [
  ...MARKET_RESOLUTION_TERMS,
  ...PHASE_2_TRIAL_DESIGN_TERMS,
  ...PHASE_2_STUDY_TYPE_TERMS,
] as const

const GLOSSARY_TERMS: GlossaryTerm[] = [
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
    term: 'CNPV',
    fullName: "Commissioner's National Priority Voucher",
    definition: 'FDA pilot pathway that can compress review timelines for selected drugs or biologics tied to national priorities. In Endpoint Arena, CNPV may appear as the application type when the public FDA record has not yet disclosed NDA or BLA specifics.',
    category: 'Expedited Programs & Designations',
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
  {
    term: 'Phase I',
    definition: 'Early human studies that primarily assess safety, tolerability, dosing, and pharmacokinetics. They often enroll healthy volunteers, but some programs (for example oncology) enroll patients.',
    category: 'Clinical Development',
  },
  {
    term: 'Phase II',
    definition: 'Mid-stage studies in patients that further assess safety and provide preliminary evidence of efficacy, dose selection, and regimen design for later-stage trials.',
    category: 'Clinical Development',
  },
  {
    term: 'Phase III',
    definition: 'Usually larger, late-stage studies intended to provide pivotal evidence of efficacy and safety. Many NDA/BLA submissions rely on Phase III data, but the required evidence package varies by disease and pathway.',
    category: 'Clinical Development',
  },
  {
    term: 'Primary Endpoint',
    fullName: 'Primary Endpoint',
    definition: "The main prespecified outcome measure used to evaluate a drug's effectiveness in a clinical trial. Statistical significance on the primary endpoint is often central to FDA approval decisions.",
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
]

export function GlossaryTerms({ rootId }: { rootId?: string }) {
  const [highlightedTerm, setHighlightedTerm] = useState<string | null>(null)
  const [yesResolutionTerm, noResolutionTerm, ...marketContextTerms] = MARKET_RESOLUTION_TERMS

  useEffect(() => {
    const highlightHashTarget = () => {
      const hash = window.location.hash
      if (!hash || !hash.startsWith('#term-')) return

      const targetAnchor = glossaryLookupAnchor(decodeURIComponent(hash.replace('#term-', '')))
      const matchedTerm = [...GUIDED_GLOSSARY_TERMS, ...GLOSSARY_TERMS].find(
        (term) => glossaryTermAnchor(term.term) === targetAnchor,
      )
      if (!matchedTerm) return

      setHighlightedTerm(matchedTerm.term)
      window.setTimeout(() => {
        const el = document.getElementById(`term-${targetAnchor}`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 100)
      window.setTimeout(() => setHighlightedTerm(null), 3000)
    }

    highlightHashTarget()
    window.addEventListener('hashchange', highlightHashTarget)
    return () => window.removeEventListener('hashchange', highlightHashTarget)
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

  const resolutionPanels = [
    {
      term: yesResolutionTerm,
      titleClassName: 'text-[#557146]',
      bodyClassName: 'text-[#66785b]',
      sectionLabelClassName: 'text-[#7b9465]',
      phraseClassName: 'border-[#cfe0c2] bg-[#f3f8ee] text-[#5f7550]',
      detailClassName: 'text-[#66785b]',
      sections: RESOLUTION_COMPARISON_ROWS.map((row) => ({
        label: row.label,
        phrases: row.yesPhrases,
        detail: row.yesDetail,
      })),
    },
    {
      term: noResolutionTerm,
      titleClassName: 'text-[#8f5952]',
      bodyClassName: 'text-[#7d615c]',
      sectionLabelClassName: 'text-[#b17b74]',
      phraseClassName: 'border-[#eccdca] bg-[#fcf2f0] text-[#8e615b]',
      detailClassName: 'text-[#7d615c]',
      sections: RESOLUTION_COMPARISON_ROWS.map((row) => ({
        label: row.label,
        phrases: row.noPhrases,
        detail: row.noDetail,
      })),
    },
  ] as const

  return (
    <section id={rootId}>
      <section className="mb-10 sm:mb-16">
        <div className="mb-6 sm:mb-8">
          <div className="mb-3 flex items-center gap-3">
            <h3 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">How Endpoint Arena Markets Resolve</h3>
            <HeaderDots />
          </div>
        </div>

        <div className="grid items-stretch gap-4 lg:grid-cols-2">
          {resolutionPanels.map((panel) => {
            const term = panel.term
            const isHighlighted = highlightedTerm === term.term
            const termAnchor = glossaryTermAnchor(term.term)

            return (
              <div
                key={term.term}
                id={`term-${termAnchor}`}
                className={`h-full scroll-mt-32 rounded-sm p-[1px] transition-shadow duration-150 ${
                  isHighlighted
                    ? 'shadow-[0_0_0_2px_rgba(211,157,46,0.12)]'
                    : 'hover:shadow-[0_1px_0_rgba(26,26,26,0.04)]'
                }`}
                style={{ background: GRADIENT_BORDER }}
              >
                <div
                  className={`flex h-full flex-col rounded-sm p-5 transition-colors duration-150 sm:p-6 ${
                    isHighlighted ? 'bg-[#fbf6ee]' : 'bg-white/95'
                  }`}
                >
                  <div className={`text-2xl font-medium ${panel.titleClassName}`}>{term.term}</div>
                  <p className={`mt-3 text-sm leading-relaxed sm:text-base ${panel.bodyClassName}`}>{term.definition}</p>

                  <div className="mt-6 space-y-4">
                    {panel.sections.map((section) => (
                      <div key={`${term.term}-${section.label}`} className="border-t border-[#ece3d7] pt-4">
                        <div
                          className={`mb-3 text-[11px] font-medium uppercase tracking-[0.22em] ${panel.sectionLabelClassName}`}
                        >
                          {section.label}
                        </div>
                        {section.phrases.length > 0 && (
                          <div className="mb-3 flex flex-wrap gap-2">
                            {section.phrases.map((phrase) => (
                              <span
                                key={phrase}
                                className={`border px-2.5 py-1.5 text-xs font-medium tracking-[0.01em] ${panel.phraseClassName}`}
                              >
                                {phrase}
                              </span>
                            ))}
                          </div>
                        )}
                        <p className={`text-sm leading-relaxed ${panel.detailClassName}`}>{section.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {marketContextTerms.map((term) => {
            const isHighlighted = highlightedTerm === term.term
            const termAnchor = glossaryTermAnchor(term.term)

            return (
              <div
                key={term.term}
                id={`term-${termAnchor}`}
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
                  <div className="mb-2 text-lg font-medium text-[#3b3833]">{term.term}</div>
                  <p className="text-sm leading-relaxed text-[#6f665b]">{term.definition}</p>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <SquareDivider className="mb-8 sm:mb-10" />

      <section className="mb-10 sm:mb-16">
        <div className="mb-6 sm:mb-8">
          <div className="mb-3 flex items-center gap-3">
            <h3 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Phase 2 Trial Design</h3>
            <HeaderDots />
          </div>
          <p className="max-w-3xl text-sm leading-relaxed text-[#8a8075] sm:text-base">
            These terms describe how a study is structured and why some Phase 2 programs generate cleaner or noisier
            evidence than others.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PHASE_2_TRIAL_DESIGN_TERMS.map((term) => {
            const isHighlighted = highlightedTerm === term.term
            const termAnchor = glossaryTermAnchor(term.term)

            return (
              <div
                key={term.term}
                id={`term-${termAnchor}`}
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
                  <div className="mb-2 text-lg font-medium text-[#3b3833]">{term.term}</div>
                  <p className="text-sm leading-relaxed text-[#6f665b]">{term.definition}</p>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <SquareDivider className="mb-8 sm:mb-10" />

      <section className="mb-10 sm:mb-16">
        <div className="mb-6 sm:mb-8">
          <div className="mb-3 flex items-center gap-3">
            <h3 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Phase 2 Study Types</h3>
            <HeaderDots />
          </div>
          <p className="max-w-3xl text-sm leading-relaxed text-[#8a8075] sm:text-base">
            These are common ways Phase 2 programs are structured in practice, from single-arm signal checks to randomized and master-protocol designs.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PHASE_2_STUDY_TYPE_TERMS.map((term) => {
            const isHighlighted = highlightedTerm === term.term
            const termAnchor = glossaryTermAnchor(term.term)

            return (
              <div
                key={term.term}
                id={`term-${termAnchor}`}
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
                  <div className="mb-2 text-lg font-medium text-[#3b3833]">{term.term}</div>
                  <div className="mb-2 text-sm font-medium text-[#8a8075]">{term.subtitle}</div>
                  <p className="text-sm leading-relaxed text-[#6f665b]">{term.definition}</p>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <SquareDivider className="mb-8 sm:mb-10" />

      {CATEGORY_ORDER.map((category, i) => {
        const terms = groupedTerms[category]
        if (!terms) return null

        return (
          <section key={category} className="mb-10 sm:mb-16">
            {i > 0 && <SquareDivider className="mb-8 sm:mb-10" />}
            <div className="mb-6 sm:mb-8">
              <div className="flex items-center gap-3 mb-3">
                <h3 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">{category}</h3>
                <HeaderDots />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {terms.map((term) => {
                const isHighlighted = highlightedTerm === term.term
                const termAnchor = glossaryTermAnchor(term.term)
                return (
                  <div
                    key={term.term}
                    id={`term-${termAnchor}`}
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
                      <p className="truncate-wrap text-sm leading-relaxed text-[#b5aa9e]">{term.definition}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </section>
  )
}
