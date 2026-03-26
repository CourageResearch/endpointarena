'use client'

import { useEffect, useState } from 'react'
import { glossaryTermAnchor } from '@/lib/glossary'
import { BRAND_GRADIENT, HeaderDots, SquareDivider } from '@/components/site/chrome'

type GlossaryTerm = {
  term: string
  definition: string
  subtitle?: string
}

type ResolutionComparisonRow = {
  label: string
  yesPhrases: string[]
  yesDetail: string
  noPhrases: string[]
  noDetail: string
}

const MARKET_RESOLUTION_TERMS: GlossaryTerm[] = [
  {
    term: 'Yes Resolution',
    definition:
      'A market resolves YES when the accepted evidence shows that the exact trial readout was positive, encouraging, clinically meaningful, supportive of success, met efficacy goals, or equivalent.',
  },
  {
    term: 'No Resolution',
    definition:
      'A market resolves NO when the accepted evidence shows that the exact trial readout was negative, disappointing, failed, did not meet goals, showed no meaningful activity, or equivalent.',
  },
  {
    term: 'Topline Result',
    definition:
      'A topline result is the initial summary of the most important trial outcomes before a full dataset is released. It is often enough to move the market even when important details are still missing.',
  },
  {
    term: 'Statistical Significance',
    definition:
      'Statistical significance means the observed result crossed a prespecified threshold suggesting the effect is unlikely to be explained by chance alone. It helps a readout, but by itself does not guarantee the result is clinically important.',
  },
  {
    term: 'Clinically Meaningful',
    definition:
      'Clinically meaningful means the effect looks important enough to matter for patients or decision-makers, not just numerically positive. This kind of language usually frames a public readout as supportive of success.',
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
      'This kind of wording usually frames the result as a real success, not just a technical datapoint.',
    noPhrases: ['did not meet goals', 'no meaningful activity'],
    noDetail:
      'This kind of wording usually signals that the outcome fell short in a way that matters for the market question.',
  },
]

const TRIAL_DESIGN_TERMS: GlossaryTerm[] = [
  {
    term: 'Phase 1',
    definition:
      'Phase 1 studies focus mainly on safety, tolerability, and dosing. They usually tell you whether a drug can move forward, not whether it clearly works.',
  },
  {
    term: 'Phase 2',
    definition:
      'Phase 2 studies test a treatment in the target disease population and look for evidence that it is working, while continuing to learn about safety and dose selection.',
  },
  {
    term: 'Phase 3',
    definition:
      'Phase 3 trials are usually larger confirmatory studies meant to provide stronger evidence for regulators, physicians, and payers than an earlier Phase 2 program can provide.',
  },
  {
    term: 'Combined Phase Trial',
    definition:
      'A combined phase trial, such as Phase 1/2 or Phase 2/3, blends multiple development stages into one study. This can speed development, but it also makes the design more complex to interpret.',
  },
  {
    term: 'Randomized',
    definition:
      'Randomization assigns participants to different study arms by chance rather than choice. It helps reduce bias and makes it easier to compare outcomes fairly.',
  },
  {
    term: 'Open-Label',
    definition:
      'In an open-label study, investigators and participants know which treatment is being given. That can be practical, but it can also make subjective endpoints harder to interpret.',
  },
  {
    term: 'Double-Blind',
    definition:
      'A double-blind trial keeps treatment assignment hidden from participants and investigators or assessors. This can reduce expectation bias and make softer or more subjective endpoints easier to trust.',
  },
  {
    term: 'Placebo-Controlled',
    definition:
      'A placebo-controlled study compares the treatment arm with a group receiving an inactive control. This can make the treatment effect easier to isolate, especially when outcomes are noisy.',
  },
  {
    term: 'Active-Controlled',
    definition:
      'An active-controlled study compares the investigational therapy against another active treatment rather than placebo. This is common when withholding treatment would be impractical or unethical.',
  },
  {
    term: 'Enrollment',
    definition:
      'Enrollment is the number of participants a trial plans to include or has already included. It affects how much data the study can generate and how stable the result may be.',
  },
]

const STUDY_DATE_TERMS: GlossaryTerm[] = [
  {
    term: 'Study Start Date',
    definition:
      'The actual date on which the first participant was enrolled in a clinical study. The estimated study start date is the date that the researchers think will be the study start date.',
  },
  {
    term: 'Primary Completion Date',
    definition:
      'The date when the last participant was examined or received an intervention to collect final data for the study’s primary outcome measures. If a study has more than one primary outcome, this means the date data collection finished for all of them. The estimated primary completion date is the date researchers expect this milestone to happen.',
  },
  {
    term: 'Study Completion Date',
    definition:
      'The date when the last participant was examined or received an intervention or treatment to collect final data for the primary outcomes, secondary outcomes, and adverse events. It is effectively the last participant’s last visit. The estimated study completion date is the date researchers expect this milestone to happen.',
  },
]

const STUDY_DESIGN_TERMS: GlossaryTerm[] = [
  {
    term: 'Single-Arm Trial',
    subtitle: 'Everyone gets the investigational treatment',
    definition:
      'A single-arm trial does not use a concurrent control group. It can be useful in rare diseases or early signal-seeking settings, but it gives less comparative certainty than a randomized study.',
  },
  {
    term: 'Randomized Controlled Trial (RCT)',
    subtitle: 'Experimental therapy versus a control arm',
    definition:
      'An RCT assigns participants by chance to different treatment groups, often the investigational therapy versus placebo or standard of care. This is the clearest way to compare treatments while reducing selection bias.',
  },
  {
    term: 'ORR-Based Single-Arm Trial',
    subtitle: 'A single-arm Phase 2 built around response rate',
    definition:
      'Some oncology Phase 2 studies are single-arm trials centered on objective response rate, or ORR. They ask whether tumor shrinkage looks strong enough to justify moving forward, but they usually provide less certainty than an RCT because there is no concurrent control arm.',
  },
  {
    term: 'Simon Two-Stage Design',
    subtitle: 'A phase 2 design that can stop early',
    definition:
      'Simon two-stage designs are commonly used in cancer phase 2 trials to stop early if a treatment looks insufficiently active after the first stage. The goal is to limit exposure to a weak drug while still allowing a promising one to continue.',
  },
  {
    term: 'Historical Control Benchmark',
    subtitle: 'Comparing against prior data instead of a live control arm',
    definition:
      'In many single-arm phase 2 studies, the new treatment is judged against a prespecified benchmark drawn from prior experience rather than a concurrently randomized control arm. This is faster, but it makes interpretation more fragile if the populations are not truly comparable.',
  },
  {
    term: 'Adaptive Trial Design',
    subtitle: 'A design with prespecified changes along the way',
    definition:
      'An adaptive trial allows planned modifications based on accumulating trial data, such as dropping arms, changing randomization, or refining enrollment. The goal is to be more efficient without sacrificing interpretability.',
  },
  {
    term: 'Biomarker-Enriched Trial',
    subtitle: 'Enrollment is narrowed toward patients more likely to respond',
    definition:
      'An enriched trial intentionally concentrates enrollment in a subgroup with a higher chance of showing an effect, such as patients with a specific biomarker. This can make a signal easier to detect, but it can also narrow how broadly the result applies.',
  },
  {
    term: 'Dose Escalation Study',
    subtitle: 'Testing different doses to find the phase 2 dose',
    definition:
      'A dose escalation study gives enrolled patients different dose levels to determine the recommended phase 2 dose (RP2D). It is usually more associated with earlier development, but it can feed directly into a phase 2 program.',
  },
  {
    term: 'Expansion Cohort',
    subtitle: 'Adding more patients after the early dose-finding stage',
    definition:
      'An expansion cohort enrolls additional patients, often at the selected Phase 2 dose, to better estimate activity and safety in a defined population. These cohorts are common in oncology programs that move from dose finding into an early efficacy signal within the same broader study.',
  },
  {
    term: 'Randomized Dosage Evaluation',
    subtitle: 'Comparing two or more doses head-to-head',
    definition:
      'Randomized dosage evaluation compares the benefit-risk of multiple dosage levels rather than assuming one dose is best. This matters when a program needs to optimize activity and tolerability before late-stage trials.',
  },
  {
    term: 'Basket Trial',
    subtitle: 'One therapy across multiple diseases or biomarker groups',
    definition:
      'A basket trial studies a single investigational drug or combination across multiple cancer populations, often defined by biomarkers or disease subtypes. In oncology, these are often single-arm, activity-estimating studies that use ORR as the primary endpoint.',
  },
  {
    term: 'Platform Trial',
    subtitle: 'An ongoing trial where arms can enter or leave',
    definition:
      'A platform trial evaluates multiple medical products in an ongoing structure, with therapies entering or exiting over time. These trials often use shared infrastructure and can use a common control arm, but comparisons usually need to focus on concurrently randomized patients.',
  },
]

const ENDPOINT_TERMS: GlossaryTerm[] = [
  {
    term: 'Primary Endpoint',
    definition:
      'The primary endpoint is the main prespecified outcome the study is designed to evaluate. It remains a key clue on Endpoint Arena, but markets resolve on whether the overall public readout is positive or negative.',
  },
  {
    term: 'Secondary Endpoint',
    definition:
      'Secondary endpoints measure other prespecified effects beyond the primary endpoint. They add context to how a readout is framed, but they usually are not enough by themselves to overturn a clearly negative result.',
  },
  {
    term: 'Surrogate Endpoint',
    definition:
      'A surrogate endpoint uses a marker such as a lab value, response rate, or imaging change instead of a direct clinical outcome. It can speed development, but the result may be less intuitive to interpret.',
  },
  {
    term: 'Dose-Finding',
    definition:
      'Dose-finding is the process of testing different dose levels to balance efficacy and safety. A noisy or incomplete dose-finding story can make a Phase 2 result harder to trust.',
  },
  {
    term: 'Objective Response Rate (ORR)',
    definition:
      'Objective response rate measures the share of patients with a predefined amount of tumor shrinkage. In oncology Phase 2 studies, a strong ORR can drive a bullish readout even if longer-term outcome data are still immature.',
  },
  {
    term: 'Overall Survival (OS)',
    definition:
      'Overall survival measures how long patients live after entering a study. It is one of the clearest clinical endpoints, but it usually takes longer to mature than an early Phase 2 signal endpoint.',
  },
]

const FDA_TERMS: GlossaryTerm[] = [
  {
    term: 'NDA',
    definition:
      'The formal submission to FDA requesting approval to market a new pharmaceutical drug. It is the main application type users still see on the site for many decision-date markets.',
  },
  {
    term: 'BLA',
    definition:
      'A BLA is the FDA application used for biologic products such as many antibodies, gene therapies, and other complex products derived from living systems.',
  },
  {
    term: 'sNDA',
    definition:
      'A supplemental NDA is a follow-on application tied to an already approved drug, often for a new indication, labeling update, or other post-approval change.',
  },
  {
    term: 'sBLA',
    definition:
      'A supplemental BLA is the biologics counterpart to an sNDA and is used for updates such as new indications, labeling changes, or manufacturing revisions.',
  },
  {
    term: 'rNDA',
    definition:
      'An rNDA is an NDA that is resubmitted after a Complete Response Letter. The sponsor is trying again after addressing FDA concerns from the prior review cycle.',
  },
  {
    term: 'rBLA',
    definition:
      'An rBLA is a BLA that is resubmitted after a Complete Response Letter. It signals that the sponsor is back in review after responding to FDA objections.',
  },
  {
    term: 'CNPV',
    definition:
      'CNPV is FDA’s Commissioner’s National Priority Voucher pilot pathway. On Endpoint Arena, it can appear as the application type when public FDA records have not yet disclosed more specific NDA or BLA details.',
  },
  {
    term: 'CRL',
    definition:
      'A Complete Response Letter means FDA finished the review cycle but did not approve the application as submitted. It is the main rejection-style outcome users still need to recognize quickly.',
  },
  {
    term: 'PDUFA Date',
    definition:
      'The PDUFA date is the FDA target action date for many NDA and BLA reviews. It is a timing milestone, not a guaranteed approval date.',
  },
  {
    term: 'Accelerated Approval',
    definition:
      'Accelerated Approval allows FDA to approve a product based on a surrogate or earlier endpoint rather than waiting for a longer clinical outcome, usually with follow-up confirmatory work still required.',
  },
  {
    term: 'Fast Track',
    definition:
      'Fast Track is an FDA designation for serious conditions with unmet need. It can lead to more communication with FDA and a faster-moving review process.',
  },
  {
    term: 'Breakthrough Therapy',
    definition:
      'Breakthrough Therapy is a stronger FDA designation used when early clinical evidence suggests substantial improvement over existing options. It usually signals unusually close FDA attention.',
  },
]

const ALL_GLOSSARY_TERMS = [
  ...MARKET_RESOLUTION_TERMS,
  ...TRIAL_DESIGN_TERMS,
  ...STUDY_DATE_TERMS,
  ...STUDY_DESIGN_TERMS,
  ...ENDPOINT_TERMS,
  ...FDA_TERMS,
] as const

function findGlossaryTermByHash(hash: string) {
  if (!hash.startsWith('#term-')) return null

  const targetAnchor = glossaryTermAnchor(decodeURIComponent(hash.replace('#term-', '')))
  const matchedTerm = ALL_GLOSSARY_TERMS.find((term) => glossaryTermAnchor(term.term) === targetAnchor)
  if (!matchedTerm) return null

  return { anchor: targetAnchor, term: matchedTerm.term }
}

function GlossaryCard({
  term,
  highlightedTerm,
  showSubtitle = false,
}: {
  term: GlossaryTerm
  highlightedTerm: string | null
  showSubtitle?: boolean
}) {
  const isHighlighted = highlightedTerm === term.term
  const termAnchor = glossaryTermAnchor(term.term)

  return (
    <div
      id={`term-${termAnchor}`}
      className={`scroll-mt-32 rounded-sm p-[1px] transition-shadow duration-150 ${
        isHighlighted
          ? 'shadow-[0_0_0_2px_rgba(211,157,46,0.12)]'
          : 'hover:shadow-[0_1px_0_rgba(26,26,26,0.04)]'
      }`}
      style={{ background: BRAND_GRADIENT }}
    >
      <div
        className={`h-full rounded-sm p-4 transition-colors duration-150 sm:p-6 ${
          isHighlighted ? 'bg-[#fbf6ee]' : 'bg-white/95 hover:bg-[#f7f1e8]'
        }`}
      >
        <div className="text-lg font-medium text-[#3b3833]">{term.term}</div>
        {showSubtitle && term.subtitle ? (
          <div className="mt-2 text-sm font-medium text-[#8a8075]">{term.subtitle}</div>
        ) : null}
        <p className="mt-3 text-sm leading-relaxed text-[#6f665b]">{term.definition}</p>
      </div>
    </div>
  )
}

export function GlossaryTermsPhase2Focused() {
  const [highlightedTerm, setHighlightedTerm] = useState<string | null>(null)
  const [yesResolutionTerm, noResolutionTerm, ...marketContextTerms] = MARKET_RESOLUTION_TERMS

  useEffect(() => {
    let clearHighlightTimeout: number | null = null
    let scrollTimeout: number | null = null

    const highlightHashTarget = () => {
      const matchedTerm = findGlossaryTermByHash(window.location.hash)
      if (!matchedTerm) return

      setHighlightedTerm(matchedTerm.term)

      if (scrollTimeout !== null) {
        window.clearTimeout(scrollTimeout)
      }

      if (clearHighlightTimeout !== null) {
        window.clearTimeout(clearHighlightTimeout)
      }

      scrollTimeout = window.setTimeout(() => {
        const el = document.getElementById(`term-${matchedTerm.anchor}`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 100)

      clearHighlightTimeout = window.setTimeout(() => {
        setHighlightedTerm(null)
      }, 3000)
    }

    highlightHashTarget()
    window.addEventListener('hashchange', highlightHashTarget)

    return () => {
      if (scrollTimeout !== null) {
        window.clearTimeout(scrollTimeout)
      }
      if (clearHighlightTimeout !== null) {
        window.clearTimeout(clearHighlightTimeout)
      }
      window.removeEventListener('hashchange', highlightHashTarget)
    }
  }, [])

  const resolutionPanels = [
    {
      term: yesResolutionTerm,
      frameColor: '#9dc784',
      surfaceClassName: 'bg-[#fbfdf9]',
      titleClassName: 'text-[#557146]',
      bodyClassName: 'text-[#66785b]',
      sectionBorderClassName: 'border-[#dbe8d2]',
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
      frameColor: '#e3a09a',
      surfaceClassName: 'bg-[#fefbfa]',
      titleClassName: 'text-[#8f5952]',
      bodyClassName: 'text-[#7d615c]',
      sectionBorderClassName: 'border-[#eed8d4]',
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
    <section>
      <section className="mb-10 sm:mb-16">
        <div className="mb-6 sm:mb-8">
          <div className="mb-3 flex items-center gap-3">
            <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Market Resolution</h2>
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
                style={{ backgroundColor: panel.frameColor }}
              >
                <div
                  className={`flex h-full flex-col rounded-sm p-5 transition-colors duration-150 sm:p-6 ${
                    isHighlighted ? 'bg-[#fbf6ee]' : panel.surfaceClassName
                  }`}
                >
                  <div className={`text-2xl font-medium ${panel.titleClassName}`}>{term.term}</div>
                  <p className={`mt-3 text-sm leading-relaxed sm:text-base ${panel.bodyClassName}`}>{term.definition}</p>

                  <div className="mt-6 space-y-4">
                    {panel.sections.map((section) => (
                      <div
                        key={`${term.term}-${section.label}`}
                        className={`border-t pt-4 ${panel.sectionBorderClassName}`}
                      >
                        <div
                          className={`mb-3 text-[11px] font-medium uppercase tracking-[0.22em] ${panel.sectionLabelClassName}`}
                        >
                          {section.label}
                        </div>
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
          {marketContextTerms.map((term) => (
            <GlossaryCard key={term.term} term={term} highlightedTerm={highlightedTerm} />
          ))}
        </div>
      </section>

      <SquareDivider className="mb-8 sm:mb-10" />

      <section className="mb-10 sm:mb-16">
        <div className="mb-6 sm:mb-8">
          <div className="mb-3 flex items-center gap-3">
            <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Trial Design</h2>
            <HeaderDots />
          </div>
          <p className="max-w-3xl text-sm leading-relaxed text-[#8a8075] sm:text-base">
            These terms describe how a study is structured and why some Phase 2 programs generate cleaner or noisier
            evidence than others.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TRIAL_DESIGN_TERMS.map((term) => (
            <GlossaryCard key={term.term} term={term} highlightedTerm={highlightedTerm} />
          ))}
        </div>
      </section>

      <SquareDivider className="mb-8 sm:mb-10" />

      <section className="mb-10 sm:mb-16">
        <div className="mb-6 sm:mb-8">
          <div className="mb-3 flex items-center gap-3">
            <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Study Dates</h2>
            <HeaderDots />
          </div>
          <p className="max-w-3xl text-sm leading-relaxed text-[#8a8075] sm:text-base">
            These are the main trial timing milestones you will see on market and trial pages.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STUDY_DATE_TERMS.map((term) => (
            <GlossaryCard key={term.term} term={term} highlightedTerm={highlightedTerm} />
          ))}
        </div>
      </section>

      <SquareDivider className="mb-8 sm:mb-10" />

      <section className="mb-10 sm:mb-16">
        <div className="mb-6 sm:mb-8">
          <div className="mb-3 flex items-center gap-3">
            <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Study Designs</h2>
            <HeaderDots />
          </div>
          <p className="max-w-3xl text-sm leading-relaxed text-[#8a8075] sm:text-base">
            These are common ways Phase 2 programs are structured in practice, from single-arm signal checks to
            randomized and master-protocol designs.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STUDY_DESIGN_TERMS.map((term) => (
            <GlossaryCard key={term.term} term={term} highlightedTerm={highlightedTerm} showSubtitle />
          ))}
        </div>
      </section>

      <SquareDivider className="mb-8 sm:mb-10" />

      <section className="mb-10 sm:mb-16">
        <div className="mb-6 sm:mb-8">
          <div className="mb-3 flex items-center gap-3">
            <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Endpoints</h2>
            <HeaderDots />
          </div>
          <p className="max-w-3xl text-sm leading-relaxed text-[#8a8075] sm:text-base">
            These are the endpoint concepts most likely to shape how a Phase 2 readout is interpreted in the market.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ENDPOINT_TERMS.map((term) => (
            <GlossaryCard key={term.term} term={term} highlightedTerm={highlightedTerm} />
          ))}
        </div>
      </section>

      <SquareDivider className="mb-8 sm:mb-10" />

      <section className="mb-10 sm:mb-16">
        <div className="mb-6 sm:mb-8">
          <div className="mb-3 flex items-center gap-3">
            <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">FDA Terms</h2>
            <HeaderDots />
          </div>
          <p className="max-w-3xl text-sm leading-relaxed text-[#8a8075] sm:text-base">
            This is the small FDA and PDUFA reference set that still shows up most often around current markets.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FDA_TERMS.map((term) => (
            <GlossaryCard key={term.term} term={term} highlightedTerm={highlightedTerm} />
          ))}
        </div>
      </section>
    </section>
  )
}
