import { ImageResponse } from 'next/og'

export const size = {
  width: 32,
  height: 32,
}
export const contentType = 'image/png'

export default function Icon() {
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
          borderRadius: 6,
        }}
      >
        {/* Three data points in ascending diagonal */}
        <svg width="24" height="24" viewBox="0 0 24 24">
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
