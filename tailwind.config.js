/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'IBM Plex Sans Arabic', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'IBM Plex Sans Arabic', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: {
          50: '#f6f6f5',
          100: '#e7e7e4',
          200: '#d1d1cb',
          300: '#b0b0a6',
          400: '#88887c',
          500: '#6d6d61',
          600: '#57574e',
          700: '#474741',
          800: '#2b2b27',
          900: '#1a1a17',
          950: '#0f0f0d',
        },
        brand: {
          50: '#f3f7f4',
          100: '#e0ebe3',
          200: '#c2d7c9',
          300: '#99bca5',
          400: '#6c9c7e',
          500: '#4b8061',
          600: '#39664c',
          700: '#2e523e',
          800: '#274233',
          900: '#21372b',
          950: '#101e17',
        },
        gold: {
          100: '#f8eed8',
          200: '#f0dcb0',
          300: '#e3c27f',
          400: '#d4a74f',
          500: '#c08f33',
          600: '#a0712a',
          700: '#7d5524',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,15,13,0.04), 0 8px 24px -12px rgba(15,15,13,0.12)',
        lift: '0 2px 4px rgba(15,15,13,0.05), 0 18px 40px -16px rgba(15,15,13,0.22)',
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.25rem', '3xl': '1.75rem' },
      keyframes: {
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'none' } },
        'slide-up': { '0%': { transform: 'translateY(100%)' }, '100%': { transform: 'none' } },
        pulseRing: { '0%': { boxShadow: '0 0 0 0 rgba(75,128,97,0.45)' }, '100%': { boxShadow: '0 0 0 14px rgba(75,128,97,0)' } },
      },
      animation: {
        'fade-up': 'fade-up .32s cubic-bezier(.22,.8,.3,1) both',
        'slide-up': 'slide-up .28s cubic-bezier(.22,.8,.3,1) both',
        'pulse-ring': 'pulseRing 1.6s ease-out infinite',
      },
    },
  },
  plugins: [],
};
