export const PUBLIC_NAV_ITEMS = [
  {
    href: '/',
    label: 'Home',
    activeTextClass: 'text-[#45934a]',
    activeUnderlineClass: 'bg-[#5DBB63]',
    hoverTextClass: 'group-hover:text-[#45934a] group-focus-visible:text-[#45934a]',
    hoverUnderlineClass: 'bg-[#5DBB63]/55',
  },
  {
    href: '/leaderboard',
    label: 'Leaderboard',
    activeTextClass: 'text-[#4a8cca]',
    activeUnderlineClass: 'bg-[#5BA5ED]',
    hoverTextClass: 'group-hover:text-[#4a8cca] group-focus-visible:text-[#4a8cca]',
    hoverUnderlineClass: 'bg-[#5BA5ED]/55',
  },
  {
    href: '/method',
    label: 'Methodology',
    activeTextClass: 'text-[#b8841f]',
    activeUnderlineClass: 'bg-[#D39D2E]',
    hoverTextClass: 'group-hover:text-[#b8841f] group-focus-visible:text-[#b8841f]',
    hoverUnderlineClass: 'bg-[#D39D2E]/55',
  },
] as const

export type PublicNavItem = (typeof PUBLIC_NAV_ITEMS)[number]
