export default function MaintenancePage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        background:
          'radial-gradient(1200px 600px at 20% 0%, #1a3a3a 0%, #0b0f12 55%, #07090b 100%)',
        color: '#e8eef0',
        fontFamily: 'Georgia, "Times New Roman", serif',
      }}
    >
      <div style={{ maxWidth: 520, textAlign: 'center' }}>
        <p
          style={{
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            fontSize: 12,
            color: '#7eb8b0',
            marginBottom: 16,
            fontFamily: 'ui-monospace, monospace',
          }}
        >
          Flowbysk
        </p>
        <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', margin: '0 0 12px', fontWeight: 600 }}>
          Under maintenance
        </h1>
        <p style={{ margin: 0, lineHeight: 1.6, color: '#a8b4b8', fontSize: 17 }}>
          We&apos;re upgrading the studio. Please check back shortly.
        </p>
      </div>
    </main>
  );
}
