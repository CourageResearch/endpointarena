'use client'

import { useEffect, useState } from 'react'
import { glossaryLookupAnchor, glossaryTermAnchor } from '@/lib/glossary'
import { BRAND_GRADIENT, HeaderDots, SquareDivider } from '@/components/site/chrome'

type GlossaryTerm = {
  term: string
  subtitle: string
  definition: string
}

type GlossarySection = {
  title: string
  intro: string
  terms: GlossaryTerm[]
}

const PHASE_2_GLOSSARY_SECTIONS: GlossarySection[] = [
  {
    title: 'How Endpoint Arena Markets Work',
    intro: 'These are the core ideas behind each live question, how the price behaves, and what outcome turns the market into a YES or NO.',
    terms: [
      {
        term: 'Market Question',
        subtitle: 'The sentence the market resolves on',
        definition: 'The exact yes-or-no prompt traders are evaluating. On Endpoint Arena, the question frames what evidence matters and what result will count as a YES.',
      },
      {
        term: 'YES Resolution',
        subtitle: 'What must happen for YES to win',
        definition: 'A market resolves YES when the accepted evidence shows that the exact trial readout was positive, encouraging, clinically meaningful, or otherwise supportive of success.',
      },
      {
        term: 'NO Resolution',
        subtitle: 'What must happen for NO to win',
        definition: 'A market resolves NO when the accepted evidence shows that the exact trial readout was negative, disappointing, failed, or otherwise clearly unsupportive of success.',
      },
      {
        term: 'Market Price',
        subtitle: 'The live implied odds in the market',
        definition: 'The YES and NO prices show how the market is valuing each outcome right now. A higher YES price means traders currently see success as more likely.',
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
      {
        term: 'Readout',
        subtitle: 'The moment results become public',
        definition: 'A readout is the release of trial results through a press release, conference presentation, registry update, or similar public disclosure. It is often the first decisive evidence for resolution.',
      },
    ],
  },
  {
    title: 'Phase 2 Trial Design',
    intro: 'These terms describe how a study is structured and why some Phase 2 programs generate cleaner or noisier evidence than others.',
    terms: [
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
        term: 'Placebo-Controlled',
        subtitle: 'Compared against an inactive control',
        definition: 'A placebo-controlled study compares the treatment arm with a group receiving an inactive control. This can make the treatment effect easier to isolate, especially when outcomes are noisy.',
      },
      {
        term: 'Enrollment',
        subtitle: 'How many participants the study recruits',
        definition: 'Enrollment is the number of participants a trial plans to include or has already included. It affects how much data the study can generate and how stable the result may be.',
      },
    ],
  },
  {
    title: 'Endpoints and Evidence',
    intro: 'These are the concepts most directly tied to whether a Phase 2 readout is strong enough to move the market or settle the question.',
    terms: [
      {
        term: 'Primary Endpoint',
        subtitle: 'The main test of success',
        definition: 'The primary endpoint is the main prespecified outcome the study is designed to evaluate. On Endpoint Arena, the core market question is whether the trial meets that primary endpoint.',
      },
      {
        term: 'Secondary Endpoint',
        subtitle: 'Additional planned outcomes',
        definition: 'Secondary endpoints measure other prespecified effects beyond the primary endpoint. They add context to how a readout is framed, but they usually are not enough by themselves to overturn a clearly negative result.',
      },
      {
        term: 'Surrogate Endpoint',
        subtitle: 'A stand-in measurement',
        definition: 'A surrogate endpoint uses a marker such as a lab value, response rate, or imaging change instead of a direct clinical outcome. It can speed development, but the result may be less intuitive to interpret.',
      },
      {
        term: 'Statistical Significance',
        subtitle: 'A signal unlikely to be random chance alone',
        definition: 'Statistical significance means the observed result crossed a prespecified threshold that suggests the effect is unlikely to be due to chance alone. It does not guarantee the effect is large or clinically important.',
      },
      {
        term: 'Dose-Finding',
        subtitle: 'Learning which dose to carry forward',
        definition: 'Dose-finding is the process of testing different dose levels to balance efficacy and safety. A noisy or incomplete dose-finding story can make a Phase 2 result harder to trust.',
      },
      {
        term: 'Topline Result',
        subtitle: 'The first high-level public summary',
        definition: 'A topline result is the initial summary of the most important trial outcomes before a full dataset is released. It is often enough to move the market, even when important details are still missing.',
      },
    ],
  },
]

function findGlossaryTermByHash(hash: string) {
  if (!hash.startsWith('#term-')) return null

  const targetAnchor = glossaryLookupAnchor(decodeURIComponent(hash.replace('#term-', '')))
  for (const section of PHASE_2_GLOSSARY_SECTIONS) {
    for (const term of section.terms) {
      if (glossaryTermAnchor(term.term) === targetAnchor) {
        return { anchor: targetAnchor, term: term.term }
      }
    }
  }

  return null
}

export function GlossaryTermsPhase2() {
  const [highlightedTerm, setHighlightedTerm] = useState<string | null>(null)

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

  return (
    <section>
      <div className="mb-10 sm:mb-14">
        <div className="mb-4 flex items-center gap-3">
          <h1 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Glossary 2</h1>
          <HeaderDots />
        </div>

        <div className="rounded-sm p-[1px]" style={{ background: BRAND_GRADIENT }}>
          <div className="grid gap-6 rounded-sm bg-white/95 p-5 sm:grid-cols-[minmax(0,1.35fr)_minmax(220px,0.9fr)] sm:p-8">
            <div>
              <p className="max-w-2xl text-base leading-relaxed text-[#5f564d] sm:text-lg">
                Endpoint Arena now centers on clinical trials and one uniform question for each market:
                whether the results will be positive.
              </p>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#8a8075] sm:text-base">
                This preview glossary is built to help you read those markets quickly, understand how trial design affects signal
                quality, and interpret what a public readout actually tells you.
              </p>
            </div>

            <div className="rounded-sm border border-[#e8ddd0] bg-[#faf7f2] p-4 sm:p-5">
              <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#aa9d8d]">What This Covers</div>
              <div className="mt-3 space-y-2 text-sm leading-relaxed text-[#6f665b]">
                <p>How a market resolves YES or NO.</p>
                <p>What Phase 2 design choices make evidence stronger or weaker.</p>
                <p>How endpoints, topline data, and significance shape a readout.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {PHASE_2_GLOSSARY_SECTIONS.map((section, index) => (
        <section key={section.title} className="mb-10 sm:mb-16">
          {index > 0 ? <SquareDivider className="mb-8 sm:mb-10" /> : null}

          <div className="mb-6 sm:mb-8">
            <div className="mb-3 flex items-center gap-3">
              <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">{section.title}</h2>
              <HeaderDots />
            </div>
            <p className="max-w-3xl text-sm leading-relaxed text-[#8a8075] sm:text-base">{section.intro}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {section.terms.map((term) => {
              const isHighlighted = highlightedTerm === term.term
              const termAnchor = glossaryTermAnchor(term.term)

              return (
                <article
                  key={term.term}
                  id={`term-${termAnchor}`}
                  className={`scroll-mt-32 rounded-sm p-[1px] transition-shadow duration-150 ${
                    isHighlighted
                      ? 'shadow-[0_0_0_2px_rgba(211,157,46,0.14)]'
                      : 'hover:shadow-[0_1px_0_rgba(26,26,26,0.04)]'
                  }`}
                  style={{ background: BRAND_GRADIENT }}
                >
                  <div
                    className={`h-full rounded-sm p-5 transition-colors duration-150 sm:p-6 ${
                      isHighlighted ? 'bg-[#fbf6ee]' : 'bg-white/95 hover:bg-[#f7f1e8]'
                    }`}
                  >
                    <div className="text-lg font-medium text-[#3b3833]">{term.term}</div>
                    <div className="mt-2 text-sm font-medium text-[#8a8075]">{term.subtitle}</div>
                    <p className="mt-3 text-sm leading-relaxed text-[#6f665b]">{term.definition}</p>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      ))}
    </section>
  )
}
