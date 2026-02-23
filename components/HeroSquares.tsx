export type SquareVariant = 'corners' | 'diagonals' | 'bands' | 'grid-border' | 'bands-edge'

const ambientSquares = (
  <>
    <rect x="20%" y="25%" width="35" height="35" rx="4" fill="#D39D2E" opacity="0.06" />
    <rect x="58%" y="40%" width="40" height="40" rx="4" fill="#5BA5ED" opacity="0.06" />
    <rect x="78%" y="15%" width="35" height="35" rx="4" fill="#5DBB63" opacity="0.06" />
  </>
)

function CornersSquares() {
  return (
    <>
      {/* Top-left cluster */}
      <rect x="3%" y="6%" width="10" height="10" rx="2" fill="#D39D2E" opacity="0.6" />
      <rect x="6%" y="11%" width="8" height="8" rx="1.5" fill="#5DBB63" opacity="0.5" />
      <rect x="2%" y="15%" width="7" height="7" rx="1.5" fill="#5DBB63" opacity="0.45" />
      <rect x="9%" y="8%" width="6" height="6" rx="1.5" fill="#EF6F67" opacity="0.4" />

      {/* Top-right cluster */}
      <rect x="90%" y="6%" width="9" height="9" rx="1.5" fill="#5BA5ED" opacity="0.55" />
      <rect x="94%" y="11%" width="7" height="7" rx="1.5" fill="#D39D2E" opacity="0.5" />
      <rect x="88%" y="14%" width="8" height="8" rx="1.5" fill="#EF6F67" opacity="0.4" />
      <rect x="95%" y="16%" width="6" height="6" rx="1.5" fill="#5DBB63" opacity="0.45" />

      {/* Bottom-left cluster */}
      <rect x="3%" y="80%" width="8" height="8" rx="1.5" fill="#5BA5ED" opacity="0.5" />
      <rect x="7%" y="85%" width="10" height="10" rx="2" fill="#5DBB63" opacity="0.55" />
      <rect x="2%" y="89%" width="7" height="7" rx="1.5" fill="#D39D2E" opacity="0.4" />
      <rect x="10%" y="82%" width="6" height="6" rx="1.5" fill="#ffffff" opacity="0.7" />

      {/* Bottom-right cluster */}
      <rect x="90%" y="80%" width="9" height="9" rx="1.5" fill="#5DBB63" opacity="0.5" />
      <rect x="94%" y="86%" width="7" height="7" rx="1.5" fill="#EF6F67" opacity="0.55" />
      <rect x="88%" y="89%" width="8" height="8" rx="1.5" fill="#5BA5ED" opacity="0.45" />
      <rect x="96%" y="83%" width="6" height="6" rx="1.5" fill="#5DBB63" opacity="0.4" />

      {ambientSquares}
    </>
  )
}

function DiagonalsSquares() {
  return (
    <>
      {/* Top-left cascade — large to small, fading */}
      <rect x="2%" y="5%" width="12" height="12" rx="2" fill="#D39D2E" opacity="0.65" />
      <rect x="6%" y="11%" width="10" height="10" rx="2" fill="#5DBB63" opacity="0.5" />
      <rect x="11%" y="17%" width="8" height="8" rx="1.5" fill="#5DBB63" opacity="0.35" />

      {/* Top-right cascade */}
      <rect x="94%" y="5%" width="11" height="11" rx="2" fill="#5BA5ED" opacity="0.6" />
      <rect x="89%" y="11%" width="9" height="9" rx="1.5" fill="#EF6F67" opacity="0.5" />
      <rect x="84%" y="17%" width="7" height="7" rx="1.5" fill="#D39D2E" opacity="0.35" />

      {/* Bottom-left cascade */}
      <rect x="2%" y="90%" width="11" height="11" rx="2" fill="#EF6F67" opacity="0.6" />
      <rect x="7%" y="83%" width="9" height="9" rx="1.5" fill="#5BA5ED" opacity="0.45" />
      <rect x="12%" y="76%" width="7" height="7" rx="1.5" fill="#ffffff" opacity="0.7" />

      {/* Bottom-right cascade */}
      <rect x="94%" y="90%" width="12" height="12" rx="2" fill="#5DBB63" opacity="0.55" />
      <rect x="88%" y="83%" width="10" height="10" rx="2" fill="#5DBB63" opacity="0.45" />
      <rect x="82%" y="76%" width="8" height="8" rx="1.5" fill="#D39D2E" opacity="0.35" />

      {/* Mid-edge accents */}
      <rect x="88%" y="45%" width="7" height="7" rx="1.5" fill="#2e2b29" opacity="0.2" />
      <rect x="4%" y="55%" width="6" height="6" rx="1.5" fill="#2e2b29" opacity="0.2" />
      <rect x="50%" y="90%" width="8" height="8" rx="1.5" fill="#ffffff" opacity="0.6" />

      {ambientSquares}
    </>
  )
}

function BandsSquares() {
  return (
    <>
      {/* Top band — y ≈ 5-10%, alternating sizes */}
      <rect x="3%" y="5%" width="9" height="9" rx="1.5" fill="#D39D2E" opacity="0.6" />
      <rect x="10%" y="8%" width="6" height="6" rx="1" fill="#5DBB63" opacity="0.4" />
      <rect x="18%" y="6%" width="8" height="8" rx="1.5" fill="#5DBB63" opacity="0.5" />
      <rect x="28%" y="9%" width="5" height="5" rx="1" fill="#5BA5ED" opacity="0.35" />
      <rect x="38%" y="6%" width="9" height="9" rx="1.5" fill="#EF6F67" opacity="0.5" />
      <rect x="48%" y="8%" width="6" height="6" rx="1" fill="#D39D2E" opacity="0.4" />
      <rect x="58%" y="5%" width="8" height="8" rx="1.5" fill="#5DBB63" opacity="0.55" />
      <rect x="68%" y="9%" width="5" height="5" rx="1" fill="#5DBB63" opacity="0.35" />
      <rect x="78%" y="6%" width="9" height="9" rx="1.5" fill="#5BA5ED" opacity="0.5" />
      <rect x="88%" y="8%" width="6" height="6" rx="1" fill="#EF6F67" opacity="0.4" />
      <rect x="95%" y="5%" width="8" height="8" rx="1.5" fill="#D39D2E" opacity="0.5" />

      {/* Mid accent — y ≈ 48-52%, very faint, sparse */}
      <rect x="85%" y="48%" width="5" height="5" rx="1" fill="#5DBB63" opacity="0.18" />
      <rect x="91%" y="50%" width="4" height="4" rx="1" fill="#D39D2E" opacity="0.15" />
      <rect x="3%" y="50%" width="5" height="5" rx="1" fill="#5BA5ED" opacity="0.18" />
      <rect x="9%" y="48%" width="4" height="4" rx="1" fill="#EF6F67" opacity="0.15" />

      {/* Bottom band — y ≈ 87-92%, alternating sizes */}
      <rect x="2%" y="89%" width="6" height="6" rx="1" fill="#5BA5ED" opacity="0.4" />
      <rect x="10%" y="87%" width="9" height="9" rx="1.5" fill="#EF6F67" opacity="0.5" />
      <rect x="20%" y="90%" width="5" height="5" rx="1" fill="#D39D2E" opacity="0.35" />
      <rect x="30%" y="87%" width="8" height="8" rx="1.5" fill="#5DBB63" opacity="0.5" />
      <rect x="40%" y="90%" width="6" height="6" rx="1" fill="#5DBB63" opacity="0.4" />
      <rect x="50%" y="88%" width="9" height="9" rx="1.5" fill="#ffffff" opacity="0.6" />
      <rect x="60%" y="90%" width="5" height="5" rx="1" fill="#D39D2E" opacity="0.35" />
      <rect x="70%" y="87%" width="8" height="8" rx="1.5" fill="#5BA5ED" opacity="0.5" />
      <rect x="80%" y="90%" width="6" height="6" rx="1" fill="#5DBB63" opacity="0.4" />
      <rect x="88%" y="88%" width="9" height="9" rx="1.5" fill="#EF6F67" opacity="0.5" />
      <rect x="96%" y="90%" width="5" height="5" rx="1" fill="#5DBB63" opacity="0.35" />

      {ambientSquares}
    </>
  )
}

function GridBorderSquares() {
  return (
    <>
      {/* Top edge */}
      <rect x="5%" y="6%" width="7" height="7" rx="1.5" fill="#D39D2E" opacity="0.55" />
      <rect x="25%" y="6%" width="7" height="7" rx="1.5" fill="#5DBB63" opacity="0.5" />
      <rect x="50%" y="6%" width="7" height="7" rx="1.5" fill="#5DBB63" opacity="0.5" />
      <rect x="75%" y="6%" width="7" height="7" rx="1.5" fill="#5BA5ED" opacity="0.55" />
      <rect x="95%" y="6%" width="7" height="7" rx="1.5" fill="#EF6F67" opacity="0.5" />

      {/* Right edge */}
      <rect x="96%" y="25%" width="7" height="7" rx="1.5" fill="#D39D2E" opacity="0.45" />
      <rect x="96%" y="50%" width="7" height="7" rx="1.5" fill="#5DBB63" opacity="0.5" />
      <rect x="96%" y="75%" width="7" height="7" rx="1.5" fill="#5DBB63" opacity="0.45" />

      {/* Bottom edge */}
      <rect x="5%" y="92%" width="7" height="7" rx="1.5" fill="#5BA5ED" opacity="0.5" />
      <rect x="25%" y="92%" width="7" height="7" rx="1.5" fill="#EF6F67" opacity="0.5" />
      <rect x="50%" y="92%" width="7" height="7" rx="1.5" fill="#D39D2E" opacity="0.55" />
      <rect x="75%" y="92%" width="7" height="7" rx="1.5" fill="#ffffff" opacity="0.7" />
      <rect x="95%" y="92%" width="7" height="7" rx="1.5" fill="#5DBB63" opacity="0.5" />

      {/* Left edge */}
      <rect x="3%" y="25%" width="7" height="7" rx="1.5" fill="#5DBB63" opacity="0.45" />
      <rect x="3%" y="50%" width="7" height="7" rx="1.5" fill="#2e2b29" opacity="0.2" />
      <rect x="3%" y="75%" width="7" height="7" rx="1.5" fill="#EF6F67" opacity="0.5" />

      {ambientSquares}
    </>
  )
}

function BandsEdgeSquares() {
  return (
    <>
      <rect x="8%" y="8%" width="6" height="6" rx="1" fill="#EF6F67" opacity="0.85" />
      <rect x="32%" y="8%" width="6" height="6" rx="1" fill="#5DBB63" opacity="0.85" />
      <rect x="56%" y="8%" width="6" height="6" rx="1" fill="#D39D2E" opacity="0.9" />
      <rect x="80%" y="8%" width="6" height="6" rx="1" fill="#5BA5ED" opacity="0.85" />
    </>
  )
}

const variantMap: Record<SquareVariant, () => React.JSX.Element> = {
  corners: CornersSquares,
  diagonals: DiagonalsSquares,
  bands: BandsSquares,
  'grid-border': GridBorderSquares,
  'bands-edge': BandsEdgeSquares,
}

export function HeroSquares({ variant }: { variant: SquareVariant }) {
  const Squares = variantMap[variant]
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
        <Squares />
      </svg>
    </div>
  )
}
