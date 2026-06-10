import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Stories from the Field — Faunterra Field Journal',
  description:
    'Field observations, conservation milestones, restoration journeys, and inspiring stories from the natural world. The Faunterra Field Journal.',
  openGraph: {
    title: 'Stories from the Field — Faunterra Field Journal',
    description: 'A living conservation journal documenting meaningful progress in nature, biodiversity, and restoration.',
    siteName: 'Faunterra',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Syne:wght@400;500;600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
