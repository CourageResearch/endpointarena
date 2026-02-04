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
          fontSize: 24,
          background: '#0a0a0a',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 6,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
            width: 28,
            height: 28,
            borderRadius: 6,
          }}
        >
          <span style={{ color: 'white', fontWeight: 'bold', fontSize: 18 }}>E</span>
        </div>
      </div>
    ),
    {
      ...size,
    }
  )
}
