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
          fontSize: 24,
          background: '#0a0a0a',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 32,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
            width: 150,
            height: 150,
            borderRadius: 32,
          }}
        >
          <span style={{ color: 'white', fontWeight: 'bold', fontSize: 90 }}>E</span>
        </div>
      </div>
    ),
    {
      ...size,
    }
  )
}
