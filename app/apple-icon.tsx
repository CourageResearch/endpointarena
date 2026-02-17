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
          background: '#FAF5F0',
          borderRadius: 32,
        }}
      >
        <svg width="130" height="130" viewBox="0 0 24 24">
          <circle cx="5" cy="18" r="3.5" fill="#2D7CF6" />
          <circle cx="12" cy="11" r="3.5" fill="#C9A227" />
          <circle cx="19" cy="4" r="3.5" fill="#D4604A" />
        </svg>
      </div>
    ),
    {
      ...size,
    }
  )
}
