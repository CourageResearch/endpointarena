import { ImageResponse } from 'next/og'

export const size = {
  width: 180,
  height: 180,
}
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
        }}
      >
        <svg width="168" height="168" viewBox="0 0 32 32" fill="none">
          <g transform="translate(1.5 5)">
            <rect x="0.8" y="7.8" width="6.4" height="6.4" rx="2" fill="#EF6F67" />
            <rect x="7.8" y="14.8" width="6.4" height="6.4" rx="2" fill="#5DBB63" />
            <rect x="14.8" y="7.8" width="6.4" height="6.4" rx="2" fill="#D39D2E" />
            <rect x="21.8" y="0.8" width="6.4" height="6.4" rx="2" fill="#5BA5ED" />
          </g>
        </svg>
      </div>
    ),
    {
      ...size,
    }
  )
}
